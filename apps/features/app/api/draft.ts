import { redirect, type ApiContext } from "optz";
import { draftMode } from "optz/server";

// /api/draft?secret=...&to=/draft turns draft mode on; /api/draft?off clears it.
export function GET({ url }: ApiContext) {
  if (url.searchParams.has("off")) {
    draftMode().disable();
    return redirect("/draft");
  }
  if (url.searchParams.get("secret") !== "dev-draft-secret") return new Response("bad secret", { status: 401 });
  draftMode().enable();
  return redirect(url.searchParams.get("to") ?? "/");
}
