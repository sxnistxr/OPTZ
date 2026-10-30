import { createHighlighter, type BundledLanguage } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// VS Code's TextMate grammars and default themes, evaluated only on the server/build.
export const highlighter = await createHighlighter({
  themes: ["light-plus", "dark-plus"],
  langs: ["typescript", "tsx", "javascript", "jsx", "shellscript", "json", "css", "html", "sql", "rust", "yaml", "toml", "diff", "markdown"],
  engine: createJavaScriptRegexEngine(),
});
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const aliases: Record<string, string> = { ts: "typescript", js: "javascript", sh: "shellscript", bash: "shellscript", shell: "shellscript", rs: "rust", yml: "yaml", md: "markdown" };

export function highlightCode(code: string, language: string): string {
  const lang = aliases[language.toLowerCase()] ?? language.toLowerCase();
  if (!highlighter.getLoadedLanguages().includes(lang)) return escape(code);
  const { tokens } = highlighter.codeToTokens(code, { lang: lang as BundledLanguage, themes: { light: "light-plus", dark: "dark-plus" } });
  return tokens.map(line => line.map(token => {
    const styles = token.htmlStyle ?? {};
    const colors = ["color", "--shiki-dark"].map((key, i) => {
      const value = styles[key];
      return typeof value === "string" && /^#[0-9a-f]{6,8}$/i.test(value) ? `syntax-${i ? "d" : "l"}${value.slice(1).toLowerCase()}` : "";
    }).filter(Boolean);
    if (styles["font-style"] === "italic") colors.push("syntax-italic");
    if (styles["font-weight"] === "bold") colors.push("syntax-bold");
    return `<span class="${colors.join(" ")}">${escape(token.content)}</span>`;
  }).join("")).join("\n");
}
