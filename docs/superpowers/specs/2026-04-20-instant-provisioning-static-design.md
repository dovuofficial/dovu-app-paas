# Instant Provisioning — Static Sites (Phase A)

**Status:** Design
**Date:** 2026-04-20
**Author:** Matt Smithies

## Goal

Collapse the time between "I want a website" and "URL is live" to effectively zero, by splitting deploy into two steps:

1. **`prewarm`** — allocate the URL and infrastructure the moment the agent knows what the user wants to build. URL is live immediately with a placeholder.
2. **`deploy`** — upload built content into the pre-provisioned slot via atomic directory swap.

Phase A covers static sites only. Phase B (separate spec) will extend the same `prewarm` tool surface to Bun and Node via warm containers.

## Why

Current deploys are cold every time: detect → `docker build` → save → transfer → run → nginx → ~60–120s. For agent-driven workflows, deploy should feel like a serverless function invocation — the URL is real before the code is written.

For static content specifically, there is no runtime to warm; nginx can serve files directly from a host directory. This phase leans into that: no Docker in the static path at all.

## Non-goals

- Dynamic runtimes (Bun, Node, Laravel, Go, etc.) — deferred to Phase B.
- Speculative prewarming based on agent intent inference — v1 uses an explicit `prewarm` tool call by the agent.
- Rollback of a bad deploy — future work.
- Concurrency safety — single-writer assumption per slot.
- Name changes after prewarm — future optimization; today, `destroy` + `prewarm` under a new name.

## Design summary

### Two coexisting deploy paths

| Path | Triggered by | Handler | Time budget |
|---|---|---|---|
| Warm-slot (new, Phase A) | `prewarm` followed by `deploy` | nginx-direct, no Docker | prewarm ~2s, deploy ~1–2s |
| Container (existing, unchanged) | `deploy` with no prior prewarm, or non-static framework | existing `buildImage` + `provider.transferImage` | ~60–120s |

The warm-slot path is a **fast path that short-circuits the existing deploy flow when a slot record is present in state**. All existing functionality is preserved; warm slots are purely additive.

### New tool: `prewarm`

```ts
prewarm({
  name: string,               // required, slugified
  framework: "static",        // v1: only "static"
  deployer?: string,          // prefixes subdomain, same as deploy
})
  → { url, slot, placeholder: true }
```

Behavior:

1. Slugify `name` + optional `deployer` → subdomain label (`{name}` or `{name}-{deployer}`).
2. If a deployment or warm slot already exists with this label: return existing URL (idempotent, zero provider calls).
3. `mkdir -p /opt/deploy-ops/sites/{label}-initial/` on the target via `provider.exec`.
4. Write a generated placeholder `index.html` into `{label}-initial/`.
5. `ln -sfn {label}-initial /opt/deploy-ops/sites/{label}` — create the stable symlink nginx will point at.
6. Write a new nginx `server` block (root-based, not `proxy_pass`) to `{provider.nginxConfDir}/dovu-app-paas-{label}.conf`.
7. `nginx -s reload`.
8. Persist state record with `kind: "static-slot"`, `status: "provisioned"`, `currentRevision: "initial"`.
9. Return `{ url, slot, placeholder: true }`.

### Modified tool: `deploy`

`deploy` gains a state lookup at the top. If an entry exists with `kind: "static-slot"` matching the resolved label, take the fast path:

1. Decode base64 tar.gz from `source` parameter (existing pattern).
2. Transfer tar.gz to target (or skip for host provider where tar is already local).
3. `tar -xzf` into a fresh revision directory: `/opt/deploy-ops/sites/{label}-rev-{ts}/`.
4. **Atomic symlink swap:** `ln -sfn {label}-rev-{ts} {label}`. This uses `rename(2)` under the hood — genuinely atomic, no window where the path is missing.
5. Async cleanup: `rm -rf` any `{label}-rev-*` directories that are not the current symlink target.
6. Update state: `status: "running"`, `updatedAt` refreshed.
7. Return the same `{ url, steps }` shape as today — **no Docker calls, no nginx reload**.

If no warm-slot record is present, `deploy` falls through to the existing container path unchanged.

**Layout after prewarm:**

