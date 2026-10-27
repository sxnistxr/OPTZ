import { handler, json, type HandlerContext } from "optz";

// POST JSON, get it back: malformed JSON is a 400 and other content types a 415, from handler().
export const POST = handler(async ({ body }: HandlerContext<{}, { text: string }>) => json({ text: (await body()).text }, { status: 201 }));
