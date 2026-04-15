# Next Steps

## GitHub Action: Push-to-Deploy

The highest-value next feature. A GitHub Action that deploys on push — any project, any repo, just add a YAML file and two secrets.

### What it looks like

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dovuofficial/dovu-app-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          ssh-key: ${{ secrets.DEPLOY_SSH_KEY }}
          domain: apps.dovu.ai
          name: my-app
```

Push to main, app deploys to `https://my-app.apps.dovu.ai`. That's it.

### Why this matters

- **Zero local setup** — no CLI install, no Bun, no Docker on the developer's machine
- **Portable** — add to any repo with one YAML file and two GitHub secrets
- **CI builds are already linux/amd64** — no cross-compilation needed
- **Branch mapping** — `main` deploys to production, `dev` to staging subdomains
- **The DO box just sits there** — provisioned once, receives deployments from any repo on push

### What to build

**`dovuofficial/dovu-app-action`** — a GitHub Action repo containing:

- `action.yml` — action metadata, inputs (host, ssh-key, domain, name, branch mappings)
- `entrypoint.sh` — installs Bun, runs the deploy flow (inspect, build, SCP, docker run, nginx config)
- Or: bundle `dovu-app deploy` logic into a standalone script that runs in CI without the full CLI

The deploy logic already exists. The action is packaging — make it run in a GitHub Actions runner instead of a local terminal.

### Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `host` | Yes | Droplet IP or hostname |
| `ssh-key` | Yes | SSH private key (as GitHub secret) |
| `domain` | Yes | Base domain (e.g. `apps.dovu.ai`) |
| `name` | No | App name (default: repo name) |
| `user` | No | SSH user (default: `deploy`) |
| `sla-tier` | No | For future billing tiers |
| `env` | No | Environment variables (multiline) |
| `branch-map` | No | Branch-to-subdomain mapping (e.g. `dev:staging`) |

### Branch mapping

Support deploying different branches to different subdomains:

```yaml
with:
  branch-map: |
    main:my-app
    dev:my-app-staging
    feature/*:my-app-preview
```

- `main` → `https://my-app.apps.dovu.ai`
- `dev` → `https://my-app-staging.apps.dovu.ai`
- `feature/xyz` → `https://my-app-preview.apps.dovu.ai`

### Secrets setup

User adds two secrets to their GitHub repo:

```
DEPLOY_HOST    = <droplet-ip>
DEPLOY_SSH_KEY = <contents of ~/.ssh/id_ed25519>
```

That's all. The provisioned DO box accepts deployments from any repo that has these secrets.

---

## Dashboard UI

Web-based control plane for managing deployments across servers. Think low-level Forge / DO App Platform.

### Core features

- **GitHub integration** — link repos, see deploy status, trigger manual deploys
- **Multi-server view** — manage multiple droplets/bare-metal boxes from one place
- **Deploy history** — who deployed what, when, rollback to previous versions
- **Log viewer** — stream container logs in the browser
- **Resource monitoring** — CPU, memory, disk per container and per server
- **Environment management** — edit env vars per app, per environment

### Architecture

```
┌─────────────────────────────────────┐
│           Dashboard UI              │
│  (React, served by dovu-app serve)  │
├─────────────────────────────────────┤
│           Dashboard API             │
│  accounts, servers, apps, deploys   │
├──────────┬──────────┬───────────────┤
│ SQLite   │ GitHub   │  SSH to       │
│ (state)  │ webhooks │  N servers    │
└──────────┴──────────┴───────────────┘
```

The dashboard itself runs as a `dovu-app` deployment — self-hosting on one of the managed servers.

### GitHub webhook flow

1. User links a repo in the dashboard
2. Dashboard creates a webhook on the GitHub repo
3. On push, GitHub POSTs to the dashboard
4. Dashboard triggers `dovu-app deploy` on the target server
5. Status updates in real-time in the UI

---

## DePIN / Multi-Server Deployments

Deploy the same app to multiple bare-metal or cloud servers for redundancy and geographic distribution.

### Use case

DOVU validation nodes — the same node software deployed across 10+ locations. One push deploys everywhere. Dashboard shows health of all nodes.

### What this looks like

```yaml
# .github/workflows/deploy.yml
- uses: dovuofficial/dovu-app-action@v1
  with:
    hosts: |
      lon1:164.92.xx.xx
      nyc1:159.65.xx.xx
      sgp1:128.199.xx.xx
    ssh-key: ${{ secrets.DEPLOY_SSH_KEY }}
    domain: nodes.dovu.ai
    name: validator
```

One push, three servers, three subdomains:
- `https://lon1-validator.nodes.dovu.ai`
- `https://nyc1-validator.nodes.dovu.ai`
- `https://sgp1-validator.nodes.dovu.ai`

### Multi-server in the dashboard

