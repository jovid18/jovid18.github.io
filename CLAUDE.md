# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

사이드 프로젝트를 만들며 만난 개념을 다시 찾아보고 정리해 남기는 기술 블로그.
**한국어가 원본이고 일본어가 번역본**이다 (일본어 작문 학습을 겸한다).
Astro + GitHub Pages. `main`에 push하면 GitHub Actions가 빌드·배포한다.

사이트: https://jovid18.github.io

## 분류 체계 — 이 리포의 핵심

축의 값은 **언제나 언어 중립 코드**로 저장하고, 표시명은 `src/i18n/taxonomy.ts`에서 언어별로 붙인다.
표시명을 그대로 저장하면 같은 분류가 「バックエンド」와 "백엔드"로 갈라져 인덱스가 반쪽씩 나뉜다.

| 축 | 개수 | frontmatter | 값 |
| --- | --- | --- | --- |
| 분야 | **정확히 1** | `domain` | `frontend` `backend` `mobile` `ml` `infra` `tooling` |
| 프로젝트 | 0~1 | `project` | `src/content/projects/<id>.md` 의 id |
| 스택 | 0~6 | `topics` | 자유 문자열 (소문자 케밥) |
| 유형 | 1 | `type` | `concept` `troubleshooting` `design` `memo` |

- **분야를 여러 개 붙이지 않는다.** 걸치는 주제(`auth` 등)는 분야가 아니라 `topics`로 간다.
- 새 분야가 필요하면 `src/i18n/taxonomy.ts`의 `DOMAINS`에 추가하고 두 언어 표시명을 함께 넣는다.
  추가를 명시적 행위로 남겨두는 것이 분류 규율이다 — 임의로 늘리지 않는다.
- 새 프로젝트는 `src/content/projects/<id>.md`를 먼저 만든다. **id는 리포명이 아니라
  프로젝트 정체성에서 딴다** (id가 URL에 박히므로 리포명이 바뀌어도 움직이지 않아야 한다).

잘못된 분류는 배포되지 않는다:
- `domain`·`type` 오타 → zod enum이 빌드를 세운다
- 없는 프로젝트 참조 → `src/lib/posts.ts`의 `assertProjectRefs`가 빌드를 세운다
  (Astro의 `reference()`는 메시지만 남기고 통과시키므로 직접 막는다)

## 글 파일 규약

```
src/content/blog/ko/<slug>.md   ← 원본 (한국어)
src/content/blog/ja/<slug>.md   ← 번역본 (일본어)
```

- **두 언어가 같은 slug를 쓴다.** 이것이 짝지음의 유일한 근거다 — 별도 필드를 두지 않는다.
- slug은 영문 소문자 케밥케이스. URL에 박히므로 발행 후 바꾸지 않는다.
- **번역본의 frontmatter에서 `title`·`description`만 번역한다.** `domain`·`project`·`topics`·`type`은
  코드값을 그대로 복사한다. 이걸 어기면 분류가 언어별로 갈라진다.
- `draft: true`인 글은 프로덕션 빌드에서 제외된다 (dev 서버에서는 보인다).

## URL 구조

```
/                        → 이전에 고른 언어로 이동 (없으면 ja)
/ja/... , /ko/...        → 두 언어 모두 접두사를 가진다
/ja/blog/<slug>/         ↔ /ko/blog/<slug>/
/ja/projects/<id>/       /ja/domains/<domain>/       /ja/topics/<topic>/
```

기본 언어를 루트에 두지 않는 이유: 그러면 `defaultLocale`을 바꾸는 순간 그 언어의 모든 글 URL이
이사한다. 접두사를 항상 붙여두면 바뀌는 건 `/`가 어디를 가리키는지 뿐이다.

`localePath()`가 만드는 경로는 **반드시 슬래시로 끝난다** — canonical과 hreflang이 한 글자라도
다르면 검색엔진이 같은 URL로 보지 않는다.

## 명령어

| | |
| --- | --- |
| `npm run dev` | 로컬 미리보기 (초안 포함) |
| `npm run build` | 프로덕션 빌드 — 분류 오류가 여기서 잡힌다 |
| `npm run i18n:status` | 번역 누락·뒤처짐 점검 |

## 워크플로우 (슬래시 커맨드)

| 커맨드 | 설명 |
| --- | --- |
| `/new-post` | 한국어 원본 글 생성 (분류 축 확정 + frontmatter 스캐폴딩) |
| `/translate-post <slug>` | ko 원본 → ja 번역본 생성 |
| `/proofread-post <slug>` | ja 번역본을 자연스러운 일본어로 교정 (staging diff로 제시) |
| `/translation-status` | ko를 고친 뒤 ja를 안 고친 글 찾기 |

전체 흐름:

```
1. /new-post          한국어로 원본 작성
2. /translate-post    일본어 번역본 생성
3. /proofread-post    교정 제안을 git diff로 검토 (작문 학습)
4. npm run build      분류·링크 검증
5. commit & push      → 자동 배포
```

## Conventions

- 코멘트·문서·커밋 메시지는 한국어. 일본어는 `「」`로 감싼 짧은 인용만.
- 한글 뜻·번역에 괄호 부가 설명을 넣지 않는다 (순수 번역만).
- 코드에 주석을 달 때는 "무엇"이 아니라 **"왜 이렇게 했는지"**를 남긴다.
