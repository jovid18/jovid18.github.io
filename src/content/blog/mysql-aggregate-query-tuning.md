---
title: "7분 걸리던 MySQL 집계 쿼리 줄이기: JSON_ARRAYAGG 분리와 TypeORM에서 옵티마이저 힌트 넣기"
description: "GROUP BY 집계 쿼리가 수 분씩 걸리던 원인 두 가지를 EXPLAIN으로 찾고, TypeORM이 막는 옵티마이저 힌트를 우회해 넣은 뒤 공유 stage에서 전후를 비교·검증한 기록."
publishedAt: 2026-11-12
domain: backend
type: troubleshooting
topics:
  - mysql
  - typeorm
  - query-optimization
draft: true
---

Node.js + TypeORM 0.3 + MySQL 8 환경에서 통계 API 하나가 문제였다. 수천만 행짜리 활동 기록 테이블을 "사용자 × 활동 타입"으로 GROUP BY 해서 점수 합계와 건수를 내는 API다. 수백 명을 3개월치로 조회하면 요청 하나가 3~7분 걸렸고, 그동안 reader 인스턴스 부하가 치솟았다. 1개월 조회도 평소 25초대였다.

쿼리는 대략 이런 모양이었다.

```sql
SELECT e.userId, e.type,
       SUM(e.score)          AS score,
       COUNT(*)              AS cnt,
       JSON_ARRAYAGG(e.rawId) AS rawIds
FROM events e
WHERE e.userId IN (...) AND e.type IN (...)
  AND e.createdAt BETWEEN ? AND ?
GROUP BY e.userId, e.type;
```

### 원인 1: JSON_ARRAYAGG가 filesort를 부른다

`EXPLAIN ANALYZE`를 떠 보니 정렬에만 약 47초가 들고 있었다. `(userId, type, createdAt)` 인덱스가 있으니 인덱스 순서대로 읽으면서 바로 그룹을 묶을 수 있어야 하는데, `JSON_ARRAYAGG`가 들어가자 GROUP BY가 정렬을 거치는 계획으로 바뀌었다. 이 컬럼을 빼고 다시 떠 보면 정렬 없이 인덱스를 읽으며 곧바로 그룹 집계를 한다.

그런데 이 ID 목록을 실제로 쓰는 곳을 찾아보니 활동 타입 하나뿐이었다. 나머지 타입은 목록을 만들어 놓고 버리고 있었다.

### 원인 2: 테이블 통계가 실제와 크게 어긋나 있었다

통계상 행 수는 약 1,300만인데 실제로는 약 3,500만이었다. 이 때문에 옵티마이저가 인덱스 range scan 대신 전체 읽기를 골랐다.

재미있는 건 반대 방향으로도 틀린다는 점이다. 범위를 좁힌 `COUNT`에서는 EXPLAIN 추정치가 실제의 약 2배로 나왔다. EXPLAIN의 `rows`는 방향조차 믿기 어렵다. 판단에 중요한 숫자라면 실제 `COUNT`로 확인하는 게 맞다.

### 해결 1: 집계와 목록을 나눈다

집계 쿼리에서 `JSON_ARRAYAGG`를 뺐다. 목록이 필요한 타입이 조회 대상에 있을 때만 `(userId, rawId)` 행을 별도 쿼리로 가져와 애플리케이션에서 사용자별로 묶는다. 두 쿼리는 `Promise.all`로 병렬 실행한다.

```ts
const [stats, rawRows] = await Promise.all([
  fetchStats(params),
  types.includes(LIST_TYPE) ? fetchRawIds(params) : Promise.resolve([]),
]);

const rawIdsByUser = new Map<number, number[]>();
for (const { userId, rawId } of rawRows) {
  const list = rawIdsByUser.get(userId) ?? [];
  list.push(rawId);
  rawIdsByUser.set(userId, list);
}
```

대가도 있다. 예전에는 건수와 ID 목록이 한 문장, 즉 한 스냅샷에서 나와서 항상 맞았다. 이제는 두 문장 사이에 행이 들어오면 잠깐 어긋날 수 있다. 화면 표시용이고 새로고침하면 맞춰지므로 감수했다. 꼭 맞아야 한다면 같은 커넥션에서 consistent snapshot 트랜잭션을 열고 두 쿼리를 실행하면 된다.

