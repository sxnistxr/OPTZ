// In-memory data for the demo: notes (changed by Server Actions) and counters (for ISR).
export interface Note {
  id: number;
  text: string;
}

const g = globalThis as { __store?: { notes: Note[]; version: number; renders: Record<string, number> } };
const s = (g.__store ??= { notes: [{ id: 1, text: "First note" }], version: 1, renders: {} });

export const listNotes = () => s.notes;
export function addNote(text: string): Note {
  const n = { id: s.notes.length + 1, text };
  s.notes.push(n);
  return n;
}
export const bumpVersion = () => ++s.version;
export const version = () => s.version;
/** How many times `key` was rendered (shows when ISR regenerated a page). */
export const rendered = (key: string) => (s.renders[key] = (s.renders[key] ?? 0) + 1);
