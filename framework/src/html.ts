import { Parser } from "htmlparser2";

/** Extract text nodes, without reparsing decoded text as markup. This returns text, not safe HTML. */
export function htmlText(html: string, decodeEntities = true): string {
  const text: string[] = [];
  const parser = new Parser({ ontext: (s) => text.push(s) }, { decodeEntities });
  parser.end(html);
  return text.join("");
}

const HIDDEN = new Set(["script", "style", "template", "noscript", "svg", "nav", "header", "footer", "aside", "form", "button"]);
const BLOCK = new Set(["p", "div", "section", "article", "ul", "ol", "li", "tr", "table", "blockquote", "figure", "dl", "dd", "dt"]);

/** Linear HTML parsing shared by MCP page resources and llms.txt. Output is Markdown-ish text. */
export function pageText(html: string): { title: string; description: string; text: string } {
  const all: string[] = [], body: string[] = [], main: string[] = [];
  const stack: Array<{ name: string; end: string }> = [];
  let title = "", description = "", titleDepth = 0, bodyDepth = 0, mainDepth = 0;
  let sawBody = false, sawMain = false, hidden = 0, pre = 0, anchor = 0;
  const emit = (s: string) => {
    all.push(s);
    if (bodyDepth) body.push(s);
    if (mainDepth) main.push(s);
  };
  const parser = new Parser({
    onopentag(name, attrs) {
      const frame = { name, end: "" };
      stack.push(frame);
      if (name === "title") titleDepth++;
      if (name === "meta" && attrs.name?.toLowerCase() === "description" && !description) description = attrs.content ?? "";
      if (name === "body") { bodyDepth++; sawBody = true; }
      if (name === "main") { mainDepth++; sawMain = true; }
      if (HIDDEN.has(name)) hidden++;
      if (hidden) return;
      if (name === "a") {
        if (!anchor && !pre && attrs.href && !attrs.href.startsWith("#")) {
          emit("[");
          frame.end = `](${attrs.href})`;
        }
        anchor++;
      } else if (!anchor && !pre) {
        if (name === "pre") { emit("\n\n```\n"); frame.end = "\n```\n\n"; }
        else if (/^h[1-6]$/.test(name)) { emit(`\n\n${"#".repeat(Number(name[1]))} `); frame.end = "\n\n"; }
        else if (name === "code") { emit("`"); frame.end = "`"; }
        else if (name === "strong" || name === "b") { emit("**"); frame.end = "**"; }
        else if (name === "li") emit("\n- ");
        else if (name === "br") emit("\n");
        if (name === "td" || name === "th") frame.end = " | ";
        else if (BLOCK.has(name)) frame.end = "\n";
      }
      if (name === "pre") pre++;
    },
    ontext(s) {
      if (titleDepth) title += s;
      if (!hidden) emit(s);
    },
    onclosetag(name) {
      const frame = stack.pop()!;
      if (!hidden) {
        emit(frame.end);
        if (name === "a") anchor--;
        if (name === "pre") pre--;
      }
      if (HIDDEN.has(name)) hidden--;
      if (name === "title") titleDepth--;
      if (name === "body") bodyDepth--;
      if (name === "main") mainDepth--;
    },
  });
  parser.end(html);
  const text = (sawMain ? main : sawBody ? body : all).join("")
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trimEnd()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  return { title: title.trim(), description, text };
}
