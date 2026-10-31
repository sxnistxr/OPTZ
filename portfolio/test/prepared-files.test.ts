import { describe, expect, test } from "bun:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { hexRows, preparedFiles } from "../app/lib/prepared-files";

describe("prepared files", () => {
  const html = "<!doctype html>\n<h1>Hello, your next idea.</h1>\n";

  test("names the page and its two compressed copies", () => {
    expect(preparedFiles(html).map(file => [file.name, file.encoding])).toEqual([
      ["index.html", "identity"],
      ["index.html.br", "br"],
      ["index.html.gz", "gzip"],
    ]);
  });

  test("each compressed copy decodes back to the page", () => {
    const [source, br, gz] = preparedFiles(html);
    expect(new TextDecoder().decode(source.bytes)).toBe(html);
    expect(new TextDecoder().decode(brotliDecompressSync(br.bytes))).toBe(html);
    expect(new TextDecoder().decode(gunzipSync(gz.bytes))).toBe(html);
  });
});

describe("hex rows", () => {
  test("offsets each row and pads every byte to two digits", () => {
    const bytes = Uint8Array.from({ length: 14 }, (_, i) => i * 18);
    expect(hexRows(bytes, 12)).toBe("0000  00 12 24 36 48 5a 6c 7e 90 a2 b4 c6\n000c  d8 ea");
  });

  test("dumps nothing for no bytes", () => {
    expect(hexRows(new Uint8Array())).toBe("");
  });
});
