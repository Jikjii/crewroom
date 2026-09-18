import { fileURLToPath } from "node:url";
import path from "node:path";
import { createApp } from "./app.mjs";
import { loadRuntime } from "./runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = loadRuntime(process.env, root);
const { port, host } = runtime;
if (runtime.production) {
  const { checkProduction } = await import("../scripts/preflight.mjs");
  const result = await checkProduction({ root });
  if (!result.ok) throw new Error(`Production preflight failed: ${result.errors.join(" ")}`);
  result.warnings.forEach((warning) => console.warn(warning));
}
let mailSender;
if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
  const { createResendSender } = await import("./accounts.mjs");
  mailSender = createResendSender({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM });
}
const server = createApp({ ...runtime, mailSender });
server.on("error", (error) => {
  console.error(`Crewroom could not start: ${error.code || error.name}`);
  process.exit(1);
});
server.listen(port, host, () => {
  console.log(`Crewroom API listening on http://${host}:${port}${runtime.production ? " behind the configured HTTPS proxy" : ""}`);
  if (runtime.production && !mailSender)
    console.warn("Password-reset email is unavailable until RESEND_API_KEY and MAIL_FROM are configured.");
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
