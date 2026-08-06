/**
 * 读取 public/attachments/ 下图片的固有尺寸，供 <img> 输出 width/height。
 *
 * 为什么不走 astro:assets：附件目录是 hygx-editor 的上传目标，文章里以裸文件名
 * 引用（`cover: x.png`、`![[x.png]]`）。把图片挪进 src/ 会切断那条链路，
 * 所以这里保留 public/attachments/ 作为唯一事实来源，只在构建时补尺寸。
 *
 * 契约：永不抛错。缺失、损坏、格式不支持一律返回 null，让调用方退回今天的行为。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/** @typedef {{ width: number, height: number }} ImageDims */

/**
 * 附件目录必须按项目根解析，不能用 import.meta.url 往上找。
 * .astro 组件在构建时会被打包进 dist/，那时 import.meta.url 指向产物位置，
 * 相对路径会解析成 dist/public/attachments/ —— 结果是构建期每张图都读不到。
 * npm scripts 保证 cwd 是项目根；万一不是，再退回按本文件位置推。
 */
function resolveAttachmentsDir() {
  const fromCwd = path.resolve(process.cwd(), 'public/attachments');
  if (fs.existsSync(fromCwd)) return fromCwd + path.sep;
  const fromModule = fileURLToPath(new URL('../../public/attachments/', import.meta.url));
  if (fs.existsSync(fromModule)) return fromModule;
  console.warn(`[image-size] 找不到附件目录（试过 ${fromCwd}），所有图片都不会带 width/height`);
  return fromCwd + path.sep;
}

const ATTACHMENTS_DIR = resolveAttachmentsDir();

/** @type {Map<string, Promise<ImageDims | null>>} */
const cache = new Map();
/** @type {Set<string>} */
const warned = new Set();

function warnOnce(key, reason) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[image-size] 读不到尺寸：${key}（${reason}），该图将不带 width/height 输出`);
}

/** 把 `/attachments/a%20b.png`、`a b.png` 之类统一成磁盘上的相对路径 */
function toRelPath(fileName) {
  let rel = String(fileName).trim();
  if (rel.startsWith('/attachments/')) rel = rel.slice('/attachments/'.length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* 落单的 % 就按字面量处理 */
  }
  return rel;
}

/**
 * 固有尺寸（已按 EXIF 方向校正）。永不抛错。
 * 按文件名缓存 Promise 本身 —— 同一张封面会在首页 / 分类页 / 标签页重复渲染，
 * 缓存 Promise 才能让并发调用共用一次 sharp 读取。
 *
 * @param {string | undefined | null} fileName 裸文件名，或 `/attachments/...` 路径
 * @returns {Promise<ImageDims | null>}
 */
export function getAttachmentSize(fileName) {
  if (!fileName) return Promise.resolve(null);

  const rel = toRelPath(fileName);
  if (!rel || /^(https?:)?\/\//.test(rel) || rel.startsWith('data:')) {
    return Promise.resolve(null);
  }

  const cached = cache.get(rel);
  if (cached) return cached;

  const abs = path.resolve(ATTACHMENTS_DIR, rel);
  // 目录穿越守卫：正文是作者可控的，但 ![[../../etc/passwd]] 不该被喂给 sharp
  if (!abs.startsWith(ATTACHMENTS_DIR)) {
    warnOnce(rel, '越出 public/attachments/');
    const miss = Promise.resolve(null);
    cache.set(rel, miss);
    return miss;
  }

  const pending = sharp(abs)
    .metadata()
    .then((m) => {
      // autoOrient 是按 EXIF 旋转校正过的尺寸。手机竖拍照片的原始 width/height
      // 是反的，直接用会预留一个横向盒子再渲染成竖图，比不写 width/height 更糟。
      const width = m.autoOrient?.width ?? m.width;
      const height = m.autoOrient?.height ?? m.height;
      if (!width || !height) {
        warnOnce(rel, '无固有尺寸');
        return null;
      }
      return { width, height };
    })
    .catch((err) => {
      warnOnce(rel, err?.message ?? String(err));
      return null;
    });

  cache.set(rel, pending);
  return pending;
}

/**
 * 同上，但整形成可直接展开进 JSX / hProperties 的形状。
 * 读不到时返回 {}，标记退回今天的输出。
 *
 * @param {string | undefined | null} fileName
 * @returns {Promise<{ width?: number, height?: number }>}
 */
export async function getAttachmentSizeAttrs(fileName) {
  const dims = await getAttachmentSize(fileName);
  return dims ? { width: dims.width, height: dims.height } : {};
}
