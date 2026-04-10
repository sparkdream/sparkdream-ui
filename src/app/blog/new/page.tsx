"use client";

import CreatePostForm from "@/components/CreatePostForm";

export default function NewPostPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-white">New Post</h1>
      <CreatePostForm />
    </div>
  );
}