```
/opt/deploy-ops/sites/
├── cat-blog          → symlink to cat-blog-initial
└── cat-blog-initial/
    └── index.html    ← placeholder
```

**Layout after first deploy:**

```
/opt/deploy-ops/sites/
├── cat-blog          → symlink to cat-blog-rev-1a2b3c
└── cat-blog-rev-1a2b3c/
    ├── index.html
    ├── style.css
    └── ...
```

The nginx `root` points at `/opt/deploy-ops/sites/{label}` (the symlink); nginx resolves it per request.

### Modified tool: `destroy`

- If state record has `kind: "static-slot"`: `rm -rf /opt/deploy-ops/sites/{label} /opt/deploy-ops/sites/{label}-*` (symlink + all revision dirs), `rm` nginx conf, `nginx -s reload`, drop state. No Docker calls.
- Else: existing container destroy path.

### New internal module: `src/engine/warm.ts`

Pure-ish helpers that keep `register.ts` thin and unit-testable:

- `generatePlaceholderHtml(name: string): string` — returns an HTML page that shows `"{name} is provisioning…"` with minimal styling.
- `generateStaticNginxConfig({serverName, sitePath, ssl?}): string` — produces a `server { ... root ...; try_files $uri $uri/ /index.html; }` block. SSL and non-SSL variants via the same `ssl?` shape as `generateNginxConfig`.
- `provisionStaticSlot(provider, label): Promise<void>` — orchestrates steps 3–6 of the prewarm flow.
- `deployStaticSlot(provider, label, sourceB64): Promise<void>` — orchestrates the tar extract + atomic swap.
- `destroyStaticSlot(provider, label): Promise<void>` — orchestrates the rm + nginx reload.

### State schema change

`DeploymentRecord` (in `src/types.ts`) gets:

```ts
kind?: "container" | "static-slot";        // undefined = "container" (backward compat)
status: "running" | "stopped" | "provisioned";  // widened from "running" | "stopped"
currentRevision?: string;                  // only for static-slot, e.g. "initial" or "rev-1a2b3c"
```

For `kind: "static-slot"`, `image`, `containerId`, `hostPort`, and `port` become optional (omitted). `status: "provisioned"` means the slot exists with a placeholder but has not yet received content.

`ls` and `status` branch on `kind`:

- Static slots report `running` if the site symlink resolves to an existing target directory.
- `status` response for a static slot reports `currentRevision` instead of CPU/memory/restart count.
- `logs` for a static slot returns a friendly message: `"Static sites have no logs. Check nginx access logs on the droplet."`

### Provider interface change

The `Provider` interface currently has `transferImage(tarballPath)` which specifically ends with `docker load`. Warm-slot deploy needs a **generic file transfer** that writes a local file to an arbitrary remote path.

Add one method to `src/providers/provider.ts`:

```ts
transferFile(localPath: string, remotePath: string): Promise<void>;
```

Per-provider implementation:

- **HostProvider**: `cp localPath remotePath` via `sh -c` (same host).
- **LocalProvider** (DinD): `docker cp localPath dind-container:remotePath`.
- **DigitalOceanProvider**: `scp` using existing SSH key (same pattern as `transferImage`, minus the `docker load` step).

Existing `transferImage` keeps its current semantics — no rename, no merge.

### Placeholder HTML

Generated at prewarm time, written once. Deploy never re-writes a placeholder — the tar extract simply overwrites `index.html` (and everything else). The placeholder is a single self-contained HTML file: inline CSS, no external assets.

Contents (approximate):

```html
<!doctype html>
<title>{name} — provisioning…</title>
<style>body{font:16px system-ui;max-width:40ch;margin:10vh auto;padding:1rem;color:#444}</style>
<h1>{name}</h1>
<p>This app is being provisioned. The agent is working on it — check back in a moment.</p>
```

### Nginx template

Static sites use `root` directly; no `proxy_pass`. SPA fallback via `try_files`.

