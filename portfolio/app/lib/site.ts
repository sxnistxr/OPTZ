// The site's name, intro and links (content/site.json). Used by the layout, home page and docs.
import site from "$content/site.json";

export interface Site {
  name: string;
  title: string;
  author: string;
  tagline: string;
  about: string;
  links: { label: string; href: string }[];
  url: string;
  /** GitHub repository and branch, for links to source files from the docs. */
  repo: string;
  branch: string;
}
export default site as Site;
