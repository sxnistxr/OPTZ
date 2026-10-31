import type { Head, PageProps } from "optz";
import { PostList } from "$components/PostList";
import { listPosts, type PostMeta } from "$lib/posts";
import site from "$lib/site";

export const loader = () => ({ posts: listPosts() });
export const head = (): Head => ({ canonical: "/blog", title: `Writing | ${site.name}`, description: "Development notes by sxnistxr on software, SQLite, systems, and building fast things on small machines." });

export default function Blog({ data }: PageProps<{ posts: PostMeta[] }, "/blog">) {
  return (
    <>
      <h1 className="page-heading">Writing</h1>
      <p className="page-description">Notes from building fast things on small machines.</p>
      <div className="page-list">
        <PostList posts={data.posts} />
      </div>
    </>
  );
}
