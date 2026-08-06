const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let config = {};
let attachments = [];
let posts = [];
let currentId = null;

const LS = {
  get(k, d) { const v = localStorage.getItem('hygx-editor:' + k); return v === null ? d : v; },
  set(k, v) { localStorage.setItem('hygx-editor:' + k, v); },
};

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  return res.json();
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\w一-龥-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

async function init() {
  config = await api('/api/config');
  $('#blogdir').textContent = '博客：' + config.blogDir;
  restoreLayout();
  await loadAttachments();
  await loadPostList();
  bindPostEditor();
  bindEditorKeys();
  bindLayout();
  bindAttachModal();
  markClean();
}

/* ============================ 布局 ============================ */

function restoreLayout() {
  document.documentElement.style.setProperty('--sidebar-w', LS.get('sidebar-w', '240px'));
  const r = Number(LS.get('split', '0.5'));
  applySplit(r);
  if (LS.get('side-collapsed', '0') === '1') $('#view-post').classList.add('side-collapsed');
  if (LS.get('fm-open', '0') === '1') $('#fm-wrap').classList.add('is-open');
  setViewMode(LS.get('view-mode', 'split'), false);
  $('#sync-scroll').checked = LS.get('sync-scroll', '1') === '1';
}

function applySplit(r) {
  const c = Math.min(0.85, Math.max(0.15, r || 0.5));
  const root = document.documentElement.style;
  root.setProperty('--split-l', c + 'fr');
  root.setProperty('--split-r', (1 - c) + 'fr');
}

function setViewMode(mode, persist = true) {
  const panel = $('#split-panel');
  panel.classList.remove('mode-edit', 'mode-preview');
  if (mode !== 'split') panel.classList.add('mode-' + mode);
  $$('#view-modes .tool').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === mode));
  if (persist) LS.set('view-mode', mode);
  if (mode !== 'edit') renderPreview();
}

// 通用拖拽手柄：按下后跟随鼠标，双击复位
function bindGutter(el, onMove, onReset) {
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.classList.add('is-dragging');
    document.body.classList.add('is-resizing');
    const move = (ev) => onMove(ev);
    const up = () => {
      el.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      document.removeEventListener('mousemove', move);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up, { once: true });
  });
  el.addEventListener('dblclick', onReset);
}

function bindLayout() {
  bindGutter($('#gutter-side'), (ev) => {
    const left = $('#view-post').getBoundingClientRect().left;
    const w = Math.min(460, Math.max(160, ev.clientX - left));
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    LS.set('sidebar-w', w + 'px');
  }, () => {
    document.documentElement.style.setProperty('--sidebar-w', '240px');
    LS.set('sidebar-w', '240px');
  });

  bindGutter($('#gutter-split'), (ev) => {
    const rect = $('#split-panel').getBoundingClientRect();
    if (!rect.width) return;
    const r = (ev.clientX - rect.left) / rect.width;
    applySplit(r);
    LS.set('split', String(Math.min(0.85, Math.max(0.15, r))));
  }, () => { applySplit(0.5); LS.set('split', '0.5'); });

  $('#toggle-sidebar').addEventListener('click', toggleSidebar);

  $('#view-modes').addEventListener('click', (e) => {
    const btn = e.target.closest('.tool');
    if (btn) setViewMode(btn.dataset.mode);
  });

  $('#fm-toggle').addEventListener('click', () => {
    const open = $('#fm-wrap').classList.toggle('is-open');
    $('#fm-toggle').setAttribute('aria-expanded', String(open));
    LS.set('fm-open', open ? '1' : '0');
  });

  $('#sync-scroll').addEventListener('change', (e) => {
    LS.set('sync-scroll', e.target.checked ? '1' : '0');
    if (e.target.checked) syncScroll($('#f-body'), $('#preview'));
  });

  bindScrollSync();
}

function toggleSidebar() {
  const on = $('#view-post').classList.toggle('side-collapsed');
  LS.set('side-collapsed', on ? '1' : '0');
}

