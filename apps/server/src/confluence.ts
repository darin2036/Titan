import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ConnectedStorage } from "./connected-storage.ts";
import { Domain, OWNER } from "./domain.ts";
import { decode, encode } from "./storage.ts";
import {
  demand,
  Fault,
  uid,
  hash,
  now,
  type Unit,
  type RecordView,
} from "./contracts.ts";
import { normalizeConfluence, confluenceMarkup } from "./confluence-content.ts";
const scopes = "offline_access read:space:confluence read:page:confluence";
const Page = z.object({
  id: z.string().regex(/^\d+$/),
  spaceId: z.string(),
  status: z.string(),
  title: z.string().min(1),
  createdAt: z.string().optional(),
  authorId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  version: z.object({
    number: z.number().int().positive(),
    createdAt: z.string().optional(),
    authorId: z.string().optional(),
  }),
  body: z
    .object({
      storage: z
        .object({ value: z.string().max(2_000_000).optional() })
        .optional(),
    })
    .optional(),
  _links: z.object({ webui: z.string().optional() }).optional(),
});
type SourcePage = z.infer<typeof Page>;
type Tokens = {
  access_token: string;
  refresh_token: string;
  expires: number;
  scope: string;
};
type Site = { id: string; name: string; url: string; scopes: string[] };
type Config = {
  site?: Site;
  spaces: string[];
  allowEdits: boolean;
  intervalMinutes: number;
  nextAt: number;
  cursor?: string;
  seen: string[];
  lastSync?: string;
  error?: string;
  authorized: boolean;
  attempts: number;
};
export type ConfluenceOptions = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  fetch?: typeof fetch;
};
class RemoteError extends Fault {
  constructor(
    public remoteStatus: number,
    public retrySeconds = 0,
  ) {
    super(
      remoteStatus === 409
        ? 409
        : remoteStatus === 403 || remoteStatus === 404
          ? 404
          : 503,
      remoteStatus === 409
        ? "The Confluence page changed. Your draft has been kept. Compare the latest page before saving."
        : remoteStatus === 401
          ? "Reconnect Confluence to continue."
          : remoteStatus === 403 || remoteStatus === 404
            ? "This Confluence page is unavailable."
            : "Confluence couldn’t complete the request. Titan will retry.",
    );
  }
}
export class Confluence {
  busy = false;
  private generation = 0;
  private key: Buffer;
  private refreshPromise?: Promise<Tokens>;
  private request: typeof fetch;
  constructor(
    public domain: Domain,
    public storage: ConnectedStorage,
    stateDir: string,
    public options: ConfluenceOptions = {},
  ) {
    this.request = options.fetch ?? fetch;
    const keyPath = join(stateDir, "confluence-key");
    if (!existsSync(keyPath))
      writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
    this.key = readFileSync(keyPath);
    this.recoverMigrations();
  }
  private config(): Config {
    return (
      this.storage.state<Config>("config") ?? {
        spaces: [],
        allowEdits: false,
        intervalMinutes: 5,
        nextAt: 0,
        seen: [],
        authorized: false,
        attempts: 0,
      }
    );
  }
  private save(config: Config) {
    this.storage.setState("config", config);
  }
  private tokens(): Tokens | undefined {
    const encrypted = this.storage.state<{
      iv: string;
      tag: string;
      data: string;
    }>("tokens");
    if (!encrypted) return;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(encrypted.data, "base64")),
        decipher.final(),
      ]).toString(),
    );
  }
  private storeTokens(tokens: Tokens | undefined) {
    if (!tokens) {
      this.storage.setState("tokens", null);
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(tokens)),
      cipher.final(),
    ]);
    this.storage.setState("tokens", {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    });
  }
  status() {
    const c = this.config();
    return {
      configured: !!(
        this.options.clientId &&
        this.options.clientSecret &&
        this.options.redirectUri &&
        this.storage.safePrivateState
      ),
      setupIssue: !this.storage.safePrivateState
        ? "Move TITAN_STATE_DIR outside the knowledge repository before connecting Confluence."
        : null,
      authorized: c.authorized && this.storage.safePrivateState,
      connected: c.authorized && !!c.site && this.storage.safePrivateState,
      site: c.site && { id: c.site.id, name: c.site.name, url: c.site.url },
      spaces: c.spaces,
      allowEdits: c.allowEdits,
      intervalMinutes: c.intervalMinutes,
      syncing: this.busy || !!c.cursor,
      lastSync: c.lastSync ?? null,
      error: c.error ?? null,
      nextSync: c.site ? new Date(c.nextAt).toISOString() : null,
      pages: this.storage
        .bindings()
        .filter(
          (b) =>
            b.site === c.site?.id &&
            b.visible &&
            !b.migrated &&
            Date.now() - b.checked <= 15 * 60_000,
        ).length,
    };
  }
  begin(allowEdits = false) {
    demand(
      this.status().configured,
      503,
      "Confluence needs operator setup before it can be connected.",
    );
    demand(
      this.storage.safePrivateState,
      422,
      "Move TITAN_STATE_DIR outside the knowledge repository before connecting Confluence.",
    );
    const state = randomBytes(32).toString("hex");
    this.storage.setState("oauth", {
      state,
      expires: Date.now() + 10 * 60_000,
      allowEdits,
    });
    const url = new URL("https://auth.atlassian.com/authorize");
    for (const [key, value] of Object.entries({
      audience: "api.atlassian.com",
      client_id: this.options.clientId!,
      redirect_uri: this.options.redirectUri!,
      response_type: "code",
      prompt: "consent",
      scope: scopes + (allowEdits ? " write:page:confluence" : ""),
      state,
    }))
      url.searchParams.set(key, value);
    return { url: url.toString() };
  }
  private async json(url: string, init: RequestInit = {}) {
    const response = await this.request(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const retry = response.headers.get("Retry-After");
      throw new RemoteError(
        response.status,
        retry
          ? Math.max(
              1,
              Number(retry) ||
                Math.ceil((Date.parse(retry) - Date.now()) / 1000) ||
                60,
            )
          : 0,
      );
    }
    const body = await response.text();
    demand(
      body.length <= 4_000_000,
      502,
      "Confluence returned more content than Titan can process at once.",
    );
    const parsed = JSON.parse(body);
    const link = response.headers
      .get("Link")
      ?.match(/<([^>]+)>;\s*rel="?next"?/i)?.[1];
    if (link && parsed && !Array.isArray(parsed) && !parsed._links?.next)
      parsed._links = { ...parsed._links, next: link };
    return parsed;
  }
  private async exchange(input: object, previous?: Tokens): Promise<Tokens> {
    const data = z
      .object({
        access_token: z.string().min(1),
        refresh_token: z.string().optional(),
        expires_in: z.number().positive(),
        scope: z.string().optional(),
      })
      .parse(
        await this.json("https://auth.atlassian.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            client_id: this.options.clientId,
            client_secret: this.options.clientSecret,
          }),
        }),
      );
    demand(
      data.refresh_token ?? previous?.refresh_token,
      502,
      "Confluence did not provide offline access. Reconnect with the offline access scope.",
    );
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? previous!.refresh_token,
      expires: Date.now() + data.expires_in * 1000,
      scope: data.scope ?? previous?.scope ?? scopes,
    };
  }
  async callback(state: string, code?: string, denied = false) {
    const pending = this.storage.state<{
      state: string;
      expires: number;
      allowEdits: boolean;
    }>("oauth");
    demand(
      pending && pending.state === state && pending.expires > Date.now(),
      400,
      "This connection request expired. Start again in Settings.",
    );
    this.storage.setState("oauth", null);
    demand(
      !denied && code,
      400,
      "Confluence access wasn’t granted. You can connect again in Settings.",
    );
    const epoch = this.generation;
    const token = await this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.options.redirectUri,
    });
    demand(
      epoch === this.generation,
      409,
      "The connection changed. Connect again in Settings.",
    );
    this.generation++;
    this.storeTokens(token);
    for (const b of this.storage.bindings())
      if (!b.migrated) this.storage.availability(b.id, false);
    this.domain.reconcile(false);
    this.save({
      ...this.config(),
      allowEdits:
        pending.allowEdits &&
        token.scope.split(" ").includes("write:page:confluence"),
      authorized: true,
      error: undefined,
      nextAt: 0,
    });
  }
  private async access() {
    demand(
      this.storage.safePrivateState,
      422,
      "Private state must be outside the knowledge repository.",
    );
    const old = this.tokens();
    demand(
      old && this.config().authorized,
      401,
      "Connect Confluence in Settings first.",
    );
    if (old.expires > Date.now() + 60_000) return old;
    if (!this.refreshPromise) {
      const epoch = this.generation;
      this.refreshPromise = this.exchange(
        { grant_type: "refresh_token", refresh_token: old.refresh_token },
        old,
      )
        .then((token) => {
          demand(epoch === this.generation, 409, "The connection changed.");
          this.storeTokens(token);
          return token;
        })
        .finally(() => {
          this.refreshPromise = undefined;
        });
    }
    return this.refreshPromise;
  }
  async sites(): Promise<Site[]> {
    const token = await this.access();
    return z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string(),
          url: z
            .string()
            .url()
            .refine((s) => new URL(s).protocol === "https:"),
          scopes: z.array(z.string()),
        }),
      )
      .parse(
        await this.json(
          "https://api.atlassian.com/oauth/token/accessible-resources",
          { headers: { Authorization: `Bearer ${token.access_token}` } },
        ),
      )
      .filter(
        (site) =>
          site.scopes.includes("read:page:confluence") &&
          site.scopes.includes("read:space:confluence"),
      );
  }
  private async api(
    path: string,
    init: RequestInit = {},
    site = this.config().site,
  ) {
    demand(site, 422, "Choose a Confluence site first.");
    const base = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(site.id)}`;
    const url = new URL(path.startsWith("/wiki/") ? base + path : path, base);
    demand(
      url.origin === "https://api.atlassian.com" &&
        url.pathname.startsWith(
          `/ex/confluence/${encodeURIComponent(site.id)}/wiki/`,
        ),
      502,
      "Confluence returned an unexpected pagination address.",
    );
    const token = await this.access();
    return this.json(url.toString(), {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  }
  private next(data: any, site: Site) {
    const next = data._links?.next;
    if (!next) return undefined;
    const base = `https://api.atlassian.com/ex/confluence/${encodeURIComponent(site.id)}`;
    return next.startsWith("/wiki/")
      ? base + next
      : new URL(next, base + "/wiki/api/v2/").toString();
  }
  async spaces(siteId: string) {
    const site = (await this.sites()).find((s) => s.id === siteId);
    demand(site, 404, "This Confluence site is unavailable.");
    const result: { id: string; name: string; key: string }[] = [];
    let path: string | undefined =
      "/wiki/api/v2/spaces?limit=100&status=current";
    for (let page = 0; path && page < 100; page++) {
      const data = await this.api(path, {}, site);
      result.push(
        ...z
          .array(
            z.object({
              id: z.string().regex(/^\d+$/),
              name: z.string(),
              key: z.string(),
            }),
          )
          .parse(data.results),
      );
      path = this.next(data, site);
    }
    demand(
      !path,
      502,
      "Too many spaces to list. Narrow the connection account’s access.",
    );
    return result;
  }
  async configure(input: unknown) {
    demand(
      !this.busy,
      409,
      "Wait for the active sync before changing this connection.",
    );
    const value = z
      .object({
        siteId: z.string(),
        spaces: z.array(z.string().regex(/^\d+$/)).min(1).max(100),
        allowEdits: z.boolean().default(false),
        intervalMinutes: z.number().int().min(1).max(60).default(5),
      })
      .strict()
      .parse(input);
    const site = (await this.sites()).find((s) => s.id === value.siteId);
    demand(site, 404, "Choose an accessible Confluence site.");
    demand(
      !value.allowEdits || site.scopes.includes("write:page:confluence"),
      403,
      "Reconnect Confluence with editing enabled before allowing edits.",
    );
    const allowed = new Set((await this.spaces(site.id)).map((s) => s.id));
    demand(
      value.spaces.every((s) => allowed.has(s)),
      422,
      "Choose accessible Confluence spaces.",
    );
    this.generation++;
    for (const b of this.storage.bindings()) {
      const content = this.storage.read(`records/${b.id}.md`);
      const source = content
        ? (decode(content).extensions["titan:confluence"] as any)
        : undefined;
      if (
        !b.migrated &&
        (b.site !== site.id || !value.spaces.includes(source?.spaceId))
      )
        this.storage.availability(b.id, false);
    }
    this.save({
      site,
      spaces: [...new Set(value.spaces)],
      allowEdits: value.allowEdits,
      intervalMinutes: value.intervalMinutes,
      authorized: true,
      nextAt: 0,
      seen: [],
      attempts: 0,
    });
    this.domain.reconcile(false);
    return this.status();
  }
  disconnect() {
    this.generation++;
    this.storeTokens(undefined);
    this.storage.setState("oauth", null);
    for (const b of this.storage.bindings())
      if (!b.migrated) this.storage.availability(b.id, false);
    this.save({
      spaces: [],
      allowEdits: false,
      intervalMinutes: 5,
      nextAt: 0,
      seen: [],
      authorized: false,
      attempts: 0,
    });
    this.domain.reconcile(false);
    return this.status();
  }
  schedule() {
    const c = this.config();
    demand(
      c.authorized && c.site,
      422,
      "Choose a site and spaces before syncing.",
    );
    demand(!this.busy, 409, "Confluence is already syncing.");
    this.save({ ...c, nextAt: 0 });
    return this.status();
  }
  private ingest(page: SourcePage, site: Site) {
    const binding = this.storage.bind(site.id, page.id, uid());
    this.storage.availability(binding.id, true);
    this.storage.setState("remote:" + binding.id, {
      version: page.version.number,
      checkedAt: now(),
    });
    if (binding.migrated) return;
    const beforeRaw = this.storage.read(`records/${binding.id}.md`);
    const before = beforeRaw ? decode(beforeRaw) : undefined;
    const source = before?.extensions["titan:confluence"] as any;
    if (source?.version === page.version.number) return;
    demand(
      page.body?.storage?.value !== undefined,
      502,
      "Confluence did not return the page body.",
    );
    const normalized = normalizeConfluence(page.body.storage.value, site.url);
    if (normalized.body.length > 100_000) {
      normalized.body =
        normalized.body.slice(0, 99_800) +
        "\n\nOpen the original in Confluence to read the remaining content.";
      normalized.issues.push("Page size needs review");
    }
    if (page.title.length > 200)
      normalized.issues.push("Long page title needs review");
    const sourceUrl = new URL(
      page._links?.webui ?? `/wiki/spaces/${page.spaceId}/pages/${page.id}`,
      site.url,
    );
    demand(
      sourceUrl.origin === new URL(site.url).origin,
      502,
      "Confluence returned an unexpected source link.",
    );
    const unit = {
      ...(before ?? {
        schemaVersion: 1,
        id: binding.id,
        kind: "knowledge",
        status: "draft",
        validity: "unverified",
        authority: "hypothesis",
        applicability: [],
        createdAt: page.createdAt ?? now(),
        lifecycle: "active",
      }),
      title: page.title.slice(0, 200),
      body: normalized.body,
      updatedAt: page.version.createdAt ?? now(),
      extensions: {
        ...before?.extensions,
        "titan:confluence": {
          siteId: site.id,
          pageId: page.id,
          spaceId: page.spaceId,
          parentId: page.parentId ?? null,
          url: sourceUrl.toString(),
          version: page.version.number,
          authorId: page.version.authorId ?? page.authorId ?? null,
          owner: "confluence",
          issues: normalized.issues,
        },
      },
    };
    this.storage.setState("raw:" + binding.id, {
      version: page.version.number,
      title: page.title,
      body: page.body.storage.value,
      links: normalized.links,
    });
    delete (unit as any).revision;
    this.domain.observeConnected(unit, before);
  }
  async tick() {
    if (this.busy || !this.storage.safePrivateState) return;
    const c = this.config();
    if (!c.authorized || !c.site || !c.spaces.length || c.nextAt > Date.now())
      return;
    this.busy = true;
    const epoch = this.generation;
    try {
      const path =
        c.cursor ??
        `/wiki/api/v2/pages?space-id=${c.spaces.join(",")}&status=current&limit=10`;
      const data = await this.api(path);
      if (epoch !== this.generation) return;
      const pages = z.array(Page).parse(data.results);
      const seen = new Set(c.seen);
      for (const page of pages) {
        if (!c.spaces.includes(page.spaceId) || page.status !== "current")
          continue;
        const binding = this.storage
          .bindings()
          .find((b) => b.site === c.site!.id && b.page === page.id);
        const content = binding
          ? this.storage.read(`records/${binding.id}.md`)
          : null;
        const oldVersion = content
          ? (decode(content).extensions["titan:confluence"] as any)?.version
          : undefined;
        let complete = page;
        if (
          !binding?.migrated &&
          oldVersion !== page.version.number &&
          page.body?.storage?.value === undefined
        ) {
          complete = Page.parse(
            await this.api(`/wiki/api/v2/pages/${page.id}?body-format=storage`),
          );
          if (epoch !== this.generation) return;
        }
        if (
          complete.status !== "current" ||
          !c.spaces.includes(complete.spaceId)
        )
          continue;
        this.ingest(complete, c.site);
        seen.add(page.id);
      }
      const cursor = this.next(data, c.site);
      if (cursor)
        this.save({
          ...c,
          cursor,
          seen: [...seen],
          attempts: 0,
          nextAt: Date.now() + 1000,
          error: undefined,
        });
      else {
        for (const b of this.storage.bindings())
          if (b.site === c.site.id && !b.migrated && !seen.has(b.page))
            this.storage.availability(b.id, false);
        this.save({
          ...c,
          cursor: undefined,
          seen: [],
          attempts: 0,
          nextAt: Date.now() + c.intervalMinutes * 60_000,
          lastSync: now(),
          error: undefined,
        });
      }
      this.domain.reconcile(false);
      if (!cursor) {
        const bindings = this.storage
          .bindings()
          .filter((b) => b.site === c.site!.id);
        const pairs: { source: string; target: string }[] = [];
        for (const binding of bindings.filter(
          (b) => b.visible && !b.migrated,
        )) {
          const raw = this.storage.state<{ links?: string[] }>(
            "raw:" + binding.id,
          );
          for (const href of raw?.links ?? []) {
            try {
              const url = new URL(href);
              if (url.origin !== new URL(c.site!.url).origin) continue;
              const pageId =
                url.pathname.match(/\/pages\/(\d+)(?:\/|$)/)?.[1] ??
                url.searchParams.get("pageId");
              const target = bindings.find((b) => b.page === pageId);
              if (target) pairs.push({ source: binding.id, target: target.id });
            } catch {}
          }
        }
        this.domain.proposeConnectedLinks(pairs);
      }
    } catch (e) {
      if (epoch !== this.generation) return;
      if (e instanceof RemoteError && e.remoteStatus === 401) {
        for (const b of this.storage.bindings())
          if (!b.migrated) this.storage.availability(b.id, false);
      }
      const attempts = c.attempts + 1;
      this.save({
        ...c,
        attempts,
        error:
          e instanceof RemoteError
            ? e.message
            : "Titan couldn’t sync Confluence. Your existing knowledge has been kept.",
        nextAt:
          Date.now() +
          Math.max(
            e instanceof RemoteError ? e.retrySeconds * 1000 : 0,
            Math.min(60_000 * 2 ** Math.min(attempts, 5), 15 * 60_000),
          ),
      });
      this.domain.reconcile(false);
    } finally {
      this.busy = false;
    }
  }
  async refreshPage(id: string) {
    const before = this.domain.get(OWNER, id);
    const source = before.extensions["titan:confluence"] as any;
    demand(
      source?.owner === "confluence",
      422,
      "This page is managed in Titan.",
    );
    const c = this.config();
    demand(
      c.site?.id === source.siteId && c.spaces.includes(source.spaceId),
      404,
      "This page is outside the connected spaces.",
    );
    const epoch = this.generation;
    try {
      const page = Page.parse(
        await this.api(
          `/wiki/api/v2/pages/${source.pageId}?body-format=storage`,
        ),
      );
      demand(epoch === this.generation, 409, "The connection changed.");
      if (page.status !== "current" || !c.spaces.includes(page.spaceId)) {
        this.storage.availability(id, false);
        this.domain.reconcile(false);
      }
      demand(
        page.status === "current" && c.spaces.includes(page.spaceId),
        404,
        "This page is unavailable.",
      );
      this.ingest(page, c.site!);
      this.domain.reconcile(false);
      return this.domain.get(OWNER, id);
    } catch (e) {
      if (
        epoch === this.generation &&
        e instanceof RemoteError &&
        [401, 403, 404].includes(e.remoteStatus)
      ) {
        this.storage.availability(id, false);
        this.domain.reconcile(false);
      }
      throw e;
    }
  }
  async publishDraft(id: string, version: number) {
    demand(
      !this.busy,
      409,
      "Wait for the active sync before saving to Confluence.",
    );
    const draft = this.domain.composerDrafts(OWNER).find((d) => d.id === id);
    demand(
      draft && draft.version === version && draft.source,
      409,
      "This draft changed. Reopen it before saving.",
    );
    const before = this.domain.get(OWNER, draft.source.id);
    const c = this.config();
    const epoch = this.generation;
    const source = before.extensions["titan:confluence"] as any;
    demand(
      source?.owner === "confluence" && this.config().allowEdits,
      403,
      "This connection is read only. Enable editing in Settings before saving.",
    );
    demand(
      !source.issues?.length,
      422,
      "This page has formatting Titan cannot safely write back. Your draft has been kept.",
    );

    const markup = confluenceMarkup(draft.body);
    demand(
      draft.title.trim() && draft.body.trim(),
      422,
      "Add a title and content before saving.",
    );
    const receiptKey = `write:${id}:${version}`;
    const receipt = this.storage.state<{
      title: string;
      markup: string;
      sourceVersion: number;
    }>(receiptKey);
    demand(
      before.revision === draft.source.revision ||
        (receipt && source.version === receipt.sourceVersion + 1),
      409,
      "This page changed. Compare the latest page before saving.",
    );
    this.busy = true;
    try {
      const current = Page.parse(
        await this.api(
          `/wiki/api/v2/pages/${source.pageId}?body-format=storage`,
        ),
      );
      demand(
        epoch === this.generation,
        409,
        "The connection changed. Your draft has been kept.",
      );
      if (current.status !== "current" || !c.spaces.includes(current.spaceId)) {
        this.storage.availability(before.id, false);
        this.domain.reconcile(false);
        throw new RemoteError(404);
      }
      if (!(
        receipt &&
        current.version.number === receipt.sourceVersion + 1 &&
        current.title === receipt.title &&
        current.body?.storage?.value !== undefined &&
        normalizeConfluence(current.body.storage.value).body ===
          normalizeConfluence(receipt.markup).body
      )) {
        if (current.version.number !== source.version) {
          this.ingest(current, c.site!);
          this.domain.reconcile(false);
          throw new RemoteError(409);
        }
        this.storage.setState(receiptKey, {
          title: draft.title,
          markup,
          sourceVersion: source.version,
        });
        await this.api(`/wiki/api/v2/pages/${source.pageId}`, {
          method: "PUT",
          body: JSON.stringify({
            id: source.pageId,
            status: "current",
            title: draft.title,
            body: { representation: "storage", value: markup },
            version: {
              number: source.version + 1,
              message: `Titan draft ${id} version ${version}`,
            },
          }),
        });
      }
      demand(
        epoch === this.generation,
        409,
        "The connection changed. Your draft has been kept.",
      );
      const saved = Page.parse(
        await this.api(
          `/wiki/api/v2/pages/${source.pageId}?body-format=storage`,
        ),
      );
      demand(
        epoch === this.generation,
        409,
        "The connection changed. Your draft has been kept.",
      );
      this.ingest(saved, c.site!);
      this.domain.reconcile(false);
      if (
        saved.version.number !==
          (receipt?.sourceVersion ?? source.version) + 1 ||
        saved.title !== draft.title ||
        saved.body?.storage?.value === undefined ||
        normalizeConfluence(saved.body.storage.value).body !==
          normalizeConfluence(markup).body
      )
        throw new RemoteError(409);
      let result = this.domain.get(OWNER, before.id);
      if (
        JSON.stringify(result.applicability) !==
        JSON.stringify(draft.applicability)
      )
        result = this.domain.edit(
          OWNER,
          result.id,
          result.revision,
          { applicability: draft.applicability },
          "Owner updated connected page applicability",
        ) as RecordView;
      this.domain.index.db
        .prepare(
          "UPDATE composer_drafts SET published_id=? WHERE id=? AND json_extract(data,'$.version')=?",
        )
        .run(result.id, id, version);
      this.domain.log(
        OWNER,
        "confluence_write",
        [result],
        "Owner saved a draft to Confluence",
        "applied",
        { resultingRevisions: { [result.id]: result.revision } },
      );
      return result;
    } finally {
      this.busy = false;
    }
  }
  sourceStatus(id: string) {
    const record = this.domain.get(OWNER, id);
    const source = record.extensions["titan:confluence"] as any;
    demand(source, 404, "This page has no Confluence source.");
    const remote = this.storage.state<{ version: number; checkedAt: string }>(
      "remote:" + id,
    );
    return {
      latestObservedVersion: remote?.version ?? source.version,
      checkedAt: remote?.checkedAt ?? null,
    };
  }
  previewMigration(id: string) {
    const record = this.domain.get(OWNER, id);
    const source = record.extensions["titan:confluence"] as any;
    demand(
      source?.owner === "confluence",
      422,
      "This page already belongs to Titan.",
    );
    return {
      id,
      revision: record.revision,
      title: record.title,
      sourceUrl: source.url,
      sourceVersion: source.version,
      issues: source.issues ?? [],
      canMove: !source.issues?.length,
      connections: this.domain
        .assertions(OWNER)
        .filter((a) => a.source === id || a.target === id).length,
    };
  }
  private finishMigration(id: string) {
    const pending = this.storage.state<{
      unit: Unit;
      before: string;
      revision: string;
      completed: boolean;
    }>("migration:" + id);
    if (!pending || pending.completed) return;
    this.domain.reconcile(false);
    const result = this.domain.get(OWNER, id);
    demand(
      result.revision === pending.revision,
      409,
      "The migrated page changed before its connections could be preserved.",
    );
    const connections = this.domain
      .assertions(OWNER)
      .filter((a) => a.revisions[id] === pending.before);
    if (connections.length)
      this.storage.transaction(
        connections.map((a) => ({
          path: `.titan/assertions/${a.id}.json`,
          content:
            JSON.stringify(
              { ...a, revisions: { ...a.revisions, [id]: result.revision } },
              null,
              2,
            ) + "\n",
        })),
        "Titan: preserve connections after ownership transfer",
      );
    this.domain.log(
      OWNER,
      "confluence_migration",
      [result],
      "Owner moved this page to Titan; the Confluence original remains",
      "applied",
    );
    this.storage.setState("migration:" + id, { ...pending, completed: true });
  }
  private recoverMigrations() {
    const rows = this.storage.db
      .prepare("SELECT key,value FROM state WHERE key LIKE 'migration:%'")
      .all() as { key: string; value: string }[];
    for (const row of rows) {
      const pending = JSON.parse(row.value) as {
        unit: Unit;
        revision: string;
        completed: boolean;
      };
      if (pending.completed) continue;
      const content = this.storage.git.read(`records/${pending.unit.id}.md`);
      if (content && decode(content).revision === pending.revision) {
        this.storage.migrate(pending.unit);
        this.finishMigration(pending.unit.id);
      }
    }
  }
  async migrate(id: string, revision: string) {
    await this.refreshPage(id);
    const record = this.domain.get(OWNER, id);
    demand(
      record.revision === revision,
      409,
      "The source changed. Review a new migration preview.",
    );
    demand(
      this.previewMigration(id).canMove,
      422,
      "Review unsupported content in Confluence before moving this page.",
    );
    const { revision: _, ...unit } = record;
    const source = unit.extensions["titan:confluence"] as any;
    const moved = {
      ...unit,
      extensions: {
        ...unit.extensions,
        "titan:confluence": { ...source, owner: "titan" },
      },
    };
    this.storage.setState("migration:" + id, {
      unit: moved,
      before: record.revision,
      revision: hash(encode(moved)),
      completed: false,
    });
    this.storage.migrate(moved);
    this.finishMigration(id);
    return this.domain.get(OWNER, id);
  }
}
