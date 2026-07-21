/**
 * Obsidian 风格图片支持：
 * 1. `![[图片.png]]` / `![[图片.png|300]]` 维基链接写法 -> /attachments/图片.png
 * 2. `![](图片.png)` / `![](./图片.png)` 相对路径写法 -> /attachments/图片.png
 * 图片只需按文件名存放在 public/attachments/ 下（可含子目录时用相对路径）。
 */
const ATTACHMENTS_BASE = '/attachments/';
const WIKILINK_IMG_RE = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

function toAttachmentUrl(raw) {
  const cleaned = decodeURI(raw.trim());
  // 已是绝对路径 / 外链则不动
  if (/^(https?:)?\/\//.test(cleaned) || cleaned.startsWith('/')) return cleaned;
  // 取文件名部分（Obsidian 默认按文件名全局查找附件）
  return ATTACHMENTS_BASE + cleaned.replace(/^(\.\/|\.\.\/)+/, '');
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
  return (tree) => {
    walk(tree, null, -1, (node, parent, index) => {
      // 1. 文本中的 ![[xxx.png]] -> image 节点
      if (node.type === 'text' && WIKILINK_IMG_RE.test(node.value) && parent) {
        WIKILINK_IMG_RE.lastIndex = 0;
        const parts = [];
        let last = 0;
        let m;
        while ((m = WIKILINK_IMG_RE.exec(node.value)) !== null) {
          if (m.index > last) parts.push({ type: 'text', value: node.value.slice(last, m.index) });
          parts.push({
            type: 'image',
            url: toAttachmentUrl(m[1]),
            alt: m[1].split('/').pop().replace(/\.[^.]+$/, ''),
          });
          last = m.index + m[0].length;
        }
        if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
        parent.children.splice(index, 1, ...parts);
      }
      // 2. 标准 markdown 图片的相对路径改写
      if (node.type === 'image' && node.url) {
        node.url = toAttachmentUrl(node.url);
      }
    });
  };
}
