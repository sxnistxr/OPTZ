import { csrf, secureHeaders } from "optz/security";
import { origin } from "$lib/app.server";
export default [csrf(origin), secureHeaders({
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
})];
