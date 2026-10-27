import { defineResource } from "optz/mcp";

// A resource template: notes://{id}
export default defineResource({
  uri: "notes://{id}",
  description: "A note by id",
  mimeType: "text/plain",
  list: () => [{ uri: "notes://1", name: "First note" }],
  read: ({ id }) => `Note ${id}`,
});
