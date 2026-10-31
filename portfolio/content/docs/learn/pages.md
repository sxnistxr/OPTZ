# Pages and layouts

Add a page, link to it from the layout, and see how OPTZ checks your links while you type.

## Add a page

Create `app/routes/books/index.tsx`:

```tsx title="app/routes/books/index.tsx"
export const head = () => ({ title: "Books", description: "What I'm reading next." });

export default function Books() {
  return <h1 className="text-3xl font-semibold">Books</h1>;
}
```

Open [/books](http://127.0.0.1:3001/books). The file's place in `app/routes` gave it its URL, and
`head` set the page's title and description. An `index.tsx` answers for its folder, so
`books/index.tsx` is `/books`.

## Link to it

The layout in `app/routes/_layout.tsx` wraps every page. Add a link to the nav:

```tsx title="app/routes/_layout.tsx"
<nav className="mb-8 flex gap-4 text-sm">
  <Link href="/">Home</Link>
  <Link href="/books">Books</Link>
  <Link href="/about">About</Link>
  <Link href="/users/ada">Ada</Link>
  <Link href="/time">Server time</Link>
</nav>
```

`<Link>` renders a normal `<a>`. With JavaScript, OPTZ swaps the new page's HTML in place, and it
prefetches a page when you hover its link.

## Let the types catch a typo

Change the link to `/bookz`, then run:

```sh
bun run check
```

```text
app/routes/_layout.tsx(11,15): error TS2820: Type '"/bookz"' is not assignable to type 'Href'. Did you mean '"/books"'?
```

OPTZ generates a type with every route in your app, so a link to a page that doesn't exist fails
the check, and your editor underlines it as you type. Put `/books` back.

## How this page is served

This page is static, the default. It's rendered once when you build, and every visitor gets the
same prepared HTML from memory.

```flow
title: A static page, from build to visitor
Build | Render to HTML | Your component runs once
Build | Compress | `.br` and `.gz` copies, with an ETag
Request* | Memory lookup | No rendering per visit
```

Pages can also render in the browser (`render: "client"`) or for every request
(`render: "dynamic"`). You'll use a dynamic page in [Handle forms](actions.md).

Next, give the page some data.
