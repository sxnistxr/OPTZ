// Run with `bun scripts/generate-syntax-css.ts` after updating Shiki or its themes.
import { highlighter } from "../app/lib/docs-syntax";
const lines = ["/* Generated from VS Code Light+/Dark+ through Shiki. No inline styles or browser highlighter. */"];
for (const [mode, theme] of [["l", "light-plus"], ["d", "dark-plus"]] as const) {
  const colors = new Set<string>();
  const walk = (value: unknown) => {
    if (typeof value === "string" && /^#[0-9a-f]{6,8}$/i.test(value)) colors.add(value.toLowerCase());
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(highlighter.getTheme(theme));
  for (const color of [...colors].sort()) lines.push(`${mode === "d" ? '[data-theme="dark"] ' : ""}.prose-docs .syntax-${mode}${color.slice(1)} { color: ${color}; }`);
}
lines.push(".syntax-italic { font-style: italic; }", ".syntax-bold { font-weight: 700; }");
await Bun.write(new URL("../app/docs-syntax.css", import.meta.url), lines.join("\n") + "\n");
