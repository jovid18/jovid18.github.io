// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://jovid18.github.io",

  // 두 언어 모두 접두사를 붙인다 (/ja/..., /ko/...).
  // 기본 언어를 루트에 두면 defaultLocale을 바꾸는 순간 그 언어의 모든 글 URL이 이사한다.
  // 접두사를 항상 붙여두면 바뀌는 건 `/`가 어디를 가리키는지 뿐이다.
  i18n: {
    locales: ["ja", "ko"],
    defaultLocale: "ja",
    routing: {
      prefixDefaultLocale: true,
      // 루트 리다이렉트는 src/pages/index.astro에서 직접 처리한다
      // (방문자의 이전 선택을 localStorage에서 읽기 위해).
      redirectToDefaultLocale: false,
    },
  },

  integrations: [
    sitemap({
      // 루트(/)는 언어를 고르기 위한 리다이렉트 페이지다. sitemap에 넣으면
      // `/` 와 `/ja/` 가 같은 ja-JP를 중복 신고해서 hreflang 짝이 어그러진다.
      filter: (page) => page !== "https://jovid18.github.io/",
      i18n: {
        defaultLocale: "ja",
        locales: { ja: "ja-JP", ko: "ko-KR" },
      },
    }),
  ],

  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
});
