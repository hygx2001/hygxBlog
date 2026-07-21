import { getCollection, type CollectionEntry } from 'astro:content';

/** 获取已发布文章，按日期倒序 */
export async function getPublishedPosts(): Promise<CollectionEntry<'blog'>[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
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