```nginx
server {
    listen 443 ssl;
    server_name {serverName};

    ssl_certificate     {certPath};
    ssl_certificate_key {keyPath};

    root /opt/deploy-ops/sites/{label};
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

(Local provider variant: `listen 80`, no ssl block — matches the pattern in `generateNginxConfig`.)

## Architecture

```
┌─────────────────┐     ┌─────────────────────────────────────────┐
│  Claude Code    │     │          Droplet / host                 │
│                 │     │                                          │
│  1. prewarm ────┼────►│  sites/{name} → {name}-initial/          │
│                 │     │                 └─ index.html (placeholder) │
│                 │     │                                          │
│                 │     │  nginx conf.d/{name}.conf                │
│                 │     │    root /opt/deploy-ops/sites/{name}     │
│                 │     │                                          │
│  2. builds app  │     │                                          │
│                 │     │                                          │
│  3. deploy ─────┼────►│  extract tar → {name}-rev-{ts}/          │
│                 │     │  ln -sfn {name}-rev-{ts} {name}          │
│                 │     │  cleanup old revs async                  │
│                 │     │                                          │
└─────────────────┘     └─────────────────────────────────────────┘
```

The wildcard SSL cert (`*.apps.yourdomain.com`) is already provisioned on the droplet, so new subdomains do not require cert acquisition — nginx reload is the only step that makes the URL live.

## Data flow

### Prewarm

```
Agent → prewarm({name: "cat-blog", framework: "static"})
  │
  ├─ state lookup → slot/deployment exists? → return existing URL (idempotent)
  │
  ├─ provider.exec: mkdir -p /opt/deploy-ops/sites/cat-blog-initial
  ├─ provider.exec: write placeholder index.html into cat-blog-initial/
  │                 (base64 pipe, same pattern as nginx conf today)
  ├─ provider.exec: ln -sfn cat-blog-initial /opt/deploy-ops/sites/cat-blog
  ├─ provider.exec: write nginx conf → /etc/nginx/conf.d/dovu-app-paas-cat-blog.conf
  ├─ provider.exec: nginx -s reload
  ├─ writeState({kind: "static-slot", status: "provisioned",
  │              currentRevision: "initial", name, domain, createdAt})
  │
  └─ return { url, slot: "cat-blog", placeholder: true }
```

### Deploy (fast path)

```
Agent → deploy({name: "cat-blog", source: <b64 tar.gz>})
  │
  ├─ state lookup → kind === "static-slot"? → fast path
  │
  ├─ write tar.gz to local tmpdir (decode from b64)
  ├─ provider.transferFile(tmpTar, /tmp/cat-blog-rev-{ts}.tar.gz)
  │                 (no-op for host provider — already local)
  ├─ provider.exec: mkdir -p sites/cat-blog-rev-{ts}
  ├─ provider.exec: tar -xzf /tmp/...tar.gz -C sites/cat-blog-rev-{ts}
  ├─ provider.exec: ln -sfn cat-blog-rev-{ts} sites/cat-blog  ← atomic swap
  ├─ provider.exec: rm -rf /tmp/cat-blog-rev-{ts}.tar.gz
  ├─ provider.exec: find sites/cat-blog-rev-* -maxdepth 0 -type d
  │                 ! -name cat-blog-rev-{ts} | xargs rm -rf  (fire-and-forget)
  ├─ writeState({...record, status: "running",
  │              currentRevision: "rev-{ts}", updatedAt: now})
  │
  └─ return { url, steps: ["Transferred", "Extracted", "Swapped"] }   ← no nginx reload
