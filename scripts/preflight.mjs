import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntime, publicHttpsOrigin } from "../server/runtime.mjs";
import { cloudBackupConfigFromEnv } from "./backup-cloud.mjs";

export async function writeBuildInfo(env = process.env, root = process.cwd()) {
  const apiUrl = publicHttpsOrigin(env.EXPO_PUBLIC_API_URL, "EXPO_PUBLIC_API_URL");
  const webUrl = publicHttpsOrigin(env.EXPO_PUBLIC_WEB_URL, "EXPO_PUBLIC_WEB_URL");
  await access(path.join(root, "dist", "index.html"));
  await writeFile(path.join(root, "dist", "crewroom-build.json"), `${JSON.stringify({ apiUrl, webUrl, builtAt: new Date().toISOString() }, null, 2)}\n`);
}

export async function checkProduction({ env = process.env, root = process.cwd(), nodeVersion = process.versions.node } = {}) {
  const errors = [], warnings = [];
  if (Number(nodeVersion.split(".")[0]) < 24) errors.push("Node 24 or newer is required by the API and backup tools.");
  let runtime;
  try { runtime = loadRuntime({ ...env, NODE_ENV: "production" }, root); } catch (error) { errors.push(error.message); }
  try {
    await access(path.join(root, "dist", "index.html"));
    const built = JSON.parse(await readFile(path.join(root, "dist", "crewroom-build.json"), "utf8"));
    const apiUrl = publicHttpsOrigin(built.apiUrl, "Built API URL");
    const webUrl = publicHttpsOrigin(built.webUrl, "Built web URL");
    if (runtime && webUrl !== runtime.appOrigin) errors.push("The built web origin differs from APP_ORIGIN; rebuild the client with the correct public URLs.");
    if (env.EXPO_PUBLIC_API_URL && apiUrl !== publicHttpsOrigin(env.EXPO_PUBLIC_API_URL, "EXPO_PUBLIC_API_URL")) errors.push("The built API URL differs from EXPO_PUBLIC_API_URL; changing runtime variables does not rewrite a client bundle.");
    if (env.EXPO_PUBLIC_WEB_URL && webUrl !== publicHttpsOrigin(env.EXPO_PUBLIC_WEB_URL, "EXPO_PUBLIC_WEB_URL")) errors.push("The built web URL differs from EXPO_PUBLIC_WEB_URL; rebuild the client.");
  } catch (error) { errors.push(`Production web export is missing or invalid: ${error.message}. Export with the production public URLs, then use preflight --write-build-info.`); }
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) warnings.push("Password-reset email is unavailable. Configure a verified sender with RESEND_API_KEY and MAIL_FROM before relying on self-service recovery.");
  try {
    if (!cloudBackupConfigFromEnv(env)) warnings.push("Automatic offsite backups are disabled. Configure private storage and verify a remote restore before broader beta use.");
  } catch (error) { errors.push(error.message); }
  if (runtime?.trustProxyHops === 0) warnings.push("TRUST_PROXY_HOPS=0 ignores forwarded IPs. Behind a proxy, clients may share rate limits; configure only after verifying the proxy topology.");
  warnings.push("Confirm DATA_DIR/DB_PATH/MEDIA_DIR are actually on a persistent writable disk. One instance only; monitor offsite backup status and verify remote restores.");
  warnings.push("This checks deployment configuration, not public DNS/TLS, policy accuracy, deliverability, device testing, app IDs, store declarations, or store approval.");
  return { ok: errors.length === 0, errors, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    if (process.argv.length === 3 && process.argv[2] === "--write-build-info") {
      await writeBuildInfo(process.env, root);
      console.log("Recorded the public URLs used for the freshly exported web bundle. This does not change bundle contents.");
    } else {
      if (process.argv.length > 2) throw new Error("Usage: node scripts/preflight.mjs [--write-build-info]");
      const result = await checkProduction({ root });
      result.errors.forEach((message) => console.error(`ERROR: ${message}`));
      result.warnings.forEach((message) => console.warn(`WARNING: ${message}`));
      console.log(result.ok ? "Deployment configuration preflight passed." : "Deployment configuration preflight failed; no changes were made.");
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
