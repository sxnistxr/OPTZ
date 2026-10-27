// The loader throws: the server answers 500 with _error.tsx, like a render error.
export const config = { render: "dynamic" } as const;
export const loader = (): never => {
  throw new Error("loader kaboom");
};
export default function BoomLoader() {
  return <p>never shown</p>;
}