- Add servers (IP + SSH key + region label)
- Create "deployment groups" — a set of servers that receive the same app
- Deploy to a group with one click or on push
- Health dashboard: which nodes are up, resource usage, last deploy time
- Alerting: node goes down, auto-redeploy or notify

### Provider additions needed

- **Hetzner** — same as DO provider, just different provisioning script
- **Bare metal** — any box with Docker + SSH access works already
- **k3s/Kubernetes** — lightweight cluster for higher density (future)

---

## Build order

1. **GitHub Action** — highest value, lowest effort. Packaging of existing deploy logic.
2. **Dashboard** — build on the vision branch's React UI + API. Start with deploy history + log viewer.
3. **Multi-server** — extend the provider interface to target multiple hosts. Dashboard shows fleet view.
4. **DePIN control plane** — dashboard + multi-server + health monitoring = node management platform.

Each step builds on the previous. The GitHub Action alone makes this useful for any team. The dashboard makes it a product. Multi-server makes it infrastructure.

---

## Private Hedera Solo Networks

Deploy and manage private Hedera consensus networks as standard dovu-app deployments. Same tooling, same workflow, your own L1.

### What this is

Hedera supports "solo" mode — a full consensus node (HCS, HTS, smart contracts, EVM) running on your own infrastructure. No mainnet dependency, no per-transaction fees, full control over the network.

With dovu-app-paas, a private Hedera network is just another set of containers:

```bash
dovu-app deploy --name hedera-node-1    # London
dovu-app deploy --name hedera-node-2    # New York  
dovu-app deploy --name hedera-node-3    # Singapore
```

Three commands. Private Hedera network across three continents.

### Why this matters

| Mainnet Hedera | Private Solo Network |
|---------------|---------------------|
| ~$0.001 per token transfer | Free — you own the network |
| ~$0.0008 per HCS message | Free — unlimited event logging |
| Shared network, public data | Isolated, private by default |
| Circle-issued USDC only | Mint your own stablecoins/tokens |
| Fixed fee schedule | Custom fee structure |
| ~3-5s finality | Same consensus, tunable parameters |

### Use cases for DOVU

**Carbon credit infrastructure:**
- Private HTS tokens for carbon credits — mint, transfer, retire on your own chain
- High-frequency validation ticks on private HCS — no per-message cost
- Public proof anchored to mainnet periodically for verifiability

**DePIN validator network:**
- Each validator node runs on a dovu-app-paas managed server
- Consensus happens on the private Hedera chain
- The PaaS IS the DePIN network — deploy, monitor, manage from one place
- Rewards and slashing via private HTS tokens

**Enterprise isolation:**
- Each enterprise customer gets their own private network
- Fully isolated — their data never touches shared infrastructure
- Hosted on their preferred cloud/bare-metal via the same deploy flow

**Hybrid architecture:**
```
┌──────────────────────────┐     ┌──────────────────────┐
│   Private Hedera Solo    │     │   Hedera Mainnet      │
│                          │     │                       │
│  High-frequency ops:     │────►│  Settlement:           │
│  - Validation ticks      │     │  - Proof anchoring     │
│  - SLA monitoring        │     │  - Public carbon       │
│  - Internal transfers    │     │    credit registry     │
│  - Agent transactions    │     │  - USDC bridging       │
│                          │     │                       │
│  Cost: $0 per tx         │     │  Cost: cents/day       │
└──────────────────────────┘     └──────────────────────┘
```

Run everything high-frequency on your own network for free. Anchor proofs and settlements to mainnet for public trust. Best of both worlds.

**The marketplace vision revisited:**
- The vision branch's compute marketplace runs on the private network instead of mainnet
- Agents transact with zero network fees
- You control the fee structure — take a cut, subsidise usage, whatever fits the business model
- Public verifiability via mainnet anchoring when needed

### Implementation

The private Hedera network is a Docker Compose setup (or multiple single containers) that runs:
- Consensus node(s)
- Mirror node (for queries and event subscriptions)
- JSON-RPC relay (for EVM/smart contract access)

This is already containerised by Hedera's solo tooling. dovu-app-paas just needs to:
1. Package the solo network as a deployable project (Dockerfile or compose)
2. Deploy across multiple servers via the multi-server feature
3. Dashboard shows network health alongside app deployments
4. The vision branch's Hedera SDK code works unchanged — just point it at the private network endpoint instead of testnet/mainnet

---

## Build order (updated)

1. **GitHub Action** — push-to-deploy for any repo. Highest value, lowest effort.
2. **Dashboard** — web UI, GitHub webhooks, log viewer, deploy history.
3. **Multi-server** — deploy to N boxes, fleet view, deployment groups.
4. **DePIN control plane** — dashboard + multi-server + health monitoring.
5. **Private Hedera network** — deploy solo nodes via the same tooling, hybrid mainnet anchoring.
6. **Compute marketplace (revisited)** — the vision branch, running on private Hedera, zero-fee agent commerce.
