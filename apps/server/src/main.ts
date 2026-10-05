import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "./api.ts";
const stateDir = resolve(process.env.TITAN_STATE_DIR ?? ".local/state");
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const tokenPath = join(stateDir, "owner-token");
if (!existsSync(tokenPath))
  writeFileSync(tokenPath, randomBytes(32).toString("hex"), { mode: 0o600 });
const ownerToken =
  process.env.TITAN_OWNER_TOKEN ?? readFileSync(tokenPath, "utf8").trim();
const { app } = createApp({
  workspace: resolve(process.env.TITAN_WORKSPACE ?? ".local/workspace"),
  stateDir,
  ownerToken,
  demo: process.env.TITAN_DEMO === "1",
});
await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.TITAN_PORT ?? 4310),
});
console.log(
  "Titan API ready on http://127.0.0.1:" + (process.env.TITAN_PORT ?? 4310),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