```

### Destroy

- `kind === "static-slot"`: `rm -rf sites/{label} sites/{label}-*` (symlink + all revs) + rm nginx conf + reload nginx + drop state.
- Else: existing container destroy path.

## Error handling

| Failure | State left behind | Recovery |
|---|---|---|
| `mkdir` fails at prewarm | nothing | prewarm returns error; agent retries |
| nginx config write fails | initial dir + symlink exist | prewarm returns error; retry is safe (idempotent mkdir + ln + write) |
| nginx reload fails | dir + symlink + conf exist, URL not live | prewarm returns error; `destroy` cleans up, agent re-prewarms |
| File transfer fails | partial tar.gz at /tmp | deploy's `finally` `rm -rf`s the partial tar; symlink unchanged |
| Tar extraction fails mid-way | `{label}-rev-{ts}/` partial | deploy's `finally` `rm -rf`s the rev dir; symlink unchanged |
| `ln -sfn` fails after extraction | new rev dir exists but symlink unchanged | symlink is still pointing at previous rev; next deploy's cleanup handles orphan |
| Deploy called for non-existent slot | — | falls through to existing container path (backward compatible) |

**Invariants:**

- Placeholder is written **only** at prewarm into `{label}-initial/`. Deploy never touches `-initial/` (it creates a new `-rev-{ts}/` dir).
- Atomic symlink swap (`ln -sfn` using `rename(2)` under the hood) means the path `sites/{label}` always resolves to a complete directory. No request window sees a missing or half-written directory.
- Nginx is reloaded **once** at prewarm. Deploy does not reload — the nginx `root` points at a stable symlink path; swapping the symlink target is transparent to nginx (`root` is re-resolved per request).
- Old revisions are cleaned asynchronously after a successful swap. A crash between swap and cleanup leaves orphan directories that the next deploy's cleanup removes.

## Concurrency

Not addressed in v1. Two parallel deploys to the same slot could race on the symlink swap (both could succeed, but the cleanup step might delete the other's rev dir mid-read). The agent is the single writer per slot in normal operation. Revisit in Phase B if warm containers need it.

## Testing

### Unit tests (`test/warm.test.ts`, bun test)

- `generatePlaceholderHtml("cat-blog")` contains the name, renders as valid HTML.
- `generateStaticNginxConfig` produces SSL and non-SSL variants with the correct `root`, `try_files`, `server_name`.
- Slug + deployer label composition matches the existing `slugify` / `{name}-{deployer}` pattern from `register.ts`.
- State record round-trip: `kind: "static-slot"` serializes and deserializes correctly.

### Integration tests (mocked provider)

Use a fake `Provider` that records `exec` and `transferFile` calls to an ordered log. Verify the call sequence and arguments for:

- `prewarm` on empty state → ordered: mkdir `{label}-initial`, placeholder write, `ln -sfn` symlink, nginx conf write, nginx reload. State record written with `kind: "static-slot"`, `status: "provisioned"`, `currentRevision: "initial"`.
- `prewarm` on existing slot → **zero** provider calls, returns cached URL.
- `deploy` on warm slot → ordered: `transferFile`, mkdir rev dir, tar extract, `ln -sfn` swap, cleanup of old revs. **No** docker calls, **no** nginx reload. State updated with new `currentRevision`.
- `deploy` on no slot → falls through to existing container path (regression guard: existing tests continue to pass unchanged).
- `destroy` on warm slot → rm site dir (including all revs + symlink), rm conf, nginx reload. **No** docker stop/rm.

### Harness test (one-shot, manual)

Add a single task to `harness/matrix.ts` exercising the new path end-to-end on the real droplet:

- `static-warm-t-01`: agent prewarms a slot, verifies the placeholder is served over HTTPS, builds a minimal static page, deploys it, verifies the content swap, destroys, verifies 404.

Not part of the 100-task matrix — standalone validation.

### Manual smoke (local provider)

```bash
# 1. prewarm cat-blog static → open URL, see placeholder
# 2. deploy cat-blog with local dist/ → reload URL, see real site
# 3. deploy cat-blog again with different content → verify swap <2s
# 4. destroy cat-blog → verify 404
```

## Out of scope for v1

- Concurrency (single-writer assumption).
- Rollback (future: skip async cleanup, add `rollback` tool that re-symlinks to the previous `{label}-rev-*`).
- Name changes after prewarm (future: rename all `{label}-*` dirs + symlink + nginx conf + state).
- Dynamic frameworks (Phase B: Bun/Node warm containers).
- Speculative prewarming from agent intent inference.

## Phase B preview (for context, not part of this spec)

When we extend to Bun/Node, the same `prewarm` tool surface accepts `framework: "bun" | "node"`. Under the hood, it dispatches to a container-based handler:

1. Prewarm starts a warm container running the existing static file server (or a generic "waiting" process), allocates a host port, wires nginx via `proxy_pass`. URL is live with a placeholder.
2. Deploy `docker cp`s the project source into `/app/`, then either triggers the container's watcher or sends a restart signal.

The static-slot atomic-swap discipline from Phase A becomes the template for the container's `cp`+restart flow. The `kind` discriminator expands to include `"warm-container"`.
