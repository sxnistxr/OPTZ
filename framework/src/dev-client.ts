// Dev-only browser code (loaded as its own chunk, never in production): listens to the dev
// server and applies updates. Replaced in full by the HMR client below.
export interface DevCtx {
  refresh: () => Promise<void>;
  roots?: Map<Element, { unmount(): void }>;
  registry?: () => Record<string, unknown>;
}

export function connect(_ctx: DevCtx) {
  const open = (wasDown: boolean) => {
    const es = new EventSource("/_optz/dev/events");
    es.onopen = () => wasDown && location.reload();
    es.addEventListener("reload", () => location.reload());
    es.onerror = () => {
      es.close();
      setTimeout(() => open(true), 300);
    };
  };
  open(false);
}
