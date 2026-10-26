/** UI 문자열. 본문이 아닌 껍데기 텍스트만 여기 둔다. */
export const UI = {
  siteTitle: "jovid18",
  siteDescription: "사이드 프로젝트를 만들며 만난 개념을 다시 찾아보고 정리해 남기는 곳.",
  nav: { posts: "글", projects: "프로젝트", domains: "분야", topics: "토픽" },
  latestPosts: "최근 글",
  allPosts: "전체 글",
  noPosts: "아직 글이 없습니다.",
  publishedAt: "작성",
  updatedAt: "수정",
  repository: "저장소",
  postCount: (n: number) => `${n}개`,
} as const;
