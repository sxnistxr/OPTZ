import { json } from "optz";
import { after, cookies, headers } from "optz/server";

export function GET() {
  after(() => console.log("whoami: logged after the response"));
  return json({ name: cookies().get("name") ?? null, agent: headers().get("user-agent") ?? "" });
}
