import type { Head, PageProps } from "optz";
import { PostList } from "$lib/components/PostList";
import { listPosts, type PostMeta } from "$lib/posts";
import site from "$lib/site";

export const loader = () => ({ posts: listPosts() });
export const head = (): Head => ({ title: `Writing | ${site.title}`, description: `Writing by ${site.name}.` });

export default function Blog({ data }: PageProps<{ posts: PostMeta[] }>) {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Writing</h1>
      <p className="mt-4 max-w-[36rem] text-muted">Notes from building fast things on small machines.</p>
      <div className="mt-12">
        <PostList posts={data.posts} />
      </div>
    </>
  );
}
