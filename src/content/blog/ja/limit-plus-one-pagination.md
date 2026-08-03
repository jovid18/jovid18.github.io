---
title: 次のページがあるかを知るために、一件だけ多く取ってくる
description: 一覧 API で総件数を数えずに、limit + 1 件だけ取得して次のページの有無だけを判断する手法をまとめる。
publishedAt: 2026-08-04
domain: backend
project: tokyo-library-map
type: concept
topics:
  - pagination
  - django
  - postgresql
draft: false
---

ページネーション周りの機能を実装している途中で、ちょっとしたテクニックを知ったので書き残しておきます。

たとえば 20 件ずつで 3 ページ目だとして、次のページがあるかないかを判断するにはどうすればいいでしょうか。

いちばん簡単な方法は、総件数を一緒に返すことです。全部で 127 件あって 20 件ずつ返しているから 7 ページ、いまが 3 ページ目だから次がある、こういうレスポンスを返せば確認できます。ところが画面が無限スクロールなら、クライアントはもっとあるかないかだけをチェックすればいいので、総件数を知る必要はありません。

ここによく知られた小技があります。**必要な件数より一件だけ多く取ってくる**というものです。

## サーバー側で 20 件必要なら 21 件をリクエストする

20 件を見せるつもりなら、クエリには 21 件くれと書きます。そして返ってきた件数を見ます。

- 21 件返ってきた → 21 件目が存在する → **次のページがある。** 21 件目は捨てて 20 件だけレスポンスに載せる。
- 20 件以下だった → もうない → ここで終わり。

Django ORM で書くとこうなります。

```python
PAGE_SIZE = 20

def library_list(request):
    qs = Library.objects.order_by("-id")
    if cursor := request.query_params.get("cursor"):
        qs = qs.filter(id__lt=cursor)

    rows = list(qs[: PAGE_SIZE + 1])      # ← 一件多くリクエストする
    has_next = len(rows) > PAGE_SIZE      # ← 件数だけ見て判断する
    rows = rows[:PAGE_SIZE]               # ← はみ出した分はレスポンスから捨てる

    return Response({
        "results": serialize(rows),
        "has_next": has_next,
        "next_cursor": rows[-1].id if has_next else None,
    })
```

肝は三行です。一件多くリクエストし、件数で判断し、はみ出した分を捨てます。この余分な一件は **レスポンスには出ず、判断だけに使われて消えます。**

## COUNT を呼ぶやり方と何が違うのか

比較対象をはっきりさせるために Django が標準で用意している `Paginator` を見ると、総件数を正直に数えています。

```python
@cached_property
def count(self):
    """Return the total number of objects, across all pages."""
    c = getattr(self.object_list, "count", None)
    if callable(c) and not inspect.isbuiltin(c) and method_has_no_args(c):
        return c()
    return len(self.object_list)

@cached_property
def num_pages(self):
    hits = max(1, self.count - self.orphans)
    return ceil(hits / self.per_page)
```

`has_next()` は `self.number < self.paginator.num_pages` なので、**次のページがあるかを知るには総ページ数を知る必要があり、そのためには総件数を知る必要があります。** ここで `count()` が `SELECT COUNT(*)` として一発飛びます。DRF の `LimitOffsetPagination` も同じ系譜で、`paginate_queryset` がまず `self.count = self.get_count(queryset)` を呼びます。

その COUNT がどれだけ安いかは DB によります。PostgreSQL では安くありません。

理由は MVCC です。PostgreSQL は行をその場で書き換えるのではなく新しいバージョンを書くので、テーブルの中には複数のバージョンが混ざっていて、そのうちどれが見えるかは自分のトランザクションが持つ **スナップショット** によって決まります。だから「いまこのテーブルが何行なのか」に唯一の答えがありません。古いスナップショットを持つトランザクションは 100 行を見て、たったいま始まったトランザクションは 102 行を見ます。答えが一つでないならどこかに書いておくこともできないので、残る方法は行を一つずつ訪ねて「これは自分に見えるのか」を判定することだけです。[公式 Wiki](https://wiki.postgresql.org/wiki/Slow_Counting) の表現がそのままです — "PostgreSQL **must** walk through all rows to determine visibility. This normally results in a sequential scan reading information about every row in the table."

つまりこれは PostgreSQL が遅いのではなく、MVCC の代償です。MySQL もエンジンによって分かれます。

| エンジン | 条件なしの `COUNT(*)` | なぜ |
| --- | --- | --- |
| MyISAM | **O(1)** | 行数をメタデータとして持っている — トランザクションがないので答えが一つだ |
| InnoDB | O(n) | MVCC なのでスナップショットごとに答えが違う |
| PostgreSQL | O(n) | 同じ理由 |

つまり条件なしの COUNT はテーブルの大きさに比例して高くなります。一方 `LIMIT 21` は 21 行目を見つけた瞬間に止まります。**テーブルが百万行あっても 21 行しか見ません。** そもそも `LIMIT 20` でもソート済みの結果を順に取っている途中だったので、一行多く見るコストはほぼタダです。

| | COUNT で判断 | limit + 1 で判断 |
| --- | --- | --- |
| クエリ数 | 2 回（COUNT + 一覧） | **1 回** |
| スキャン範囲 | 条件に当たる全件 | リクエストした件数 + 1 行 |
| テーブルが大きくなると | 一緒に遅くなる | 変わらない |
| わかること | 総件数・総ページ数・現在位置 | **「次があるか」だけ** |

## DRF の実装

実際に DRF の `CursorPagination` のソースがこれを使っています。

```python
results = list(queryset[offset:offset + self.page_size + 1])
self.page = list(results[:self.page_size])

# Determine the position of the final item following the page.
if len(results) > len(self.page):
    has_following_position = True
    following_position = self._get_position_from_instance(results[-1], self.ordering)
else:
    has_following_position = False
    following_position = None
```

`page_size + 1` 件を取って `page_size` 件だけをページとし、件数の差で次のページの有無を決めています。さらにその余分な一行を **次のカーソルの材料** として使っています（`following_position`）。

## トレードオフ

**「3 / 17 ページ」を作れません。** 番号付きのページネーターや「全 127 件」の表示が必要な画面なら、総件数を数えるしか方法がありません。無限スクロールや「もっと見る」ボタンのように、次の一歩だけが必要な UI に合う手法です。

**追加の処理が必要。** 21 件をそのまま返すとページサイズが狂い、カーソルを 21 件目に取るとその項目が次のページでもう一度出てくるか、あるいは丸ごと飛ばされます。「一件多く取ってくる」と「一件多く見せる」は違います。

**ソートが安定していること。** これはカーソルページネーション全般の条件ですが、ここでもそのまま効いてきます。`created_at` のように値が重なりうるカラムだけでソートすると、同時刻の項目の順序がリクエストごとに揺れるので、「一件多く」で引いた境界が信用できなくなります。上の例で `id` でソートしたのはそのためで、実務では `("-created_at", "-id")` のように一意なカラムを最後のソートキーに足します。

## まとめ

「次のページがあるか」は「全部で何件か」の部分問題です。総件数を数えると必要よりずっと多くを知ることになるので、一件だけ多くリクエストして判断すれば足ります。
