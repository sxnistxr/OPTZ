import { describe, expect, test } from "bun:test";
import { BINARY_COLUMNS, BINARY_ROWS, binaryGrid, htmlBytes } from "../app/lib/html-bytes";

describe("HTML byte evidence", () => {
  test("encodes markup as eight-bit UTF-8 bytes, including multi-byte text", () => {
    expect(htmlBytes("<")).toEqual(["00111100"]);
    expect(htmlBytes("µ")).toEqual(["11000010", "10110101"]);
    const text = "<p>18 µs → faster</p>";
    const decoded = new TextDecoder().decode(Uint8Array.from(htmlBytes(text), bits => parseInt(bits, 2)));
    expect(decoded).toBe(text);
  });

  test("every grid cell comes from the article byte stream, wrapping at either end", () => {
    const bytes = htmlBytes("<h1>Hello</h1>");
    for (const offset of [0, 7, -2, bytes.length + 4]) {
      const rows = binaryGrid(bytes, offset).split("\n");
      expect(rows).toHaveLength(BINARY_ROWS);
      const cells = rows.flatMap(row => row.split(" "));
      expect(cells).toHaveLength(BINARY_ROWS * BINARY_COLUMNS);
      cells.forEach((cell, index) => expect(cell).toBe(bytes[((offset + index) % bytes.length + bytes.length) % bytes.length]));
    }
    expect(binaryGrid([])).toBe("");
  });
});
