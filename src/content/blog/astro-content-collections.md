---
title: Astro 内容集合速记
description: 用 Content Collections 组织博客文章的标准姿势。
pubDate: 2026-07-15
updatedDate: 2026-07-18
category: 前端
tags: [Astro, TypeScript]
---

Astro 5+ 的内容集合通过 `src/content.config.ts` 定义：

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
```

## 要点

| 概念 | 说明 |
| ---- | ---- |
| `glob` loader | 从任意目录加载 md 文件 |
| `zod` schema | frontmatter 类型校验，写错字段直接报错 |
| `getCollection` | 在页面里查询文章 |

frontmatter 有类型保护之后，分类、标签页做起来就非常顺手了。
