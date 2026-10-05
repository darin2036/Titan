import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/src/api.ts";
import { OWNER } from "../apps/server/src/domain.ts";
import type { RecordView } from "../apps/server/src/contracts.ts";

test("document browser lists readable active documents and folders, excluding internal files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "titan-documents-"));
  const t = createApp({
    workspace: join(dir, "workspace"),
    stateDir: join(dir, "state"),
    ownerToken: "documents-test",
    workers: false,
  });
  try {
    const record = t.domain.create(OWNER, {
      kind: "knowledge",
      title: "Employee handbook",
      body: "Welcome",
    }) as RecordView;
    const source = t.domain.storage.read(`records/${record.id}.md`)!;
    t.domain.storage.transaction(
      [
        { path: `records/${record.id}.md`, content: null },
        { path: "records/teams/handbook.md", content: source },
        { path: "records/.internal/hidden.md", content: source },
        { path: "records/notes.txt", content: "Not a document" },
        { path: ".titan/private.md", content: source },
      ],
      "Prepare document browser fixtures",
    );
    const headers = { authorization: "Bearer documents-test" };
    const response = await t.app.inject({ url: "/api/v1/documents", headers });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), [
      {
        path: "teams/handbook.md",
        id: record.id,
        title: record.title,
        kind: "knowledge",
      },
    ]);
    assert.equal(
      (await t.app.inject({ url: "/api/v1/documents" })).statusCode,
      401,
    );
    assert.equal(
      (
        await t.app.inject({
          url: "/api/v1/documents",
          headers: {
            authorization: "Bearer " + t.domain.index.token(["read"]),
          },
        })
      ).statusCode,
      403,
    );
  } finally {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
