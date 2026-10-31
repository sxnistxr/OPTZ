# Handle forms

Add a suggestion form that calls server code directly. It works with JavaScript turned off.

## Keep the suggestions

For this chapter the suggestions live in memory, which is enough to see the whole flow:

```ts title="app/lib/suggestions.ts"
// Kept in memory: fine while you learn, gone when the server restarts.
export const suggestions: { title: string; at: string }[] = [];
```

## Write a Server Action

A module that starts with `"use server"` exports functions the browser can call. OPTZ gives each
one an endpoint and checks that form posts come from your own site.

```ts title="app/actions/suggest.ts"
"use server";
import { ActionError, revalidatePath } from "optz/server";
import { suggestions } from "$lib/suggestions";

export async function suggestBook(form: FormData): Promise<void> {
  const title = String(form.get("title") ?? "").trim();
  if (!title) throw new ActionError("Write a title first.");
  suggestions.unshift({ title, at: new Date().toISOString() });
  revalidatePath("/suggest");
}
```

`ActionError` messages reach the visitor. Any other error is reported as "Something went wrong" in
production, so internal details stay on the server.

## Add the page

This page shows data that changes between visits, so it renders for every request:

```tsx title="app/routes/suggest.tsx"
import type { PageProps } from "optz";
import { suggestBook } from "../actions/suggest";
import { suggestions } from "$lib/suggestions";

export const config = { render: "dynamic" } as const;
export const head = () => ({ title: "Suggest a book" });
export const loader = () => ({ suggestions: suggestions.slice(0, 10) });

export default function Suggest({ data }: PageProps<{ suggestions: { title: string; at: string }[] }>) {
  return (
    <>
      <h1 className="text-3xl font-semibold">Suggest a book</h1>
      <form action={suggestBook} className="mt-6 flex gap-2">
        <input name="title" required aria-label="Book title" className="rounded border px-3 py-1" />
        <button className="rounded border px-3 py-1">Suggest</button>
      </form>
      <ul className="mt-6 space-y-2">
        {data.suggestions.map((s) => <li key={s.at}>{s.title}</li>)}
      </ul>
    </>
  );
}
```

Add `<Link href="/suggest">Suggest</Link>` to the layout's nav, open
[/suggest](http://127.0.0.1:3001/suggest) and send a title. It appears in the list.

## Try it without JavaScript

Turn JavaScript off in your browser's developer tools and send another. It still works: the form
is a plain `POST`, and the browser comes back to the page.

```sequence
title: A form post without JavaScript
Browser -> Server: POST the form to the action's endpoint
Server -> Browser: 303, back to /suggest
Browser -> Server: GET /suggest
Server -> Browser: The page, rendered with the new list
```

The form behaves the same way with JavaScript on. An island can also import `suggestBook` and
call it like any async function: OPTZ sends that call with `fetch`, typed from the real code.

> [!WARNING]
> In-memory data disappears on every restart and isn't shared between servers. For data that
> lasts, use SQLite through `optz/sqlite`, shown in the [full-stack guide](../full-stack.md).

Next, expose your books as JSON.
