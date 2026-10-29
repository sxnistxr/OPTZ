import { Link, type Head } from "optz";
import { LabList } from "$components/Lab";
import { Arrow } from "$components/Icons";
import lab from "$lib/lab";
export const head = (): Head => ({ title: "Projects | DihLabs", description: "Software and systems by sxnistxr. Building fast things on small machines." });
export default function Lab() {
  return <><h1 className="page-heading">Projects</h1><p className="page-description">Software, systems, and things built to find out how they work.</p><section className="project-list" aria-label="Systems projects"><LabList items={lab.filter(x => x.slug !== "optz")} detail /></section><Link href="/optz" className="project-portal"><div><h2>Looking for OPTZ?</h2><p>The framework has a space of its own. Start there for the docs, benchmarks, and architecture.</p></div><Arrow /></Link></>;
}
