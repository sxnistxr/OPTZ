// Throws while rendering: the server answers 500 with _error.tsx in its place.
export const config = { render: "dynamic" } as const;
export default function Boom(): never {
  throw new Error("kaboom");
}
