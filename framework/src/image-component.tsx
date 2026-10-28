// <Image>: an <img> that the server resizes and re-encodes (AVIF/WebP) for each screen, with
// width and height reserved so the page doesn't shift while it loads, lazy loading below the
// fold and high priority for the hero image.
//
//   import { Image } from "optz/image";
//   <Image src="/photos/desk.jpg" width={1200} height={800} alt="My desk" sizes="(min-width: 768px) 50vw, 100vw" />
import { createContext, useContext } from "react";
import type { CSSProperties, ImgHTMLAttributes } from "react";

const DEFAULT_SIZES = [384, 640, 828, 1080, 1200, 1920, 2048];
/** The widths the optimizer produces (config images.sizes): set by the server and compiled into
 *  browser bundles, so srcset never offers a width the server would round down. */
export const ImageSizesContext = createContext<number[] | undefined>(undefined);
const configuredSizes = (scoped?: number[]): number[] => {
  const s = (globalThis as { __OPTZ_IMAGE_SIZES__?: number[] }).__OPTZ_IMAGE_SIZES__;
  const sizes = scoped ?? s;
  return sizes?.length ? [...sizes].sort((a, b) => a - b) : DEFAULT_SIZES;
};

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "loading" | "srcSet"> {
  src: string;
  alt: string;
  /** Intrinsic width in CSS pixels (reserves space; required unless `fill`). */
  width?: number;
  height?: number;
  /** Fill the parent (which must be positioned) instead of a fixed size. */
  fill?: boolean;
  /** How wide the image is shown, as a `sizes` attribute ("100vw", "(min-width: 768px) 50vw, 100vw").
   *  With it, every width is offered; without it, 1x and 2x of `width`. */
  sizes?: string;
  /** 1-100. Default the server's images.quality (75). */
  quality?: number;
  /** Above the fold: load eagerly with high fetch priority. */
  priority?: boolean;
  /** A tiny data: URL shown until the image loads (uses an inline style: your CSP needs style-src-attr 'unsafe-inline'). */
  blurDataURL?: string;
  /** Send `src` as it is (SVGs, static exports). */
  unoptimized?: boolean;
}

export const imageUrl = (src: string, w: number, q?: number) => `/_optz/image?url=${encodeURIComponent(src)}&w=${w}${q ? `&q=${q}` : ""}`;

export function Image({ src, alt, width, height, fill, sizes, quality, priority, blurDataURL, unoptimized, style, ...rest }: ImageProps) {
  if (!fill && (!width || !height)) throw new Error(`<Image src="${src}">: width and height are required (or use fill)`);
  const plain = unoptimized || src.endsWith(".svg") || src.startsWith("data:");
  let srcSet: string | undefined;
  let url = src;
  const SIZES = configuredSizes(useContext(ImageSizesContext));
  if (!plain) {
    if (sizes || fill) {
      srcSet = SIZES.map((w) => `${imageUrl(src, w, quality)} ${w}w`).join(", ");
      url = imageUrl(src, SIZES[SIZES.length - 1], quality);
    } else {
      const up = (w: number) => SIZES.find((s) => s >= w) ?? SIZES[SIZES.length - 1];
      const one = up(width!);
      const two = up(width! * 2);
      srcSet = one === two ? undefined : `${imageUrl(src, one, quality)} 1x, ${imageUrl(src, two, quality)} 2x`;
      url = imageUrl(src, one, quality);
    }
  }
  // Classes, not inline styles, so a strict CSP (no style-src 'unsafe-inline') still applies them.
  const cls = [fill ? "optz-img-fill" : "optz-img", rest.className].filter(Boolean).join(" ");
  const s: CSSProperties | undefined = blurDataURL ? { backgroundImage: `url("${blurDataURL}")`, backgroundSize: "cover", backgroundPosition: "center", ...style } : style;
  return (
    <img
      {...rest}
      src={url}
      srcSet={srcSet}
      sizes={sizes ?? (fill ? "100vw" : undefined)}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      className={cls}
      style={s}
    />
  );
}

export default Image;
