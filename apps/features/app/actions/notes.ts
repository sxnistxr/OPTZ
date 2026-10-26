"use server";
// Server Actions: called from islands as plain async functions, or posted by forms with no JS.
import { ActionError, cookies, redirect, revalidatePath } from "optz/server";
import { addNote as add, listNotes } from "$lib/store";

/** Adds a note and returns it (for islands). */
export async function createNote(form: FormData) {
  const text = String(form.get("text") ?? "").trim();
  if (!text) throw new ActionError("Write something first.");
  if (text.length > 200) throw new ActionError("Notes are 200 characters at most.");
  const note = add(text);
  revalidatePath("/notes");
  return note;
}

/** The same, as a form action (form actions return nothing). */
export async function addNote(form: FormData): Promise<void> {
  await createNote(form);
}

export async function countNotes(): Promise<number> {
  return listNotes().length;
}

export async function rename(id: number, form: FormData) {
  const text = String(form.get("text") ?? "");
  const n = listNotes().find((x) => x.id === id);
  if (!n) throw new ActionError("No such note.");
  n.text = text;
  revalidatePath("/notes");
}

export async function remember(name: string) {
  cookies().set("name", name, { maxAge: 3600 });
  return `Saved ${name}`;
}

export async function goHome() {
  throw redirect("/");
}
