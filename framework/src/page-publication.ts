import { privateResponse } from "./cache";
import { ogPath } from "./manifest";
import type { OgModule } from "./og-types";

/** A page may render temporary metadata without making that result shared or durable. */
export class PagePublication {
  constructor(readonly og: string | undefined, readonly ogSize: OgModule["size"], private readonly complete: boolean) {}

  respond(produce: () => Promise<Response>, share = produce): Promise<Response> {
    return this.complete ? share() : produce().then(privateResponse);
  }

  async publish(update: () => Promise<void>): Promise<void> {
    if (this.complete) await update();
  }
}

/** Shares project imports and owns optional producer readiness for each page publication. */
export class PageModules {
  private readonly modules = new Map<string, Promise<unknown>>();

  constructor(private readonly importModule: (file: string) => Promise<unknown>, private readonly prerender = false) {}

  load<T>(file: string): Promise<T> {
    let pending = this.modules.get(file);
    if (!pending) this.modules.set(file, (pending = this.importModule(file)));
    return pending as Promise<T>;
  }

  async publication(file: string | undefined, pathname: string): Promise<PagePublication> {
    if (!file) return new PagePublication(undefined, undefined, true);
    const producer = await this.optionalProducer(file);
    return new PagePublication(ogPath(pathname), producer?.size, producer !== undefined);
  }

  private async optionalProducer(file: string): Promise<OgModule | undefined> {
    let timer: number | ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = this.load<OgModule>(file);
      const optional = pending.catch(() => {
        // Evict only this rejection; a timed-out pending import stays shared.
        if (this.modules.get(file) === pending) this.modules.delete(file);
        return undefined;
      });
      // Built metadata must match the generated image, regardless of import duration.
      if (this.prerender) return await optional;
      return await Promise.race([
        optional,
        new Promise<undefined>((resolve) => { timer = setTimeout(resolve, 100); }),
      ]);
    } catch {
      return undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
