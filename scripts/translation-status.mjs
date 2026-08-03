/**
 * 번역 상태 점검. 의존성 없는 순수 Node.
 *
 * 한국어가 원본이고 일본어가 번역본이므로, ko를 고친 뒤 ja를 안 고치면 번역이 조용히 낡는다.
 * frontmatter에 해시를 박는 대신 git이 이미 아는 사실(마지막 커밋 시각)을 비교한다.
 *
 *   node scripts/translation-status.mjs
 *   node scripts/translation-status.mjs --strict   # 문제가 있으면 exit 1
 */
import { readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOG = join(ROOT, "src/content/blog");
const SOURCE = "ko";
const TARGET = "ja";

/** 파일을 마지막으로 건드린 커밋 시각(epoch). 커밋 이력이 없으면 null */
function lastCommitTime(relPath) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct", "--", relPath], {
      cwd: ROOT,
      encoding: "utf8",
      // 커밋이 하나도 없는 리포에서는 git이 stderr로 fatal을 뱉는다. 정상 상황이므로 삼킨다.
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? Number(out) * 1000 : null;
  } catch {
    return null;
  }
}

function slugs(lang) {
  const dir = join(BLOG, lang);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "커밋 없음");

const sourceSlugs = slugs(SOURCE);
const targetSlugs = new Set(slugs(TARGET));

const missing = [];
const stale = [];
const orphan = [];

for (const slug of sourceSlugs) {
  const srcRel = `src/content/blog/${SOURCE}/${slug}.md`;
  const tgtRel = `src/content/blog/${TARGET}/${slug}.md`;

  if (!targetSlugs.has(slug)) {
    missing.push({ slug });
    continue;
  }

  const srcTime = lastCommitTime(srcRel);
  const tgtTime = lastCommitTime(tgtRel);
  // 둘 중 하나라도 커밋 이력이 없으면(=아직 커밋 전) 비교가 의미 없다
  if (srcTime !== null && tgtTime !== null && srcTime > tgtTime) {
    stale.push({ slug, srcTime, tgtTime });
  }
}

for (const slug of targetSlugs) {
  if (!sourceSlugs.includes(slug)) orphan.push({ slug });
}

const lines = [];
if (missing.length) {
  lines.push(`\n📝 번역 없음 (${SOURCE}만 있음) — ${missing.length}건`);
  for (const m of missing) lines.push(`   ${m.slug}`);
}
if (stale.length) {
  lines.push(`\n⚠️  번역이 뒤처짐 (${SOURCE}를 고친 뒤 ${TARGET}를 안 고침) — ${stale.length}건`);
  for (const s of stale) {
    lines.push(`   ${s.slug}  ${SOURCE}:${fmt(s.srcTime)} > ${TARGET}:${fmt(s.tgtTime)}`);
  }
}
if (orphan.length) {
  lines.push(`\n❓ 원본 없음 (${TARGET}만 있음) — ${orphan.length}건`);
  for (const o of orphan) lines.push(`   ${o.slug}`);
}

if (lines.length === 0) {
  console.log(`✅ 번역 상태 정상 — ${SOURCE} ${sourceSlugs.length}건 모두 최신`);
} else {
  console.log(lines.join("\n"));
  if (process.argv.includes("--strict")) process.exit(1);
}
