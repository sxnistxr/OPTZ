export default function PageError({ error }: { error: Error }) {
  return (
    <div role="alert" className="error-page">
      <h1 className="page-heading">This page hit an error</h1>
      <p>{error.message}</p>
      <p>
        <a href="">Reload the page</a>
      </p>
    </div>
  );
}
