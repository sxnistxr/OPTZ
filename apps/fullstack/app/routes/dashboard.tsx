import type { LoaderContext, PageProps } from "optz";
import { app, requireUser, type Note, type Attachment } from "$lib/app.server";
export const config = { render: "dynamic" } as const;
export const head = () => ({ title: "Your dashboard", robots: "noindex" });
export async function loader({ request }: LoaderContext) {
  const user = await requireUser(request!), db = app().db;
  return { user, notes: db.query<Note, [string]>("SELECT id,text,done FROM notes WHERE user_id=? ORDER BY rowid DESC").all(user.id), files: db.query<Attachment, [string]>("SELECT key,name,size FROM files WHERE user_id=? ORDER BY rowid DESC").all(user.id) };
}
export default function Dashboard({ data }: PageProps<Awaited<ReturnType<typeof loader>>>) {
  return <><h1>Your dashboard</h1><p>Signed in as {data.user.email}</p><form method="post" action="/api/auth/logout"><button>Sign out</button></form><h2>Private notes</h2><form method="post" action="/api/notes"><label>New note <textarea name="text" required maxLength={2000} /></label><button>Add note</button></form><ul>{data.notes.map(note => <li key={note.id}><span>{note.done ? "Done: " : ""}{note.text}</span><form method="post" action={`/api/notes/${note.id}`}><button name="operation" value="toggle">Toggle</button><button name="operation" value="delete">Delete</button></form></li>)}</ul><h2>Private attachments</h2><form method="post" action="/api/files" encType="multipart/form-data"><label>File (5 MB maximum)<input name="file" type="file" required accept="text/plain,image/png,image/jpeg,application/pdf" /></label><button>Upload</button></form><ul>{data.files.map(file => <li key={file.key}><a href={`/api/files/${file.key}`}>{file.name}</a> ({file.size} bytes)</li>)}</ul></>;
}
