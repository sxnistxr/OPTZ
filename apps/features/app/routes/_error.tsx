export default function ErrorView({ error }: { error: Error }) {
  return (
    <p role="alert" data-testid="error">
      This page failed: {error.message}
    </p>
  );
}
