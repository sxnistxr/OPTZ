# Load data

Keep your books in one module, list them with a loader, and build a page for each book from a
dynamic route.

## Add the data

Create `app/lib/books.ts`. In a real app this could read Markdown files or a database; the
pages won't care where it comes from.

```ts title="app/lib/books.ts"
export interface Book {
  slug: string;
  title: string;
  author: string;
  summary: string;
}

export const books: Book[] = [
  { slug: "the-pragmatic-programmer", title: "The Pragmatic Programmer", author: "Andrew Hunt and David Thomas", summary: "Habits that keep software easy to change." },
  { slug: "designing-data-intensive-applications", title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", summary: "How databases, queues and streams really work." },
  { slug: "a-philosophy-of-software-design", title: "A Philosophy of Software Design", author: "John Ousterhout", summary: "Deep modules, and why complexity is the enemy." },
];

export const getBook = (slug: string) => books.find((book) => book.slug === slug);
```

## List the books

A `loader` returns the page's data. The page receives it as `data`, typed by `PageProps`.

```tsx title="app/routes/books/index.tsx"
import { Link, type PageProps } from "optz";
import { books, type Book } from "$lib/books";

export const head = () => ({ title: "Books", description: "What I'm reading next." });
export const loader = () => ({ books });

export default function Books({ data }: PageProps<{ books: Book[] }>) {
  return (
    <>
      <h1 className="text-3xl font-semibold">Books</h1>
      <ul className="mt-6 space-y-4">
        {data.books.map((book) => (
          <li key={book.slug}>
            <Link href={`/books/${book.slug}`} className="font-medium underline">{book.title}</Link>
            <p className="text-sm text-gray-500">{book.author}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
```

> [!TIP]
> Loaders run only on the server, at build time for static pages. Whatever they import, such as a
> database client or a file reader, never reaches the browser. Only the data they return does.

## Add a page for each book

Square brackets in a file name make a parameter. `paths` lists which pages to build, and the
loader receives each one's `params`:

```tsx title="app/routes/books/[slug].tsx"
import { Link, notFound, type LoaderContext, type PageProps } from "optz";
import { books, getBook, type Book } from "$lib/books";

export const paths = () => books.map((book) => ({ slug: book.slug }));
export const loader = ({ params }: LoaderContext<{ slug: string }>) => getBook(params.slug) ?? notFound();
export const head = (book: Book) => ({ title: book.title, description: book.summary });

export default function BookPage({ data: book }: PageProps<Book, "/books/[slug]">) {
  return (
    <article>
      <Link href="/books" className="text-sm underline">All books</Link>
      <h1 className="mt-4 text-3xl font-semibold">{book.title}</h1>
      <p className="mt-1 text-gray-500">{book.author}</p>
      <p className="mt-6">{book.summary}</p>
    </article>
  );
}
```

Click a book on [/books](http://127.0.0.1:3001/books). Then try
[/books/nope](http://127.0.0.1:3001/books/nope): `notFound()` sends your app's 404 page.
`head` gets the loader's data too, so each book's tab shows its title.

```files
title: One file, one page per book
app/routes/books/index.tsx -> /books
app/routes/books/[slug].tsx -> /books/the-pragmatic-programmer
app/routes/books/[slug].tsx -> /books/designing-data-intensive-applications
app/routes/books/[slug].tsx -> /books/a-philosophy-of-software-design
```

Both pages are still static. When you build, OPTZ calls `paths`, runs the loader for each book
and keeps every page ready in memory.

> [!NOTE]
> Content that changes after you deploy can refresh itself without a rebuild:
> `export const revalidate = 60` rebuilds a page in the background at most once a minute. See
> [incremental static regeneration](../../../../framework/README.md#incremental-static-regeneration).

Next, make part of the book page interactive.
