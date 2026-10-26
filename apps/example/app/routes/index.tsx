import type { PageProps } from "optz";
import Counter from "$components/Counter.island";
import { greeting } from "$lib/greeting";

// Static (the default): rendered once at build time. The loader never reaches the browser.
export const loader = () => ({ message: greeting("world"), builtAt: new Date().toISOString() });

export default function Home({ data }: PageProps<{ message: string; builtAt: string }>) {
  return (
    <>
      <h1 className="text-3xl font-semibold">{data.message}</h1>
      <p className="mt-2 text-gray-500">Built at {data.builtAt}.</p>
      <div className="mt-6">
        <Counter start={1} />
      </div>
    </>
  );
}
