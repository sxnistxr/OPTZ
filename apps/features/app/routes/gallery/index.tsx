import { Link } from "optz";

const photos = ["1", "2", "3"];

export default function Gallery() {
  return (
    <>
      <h1 data-testid="gallery">Gallery</h1>
      <ul>
        {photos.map((id) => (
          <li key={id}>
            <Link href={`/gallery/photo/${id}`}>Photo {id}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