/* 编辑区 ↔ 预览区 按比例同步滚动 */
function scrollRatio(el) {
  const d = el.scrollHeight - el.clientHeight;
  return d > 0 ? el.scrollTop / d : 0;
}
function syncScroll(from, to) {
  const d = to.scrollHeight - to.clientHeight;
  to.scrollTop = Math.round(scrollRatio(from) * Math.max(d, 0));
}
function bindScrollSync() {
  const ta = $('#f-body'), pv = $('#preview');
  let lock = 0;
  const pair = (src, dst, tag) => src.addEventListener('scroll', () => {
    if (!$('#sync-scroll').checked || lock === (3 - tag)) return;
    lock = tag;
    syncScroll(src, dst);
    requestAnimationFrame(() => { lock = 0; });
  });
  pair(ta, pv, 1);
  pair(pv, ta, 2);
}

/* ============================ 附件 ============================ */

async function loadAttachments() {
  attachments = await api('/api/attachments');
  refreshCoverSelect();
  return attachments;
}
function refreshCoverSelect() {
  const sel = $('#f-cover');
  const val = sel.value;
  sel.innerHTML = '<option value="">无</option>' +
    attachments.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === val)) sel.value = val;
}

async function uploadFiles(files) {
  const fd = new FormData();
  [...files].forEach((f) => fd.append('file', f));
  const { files: names, error } = await api('/api/upload', { method: 'POST', body: fd });
  if (error) { toast('上传失败'); return []; }
  await loadAttachments();
  return names || [];
}

/* ============================ 文章列表 ============================ */

async function loadPostList() {
  posts = await api('/api/posts');
  renderPostList();
}

function renderPostList() {
  const q = $('#post-search').value.trim().toLowerCase();
  const list = q
    ? posts.filter((p) => (p.title + ' ' + p.id).toLowerCase().includes(q))
    : posts;
  $('#post-list').innerHTML = list.length
    ? list.map((p) => `
      <li data-id="${esc(p.id)}"${p.id === currentId ? ' class="is-active"' : ''}>
        ${p.pinned ? '<span class="pin">★</span>' : ''}${esc(p.title)}
        <span class="post-id">${esc(p.id)}</span>
      </li>`).join('')
    : '<li class="list-empty">没有匹配的文章</li>';
  $('#post-count').textContent = q
    ? `${list.length} / ${posts.length} 篇`
    : `${posts.length} 篇文章`;
}

/* ============================ 脏数据保护 ============================ */

const FIELDS = ['#f-title', '#f-filename', '#f-subdir', '#f-category', '#f-tags',
  '#f-pubdate', '#f-updated', '#f-cover', '#f-pinned', '#f-draft', '#f-desc', '#f-body'];

let savedSnapshot = '';

function snapshot() {
  return JSON.stringify(FIELDS.map((s) => {
    const el = $(s);
    return el.type === 'checkbox' ? el.checked : el.value;
  }));
}
function isDirty() { return $('#post-editor').hidden ? false : snapshot() !== savedSnapshot; }
function markClean() { savedSnapshot = snapshot(); updateDirty(); }
function updateDirty() { $('#dirty-dot').classList.toggle('is-on', isDirty()); }
function confirmDiscard() {
  return !isDirty() || confirm('当前文章有未保存的修改，确定放弃？');
}

/* ============================ 编辑器 ============================ */

async function openPost(id) {
  if (!confirmDiscard()) return;
  const { data, body, error } = await api('/api/post?id=' + encodeURIComponent(id));
  if (error) return toast('打开失败：' + error);
  currentId = id;
  $('#post-editor').hidden = false;
  $('#post-empty').hidden = true;
  $('#delete-post').hidden = false;
  $('#f-title').value = data.title || '';
  $('#f-filename').value = id.split('/').pop();
  $('#f-subdir').value = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
  $('#f-category').value = data.category || '';
  $('#f-tags').value = (data.tags || []).join(', ');
  $('#f-pubdate').value = data.pubDate ? String(data.pubDate).slice(0, 10) : '';
  $('#f-updated').value = data.updatedDate ? String(data.updatedDate).slice(0, 10) : '';
  $('#f-cover').value = data.cover || '';
  $('#f-pinned').checked = !!data.pinned;
  $('#f-draft').checked = !!data.draft;
  $('#f-desc').value = data.description || '';
  $('#f-body').value = body || '';
  $('#f-body').scrollTop = 0;
  $('#preview').scrollTop = 0;
  markClean();
  updateFmSummary();
  updateMeta();
  renderPreview();
  renderPostList();
}

