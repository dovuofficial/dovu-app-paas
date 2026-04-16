# Agent Training Harness — Strategy

## Concept

Run 100+ Claude agents, each generating a project in a different language/framework, deploying via the remote MCP server, iterating on failures until success, and filing structured GitHub issues with what broke and how it was fixed.

This is reinforcement training for the deploy platform — but instead of gradient updates, the feedback loop is GitHub issues that become the fix backlog.

## The Loop

Each agent runs this cycle:

```
1. Pick a random (language, framework, complexity) from the matrix
2. Generate a working project
3. Package as tar.gz, deploy via MCP source param
4. If success → file a "success" issue with metadata, stop
5. If failure → read the error, fix, retry (max N attempts)
6. If exhausted retries → file a "failure" issue with full diagnostics
```

## Tech Matrix

Each agent draws from a matrix. Start broad, weight toward common use cases:

| Category | Options |
|----------|---------|
| **Static** | Plain HTML, Tailwind landing page, D3.js visualization, SVG animation |
| **Bun** | API server, WebSocket server, file server, Bun.serve with routes |
| **Node/Express** | REST API, GraphQL endpoint, SSR template engine |
| **Astro** | Blog, marketing site, docs site, portfolio |
| **Next.js** | Dashboard, CRUD app, API routes + frontend |
| **Vite/React** | SPA, component library demo, data visualization |
| **Vite/Svelte** | Todo app, form builder, interactive widget |
| **Laravel** | API backend, admin panel, queue worker |
| **Go** | HTTP server, CLI tool with web UI, gRPC gateway |
| **Rust** | Actix-web API, Axum server, static site generator |
| **Python** | FastAPI, Flask, Streamlit dashboard |
| **Clojure** | Ring/Compojure API, Reagent SPA |
| **Ruby** | Sinatra API, Rails minimal |

**Complexity levels:**
- **Trivial** — single file, no deps (hello world)
- **Simple** — 2-5 files, 1-2 deps (landing page with CSS)
- **Standard** — package.json/deps, build step, multiple routes
- **Complex** — database, env vars, multi-stage Docker build

## Issue Template

Every agent files an issue. Successful deploys and failures both produce signal.

### Success Issue

```markdown
Title: [SUCCESS] {framework} / {complexity} — deployed in {attempts} attempt(s)

Labels: training, success, {framework}, {complexity}

## Summary
- **Framework:** Astro
- **Complexity:** Standard
- **Attempts:** 1
- **Total time:** 45s
- **URL:** https://astro-blog-agent42.apps.dovu.ai

## Project Structure
├── package.json
├── astro.config.mjs
├── src/pages/index.astro
└── public/favicon.svg

## Detection
- Runtime: bun
- Framework: none (Astro not auto-detected)
- Entrypoint: _serve.ts (static mode)
- Port: 3000

## Notes
- Had to pre-build Astro locally and ship dist/
- Platform detected as static site correctly
- Clean URL routing worked via SPA fallback
```

### Failure Issue

```markdown
Title: [FAILURE] {framework} / {complexity} — failed after {attempts} attempts

Labels: training, failure, {framework}, {complexity}, stage:{stage}

## Summary
- **Framework:** Rust/Actix-web
- **Complexity:** Simple
- **Attempts:** 5 (max)
- **Final error stage:** image_build
- **Final error:** Docker build failed: cargo not found in oven/bun:1-alpine

## Attempt Log

### Attempt 1
- **Source:** index.rs + Cargo.toml (no Dockerfile)
- **Error:** image_build — generated Bun Dockerfile, tried `bun run index.rs`
- **Fix tried:** Added Dockerfile with rust:1-alpine

### Attempt 2
- **Error:** image_build — `cargo build` OOM on 512MB droplet
- **Fix tried:** Added `--release` flag, reduced deps

### Attempt 3
- **Error:** image_build — still OOM
- **Fix tried:** Multi-stage build, build on larger tier

...

## Root Cause Analysis
The platform has no Rust runtime support. The Bun Dockerfile template is applied
to all unknown frameworks. A Rust Dockerfile template or better custom Dockerfile
detection would fix this.

## Suggested Platform Fix
- Detect `Cargo.toml` → use `rust:1-slim` base image
- Or: better error when an unrecognized language is detected with no Dockerfile
```

