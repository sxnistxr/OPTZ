import { chmodSync, closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Metadata and bytes from the same opened file, even if its pathname is replaced. */
export function readFileSnapshot(file: string): { body: Buffer; mtimeMs: number } {
  const fd = openSync(file, "r");
  try {
    const { mtimeMs } = fstatSync(fd);
    return { body: readFileSync(fd), mtimeMs };
  } finally {
    closeSync(fd);
  }
}

export function readTextIfPresent(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return undefined;
  }
}

/** Publish a complete file by rename; an existing destination symlink is replaced, never followed. */
export function writeFileAtomic(file: string, body: string | Uint8Array): void {
  let mode: number | undefined;
  try {
    const st = lstatSync(file);
    if (!st.isSymbolicLink()) mode = st.mode & 0o777;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const dir = mkdtempSync(join(dirname(file), ".optz-write-"));
  try {
    const tmp = join(dir, "data");
    writeFileSync(tmp, body, { flag: "wx" });
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
