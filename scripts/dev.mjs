import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) {
  console.error(
    `Crewroom needs Node.js 24 or newer for its SQLite API. Current version: ${process.version}.\nSwitch to Node 24+, then rerun npm run dev or npm run dev:phone. See README.md for this computer's bundled Node command.`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--phone")) {
  console.error("Usage: node scripts/dev.mjs [--phone]");
  process.exit(1);
}

const phone = args.includes("--phone");
const noWatch = process.env.CREWROOM_NO_WATCH === "1";
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverEntry = path.join(projectRoot, "server/index.mjs");
const expoEntry = path.join(projectRoot, "node_modules/expo/bin/cli");

if (!existsSync(serverEntry) || !existsSync(expoEntry)) {
  console.error(
    "Crewroom could not find its API or installed Expo CLI. Run npm install in the project directory, then try again.",
  );
  process.exit(1);
}

function getLanAddress() {
  const override = process.env.CREWROOM_LAN_IP?.trim();
  if (override) {
    if (
      isIP(override) !== 4 ||
      override.startsWith("127.") ||
      override === "0.0.0.0"
    ) {
      throw new Error(
        "CREWROOM_LAN_IP must be this computer's reachable LAN IPv4 address, such as 192.168.1.20.",
      );
    }
    return override;
  }

  const candidates = Object.entries(networkInterfaces()).flatMap(
    ([name, records]) =>
      (records || [])
        .filter(
          (record) =>
            !record.internal &&
            (record.family === "IPv4" || record.family === 4),
        )
        .filter((record) => !record.address.startsWith("169.254."))
        .filter(() => !/^(utun|tun|tap|docker|veth|virbr|br-)/i.test(name))
        .map((record) => ({ name, address: record.address })),
  );
  candidates.sort((a, b) => {
    const physical = (name) =>
      /^(en\d|eth\d|wlan\d|wi-?fi|ethernet)/i.test(name) ? 0 : 1;
    return physical(a.name) - physical(b.name) || a.name.localeCompare(b.name);
  });
  if (!candidates.length) {
    throw new Error(
      "No LAN IPv4 address found. Connect this computer to the same Wi-Fi as the phone, or set CREWROOM_LAN_IP explicitly.",
    );
  }
  return candidates[0].address;
}

let address = "localhost";
try {
  if (phone) address = getLanAddress();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const webOrigin = `http://${address}:8081`;
const apiOrigin = `http://${address}:4311`;
const childEnv = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}`,
  HOST: phone ? "0.0.0.0" : "127.0.0.1",
  PORT: "4311",
  APP_ORIGIN: webOrigin,
  EXPO_PUBLIC_API_URL: apiOrigin,
  EXPO_PUBLIC_WEB_URL: webOrigin,
  EXPO_NO_TELEMETRY: "1",
  EXPO_NO_CACHE: process.env.EXPO_NO_CACHE ?? "1",
  ...(noWatch ? { CI: "1" } : {}),
  ...(phone ? { REACT_NATIVE_PACKAGER_HOSTNAME: address } : {}),
};

const children = new Set();
let stopping = false;
let forceTimer;

function finishIfClosed() {
  if (stopping && children.size === 0) clearTimeout(forceTimer);
}

function stop(signal = "SIGTERM", exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal);
  }
  forceTimer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    }
  }, 5000);
  forceTimer.unref();
  finishIfClosed();
}

function launch(label, entry, childArgs = []) {
  const child = spawn(process.execPath, [entry, ...childArgs], {
    cwd: projectRoot,
    env: childEnv,
    stdio: "inherit",
    shell: false,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`${label} could not start: ${error.message}`);
    stop("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      if (code !== 0)
        console.error(
          `${label} stopped (${signal || `exit ${code}`}); stopping Crewroom.`,
        );
      stop("SIGTERM", code === 0 ? 0 : 1);
    }
  });
  child.on("close", () => {
    children.delete(child);
    finishIfClosed();
  });
  return child;
}

process.on("SIGINT", () => stop("SIGINT", 130));
process.on("SIGTERM", () => stop("SIGTERM", 143));
process.on("SIGHUP", () => stop("SIGHUP", 129));

console.log(
  `\nCrewroom ${phone ? "phone + web" : "web"} pilot\nWeb and invites: ${webOrigin}\nAPI: ${apiOrigin}`,
);
if (phone) console.log(`Expo Go: exp://${address}:8081`);
if (phone)
  console.log(
    "Keep your phone on the same Wi-Fi. Open the Expo QR code with Expo Go.\nIf this IP is incorrect, rerun with CREWROOM_LAN_IP=<computer-LAN-IP>.",
  );
if (noWatch)
  console.log(
    `File watching and automatic reload are disabled (CREWROOM_NO_WATCH=1).\nOpen the app at ${webOrigin}\nRestart this command after editing source files.`,
  );
console.log("Press Ctrl+C to stop both servers.\n");

launch("API", serverEntry);
launch("Expo", expoEntry, [
  "start",
  "--clear",
  "--web",
  phone ? "--lan" : "--localhost",
  "--port",
  "8081",
]);
