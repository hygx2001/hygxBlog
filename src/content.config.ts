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
    cover: z.string().optional(), // 可填 attachments 里的文件名，如 cover.png
  }),
});

export const collections = { blog };
