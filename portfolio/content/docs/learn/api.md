# Add an API route

Serve a random book as JSON, then call it from an island with a client that knows its types.

## Write the route

Files in `app/api` answer under `/api`. Export a function named for each HTTP method you handle:

```ts title="app/api/books/random.ts"
import { json } from "optz";
import { books } from "$lib/books";

export const GET = () => json(books[Math.floor(Math.random() * books.length)]);
```

Try it:

```sh
curl http://127.0.0.1:3001/api/books/random
```

```json
{"slug":"the-pragmatic-programmer","title":"The Pragmatic Programmer","author":"Andrew Hunt and David Thomas","summary":"Habits that keep software easy to change."}
```

## Call it with types

`api()` from `optz` knows every route in your app and what each one returns:

```tsx title="app/components/RandomBook.island.tsx"
import { useState } from "react";
import { api } from "optz";

export default function RandomBook() {
  const [title, setTitle] = useState<string>();
  const pick = async () => {
    const book = await api("/api/books/random");
    setTitle(book.title);
  };
  return (
    <div className="mt-8">
      <button type="button" onClick={pick} className="rounded border px-3 py-1">Pick one for me</button>
      {title && <p className="mt-2">Try {title}.</p>}
    </div>
  );
}
```

Add `<RandomBook />` under the list in `app/routes/books/index.tsx` (import it from
`$components/RandomBook.island`) and press the button.

`book.title` is typed as a string because the route returns a `Book`. Ask for a route that
doesn't exist, like `api("/api/bookz")`, and `bun run check` fails, the same way a bad link did.

## Where to go from here

| you want to | use |
|---|---|
| Read a JSON body, typed for the caller too | `handler()` with `HandlerContext<Params, Body>` |
| Cache a response for everyone | `export const cache = { maxAge: 30, staleWhileRevalidate: 300 }` |
| Answer from memory, computed at build time | `export const prerender = true` |
| Route parameters | A file like `app/api/books/[slug].ts`, read with `params.slug` |

The [framework reference](../../../../framework/README.md#api-routes-appapi-typed-end-to-end)
covers each of these.

Next, build the app and put it on a server.
