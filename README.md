# jovid18.github.io

사이드 프로젝트를 만들며 만난 개념을 다시 찾아보고 정리해 남기는 기술 블로그.

→ https://jovid18.github.io

## 구조

```
src/
├── content/
│   ├── blog/<slug>.md        글
│   └── projects/<id>.md      프로젝트 축
├── content.config.ts         분류 스키마 (zod) — 잘못된 분류는 빌드를 세운다
├── lib/taxonomy.ts           축의 코드값 + 표시명
└── pages/                    /blog/... , /projects/... , /domains/... , /topics/...
```

분류는 세 축이다. **분야**(정확히 하나) × **프로젝트**(0~1) × **스택**(0~6).
축의 값은 코드로 저장하고 표시명만 따로 붙인다 — 자세한 규칙은 [CLAUDE.md](./CLAUDE.md).

## 명령어

```bash
npm run dev           # 로컬 미리보기 (초안 포함)
npm run build         # 프로덕션 빌드 — 분류 오류가 여기서 잡힌다
```

`main`에 push하면 GitHub Actions가 빌드해서 GitHub Pages에 배포한다.
