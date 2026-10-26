import { notFound, type LoaderContext, type PageProps } from "optz";
import { rendered } from "$lib/store";

// Built for id 1; any other id renders on its first request and is kept (dynamicParams).
export const paths = () => [{ id: "1" }];
export const dynamicParams = true;
export const loader = ({ params }: LoaderContext<{ id: string }>) => {
  if (!/^\d+$/.test(params.id)) notFound();
  return { id: params.id, n: rendered(`product-${params.id}`) };
};

export default function Product({ data }: PageProps<{ id: string; n: number }>) {
  return (
    <h1 data-testid="product">
      product {data.id} render {data.n}
    </h1>
  );
}
