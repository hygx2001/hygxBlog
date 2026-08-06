// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import { remarkObsidianImages } from './src/plugins/remark-obsidian-images.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://blog.hygx.ren',
  integrations: [sitemap()],
  markdown: {
    // Astro 7 起通过 unified() 显式配置 remark 处理器
    processor: unified({
      remarkPlugins: [remarkObsidianImages],
    }),
    shikiConfig: {
      theme: 'github-dark-default',
    },
  },
});
