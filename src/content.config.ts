import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// 纯文本 Markdown 统一放在 src/content/blog/
// 图片统一放在 public/attachments/（Obsidian 附件目录风格，按文件名引用）
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.string().default('未分类'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    pinned: z.boolean().default(false), // 置顶：排在首页最前
    cover: z.string().optional(), // 可填 attachments 里的文件名，如 cover.png
  }),
});

// 照片墙：按「年-月」一个 md 文件（如 2026-07.md），集中放在 src/content/photos/
// 照片图片统一放在 public/attachments/，src 只写文件名
const photos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/photos' }),
  schema: z.object({
    year: z.number(),
    month: z.number().min(1).max(12),
    photos: z
      .array(
        z.object({
          src: z.string(), // attachments 里的文件名
          title: z.string(),
          note: z.string().default(''),
          date: z.coerce.date().optional(), // 拍摄日期，检视放大时显示
        }),
      )
      .default([]),
  }),
});

export const collections = { blog, photos };
