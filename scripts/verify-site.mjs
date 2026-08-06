/**
 * 构建守卫：astro.config.mjs 的 site 还是占位符时中断构建。
 *
 * site 会进入 canonical / og:url / og:image / RSS 的每个 <link> / sitemap 的每条 <loc>，
 * 用 example.com 发布出去等于把规范链接指向别人的域名。这个错误发布后才发现的代价很高，
 * 所以宁可在这里红一次。
 *
 * 本地想构建产物看看时：ALLOW_PLACEHOLDER_SITE=1 npm run build
 * CI 不要设这个变量。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CONFIG_URL = new URL('../astro.config.mjs', import.meta.url);
const PLACEHOLDER_HOSTS = ['example.com', 'example.org', 'localhost'];

/** 优先加载配置读真实值；加载失败则退回正则扫文本 */
async function readSite() {
  try {
    const mod = await import(CONFIG_URL.href);
    return mod.default?.site;
  } catch {
    const raw = await readFile(CONFIG_URL, 'utf8');
    return raw.match(/\bsite\s*:\s*['"]([^'"]+)['"]/)?.[1];
  }
}

const site = await readSite();

if (!site) {
  console.error(`\n[verify-site] astro.config.mjs 没有配置 site。`);
  console.error(`  canonical / OG / RSS / sitemap 都依赖它，请先补上。\n`);
  process.exit(1);
}

let host;
try {
  host = new URL(site).hostname;
} catch {
  console.error(`\n[verify-site] site 不是合法 URL：${site}\n`);
  process.exit(1);
}

if (PLACEHOLDER_HOSTS.includes(host)) {
  if (process.env.ALLOW_PLACEHOLDER_SITE) {
    console.warn(`[verify-site] site 仍是占位符 ${site}，因 ALLOW_PLACEHOLDER_SITE 放行 —— 此产物不可发布。`);
  } else {
    const file = fileURLToPath(CONFIG_URL);
    console.error(`\n[verify-site] site 仍是占位符：${site}`);
    console.error(`  它会污染 canonical / og:url / og:image / RSS 链接 / sitemap 的每一条 URL。`);
    console.error(`  修改 ${file} 里的 site 为真实域名后再构建。`);
    console.error(`  只是本地看看产物：ALLOW_PLACEHOLDER_SITE=1 npm run build\n`);
    process.exit(1);
  }
}
