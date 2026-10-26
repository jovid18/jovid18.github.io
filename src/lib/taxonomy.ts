/**
 * 분류 체계의 단일 진실원.
 *
 * 축의 값은 코드로만 저장하고, 표시명은 여기서 붙인다.
 * 표시명을 그대로 저장하면 표기를 바꿀 때마다 모든 글의 frontmatter를 고쳐야 한다.
 */

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

export const DOMAIN_LABELS: Record<Domain, string> = {
  frontend: "프론트엔드",
  backend: "백엔드",
  mobile: "모바일",
  ml: "머신러닝",
  infra: "인프라",
  tooling: "개발 기반",
};

/** 글 유형 — 어떤 성격의 글인가. */
export const POST_TYPES = ["concept", "troubleshooting", "design", "memo"] as const;
export type PostType = (typeof POST_TYPES)[number];

export const POST_TYPE_LABELS: Record<PostType, string> = {
  concept: "개념",
  troubleshooting: "트러블슈팅",
  design: "설계",
  memo: "메모",
};

/** 프로젝트 상태 */
export const PROJECT_STATUSES = ["active", "learning", "paused", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "진행 중",
  learning: "연습용",
  paused: "중단",
  archived: "종료",
};