function newPost() {
  if (!confirmDiscard()) return;
  currentId = null;
  $('#post-editor').hidden = false;
  $('#post-empty').hidden = true;
  $('#delete-post').hidden = true;
  $('#f-title').value = '';
  $('#f-filename').value = '';
  $('#f-subdir').value = '';
  $('#f-category').value = '';
  $('#f-tags').value = '';
  $('#f-pubdate').value = new Date().toISOString().slice(0, 10);
  $('#f-updated').value = '';
  $('#f-cover').value = '';
  $('#f-pinned').checked = false;
  $('#f-draft').checked = false;
  $('#f-desc').value = '';
  $('#f-body').value = '';
  // 新文章需要填文件名，自动展开信息面板
  $('#fm-wrap').classList.add('is-open');
  $('#f-title').focus();
  markClean();
  updateFmSummary();
  updateMeta();
  renderPreview();
  renderPostList();
}

function updateFmSummary() {
  const sub = $('#f-subdir').value.trim().replace(/^\/+|\/+$/g, '');
  const fn = $('#f-filename').value.trim() || '未命名';
  const tags = $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
  const bits = [
    (sub ? sub + '/' : '') + fn + '.md',
    $('#f-category').value.trim() || '未分类',
    $('#f-pubdate').value || '无日期',
  ];
  if (tags.length) bits.push(tags.length + ' 个标签');
  if ($('#f-pinned').checked) bits.push('置顶');
  if ($('#f-draft').checked) bits.push('草稿');
  $('#fm-summary').textContent = bits.join(' · ');
}

function updateMeta() {
  const ta = $('#f-body');
  const v = ta.value;
  const upto = v.slice(0, ta.selectionStart);
  const ln = upto.split('\n').length;
  const col = ta.selectionStart - (upto.lastIndexOf('\n') + 1) + 1;
  $('#edit-meta').textContent = `${v.length} 字 · ${v.split('\n').length} 行 · Ln ${ln}, Col ${col}`;
}

