import { redirect } from "optz";

// Redirects work from any loader: throw redirect(...).
export const loader = () => {
  throw redirect("/about", 301);
};
export default function OldAbout() {
  return null;
}
