/**
 * 분류 체계의 단일 진실원.
 *
 * 축의 값은 언어 중립 코드로만 저장하고, 표시명은 여기서 언어별로 붙인다.
 * 태그를 언어별 문자열로 저장하면 같은 분류가 두 갈래로 갈라져 인덱스가 반쪽씩 나뉜다.
 */

export const LANGS = ["ja", "ko"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = {
  ja: "日本語",
  ko: "한국어",
};

/** 분야 — 글이 "어디에" 속하는가. 정확히 하나. 새 값은 여기에 추가해야 빌드가 통과한다. */
export const DOMAINS = [
  "frontend",
  "backend",
  "mobile",
  "ml",
  "infra",
  "tooling",
] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<Lang, Record<Domain, string>> = {
  ja: {
    frontend: "フロントエンド",
    backend: "バックエンド",
    mobile: "モバイル",
    ml: "機械学習",
    infra: "インフラ",
    tooling: "開発基盤",
  },
  ko: {
    frontend: "프론트엔드",
    backend: "백엔드",
    mobile: "모바일",
    ml: "머신러닝",
    infra: "인프라",
    tooling: "개발 기반",
  },
};

/** 글 유형 — 어떤 성격의 글인가. */
export const POST_TYPES = ["concept", "troubleshooting", "design", "memo"] as const;
export type PostType = (typeof POST_TYPES)[number];

export const POST_TYPE_LABELS: Record<Lang, Record<PostType, string>> = {
  ja: {
    concept: "概念",
    troubleshooting: "トラブルシューティング",
    design: "設計",
    memo: "メモ",
  },
  ko: {
    concept: "개념",
    troubleshooting: "트러블슈팅",
    design: "설계",
    memo: "메모",
  },
};

/** 프로젝트 상태 */
export const PROJECT_STATUSES = ["active", "learning", "paused", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<Lang, Record<ProjectStatus, string>> = {
  ja: {
    active: "進行中",
    learning: "練習用",
    paused: "中断",
    archived: "終了",
  },
  ko: {
    active: "진행 중",
    learning: "연습용",
    paused: "중단",
    archived: "종료",
  },
};

export function isLang(value: string | undefined): value is Lang {
  return LANGS.includes(value as Lang);
}
