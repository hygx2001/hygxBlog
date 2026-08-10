import express from 'express';
import matter from 'gray-matter';
import multer from 'multer';
import open from 'open';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
// 直接复用同一仓库的 Obsidian 图片解析插件，保证预览与线上一致
import { remarkObsidianImages } from '../../src/plugins/remark-obsidian-images.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 博客项目根目录：Editor 现与 Blog 共用一个仓库，可用 BLOG_DIR 环境变量覆盖
const BLOG_DIR = process.env.BLOG_DIR
  ? path.resolve(process.env.BLOG_DIR)
  : path.resolve(__dirname, '../..');

const BLOG_POST_DIR = path.join(BLOG_DIR, 'src/content/blog');
const BLOG_PHOTO_DIR = path.join(BLOG_DIR, 'src/content/photos');
const BLOG_ATTACHMENTS = path.join(BLOG_DIR, 'public/attachments');

// 校验博客目录
if (!fs.existsSync(BLOG_POST_DIR)) {
  console.error(`[!] 未找到博客文章目录：${BLOG_POST_DIR}`);
  console.error('    请确认编辑器位于博客仓库的 hygx-editor/ 目录，或用 BLOG_DIR 环境变量指定博客路径。');
  process.exit(1);
}
fs.mkdirSync(BLOG_ATTACHMENTS, { recursive: true });
fs.mkdirSync(BLOG_PHOTO_DIR, { recursive: true });

// Markdown 渲染管线（与博客保持一致：GFM + Obsidian 图片 + 代码高亮）
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkObsidianImages)
  .use(remarkRehype)
  .use(rehypeHighlight, { ignoreMissing: true })
  .use(rehypeStringify);

const app = express();
const upload = multer({ storage: multer.diskStorage({
  destination: BLOG_ATTACHMENTS,
  filename: (_req, file, cb) => {
    // 保留原文件名（Obsidian 按名引用），重名则加后缀
    const safe = file.originalname.replace(/[^\w.\u4e00-\u9fa5-]/g, '_');
    let name = safe, i = 1;
    while (fs.existsSync(path.join(BLOG_ATTACHMENTS, name))) {
      const ext = path.extname(safe), base = path.basename(safe, ext);
      name = `${base}-${i++}${ext}`;
    }
    cb(null, name);
  },
}) });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));
// 让预览里的 /attachments/xxx 直接指向博客的附件目录
app.use('/attachments', express.static(BLOG_ATTACHMENTS));

