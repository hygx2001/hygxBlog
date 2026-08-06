/**
 * 把 Fusion Pixel 中文像素字体按 unicode-range 切片。手动执行：npm run fonts:build
 *
 * 为什么需要：源文件是单个 609 KB 的 woff2，没有 unicode-range，而它是全站 body 字体，
 * 于是每个页面都要先下完 609 KB 才能渲染正文。切片后浏览器只取当前页用到的那几块。
 *
 * 产物提交进仓库，CI 不跑本脚本 —— cn-font-split 是原生 FFI（koffi dlopen 一个 Rust
 * 动态库，postinstall 从 GitHub Releases 下载），让 CI 依赖它是这个仓库最容易挂的地方。
 * 源字体是 pin 死的 fontsource 版本，重新生成一年也就一次。
 *
 * 字形保真：切分由 Harfbuzz 完成，只复制字形轮廓，不重新渲染或 hint，像素点阵不会变。
 * 下面的覆盖率断言保证没有任何码位被丢掉（掉字会让正文回退到系统字体，像素风当场破功）。
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
const FONT_OUT_DIR = path.join(ROOT, 'public/fonts/fusion-pixel-12px-monospaced-sc');
const GENERATED_DIR = path.join(ROOT, 'src/styles/generated');
const CSS_OUT = path.join(GENERATED_DIR, 'fusion-pixel-12px-monospaced-sc.css');
const MANIFEST_OUT = path.join(GENERATED_DIR, 'fusion-pixel.manifest.json');
const PUBLIC_PREFIX = '/fonts/fusion-pixel-12px-monospaced-sc/';
const FAMILY = 'Fusion Pixel 12px Monospaced SC';

/** 分片目标大小。实测 70KB→49 片 / 300KB→24 片，总量几乎不变（1.28MB vs 1.18MB），
 *  所以取小的：粒度越细，单页命中的无用字形越少。 */
const OPTIONS = {
  targetType: 'woff2',
  chunkSize: 70 * 1024,
  languageAreas: true,
  reduceMins: true,
  css: {
    fontFamily: FAMILY, // 必须显式钉死：字体 name table 里写的是 "…Monospaced zh_hans"
    fontWeight: '400',
    fontStyle: 'normal',
    fontDisplay: 'swap',
  },
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ---------------- 源字体 cmap 解析（用于覆盖率断言） ---------------- */

/** 读 sfnt 的 cmap，返回所有码位。支持 format 4 / 6 / 12。 */
function readCodepoints(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = dv.getUint16(4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...buf.subarray(rec, rec + 4));
    if (tag === 'cmap') cmapOff = dv.getUint32(rec + 8);
  }
  if (cmapOff < 0) throw new Error('字体里找不到 cmap 表');

  // 选最合适的子表：优先 (3,10) UCS-4，其次 (3,1) BMP，再退 (0,x)
  const n = dv.getUint16(cmapOff + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < n; i++) {
    const rec = cmapOff + 4 + i * 8;
    const platform = dv.getUint16(rec);
    const encoding = dv.getUint16(rec + 2);
    const offset = dv.getUint32(rec + 4);
    const score =
      platform === 3 && encoding === 10 ? 4
      : platform === 0 && encoding >= 4 ? 3
      : platform === 3 && encoding === 1 ? 2
      : platform === 0 ? 1
      : 0;
    if (score > bestScore) { bestScore = score; best = cmapOff + offset; }
  }
  if (best < 0) throw new Error('cmap 里没有可用子表');

  const out = new Set();
  const format = dv.getUint16(best);
  if (format === 4) {
    const segX2 = dv.getUint16(best + 6);
    const endBase = best + 14;
    const startBase = endBase + segX2 + 2;
    const deltaBase = startBase + segX2;
    const rangeBase = deltaBase + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = dv.getUint16(endBase + s * 2);
      const start = dv.getUint16(startBase + s * 2);
      if (start === 0xffff) continue;
      const rangeOffset = dv.getUint16(rangeBase + s * 2);
      const delta = dv.getInt16(deltaBase + s * 2);
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let gid;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const gi = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 1 >= buf.byteLength) continue;
          gid = dv.getUint16(gi);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) out.add(c);
      }
    }
  } else if (format === 12) {
    const nGroups = dv.getUint32(best + 12);
    for (let g = 0; g < nGroups; g++) {
      const rec = best + 16 + g * 12;
      const start = dv.getUint32(rec);
      const end = dv.getUint32(rec + 4);
      for (let c = start; c <= end; c++) out.add(c);
    }
  } else if (format === 6) {
    const first = dv.getUint16(best + 6);
    const count = dv.getUint16(best + 8);
    for (let i = 0; i < count; i++) {
      if (dv.getUint16(best + 10 + i * 2) !== 0) out.add(first + i);
    }
  } else {
    throw new Error(`不支持的 cmap format ${format}`);
  }
  return out;
}

