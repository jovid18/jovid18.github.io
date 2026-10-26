# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

사이드 프로젝트를 만들며 만난 개념을 다시 찾아보고 정리해 남기는 기술 블로그. 한국어로만 쓴다.
Astro + GitHub Pages. `main`에 push하면 GitHub Actions가 빌드·배포한다.

사이트: https://jovid18.github.io

## 분류 체계 — 이 리포의 핵심

축의 값은 **언제나 코드값**으로 저장하고, 표시명은 `src/lib/taxonomy.ts`에서 붙인다.
표시명을 그대로 저장하면 표기를 바꿀 때마다 모든 글의 frontmatter를 고쳐야 한다.

| 축 | 개수 | frontmatter | 값 |
| --- | --- | --- | --- |
| 분야 | **정확히 1** | `domain` | `frontend` `backend` `mobile` `ml` `infra` `tooling` |
| 프로젝트 | 0~1 | `project` | `src/content/projects/<id>.md` 의 id |
| 스택 | 0~6 | `topics` | 자유 문자열 (소문자 케밥) |
| 유형 | 1 | `type` | `concept` `troubleshooting` `design` `memo` |

- **분야를 여러 개 붙이지 않는다.** 걸치는 주제(`auth` 등)는 분야가 아니라 `topics`로 간다.
- 새 분야가 필요하면 `src/lib/taxonomy.ts`의 `DOMAINS`에 추가하고 표시명을 함께 넣는다.
  추가를 명시적 행위로 남겨두는 것이 분류 규율이다 — 임의로 늘리지 않는다.
- 새 프로젝트는 `src/content/projects/<id>.md`를 먼저 만든다. **id는 리포명이 아니라
  프로젝트 정체성에서 딴다** (id가 URL에 박히므로 리포명이 바뀌어도 움직이지 않아야 한다).

잘못된 분류는 배포되지 않는다:
- `domain`·`type` 오타 → zod enum이 빌드를 세운다
- 없는 프로젝트 참조 → `src/lib/posts.ts`의 `assertProjectRefs`가 빌드를 세운다
  (Astro의 `reference()`는 메시지만 남기고 통과시키므로 직접 막는다)

## 글 파일 규약

```
src/content/blog/<slug>.md
```

- slug은 영문 소문자 케밥케이스. URL에 박히므로 발행 후 바꾸지 않는다.
- `draft: true`인 글은 프로덕션 빌드에서 제외된다 (dev 서버에서는 보인다).

## URL 구조

```
/blog/<slug>/   /projects/<id>/   /domains/<domain>/   /topics/<topic>/
```

`sitePath()`가 만드는 경로는 **반드시 슬래시로 끝난다** — canonical과 링크가 한 글자라도
다르면 검색엔진이 같은 URL로 보지 않는다.

## 명령어

| | |
| --- | --- |
| `npm run dev` | 로컬 미리보기 (초안 포함) |
| `npm run build` | 프로덕션 빌드 — 분류 오류가 여기서 잡힌다 |

## 워크플로우

```
1. /new-post          글 생성 (분류 축 확정 + frontmatter 스캐폴딩)
2. npm run build      분류·링크 검증
3. commit & push      → 자동 배포
```

## Conventions

- 코멘트·문서·커밋 메시지는 한국어.
- 한글 뜻·번역에 괄호 부가 설명을 넣지 않는다 (순수 번역만).
- 코드에 주석을 달 때는 "무엇"이 아니라 **"왜 이렇게 했는지"**를 남긴다.
