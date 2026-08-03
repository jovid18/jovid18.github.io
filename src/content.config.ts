import { defineCollection, reference, z } from "astro:content";
import { glob } from "astro/loaders";
import { DOMAINS, POST_TYPES, PROJECT_STATUSES } from "./i18n/taxonomy";

/**
 * 글은 언어별 디렉토리에 같은 slug로 짝지어 둔다.
 *   src/content/blog/ko/proto-codegen.md   ← 원본
 *   src/content/blog/ja/proto-codegen.md   ← 번역본
 * glob 로더가 만드는 id가 "ko/proto-codegen" 형태라 언어와 slug를 id에서 그대로 뽑는다.
 * 별도의 짝지음 필드를 두면 두 파일이 서로 어긋날 여지가 생긴다.
 */
const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),

    // 분야 — 정확히 하나. enum이라 오타나 새 값은 빌드 에러가 된다.
    domain: z.enum(DOMAINS),
    // 프로젝트 — 없는 프로젝트를 참조하면 빌드가 실패한다.
    project: reference("projects").optional(),
    // 스택 — 계속 늘어나는 게 정상이라 자유 문자열
    topics: z.array(z.string()).max(6).default([]),
    type: z.enum(POST_TYPES),

    draft: z.boolean().default(false),
  }),
});

/**
 * 프로젝트는 단순 문자열이 아니라 자체 메타데이터를 갖는 컬렉션이다.
 * id는 리포명이 아니라 프로젝트 정체성에서 딴다 — 리포명이 바뀌어도 URL이 안 움직인다.
 */
const projects = defineCollection({
  loader: glob({ base: "./src/content/projects", pattern: "**/*.md" }),
  schema: z.object({
    name: z.object({ ja: z.string(), ko: z.string() }),
    description: z.object({ ja: z.string(), ko: z.string() }),
    status: z.enum(PROJECT_STATUSES),
    repoUrl: z.string().url().optional(),
    startedAt: z.coerce.date().optional(),
    /** 프로젝트 목록 정렬용 (작은 값이 먼저) */
    order: z.number().default(100),
  }),
});

export const collections = { blog, projects };