## Harness Implementation

### Option A: Script-based (simplest)

A Bun script that spawns N Claude Code sessions in parallel:

```typescript
// harness.ts
const MATRIX = [
  { framework: "static-html", complexity: "trivial", prompt: "Create a single-page HTML site with..." },
  { framework: "bun-api", complexity: "simple", prompt: "Create a Bun REST API that..." },
  { framework: "astro", complexity: "standard", prompt: "Create an Astro blog with..." },
  // ... 100 entries
];

for (const task of MATRIX) {
  Bun.spawn(["claude", "-p", buildPrompt(task)], {
    env: {
      ...process.env,
      // Each agent gets the MCP server config
    },
  });
}
```

The prompt for each agent:

```
You have access to the deploy-ops MCP tools. Your task:

1. Build a {framework} project: {description}
2. Deploy it using the deploy tool with source parameter
3. If it fails, read the error, fix the code, and retry (max 5 attempts)
4. When done (success or failure), create a GitHub issue on dovuofficial/dovu-app-paas
   using the gh CLI with the structured template below.

Your deployer name is "agent-{id}".
Your app name should be "{framework}-{id}".

{issue template here}
```

### Option B: Claude Code triggers (scheduled)

Use `claude schedule` or triggers to run agents on a cron. Each trigger fires one agent with one task from the matrix. Spread across hours to avoid overloading the droplet.

### Option C: Custom MCP harness tool

Add a `training-run` MCP tool to the server itself that:
1. Accepts a framework + complexity
2. Asks Claude to generate the project
3. Deploys it internally
4. Reports results

This keeps the loop entirely within the MCP ecosystem.

## Execution Plan

### Phase 1: Manual validation (5 agents)
Run 5 agents manually across different frameworks. Validate the issue template, check that the feedback is useful, tune the prompt.

### Phase 2: Parallel batch (25 agents)
Script 25 agents in parallel. Monitor the droplet for resource pressure (CPU, memory, disk). Stagger deploys if needed.

### Phase 3: Full run (100 agents)
Run the full matrix. Let it cook for an hour. Review the issues.

### Phase 4: Fix and repeat
Prioritize issues by frequency. Fix the top failures. Run again. The success rate should climb each iteration.

## Success Metrics

- **Success rate per framework** — what percentage of deploys succeed on first try?
- **Average attempts to success** — how many retries before it works?
- **Common failure stages** — which stage fails most? (unpack, inspect, build, start, nginx)
- **Coverage** — how many frameworks can deploy without a custom Dockerfile?
- **Time to first success** — how long from prompt to live URL?

Target: 90% first-try success rate for the top 10 frameworks within 3 iterations of the harness.

## Resource Considerations

- **Droplet:** Each deploy builds a Docker image. On a 512MB/1CPU droplet, builds are slow and can OOM. Consider a temporary upgrade to 2GB during training runs.
- **Disk:** Docker images accumulate. Run `docker system prune -af` between batches.
- **Concurrency:** Don't run 100 deploys simultaneously. Stagger with 5-10 concurrent agents max.
- **Cost:** Claude API usage. At ~$0.05-0.15 per agent session, 100 agents = $5-15. Cheap.
- **GitHub rate limits:** Issue creation is rate-limited. Batch issue filing or use a queue.

## What You Get

After one full run:
- A prioritized backlog of exactly what's broken, filed as issues
- Real-world Dockerfiles that work for each framework (extracted from successful deploys)
- Detection rules that need fixing (from misdetection reports)
- Error messages that need improving (from "I couldn't tell what was wrong" reports)
- A benchmark: X% success rate across Y frameworks, improving with each iteration

After three iterations:
- A platform that deploys most common frameworks on first try
- A test suite of 100+ real projects across 15+ languages
- Documentation that writes itself (the successful deploy recipes)
- Confidence that when a team member says "build me X," it'll work
