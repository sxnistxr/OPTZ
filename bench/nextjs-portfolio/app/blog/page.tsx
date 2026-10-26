import type { Metadata } from "next";
import { PostList } from "$components/PostList";
import { listPosts } from "$lib/posts";
import site from "$lib/site";

export const metadata: Metadata = { title: `Writing | ${site.title}`, description: `Writing by ${site.name}.` };

export default function Blog() {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Writing</h1>
      <p className="mt-4 max-w-[36rem] text-muted">Notes from building fast things on small machines.</p>
      <div className="mt-12">
        <PostList posts={listPosts()} />
      </div>
    </>
  );
}
