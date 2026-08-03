import { getCollection, type CollectionEntry } from "astro:content";
import { LANGS, type Domain, type Lang } from "../i18n/taxonomy";

export type BlogEntry = CollectionEntry<"blog">;
export type ProjectEntry = CollectionEntry<"projects">;

/** id("ko/proto-codegen") → { lang, slug } */
export function parseId(id: string): { lang: Lang; slug: string } {
  const idx = id.indexOf("/");
  return { lang: id.slice(0, idx) as Lang, slug: id.slice(idx + 1) };
}

export type Post = BlogEntry & { lang: Lang; slug: string };

function decorate(entry: BlogEntry): Post {
  return { ...entry, ...parseId(entry.id) };
}

/**
 * 존재하지 않는 프로젝트를 참조하면 빌드를 세운다.
 *
 * Astro의 reference()는 참조가 깨졌을 때 메시지만 남기고 빌드를 통과시킨다.
 * 그러면 프로젝트 배지가 조용히 사라진 글이 배포되므로, 여기서 명시적으로 막는다.
 */
async function assertProjectRefs(posts: Post[]): Promise<void> {
  const known = new Set((await getCollection("projects")).map((p) => p.id));
  const broken = posts
    .filter((p) => p.data.project && !known.has(p.data.project.id))
    .map((p) => `  ${p.id}.md → project: ${p.data.project!.id}`);

  if (broken.length > 0) {
    throw new Error(
      `존재하지 않는 프로젝트를 참조하는 글이 있습니다:\n${broken.join("\n")}\n` +
        `사용 가능한 프로젝트: ${[...known].sort().join(", ")}\n` +
        `src/content/projects/ 에 파일을 만들거나 frontmatter의 project를 고치세요.`,
    );
  }
}

/** 발행된 글만. 초안은 프로덕션 빌드에서 제외된다 (dev에서는 보인다). */
export async function getPosts(lang?: Lang): Promise<Post[]> {
  const all = await getCollection("blog", ({ data }) =>
    import.meta.env.PROD ? !data.draft : true,
  );
  const posts = all.map(decorate);
  await assertProjectRefs(posts);

  return posts
    .filter((p) => (lang ? p.lang === lang : true))
    .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf());
}

/** 같은 slug로 존재하는 언어 목록 — 언어 전환 버튼의 활성/비활성을 결정한다. */
export async function getLangsForSlug(slug: string): Promise<Lang[]> {
  const all = await getPosts();
  const present = new Set(all.filter((p) => p.slug === slug).map((p) => p.lang));
  return LANGS.filter((l) => present.has(l));
}

/** 분야별 글 수 — 인덱스 페이지에서 빈 축을 숨기는 데 쓴다. */
export async function countByDomain(lang: Lang): Promise<Map<Domain, number>> {
  const posts = await getPosts(lang);
  const counts = new Map<Domain, number>();
  for (const p of posts) {
    counts.set(p.data.domain, (counts.get(p.data.domain) ?? 0) + 1);
  }
  return counts;
}

/** 스택 태그별 글 수 (많은 순) */
export async function countByTopic(lang: Lang): Promise<Array<[string, number]>> {
  const posts = await getPosts(lang);
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const topic of p.data.topics) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** 프로젝트별 글 수 */
export async function countByProject(lang: Lang): Promise<Map<string, number>> {
  const posts = await getPosts(lang);
  const counts = new Map<string, number>();
  for (const p of posts) {
    const id = p.data.project?.id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function formatDate(date: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * 로케일 접두사를 붙인 경로. 반드시 슬래시로 끝낸다 —
 * Astro가 디렉토리 index.html로 빌드하므로 canonical URL이 슬래시로 끝나고,
 * hreflang이 canonical과 한 글자라도 다르면 같은 URL로 인식되지 않는다.
 */
export function localePath(lang: Lang, path = ""): string {
  const clean = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return clean ? `/${lang}/${clean}/` : `/${lang}/`;
}
