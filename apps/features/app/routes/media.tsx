import { Image } from "optz/image";
import { Script } from "optz/script";

export default function Media() {
  return (
    <>
      <h1>Media</h1>
      <Image src="/photo.jpg" width={600} height={400} alt="A gradient" priority data-testid="hero" />
      <Image src="/photo.jpg" alt="Full width" sizes="100vw" width={1200} height={800} data-testid="wide" />
      <Script src="/third-party.js" strategy="lazyOnload" attrs={{ "data-site": "features" }} />
    </>
  );
}
