import type { ApiContext } from "optz";
import { handleUploads } from "$lib/modules.server";
export const POST = ({ request }: ApiContext) => handleUploads(request);
