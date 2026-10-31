# Add interactivity

Add a star rating to each book. It's an island: the one part of the page that ships JavaScript.

## Write an island

Any component in a file ending in `.island.tsx` is an island. It renders to HTML on the server
like everything else, then hydrates in the browser so it can respond to clicks.

```tsx title="app/components/Rating.island.tsx"
import { useState } from "react";

export const hydrate = "visible";

export default function Rating({ title }: { title: string }) {
  const [stars, setStars] = useState(0);
  return (
    <div className="mt-8" role="group" aria-label={`Rate ${title}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-label={`${n} of 5`} aria-pressed={n <= stars} onClick={() => setStars(n)} className={n <= stars ? "text-amber-500" : "text-gray-300"}>
          ★
        </button>
      ))}
      <p className="text-sm text-gray-500">{stars ? `You rated it ${stars} of 5.` : "Not rated yet."}</p>
    </div>
  );
}
```

## Use it on the book page

```tsx title="app/routes/books/[slug].tsx"
import Rating from "$components/Rating.island";

// ...inside BookPage, after the summary:
<p className="mt-6">{book.summary}</p>
<Rating title={book.title} />
```

Open a book and pick a rating. The rest of the page is the same static HTML as before.

## What ships to the browser

```flow
title: One page, one island
Server | Whole page to HTML | Heading, summary, the rating's first render
Browser | Shows the HTML | Readable before any JavaScript runs
Browser* | Hydrates `Rating` | Only this component's code loads
```

View the page's source and you'll find the rating wrapped in
`<optz-island data-id="app/components/Rating.island.tsx">`. That element, and nothing else on
the page, is handed to React in the browser. A page with no islands ships no React at all.

## Choose when it wakes up

| `hydrate` | when the island's JavaScript runs |
|---|---|
| `"load"` (default) | As soon as the page loads |
| `"idle"` | When the browser has a free moment |
| `"visible"` | When the island scrolls into view |

> [!IMPORTANT]
> Island props travel inside the HTML as JSON. Pass strings, numbers, arrays and plain objects,
> not functions or class instances.

To make islands even smaller, set `client.runtime: "preact"` in `optz.config.ts`: the same React
code hydrates with Preact, about 4 KB instead of about 60 KB.

Next, take input from your visitors.
