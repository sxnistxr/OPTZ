"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { social, type Post } from "$lib/social";
import { PostItem } from "./PostItem";

/** Island: loads one post by the id in the URL. */
export default function PostView() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    setPost(null);
    setError("");
    social.post(id).then(
      (p) => {
        setPost(p);
        document.title = `${p.author}: ${p.body.slice(0, 50)}`;
      },
      (e: { status: number; message: string }) => setError(e.status === 404 ? "This post doesn't exist. It may have the wrong id." : e.message),
    );
  }, [id]);
  return (
    <ol className="mt-8 max-w-[40rem] divide-y divide-rule border-y border-rule">
      {post ? <PostItem post={post} /> : <li className="py-5 text-muted">{error || "Loading the post"}</li>}
    </ol>
  );
}
