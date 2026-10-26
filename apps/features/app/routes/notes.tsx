import type { PageProps } from "optz";
import { addNote, rename } from "$actions/notes";
import NoteForm from "$components/NoteForm.island";
import { listNotes, type Note } from "$lib/store";

export const config = { render: "dynamic" } as const;
export const loader = () => ({ notes: [...listNotes()] });

export default function Notes({ data }: PageProps<{ notes: Note[] }>) {
  return (
    <>
      <h1 className="text-2xl font-bold">Notes</h1>
      <ul data-testid="notes">
        {data.notes.map((n) => (
          <li key={n.id}>
            {n.text}
            {/* A bound action in a plain form: works without JavaScript. */}
            <form action={rename.bind(null, n.id)} className="inline">
              <input name="text" defaultValue={n.text} aria-label={`rename ${n.id}`} />
              <button>Rename</button>
            </form>
          </li>
        ))}
      </ul>
      {/* Server-rendered form posting to the action: no JavaScript needed. */}
      <form action={addNote} data-testid="plain-form">
        <input name="text" aria-label="plain note" />
        <button>Add (no JS)</button>
      </form>
      <NoteForm />
    </>
  );
}
