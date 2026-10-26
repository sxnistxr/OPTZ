import { handler, json, type HandlerContext } from "optz";
import { revalidatePath, revalidateTag } from "optz/server";

// What a CMS webhook would call after publishing: rebuild the pages that changed.
export const POST = handler(async ({ body }: HandlerContext<{}, { path?: string; tag?: string; secret: string }>) => {
  const b = await body();
  if (b.secret !== "dev-draft-secret") return json({ ok: false }, { status: 401 });
  if (b.path) revalidatePath(b.path);
  if (b.tag) revalidateTag(b.tag);
  return json({ ok: true });
});
