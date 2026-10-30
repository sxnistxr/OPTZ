import type { PageProps } from "optz";
import { StatusPage } from "@optz/status/view";
import { status } from "$lib/modules.server";
export const config = { render: "dynamic" } as const;
export const cache = { maxAge: 5, tags: ["module-status"] };
export const head = () => ({ title: "Service status · OPTZ" });
export const loader = () => status().snapshot();
export default function Status({ data }: PageProps<Awaited<ReturnType<typeof loader>>>) { return <StatusPage snapshot={data} title="Example service status" />; }
