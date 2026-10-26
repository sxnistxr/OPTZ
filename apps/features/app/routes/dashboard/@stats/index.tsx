export const loader = () => ({ visits: 42 });
export default function Stats({ data }: { data: { visits: number } }) {
  return <p>visits {data.visits}</p>;
}
