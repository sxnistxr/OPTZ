import type { ApiContext } from "optz";
import { analytics } from "$lib/modules.server";
export const POST = ({ request }: ApiContext) => analytics().ingest(request);
