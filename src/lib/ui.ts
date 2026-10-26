import type { Lang } from "./taxonomy";

/** UI 문자열. 본문이 아닌 껍데기 텍스트만 여기 둔다. */
export const UI = {
  ja: {
    siteTitle: "jovid18",
    siteDescription:
      "サイドプロジェクトをつくる過程で出会った概念を、調べ直して書き残す場所。",
    nav: { posts: "記事", projects: "プロジェクト", domains: "分野", topics: "トピック" },
    latestPosts: "最新の記事",
    allPosts: "すべての記事",
    noPosts: "まだ記事がありません。",
    readMore: "続きを読む",
    publishedAt: "公開",
    updatedAt: "更新",
    postsIn: "の記事",
    relatedProject: "関連プロジェクト",
    repository: "リポジトリ",
    postCount: (n: number) => `${n} 件`,
    translationMissing: "この記事はまだ翻訳がありません",
    switchTo: (label: string) => `${label}で読む`,
    backToHome: "ホームへ",
  },
  ko: {
    siteTitle: "jovid18",
    siteDescription:
      "사이드 프로젝트를 만들며 만난 개념을 다시 찾아보고 정리해 남기는 곳.",
    nav: { posts: "글", projects: "프로젝트", domains: "분야", topics: "토픽" },
    latestPosts: "최근 글",
    allPosts: "전체 글",
    noPosts: "아직 글이 없습니다.",
    readMore: "더 읽기",
    publishedAt: "작성",
    updatedAt: "수정",
    postsIn: " 글",
    relatedProject: "관련 프로젝트",
    repository: "저장소",
    postCount: (n: number) => `${n}개`,
    translationMissing: "이 글은 아직 번역이 없습니다",
    switchTo: (label: string) => `${label}로 읽기`,
    backToHome: "홈으로",
  },
} as const;

export function t(lang: Lang) {
  return UI[lang];
}