/** 解析 CSS 里的 `unicode-range: U+41, U+4E00-9FFF` -> Set<number> */
function parseUnicodeRanges(css) {
  const covered = new Set();
  for (const m of css.matchAll(/unicode-range:\s*([^;}]+)/gi)) {
    for (const token of m[1].split(',')) {
      const t = token.trim().replace(/^U\+/i, '');
      if (!t) continue;
      const [a, b] = t.split('-');
      const start = parseInt(a, 16);
      const end = b === undefined ? start : parseInt(b, 16);
      if (Number.isNaN(start) || Number.isNaN(end)) continue;
      for (let c = start; c <= end; c++) covered.add(c);
    }
  }
  return covered;
}

/* ---------------- 主流程 ---------------- */

function optionsSha() {
  return sha256(Buffer.from(JSON.stringify(OPTIONS)));
}

async function upToDate(sourceSha, toolVersion) {
  try {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_OUT, 'utf8'));
    if (
      manifest.sourceSha256 !== sourceSha ||
      manifest.toolVersion !== toolVersion ||
      manifest.optionsSha256 !== optionsSha()
    ) return false;
    await fs.access(CSS_OUT);
    for (const f of manifest.files) await fs.access(path.join(FONT_OUT_DIR, f.name));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const src = await fs.readFile(SOURCE);
  const sourceSha = sha256(src);
  const { version: toolVersion } = JSON.parse(
    await fs.readFile(path.join(ROOT, 'node_modules/cn-font-split/package.json'), 'utf8'),
  );

  if (!process.argv.includes('--force') && (await upToDate(sourceSha, toolVersion))) {
    console.log('[fonts] 产物已是最新（源字体 / 工具版本 / 选项均未变），跳过。加 --force 可强制重建。');
    return;
  }

  console.log(`[fonts] 源字体 ${(src.length / 1024).toFixed(0)} KB，开始切分…`);

  // cn-font-split v7 不接受 woff2 输入，先无损解回 sfnt
  const { decompress } = await import('wawoff2');
  const sfnt = Buffer.from(await decompress(src));
  const sourceCodepoints = readCodepoints(sfnt);
  console.log(`[fonts] 源字体覆盖 ${sourceCodepoints.size} 个码位`);

  // 输出到临时目录，全部断言通过后才落到仓库里，失败不破坏已提交产物。
  // 注意：不要用 fontSplit 的 outputFile 回调拦截写盘 —— 实测会挂死。
  const tmp = path.join(ROOT, 'node_modules/.cache/cn-font-split');
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });

  const { fontSplit } = await import('cn-font-split');
  await fontSplit({ input: new Uint8Array(sfnt), outDir: tmp, silent: true, ...OPTIONS });

  let css = await fs.readFile(path.join(tmp, 'result.css'), 'utf8');
  const chunkNames = (await fs.readdir(tmp)).filter((f) => f.endsWith('.woff2'));

  /* ---- 断言 ---- */
  const fail = (msg) => { throw new Error(msg); };

  if (!chunkNames.length) fail('没有生成任何 woff2 分片');
  if (!css.includes(`font-family:"${FAMILY}"`) && !css.includes(`font-family:'${FAMILY}'`)) {
    fail(`生成的 CSS 里 font-family 不是 "${FAMILY}"，global.css 的 --font-pixel 会失配`);
  }

  const referenced = new Set([...css.matchAll(/url\((['"]?)(?:\.\/)?([^'")]+?\.woff2)\1\)/g)].map((m) => path.basename(m[2])));
  for (const name of referenced) {
    if (!chunkNames.includes(name)) fail(`CSS 引用了不存在的分片 ${name}`);
  }
  for (const name of chunkNames) {
    if (!referenced.has(name)) fail(`分片 ${name} 没有被任何 @font-face 引用`);
  }

  // 覆盖率闸门：源字体的每个码位都必须落在某个 unicode-range 里，一个都不能少
  const declared = parseUnicodeRanges(css);
  const missing = [];
  for (const cp of sourceCodepoints) {
    if (!declared.has(cp)) {
      missing.push(cp);
      if (missing.length > 20) break;
    }
  }
  if (missing.length) {
    fail(
      `有 ${missing.length}+ 个码位没被任何分片覆盖，会掉字回退到系统字体：` +
        missing.slice(0, 10).map((c) => 'U+' + c.toString(16).toUpperCase()).join(', '),
    );
  }

  /* ---- 改写 CSS ---- */
  // 去掉 src: local(...)：本机若装了同名字体会顶掉像素字形。
  // localFamily: [] 这个选项实测无效，只能在这里剥。
  css = css.replace(/src:\s*local\([^)]*\)\s*,\s*/g, 'src:');
  if (/local\(/.test(css)) fail('local() 没有清干净');
  // url 指向 public/ 下的固定路径（Vite 对 public 内的 url() 原样输出，不会二次哈希）
  css = css.replace(
    /url\((['"]?)(?:\.\/)?([^'")]+?\.woff2)\1\)/g,
    (_, _q, name) => `url('${PUBLIC_PREFIX}${path.basename(name)}')`,
  );

  /* ---- 落盘 ---- */
  await fs.rm(FONT_OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(FONT_OUT_DIR, { recursive: true });
  await fs.mkdir(GENERATED_DIR, { recursive: true });

  const files = [];
  for (const name of chunkNames.sort()) {
    const data = await fs.readFile(path.join(tmp, name));
    await fs.writeFile(path.join(FONT_OUT_DIR, name), data);
    files.push({ name, bytes: data.length });
  }
  await fs.writeFile(CSS_OUT, css, 'utf8');

  // 预加载：只挑含 U+0041 的那一片。它是拉丁块，站点每个页面（logo、READ >>、日期）都用得到，
  // 不会触发 Chrome 的 "preloaded but not used"。CJK 分片按页而异，猜着预加载纯属浪费。
  const preload = [];
  for (const rule of css.match(/@font-face\{[^}]*\}/g) ?? []) {
    if (parseUnicodeRanges(rule).has(0x41)) {
      const url = rule.match(/url\('([^']+)'\)/)?.[1];
      if (url) preload.push(url);
    }
  }

  const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
  await fs.writeFile(
    MANIFEST_OUT,
    JSON.stringify(
      {
        family: FAMILY,
        sourceSha256: sourceSha,
        toolVersion,
        optionsSha256: optionsSha(),
        generatedAt: new Date().toISOString(),
        publicPrefix: PUBLIC_PREFIX,
        coverage: { codepoints: sourceCodepoints.size, chunks: files.length },
        preload,
        files,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  await fs.rm(tmp, { recursive: true, force: true });

  console.log(
    `[fonts] 完成：${files.length} 个分片，共 ${(totalBytes / 1024).toFixed(0)} KB，` +
      `覆盖 ${sourceCodepoints.size} 个码位（0 缺失）`,
  );
  console.log(`[fonts] 预加载分片：${preload.join(', ') || '（无）'}`);
  console.log('[fonts] 记得把 public/fonts/ 和 src/styles/generated/ 一起提交。');
}

main().catch((err) => {
  console.error(`\n[fonts] 生成失败，已提交的产物未被改动：\n  ${err.message}\n`);
  process.exit(1);
});
