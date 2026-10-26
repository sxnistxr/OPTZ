// Your name, intro and links. Used by the layout and the home page.
import site from "$content/site.json";

export interface Site {
  name: string;
  title: string;
  about: string;
  links: { label: string; href: string }[];
}
export default site as Site;