### 해결 2: 옵티마이저 힌트로 인덱스를 강제한다

통계가 틀린 상태에서 옵티마이저가 알아서 인덱스를 고르길 기대하기는 어려웠다. 그래서 MySQL 8의 옵티마이저 힌트를 붙였다.

```sql
SELECT /*+ INDEX(e IX_events_user_type_time) */ e.userId, ...
```

여기서 알아 둘 것이 몇 가지 있다.

- **힌트는 `SELECT` 키워드 바로 뒤에 있어야만 힌트다.** 다른 자리에 있으면 평범한 주석으로 버려지고 경고도 없다.
- 지정한 인덱스가 없는 환경(로컬 DB 등)에서는 경고만 나고 쿼리는 정상 실행된다.
- `INDEX()` 힌트는 MySQL 8.0.20부터 있고, 동작은 예전 `FORCE INDEX`와 같다.
- `USE INDEX`는 "고려하라" 정도의 권고다. 같은 조건에서 EXPLAIN을 떠 보니 range scan이 아니라 인덱스 전체 스캔이 나왔다. TypeORM의 `.useIndex()`가 바로 이 `USE INDEX`라서 이걸로는 해결되지 않았다.

### TypeORM에서 힌트 넣기

TypeORM QueryBuilder에는 옵티마이저 힌트를 넣는 API가 없다. 처음엔 select 문자열에 끼워 넣어 봤다.

```ts
qb.select("/*+ INDEX(e IX_events_user_type_time) */ SUM(e.score)", "score")
  .addSelect("e.userId", "userId");
```

이것도 안 된다. TypeORM은 SELECT 목록을 만들 때 `alias.column` 형태의 엔티티 컬럼 select를 맨 앞으로 옮긴다(`SelectQueryBuilder`의 `createSelectExpression` → `buildEscapedEntityColumnSelects`). 힌트가 컬럼 목록 중간으로 밀려나니, 앞에서 본 규칙대로 그냥 주석이 된다.

그럼 완성된 SQL 문자열을 받아서 고치면 되는데, TypeORM에는 값까지 채운 "최종 SQL"을 돌려주는 API도 없다. 사실 TypeORM 자신도 그런 SQL을 만들지 않는다. 실행할 때 `getQueryAndParameters()`로 `?` 자리표시가 들어간 SQL과 값 배열을 받아서 `queryRunner.query(sql, params)`로 드라이버에 넘기고, 값은 드라이버가 채운다. 참고로 `getSql()`도 같은 `?` SQL이고, `getQuery()`는 `:name` 자리표시가 남은 SQL이다.

그래서 TypeORM이 하는 일을 그대로 따라 하되, 중간에 한 줄만 끼웠다.

```ts
const HINT = "/*+ INDEX(e IX_events_user_type_time) */";

const [sql, params] = qb.getQueryAndParameters();
const hinted = sql.replace(/^SELECT /, `SELECT ${HINT} `);
if (hinted === sql) {
  // 치환이 안 되면 힌트가 소리 없이 빠지므로 여기서 막는다
  throw new Error("optimizer hint was not applied");
}
const rows = await manager.query(hinted, params);
```

TypeORM이 만드는 SELECT는 CTE나 comment가 없으면 항상 `"SELECT "`로 시작하므로 맨 앞만 바꾸면 된다. 값 배열은 그대로 넘기니 바인딩도 그대로고, 인젝션 걱정도 없다.

약점은 있다. 나중에 누가 `.comment()`를 붙이면 SQL이 `/* ... */ SELECT`로 시작해 정규식이 맞지 않는다. `.maxExecutionTime()`을 붙이면 TypeORM이 자기 힌트 블록을 먼저 넣는다. 위 코드에서 치환 전후가 같으면 예외를 던지는 건 이런 경우를 조용히 넘기지 않기 위해서다.

### 결과

같은 조건으로 prod reader에서 `EXPLAIN ANALYZE`를 떠 보니 집계 쿼리가 66.9초에서 약 7.6초로 줄었다. 계획은 `Index range scan` → `Group aggregate`이고 정렬이 없다.

### 전후 비교와 검증

