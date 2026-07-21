---
title: 像 Obsidian 一样管理图片
description: 文字与图片分离存放，用维基链接引用附件。
pubDate: 2026-07-10
category: 教程
tags: [Obsidian, Markdown, 工作流]
cover: pixel-miku.png
---

这个博客采用和 Obsidian 一致的素材管理方式：

- **文字**：`src/content/blog/*.md`（纯文本，不夹杂图片）
- **图片**：`public/attachments/`（所有附件统一存放，按文件名引用）

## 两种写法都支持

维基链接写法（Obsidian 原生）：

```
![[pixel-miku.png]]
```

标准 Markdown 写法（相对文件名即可，无需完整路径）：

```
![](pixel-miku.png)
```

渲染效果（下面这张图就是存在 `public/attachments/` 里的附件）：

![[pixel-miku.png]]

构建时，`remark-obsidian-images` 插件会自动把文件名解析到 `/attachments/` 目录，
和 Obsidian 的「附件文件夹」行为一致——正文里只写文件名，图片搬家不用改文章。
