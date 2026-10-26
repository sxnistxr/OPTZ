// An async server component page: _loading.tsx shows until it resolves.
export const config = { render: "dynamic" } as const;

export default async function Slow() {
  const data = await new Promise<string>((r) => setTimeout(() => r("slow data"), 400));
  return <h1 data-testid="slow">{data}</h1>;
}
