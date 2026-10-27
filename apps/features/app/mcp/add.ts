import { defineTool, ToolError } from "optz/mcp";
import { headers } from "optz/server";

// MCP tool: typed arguments from the schema, validated before `run`.
export default defineTool({
  title: "Add numbers",
  description: "Add a list of numbers. Returns the sum and who asked.",
  input: {
    type: "object",
    properties: {
      numbers: { type: "array", items: { type: "number" }, minItems: 1, description: "Numbers to add" },
      label: { type: "string", default: "sum" },
    },
    required: ["numbers"],
  },
  annotations: { readOnlyHint: true },
  run: ({ numbers, label }) => {
    if (numbers.some((n) => !Number.isFinite(n))) throw new ToolError("numbers must be finite");
    return { [label ?? "sum"]: numbers.reduce((a, b) => a + b, 0), agent: headers().get("user-agent") ?? "" };
  },
});