function bindPostEditor() {
  $('#new-post').addEventListener('click', newPost);
  $('#save-post').addEventListener('click', savePost);
  $('#delete-post').addEventListener('click', deletePost);

  $('#post-search').addEventListener('input', renderPostList);
  $('#post-list').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) openPost(li.dataset.id);
  });

  $('#f-title').addEventListener('input', (e) => {
    if (!currentId && !$('#f-filename').dataset.touched) {
      $('#f-filename').value = slugify(e.target.value);
    }
  });
  $('#f-filename').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });

  // 任一字段变动 → 更新未保存标记与摘要
  $('#post-editor').addEventListener('input', () => { updateDirty(); updateFmSummary(); });
  $('#post-editor').addEventListener('change', () => { updateDirty(); updateFmSummary(); });

  const ta = $('#f-body');
  ta.addEventListener('input', scheduleRender);
  ['click', 'keyup', 'select'].forEach((ev) => ta.addEventListener(ev, updateMeta));

  ta.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); await insertImages(files); }
  });
  ta.addEventListener('dragover', (e) => e.preventDefault());
  ta.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); await insertImages(files); }
  });

  // 工具条
  $('.md-tools').addEventListener('click', (e) => {
    const btn = e.target.closest('.tool[data-md]');
    if (btn) applyMd(btn.dataset.md);
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ---------- 文本编辑原语（走 execCommand 以保留原生撤销栈） ---------- */

function replaceRange(ta, start, end, text) {
  ta.focus();
  ta.setSelectionRange(start, end);
  let ok = false;
  if (text !== '') {
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  }
  if (!ok) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function wrapSelection(marker) {
  const ta = $('#f-body');
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const sel = v.slice(s, e);
  const n = marker.length;
  if (v.slice(s - n, s) === marker && v.slice(e, e + n) === marker) {
    replaceRange(ta, s - n, e + n, sel);
    ta.setSelectionRange(s - n, s - n + sel.length);
  } else {
    replaceRange(ta, s, e, marker + sel + marker);
    ta.setSelectionRange(s + n, s + n + sel.length);
  }
  scheduleRender();
}

// 取当前选区覆盖的完整行范围
function lineRange(ta) {
  const v = ta.value;
  const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let end = v.indexOf('\n', ta.selectionEnd);
  if (end === -1) end = v.length;
  return [start, end];
}

// 按行加/去前缀；rx 命中则视为已有前缀（再次点击即取消）
function togglePrefix(rx, make, { stripHeading = false } = {}) {
  const ta = $('#f-body');
  const [ls, le] = lineRange(ta);
  const lines = ta.value.slice(ls, le).split('\n');
  const all = lines.every((l) => rx.test(l));
  const out = lines.map((l, i) => {
    let base = l.replace(rx, '');
    if (!all && stripHeading) base = base.replace(/^#{1,6}\s+/, '');
    return all ? base : make(i) + base;
  }).join('\n');
  replaceRange(ta, ls, le, out);
  ta.setSelectionRange(ls, ls + out.length);
  scheduleRender();
}

function applyMd(kind) {
  const ta = $('#f-body');
  switch (kind) {
    case 'bold': return wrapSelection('**');
    case 'italic': return wrapSelection('*');
    case 'h2': return togglePrefix(/^##\s+/, () => '## ', { stripHeading: true });
    case 'h3': return togglePrefix(/^###\s+/, () => '### ', { stripHeading: true });
    case 'quote': return togglePrefix(/^>\s?/, () => '> ');
    case 'ul': return togglePrefix(/^[-*+]\s+/, () => '- ');
    case 'ol': return togglePrefix(/^\d+\.\s+/, (i) => `${i + 1}. `);
    case 'code': {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel.includes('\n')) {
        const [ls, le] = lineRange(ta);
        const block = ta.value.slice(ls, le);
        replaceRange(ta, ls, le, '```\n' + block + '\n```');
        ta.setSelectionRange(ls + 4, ls + 4 + block.length);
        return scheduleRender();
      }
      return wrapSelection('`');
    }
    case 'link': {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const sel = ta.value.slice(s, e);
      const text = `[${sel || '链接文字'}](url)`;
      replaceRange(ta, s, e, text);
      // 选中 url 占位符，方便直接粘贴
      ta.setSelectionRange(s + text.length - 4, s + text.length - 1);
      return scheduleRender();
    }
  }
}

let renderTimer;
function scheduleRender() {
  updateMeta();
  updateDirty();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 250);
}

/* ---------- 键盘 ---------- */

function bindEditorKeys() {
  const ta = $('#f-body');

  ta.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); return applyMd('bold'); }
      if (k === 'i') { e.preventDefault(); return applyMd('italic'); }
      if (k === 'k') { e.preventDefault(); return applyMd('link'); }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const hasSel = ta.selectionStart !== ta.selectionEnd;
      if (e.shiftKey || hasSel) {
        const [ls, le] = lineRange(ta);
        const lines = ta.value.slice(ls, le).split('\n');
        const out = lines
          .map((l) => (e.shiftKey ? l.replace(/^(\t| {1,2})/, '') : '  ' + l))
          .join('\n');
        replaceRange(ta, ls, le, out);
        ta.setSelectionRange(ls, ls + out.length);
      } else {
        replaceRange(ta, ta.selectionStart, ta.selectionEnd, '  ');
      }
      return scheduleRender();
    }

    // 回车续写列表：空条目则退出列表
    if (e.key === 'Enter' && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const m = v.slice(ls, s).match(/^(\s*)([-*+]|\d+\.)(\s+)(\[[ xX]\]\s+)?(.*)$/);
      if (!m) return;
      const [, indent, marker, gap, task, content] = m;
      e.preventDefault();
      if (!content.trim()) {
        replaceRange(ta, ls, s, '');            // 空条目 → 清掉标记
      } else {
        const next = /^\d+\.$/.test(marker)
          ? `${parseInt(marker, 10) + 1}.`
          : marker;
        replaceRange(ta, s, s, `\n${indent}${next}${gap}${task ? '[ ] ' : ''}`);
      }
      scheduleRender();
    }
  });

  // 全局快捷键
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!$('#post-editor').hidden) savePost();
      return;
    }
    if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
  });
}

/* ---------- 图片 / 预览 / 保存 ---------- */

async function insertImages(files) {
  toast(`上传中… ${files.length} 张`);
  const names = await uploadFiles(files);
  if (!names.length) return;
  const ta = $('#f-body');
  const insert = names.map((n) => `\n![[${n}]]\n`).join('');
  replaceRange(ta, ta.selectionStart, ta.selectionEnd, insert);
  scheduleRender();
  toast(`插入 ${names.length} 张图片`);
}

