---
title: 다음 페이지가 있는지 알려고 한 개를 더 가져온다
description: 목록 API에서 총 개수를 세지 않고, limit + 1개를 긁어 다음 페이지가 있는지만 판단하는 기법을 정리한다.
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

페이지네이션과 관련된 기능을 개발하던 중 사소한 테크닉을 알게 되어서 글을 작성하게 되었습니다.

예를 들어 20개씩 3페이지인데 다음 페이지가 있는지 없는지 판단하려면 어떻게 해야 할까요?

가장 간단한 방법은 총 개수를 같이 주는 것입니다. 전체가 127개고 20개씩 주고 있으니 7페이지, 지금이 3페이지니까 다음이 있다 이런 식으로 응답을 주면 확인할 수 있습니다. 그런데 화면이 무한 스크롤이라면 클라이언트는 더 있냐 없냐만 체크하면 되기 때문에 총 개수를 알 필요는 없습니다.

여기에 알려진 요령이 있습니다. **필요한 개수보다 한 개를 더 가져온다**는 것입니다.

## 서버단에서 20개가 필요하면 21개를 요청한다

20개를 보여줄 거라면 쿼리에는 21개를 달라고 씁니다. 그리고 돌아온 개수를 봅니다.

- 21개가 왔다 → 21번째가 존재한다 → **다음 페이지가 있다.** 21번째는 버리고 20개만 응답한다.
- 20개 이하가 왔다 → 더 없다 → 여기가 끝이다.

Django ORM으로 쓰면 이렇게 됩니다.

```python
PAGE_SIZE = 20

def library_list(request):
    qs = Library.objects.order_by("-id")
    if cursor := request.query_params.get("cursor"):
        qs = qs.filter(id__lt=cursor)

    rows = list(qs[: PAGE_SIZE + 1])      # ← 한 개 더 요청한다
    has_next = len(rows) > PAGE_SIZE      # ← 개수만 보고 판단한다
    rows = rows[:PAGE_SIZE]               # ← 초과분은 응답에서 버린다

    return Response({
        "results": serialize(rows),
        "has_next": has_next,
        "next_cursor": rows[-1].id if has_next else None,
    })
```

핵심은 세 줄입니다. 한 개 더 요청하고, 개수로 판단하고, 초과분을 버립니다. 이 여분의 한 개는 **응답에 나가지 않고 판단에만 쓰이고 사라집니다.**

## COUNT를 부르는 쪽과 무엇이 다른가

비교 대상을 분명히 하기 위해 Django가 기본으로 주는 `Paginator`를 보면, 총 개수를 정직하게 셉니다.

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

`has_next()`는 `self.number < self.paginator.num_pages`이므로, **다음 페이지가 있는지 알기 위해 총 페이지 수를 알아야 하고, 그러려면 총 개수를 알아야 합니다.** 여기서 `count()`가 `SELECT COUNT(*)` 한 방으로 나갑니다. DRF의 `LimitOffsetPagination`도 같은 계보로, `paginate_queryset`이 먼저 `self.count = self.get_count(queryset)`을 부릅니다.

그 COUNT가 얼마나 싼지는 DB에 달려 있습니다. PostgreSQL에서는 싸지 않습니다.

이유는 MVCC입니다. PostgreSQL은 행을 제자리에서 고치지 않고 새 버전을 쓰기 때문에 테이블 안에는 여러 버전이 섞여 있고, 그중 무엇이 보이는지는 내 트랜잭션이 든 **스냅샷**에 달려 있습니다. 그래서 「지금 이 테이블이 몇 행이냐」에 단일한 답이 없습니다 — 오래된 스냅샷을 든 트랜잭션은 100행을 보고, 방금 시작한 트랜잭션은 102행을 봅니다. 답이 하나가 아니면 어딘가에 적어둘 수도 없으니, 남는 방법은 행을 하나씩 방문해 「이게 나한테 보이나」를 판정하는 것뿐입니다. [공식 위키](https://wiki.postgresql.org/wiki/Slow_Counting)의 표현이 그대로입니다 — "PostgreSQL **must** walk through all rows to determine visibility. This normally results in a sequential scan reading information about every row in the table."

그러니 이건 PostgreSQL이 느린 게 아니라 MVCC의 대가입니다. MySQL도 엔진에 따라 갈립니다.

| 엔진       | 조건 없는 `COUNT(*)` | 왜                                                           |
| ---------- | -------------------- | ------------------------------------------------------------ |
| MyISAM     | **O(1)**             | 행 수를 메타데이터로 들고 있다 — 트랜잭션이 없어 답이 하나다 |
| InnoDB     | O(n)                 | MVCC라서 스냅샷마다 답이 다르다                              |
| PostgreSQL | O(n)                 | 같은 이유                                                    |

즉 조건 없는 COUNT는 테이블 크기에 비례해서 비싸집니다. 반면 `LIMIT 21`은 21번째 행을 찾는 순간 멈춥니다. **테이블이 백만 행이어도 21행만 봅니다.** 그리고 어차피 `LIMIT 20`으로도 정렬된 결과를 순서대로 뽑던 중이었으니, 한 행을 더 보는 값은 거의 공짜입니다.

|                 | COUNT로 판단                   | limit + 1로 판단      |
| --------------- | ------------------------------ | --------------------- |
| 쿼리 수         | 2번 (COUNT + 목록)             | **1번**               |
| 스캔 범위       | 조건에 걸리는 전체             | 요청한 개수 + 1행     |
| 테이블이 커지면 | 같이 느려진다                  | 그대로다              |
| 알 수 있는 것   | 총 개수·총 페이지 수·현재 위치 | **「다음이 있나」뿐** |

## DRF의 구현

실제로 DRF의 `CursorPagination` 소스는 이것을 이용하고 있습니다.

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

`page_size + 1`개를 가져와 `page_size`개만 페이지로 삼고, 개수 차이로 다음 페이지 유무를 정합니다. 또한 그 여분의 행을 **다음 커서의 재료**로 사용하고 있습니다(`following_position`).

## 트레이드 오프

**「3 / 17 페이지」를 만들 수 없습니다.** 번호가 붙은 페이지네이터나 「전체 127건」 표시가 필요한 화면이라면 총 개수를 세는 것 말고 방법이 없습니다. 무한 스크롤·「더 보기」 버튼처럼 다음 한 걸음만 필요한 UI에 맞는 기법입니다.

**추가 처리가 필요.** 21개를 그대로 응답하면 페이지 크기가 어긋나고, 커서를 21번째로 잡으면 그 항목이 다음 페이지에서 다시 나오거나 아예 건너뛰어집니다. 「한 개 더 가져온다」와 「한 개 더 보여준다」는 다릅니다.

**정렬이 안정적이어야 함** 이건 커서 페이지네이션 전반의 조건이지만 여기서도 그대로 걸립니다. `created_at`처럼 값이 겹칠 수 있는 컬럼만으로 정렬하면 동시간대 항목의 순서가 요청마다 흔들려서, 「한 개 더」로 잡은 경계가 믿을 수 없게 됩니다. 위 예시에서 `id`로 정렬한 건 그래서고, 실무에서는 `("-created_at", "-id")`처럼 유일한 컬럼을 마지막 정렬 키로 붙입니다.

## 정리

「다음 페이지가 있나」는 「전부 몇 개인가」의 부분 문제로 총 개수를 세면 필요보다 훨씬 많이 알아내게 되므로 1개 더만 요청해서 판단할 수 있다.
