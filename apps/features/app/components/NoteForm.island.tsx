import { useState } from "react";
import { countNotes, createNote, remember } from "$actions/notes";

// An island calling Server Actions. Its counter survives the refresh after addNote revalidates.
export default function NoteForm() {
  const [clicks, setClicks] = useState(0);
  const [msg, setMsg] = useState("");
  return (
    <div className="mt-6">
      <form
        data-testid="island-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          try {
            const n = await createNote(new FormData(form));
            setMsg(`added #${n.id}`);
            form.reset();
          } catch (err) {
            setMsg((err as Error).message);
          }
        }}
      >
        <input name="text" aria-label="island note" />
        <button>Add (island)</button>
      </form>
      <button data-testid="clicks" onClick={() => setClicks(clicks + 1)}>
        clicked {clicks}
      </button>
      <button data-testid="count" onClick={async () => setMsg(`count ${await countNotes()}`)}>
        Count
      </button>
      <button data-testid="remember" onClick={async () => setMsg(await remember("ada"))}>
        Remember
      </button>
      <p data-testid="msg">{msg}</p>
    </div>
  );
}
