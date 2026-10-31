export const BINARY_COLUMNS = 16;
export const BINARY_ROWS = 26;

export function htmlBytes(source: string): string[] {
  return Array.from(new TextEncoder().encode(source), byte => byte.toString(2).padStart(8, "0"));
}

export function binaryGrid(bytes: readonly string[], offset = 0): string {
  if (!bytes.length) return "";
  let grid = "";
  for (let row = 0; row < BINARY_ROWS; row++) {
    for (let col = 0; col < BINARY_COLUMNS; col++) {
      if (col) grid += " ";
      grid += bytes[((offset + row * BINARY_COLUMNS + col) % bytes.length + bytes.length) % bytes.length];
    }
    if (row < BINARY_ROWS - 1) grid += "\n";
  }
  return grid;
}
