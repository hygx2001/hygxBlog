/**
 * Obsidian 风格图片支持：
 * 1. `![[图片.png]]` / `![[图片.png|300]]` / `![[图片.png|说明文字]]` 维基链接写法 -> /attachments/图片.png
 * 2. `![](图片.png)` / `![](./图片.png)` 相对路径写法 -> /attachments/图片.png
 * 图片只需按文件名存放在 public/attachments/ 下（可含子目录时用相对路径）。
 *
 * 管道后面的部分按 Obsidian 惯例处理：纯数字当宽度，其余当替代文字。
 */
import { getAttachmentSize } from '../utils/image-size.mjs';

const ATTACHMENTS_BASE = '/attachments/';

/**
 * 每次调用新建，不用模块级常量。
 * 带 /g 的正则会把 lastIndex 挂在自己身上，一旦某次遍历中途抛错或提前退出，
 * 残留的 lastIndex 会让「下一篇文档」从中间开始匹配，图片静默失效且不报错。
 */
const wikilinkRe = () => /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/** 按路径段编码，保留 `/`；`#` `?` 不编码会被当成 fragment/query 导致 404 */
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function toAttachmentUrl(raw) {
  const trimmed = raw.trim();
  // 文件名里出现落单的 % 会让 decodeURI 抛 URIError（中文输入法、截图工具很常见），
  // 此时按字面量处理即可，绝不能让它冒泡出去中断构建。
  let cleaned;
  try {
    cleaned = decodeURI(trimmed);
  } catch {
    cleaned = trimmed;
  }
  // 已是绝对路径 / 外链则不动
  if (/^(https?:)?\/\//.test(cleaned) || cleaned.startsWith('/')) return cleaned;
  // Obsidian 默认按文件名全局查找附件，这里保留相对写法里的中间目录
  return ATTACHMENTS_BASE + encodePath(cleaned.replace(/^(\.\/|\.\.\/)+/, ''));
}

/** 解析 `![[a.png|300]]` 管道后的部分：纯数字 -> 宽度，其余 -> alt */
function parsePipe(pipe) {
  if (pipe == null) return { alt: '', width: undefined };
  const text = pipe.trim();
  if (/^\d+$/.test(text)) return { alt: '', width: Number(text) };
  return { alt: text, width: undefined };
}

/** 递归遍历 mdast 树 */
function walk(node, parent, index, cb) {
  cb(node, parent, index);
  if (node.children) {
    for (let i = node.children.length - 1; i >= 0; i--) {
      walk(node.children[i], node, i, cb);
    }
  }
}

export function remarkObsidianImages() {
  return async (tree) => {
    /** 本次遍历产出的、指向本地附件的 image 节点，稍后统一补尺寸 */
    const localImages = [];

    walk(tree, null, -1, (node, parent, index) => {
      // 1. 文本中的 ![[xxx.png]] -> image 节点
      if (node.type === 'text' && parent) {
        const re = wikilinkRe();
        const parts = [];
        let last = 0;
        let m;
        while ((m = re.exec(node.value)) !== null) {
          if (m.index > last) parts.push({ type: 'text', value: node.value.slice(last, m.index) });
          const { alt, width } = parsePipe(m[2]);
          const image = {
            type: 'image',
            url: toAttachmentUrl(m[1]),
            // 用文件名当 alt 对读屏器是噪音（「1000-1000_voicebank」），
            // 没给说明文字就当装饰图处理。
            alt,
          };
          if (width) image.data = { hProperties: { width } };
          parts.push(image);
          if (image.url.startsWith(ATTACHMENTS_BASE)) localImages.push(image);
          last = m.index + m[0].length;
        }
        if (!parts.length) return;
        if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
        parent.children.splice(index, 1, ...parts);
      }
      // 2. 标准 markdown 图片的相对路径改写
      if (node.type === 'image' && node.url) {
        node.url = toAttachmentUrl(node.url);
        if (node.url.startsWith(ATTACHMENTS_BASE)) localImages.push(node);
      }
    });

    // 补固有尺寸 + 懒加载。正文图片是全站唯一没有被 CSS 锁定盒子的地方，
    // 不给 width/height 每张图解码时都会把下方内容顶一次。
    await Promise.all(
      localImages.map(async (node) => {
        const dims = await getAttachmentSize(node.url);
        const hProperties = { ...node.data?.hProperties };
        if (dims) {
          // 作者用 |300 显式指定过宽度时以他为准，高度按原始比例换算，避免变形
          if (hProperties.width) {
            hProperties.height = Math.round((hProperties.width / dims.width) * dims.height);
          } else {
            hProperties.width = dims.width;
            hProperties.height = dims.height;
          }
        }
        hProperties.loading = 'lazy';
        hProperties.decoding = 'async';
        node.data = { ...node.data, hProperties };
      }),
    );
  };
}
