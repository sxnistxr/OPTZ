export default function PageError({ error }: { error: Error }) {
  return (
    <div role="alert">
      <h1 className="text-3xl font-semibold tracking-[-0.02em]">This page hit an error</h1>
      <p className="mt-4 text-muted">{error.message}</p>
      <p className="mt-4">
        <a className="underline decoration-rule underline-offset-4" href="">
          Reload the page
        </a>
      </p>
    </div>
  );
}
