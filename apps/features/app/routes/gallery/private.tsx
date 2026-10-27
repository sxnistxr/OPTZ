// Inside the gallery, but app/middleware.ts only lets a visitor with the admin cookie see it.
// An intercepted photo opened "from" here must not render it for anyone else.
export default function Private() {
  return <p data-testid="private">private gallery secret</p>;
}