고치는 것보다 "고쳐졌다"고 말하는 게 더 까다로웠다.

**기준선은 배포 전에 있어야 한다.** stage에서 배포한 뒤에만 재면 비교할 대상이 없다. 다행히 prod 접근 로그에는 요청 URL과 응답 시간이 남아 있었고, 배포 전 같은 조건의 응답 시간(3개월 196~421초, 1개월 약 26초)을 거기서 찾을 수 있었다. 이게 가장 좋은 기준선이었다.

**공유 stage에서 옛 코드를 다시 띄우는 법.** 통합 브랜치에 "해당 파일만 이전 구현으로 되돌리는 임시 커밋"을 올려 배포하고, 측정한 뒤 그 커밋을 revert해 원복했다. merge 커밋 자체를 revert하지 않은 건, 그러면 나중에 같은 브랜치를 다시 머지할 때 변경이 들어가지 않는 함정이 있어서다. 배포 완료는 컨테이너 레지스트리의 이미지 push 시각을 확인하고 `kubectl rollout status`로 기다렸다.

stage에서 수백 명 × 3개월로 잰 결과는 이랬다.

| | 옛 코드 | 새 코드 |
| --- | --- | --- |
| 3개월 | 두 번 모두 60초 게이트웨이 타임아웃 | 18.0초 / 11.0초 |
| 1개월 | 2.0~2.2초 | 1.5~1.7초 |

짧은 기간에서도 느려지지 않았다. 첫 호출과 두 번째 호출이 2배 가까이 차이 나서(캐시) 최소 두 번씩 쟀다.

**응답을 비교할 수 없을 때 결과가 같은지 확인하는 법.** 옛 코드는 타임아웃이라 응답끼리 비교할 수가 없었다. 그래서 DB에서 옛 쿼리와 같은 행 집합으로 사용자별 `COUNT(*)`와 `SUM(CRC32(rawId))`를 구했다.

```sql
SELECT userId, COUNT(*) AS cnt, SUM(CRC32(rawId)) AS checksum
FROM events
WHERE ...  -- 옛 쿼리와 같은 조건
GROUP BY userId;
```

새 API 응답에서는 브라우저 JS로 같은 CRC32 합을 계산해 사용자별로 대조했다. 수만 개 ID를 옮기지 않고도 두 집합이 같은지 싸게 확인할 수 있고, 합이라서 순서와 상관없으니 정렬할 필요도 없다. 목록이 있는 사용자 전원이 전 건 일치했다.

**stage 수치를 prod에 비례 대입하지 않는다.** 같은 3개월 범위가 stage는 약 157만 행, prod는 약 349만 행으로 2배 넘게 달랐다. stage가 증명하는 건 "옛 코드보다 빨라졌고 결과가 같다"까지다.

**지적이 맞아도 우선순위는 빈도로 정한다.** 리뷰에서 "이 쿼리는 목록을 안 쓰는 호출(CSV 다운로드)에서도 돈다"는 지적이 나왔다. 맞는 말이지만 로그에서 세어 보니 그 호출은 통계 조회의 0.05%(하루 약 5건 대 약 9,300건)였다. 게다가 그 낭비는 원래도 있던 것이고, 예전엔 모든 타입의 ID 목록을 만들었다가 버렸으니 오히려 줄어든 상태였다. 그래서 고치지 않았다.

### 정리

- 집계 쿼리에 붙은 `JSON_ARRAYAGG` 하나가 GROUP BY를 filesort로 바꿀 수 있다. 정말 필요한 곳에만 따로 뽑는다.
- EXPLAIN의 `rows`는 양쪽 방향으로 틀린다. 중요한 숫자는 실제 `COUNT`로 확인한다.
- 옵티마이저 힌트는 `SELECT` 바로 뒤에서만 동작하고, 틀린 자리에서는 소리 없이 무시된다.
- TypeORM에서는 `getQueryAndParameters()`로 받은 SQL의 맨 앞만 바꿔 `manager.query()`로 실행하면 바인딩을 유지한 채 힌트를 넣을 수 있다. 치환이 실패하면 예외를 던지게 해 둔다.
- 개선을 말하려면 배포 전 기준선과, 결과가 같다는 증거가 함께 있어야 한다.
