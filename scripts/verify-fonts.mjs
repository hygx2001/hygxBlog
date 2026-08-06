/**
 * 构建守卫：确认已提交的字体分片和当前 fontsource 源字体是配套的。
 *
 * 分片产物是提交进仓库的（CI 不跑 cn-font-split），所以升级 fontsource 之后
 * 如果忘了重新生成，构建会静默产出一套对不上的 @font-face —— 正文掉字回退到
 * 系统字体，像素风当场破功。这种事宁可红构建也不要静默降级。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = path.join(
  ROOT,
  'node_modules/@fontsource/fusion-pixel-12px-monospaced-sc/files/fusion-pixel-12px-monospaced-sc-latin-400-normal.woff2',
);
const MANIFEST = path.join(ROOT, 'src/styles/generated/fusion-pixel.manifest.json');
const CSS = path.join(ROOT, 'src/styles/generated/fusion-pixel-12px-monospaced-sc.css');
const FONT_DIR = path.join(ROOT, 'public/fonts/fusion-pixel-12px-monospaced-sc');

const HINT = '  跑 `npm run fonts:build` 重新生成并提交产物。\n';

function die(msg) {
  console.error(`\n[verify-fonts] ${msg}\n${HINT}`);
  process.exit(1);
}

const manifest = await fs.readFile(MANIFEST, 'utf8').then(JSON.parse).catch(() => null);
if (!manifest) die(`读不到 ${path.relative(ROOT, MANIFEST)}。`);

const src = await fs.readFile(SOURCE).catch(() => null);
if (!src) die(`读不到源字体 ${path.relative(ROOT, SOURCE)}，依赖没装全？`);

const sha = crypto.createHash('sha256').update(src).digest('hex');
if (sha !== manifest.sourceSha256) {
  die(
    `fontsource 源字体变了，分片产物已过期。\n` +
      `  manifest 记录 ${manifest.sourceSha256.slice(0, 12)}…，实际 ${sha.slice(0, 12)}…`,
  );
}

const css = await fs.readFile(CSS, 'utf8').catch(() => '');
if (!css.trim()) die(`${path.relative(ROOT, CSS)} 缺失或为空。`);

for (const file of manifest.files) {
  const stat = await fs.stat(path.join(FONT_DIR, file.name)).catch(() => null);
  if (!stat) die(`分片文件缺失：public/fonts/…/${file.name}`);
  if (stat.size !== file.bytes) {
    die(`分片 ${file.name} 大小不符（记录 ${file.bytes}，实际 ${stat.size}）。`);
  }
}

const names = new Set(manifest.files.map((f) => f.name));
for (const href of manifest.preload ?? []) {
  if (!names.has(path.basename(href))) die(`预加载指向了不存在的分片：${href}`);
}
