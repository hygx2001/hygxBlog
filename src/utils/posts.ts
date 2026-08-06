import { getCollection, type CollectionEntry } from 'astro:content';

/** 归档列表每页文章数（/blog/ 与 /blog/page/N/ 共用） */
export const PAGE_SIZE = 10;

/**
 * 获取已发布文章：置顶优先，其余按日期倒序。
 * 开发模式下保留草稿，方便本地预览；构建产物里始终过滤掉。
 */
export async function getPublishedPosts(): Promise<CollectionEntry<'blog'>[]> {
  const posts = await getCollection('blog', ({ data }) => import.meta.env.DEV || !data.draft);
  return posts.sort((a, b) => {
    if (a.data.pinned !== b.data.pinned) return a.data.pinned ? -1 : 1;
    return b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
  });
}

/**
 * 纯按日期倒序，忽略置顶。
 * 时间轴、归档这类「按时间讲故事」的视图必须用这个：沿用置顶优先的顺序会让
 * 一篇 pinned 的旧文插到它所在年份的最前面，看起来就是排序坏了。
 */
export async function getPostsByDate(): Promise<CollectionEntry<'blog'>[]> {
  const posts = await getPublishedPosts();
  return [...posts].sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/** 估算阅读时长（分钟）：中文按 400 字/分，西文按 200 词/分 */
export function readingTime(body: string = ''): number {
  const cjk = (body.match(/[一-鿿]/g) || []).length;
  const words = (body.replace(/[一-鿿]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length;
  return Math.max(1, Math.ceil(cjk / 400 + words / 200));
}

/** 统计某个字段（category / tags）的文章数 */
export function countBy(posts: CollectionEntry<'blog'>[], pick: (p: CollectionEntry<'blog'>) => string[]) {
  const map = new Map<string, CollectionEntry<'blog'>[]>();
  for (const post of posts) {
    for (const key of pick(post)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(post);
    }
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}