let renderSeq = 0;
async function renderPreview() {
  if ($('#split-panel').classList.contains('mode-edit')) return;
  const seq = ++renderSeq;
  const md = $('#f-body').value;
  const { html, error } = await api('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ md }),
  });
  if (seq !== renderSeq) return;               // 丢弃过期响应，避免预览闪回旧内容
  const pv = $('#preview');
  const keep = pv.scrollTop;
  pv.innerHTML = error ? '' : (html || '');
  pv.scrollTop = keep;                          // 重渲染不再把滚动条弹回顶部
  if ($('#sync-scroll').checked && document.activeElement === $('#f-body')) {
    syncScroll($('#f-body'), pv);
  }
}

async function savePost() {
  const filename = $('#f-filename').value.trim();
  if (!filename) {
    $('#fm-wrap').classList.add('is-open');
    $('#f-filename').focus();
    return toast('请先填写文件名');
  }
  const payload = {
    subdir: $('#f-subdir').value.trim(),
    filename,
    frontmatter: {
      title: $('#f-title').value.trim(),
      description: $('#f-desc').value.trim(),
      pubDate: $('#f-pubdate').value,
      updatedDate: $('#f-updated').value || undefined,
      category: $('#f-category').value.trim() || '未分类',
      tags: $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      draft: $('#f-draft').checked,
      pinned: $('#f-pinned').checked,
      cover: $('#f-cover').value || undefined,
    },
    body: $('#f-body').value,
  };
  const { id, error } = await api('/api/save-post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (error) return toast('保存失败：' + error);
  currentId = id;
  $('#delete-post').hidden = false;
  markClean();
  toast('已保存：' + id);
  await loadPostList();
}

async function deletePost() {
  if (!currentId) return;
  if (!confirm(`确定删除文章 ${currentId}？此操作不可撤销。`)) return;
  const { error } = await api('/api/post?id=' + encodeURIComponent(currentId), { method: 'DELETE' });
  if (error) return toast('删除失败：' + error);
  toast('已删除 ' + currentId);
  currentId = null;
  $('#post-editor').hidden = true;
  $('#post-empty').hidden = false;
  savedSnapshot = snapshot();
  await loadPostList();
}

/* ============================ 插入附件弹窗 ============================ */

function bindAttachModal() {
  $('#insert-attach').addEventListener('click', openAttachModal);

  $('#modal-close').addEventListener('click', closeAttachModal);
  $('#attach-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAttachModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#attach-modal').classList.contains('is-open')) closeAttachModal();
  });

  $('#attach-upload-input').addEventListener('change', async (e) => {
    const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    await uploadFiles(files);
    await loadAttachGrid();
    toast(`上传 ${files.length} 张图片`);
    e.target.value = '';
  });
}

function openAttachModal() {
  $('#attach-modal').classList.add('is-open');
  loadAttachGrid();
}

function closeAttachModal() {
  $('#attach-modal').classList.remove('is-open');
  if (!$('#post-editor').hidden) $('#f-body').focus();   // 关窗后焦点回到正文
}

async function loadAttachGrid() {
  await loadAttachments();
  const grid = $('#attach-grid');
  const count = $('#attach-count');
  if (!attachments.length) {
    count.textContent = '暂无附件';
    grid.innerHTML = '<div class="attach-empty">还没有图片附件，点击上方上传</div>';
    return;
  }
  count.textContent = `${attachments.length} 张`;
  grid.innerHTML = attachments.map((f) => `
    <div class="attach-item" data-file="${esc(f)}">
      <img src="/attachments/${encodeURIComponent(f)}" alt="${esc(f)}" loading="lazy" />
      <span class="attach-name" title="${esc(f)}">${esc(f)}</span>
      <div class="attach-actions">
        <button class="attach-insert" title="插入到正文">插入</button>
        <button class="attach-del" title="删除">删除</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.attach-insert').forEach((btn) => {
    btn.addEventListener('click', () => {
      const file = btn.closest('.attach-item').dataset.file;
      const ta = $('#f-body');
      closeAttachModal();
      replaceRange(ta, ta.selectionStart, ta.selectionEnd, `![[${file}]]`);
      scheduleRender();
      toast(`已插入 ${file}`);
    });
  });

  grid.querySelectorAll('.attach-del').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const file = btn.closest('.attach-item').dataset.file;
      if (!confirm(`确定删除 ${file}？`)) return;
      const { error } = await api('/api/attachment?file=' + encodeURIComponent(file), { method: 'DELETE' });
      if (error) return toast('删除失败：' + error);
      await loadAttachGrid();
      toast(`已删除 ${file}`);
    });
  });
}

init();
