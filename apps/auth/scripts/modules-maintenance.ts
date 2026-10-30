import { maintainModules } from "../app/lib/modules.server";
// Run explicitly under the same runtime/Doppler environment as this application.
console.log(JSON.stringify(await maintainModules()));
process.exit(0);
