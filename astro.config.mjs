// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://jovid18.github.io",

  integrations: [sitemap()],

  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
});