function safeName(s) {
  // 单个文件名：取 basename，禁止目录分隔符与穿越
  return path.basename((s || '').trim()).replace(/\.md$/i, '');
}
function safeRel(s) {
  // 相对路径（允许子目录，如 cat1/hello）：去前导斜杠，禁 ..
  const p = (s || '').trim().replace(/^\/+/, '').replace(/\.md$/i, '');
  return p.includes('..') ? '' : p;
}
async function walkMd(dir) {
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walkMd(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// ---------- 配置 ----------
app.get('/api/config', (_req, res) => {
  res.json({ blogDir: BLOG_DIR, blogName: path.basename(BLOG_DIR) });
});

// ---------- 文章 ----------
app.get('/api/posts', async (_req, res) => {
  try {
    const files = await walkMd(BLOG_POST_DIR);
    const posts = await Promise.all(files.map(async (full) => {
      const rel = path.relative(BLOG_POST_DIR, full).replace(/\.md$/, '');
      const raw = await fsp.readFile(full, 'utf8');
      const { data } = matter(raw);
      return { id: rel, title: data.title ?? rel, pubDate: data.pubDate, category: data.category, pinned: !!data.pinned };
    }));
    posts.sort((a, b) => (b.pinned - a.pinned) || String(b.pubDate).localeCompare(String(a.pubDate)));
    res.json(posts);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/post', async (req, res) => {
  try {
    const id = safeRel(req.query.id);
    const full = path.join(BLOG_POST_DIR, id + '.md');
    const raw = await fsp.readFile(full, 'utf8');
    const { data, content } = matter(raw);
    res.json({ id, data, body: content });
  } catch (e) { res.status(404).json({ error: String(e) }); }
});

app.post('/api/save-post', async (req, res) => {
  try {
    const { subdir = '', filename, frontmatter = {}, body = '' } = req.body;
    const fn = safeName(filename);
    if (!fn) return res.status(400).json({ error: '文件名不能为空' });
    const dir = path.join(BLOG_POST_DIR, safeRel(subdir));
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, fn + '.md');
    const fm = {
      title: frontmatter.title || fn,
      description: frontmatter.description || '',
      pubDate: frontmatter.pubDate || new Date().toISOString().slice(0, 10),
      category: frontmatter.category || '未分类',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      draft: !!frontmatter.draft,
      pinned: !!frontmatter.pinned,
    };
    if (frontmatter.cover) fm.cover = frontmatter.cover;
    if (frontmatter.updatedDate) fm.updatedDate = frontmatter.updatedDate;
    const raw = matter.stringify(body, fm);
    await fsp.writeFile(full, raw, 'utf8');
    res.json({ id: path.relative(BLOG_POST_DIR, full).replace(/\.md$/, '') });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/post', async (req, res) => {
  try {
    const id = safeRel(req.query.id);
    await fsp.rm(path.join(BLOG_POST_DIR, id + '.md'));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ---------- 附件 ----------
app.get('/api/attachments', async (_req, res) => {
  try {
    const files = await fsp.readdir(BLOG_ATTACHMENTS);
    res.json(files.filter((f) => !f.startsWith('.')));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/upload', upload.array('file'), (req, res) => {
  res.json({ files: (req.files || []).map((f) => f.filename) });
});

app.delete('/api/attachment', async (req, res) => {
  try {
    const name = safeName(req.query.file);
    if (!name) return res.status(400).json({ error: '文件名不能为空' });
    const full = path.join(BLOG_ATTACHMENTS, name);
    if (fs.existsSync(full)) await fsp.unlink(full);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ---------- 渲染预览 ----------
app.post('/api/render', async (req, res) => {
  try {
    const md = req.body.md || '';
    const html = String(await processor.process(md));
    res.json({ html });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ---------- 照片墙 ----------
app.get('/api/photos', async (_req, res) => {
  try {
    const files = (await fsp.readdir(BLOG_PHOTO_DIR)).filter((f) => f.endsWith('.md'));
    const data = await Promise.all(files.map(async (f) => {
      const { data } = matter(await fsp.readFile(path.join(BLOG_PHOTO_DIR, f), 'utf8'));
      return { file: f.replace(/\.md$/, ''), year: data.year, month: data.month, count: (data.photos || []).length };
    }));
    data.sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month));
    res.json(data);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/photo', async (req, res) => {
  try {
    const file = safeName(req.query.file);
    const full = path.join(BLOG_PHOTO_DIR, file + '.md');
    const { data, content } = matter(await fsp.readFile(full, 'utf8'));
    res.json({ file, year: data.year, month: data.month, photos: data.photos || [], body: content });
  } catch (e) { res.status(404).json({ error: String(e) }); }
});

app.post('/api/save-photo', async (req, res) => {
  try {
    const { year, month, photos = [], body = '' } = req.body;
    const y = Number(year), m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: '请输入有效的年和月份（1–12）' });
    }
    if (!Array.isArray(photos)) return res.status(400).json({ error: '照片数据格式不正确' });
    const file = `${y}-${String(m).padStart(2, '0')}`;
    const fm = { year: y, month: m, photos };
    await fsp.mkdir(BLOG_PHOTO_DIR, { recursive: true });
    await fsp.writeFile(path.join(BLOG_PHOTO_DIR, file + '.md'), matter.stringify(body, fm), 'utf8');
    res.json({ file });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

const PORT = process.env.PORT || 7878;
app.listen(PORT, async () => {
  console.log(`\n  HYGX EDITOR`);
  console.log(`  博客目录: ${BLOG_DIR}`);
  console.log(`  编辑器:   http://localhost:${PORT}\n`);
  if (!process.env.NO_OPEN) {
    try { await open(`http://localhost:${PORT}`); } catch {}
  }
});
