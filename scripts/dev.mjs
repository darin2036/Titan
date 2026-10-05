import { spawn } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
const state = resolve(process.env.TITAN_STATE_DIR ?? ".local/state");
mkdirSync(state, { recursive: true, mode: 0o700 });
const keyPath = join(state, "owner-token");
if (!existsSync(keyPath))
  writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
const owner =
  process.env.TITAN_OWNER_TOKEN ?? readFileSync(keyPath, "utf8").trim();
const env = {
  ...process.env,
  TITAN_STATE_DIR: state,
  TITAN_OWNER_TOKEN: owner,
  TITAN_INTELLIGENCE_TOKEN:
    process.env.TITAN_INTELLIGENCE_TOKEN ?? randomBytes(32).toString("hex"),
  TITAN_WORKSPACE:
    process.env.TITAN_WORKSPACE ??
    resolve(
      process.argv.includes("--demo")
        ? ".local/demo-workspace"
        : ".local/workspace",
    ),
  TITAN_DEMO: process.argv.includes("--demo") ? "1" : "0",
};
const children = [];
let stopped = false;
function stop(code = 0) {
  if (stopped) return;
  stopped = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 400);
}
function start(command, args) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopped) stop(code ?? 1);
  });
}
start(process.env.PYTHON ?? "python3", ["services/intelligence/service.py"]);
start(process.execPath, [
  "node_modules/tsx/dist/cli.mjs",
  "apps/server/src/main.ts",
]);
start(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "--config",
  "apps/web/vite.config.ts",
]);
console.log(
  "\nTitan workspace: http://127.0.0.1:5173/#token=" +
    encodeURIComponent(owner) +
    "\n",
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
