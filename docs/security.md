# Security

How dovu-app-paas compares to similar platforms from a security perspective, what's in place, and what's on the roadmap.

## Current security posture

### What's in place

| Area | Status | Detail |
|------|--------|--------|
| **Container isolation** | Good | Every app runs in its own Docker container with separate filesystem, network namespace, and process space |
| **Port binding** | Good | Container ports bound to `127.0.0.1` only — not reachable directly, must go through nginx |
| **Resource limits** | Good | Containers capped at 256MB RAM, 0.5 CPU by default. Prevents one app from starving others |
| **Restart policy** | Good | Containers use `--restart=unless-stopped` — auto-recover from crashes |
| **SSL/TLS** | Good | Wildcard Let's Encrypt cert, TLS 1.2+, HTTP auto-redirects to HTTPS |
| **SSH access** | Good | Key-based only, `deploy` user (non-root) for all operations |
| **Deployment user** | Good | `deploy` user with Docker group access and scoped sudo (nginx reload only) |
| **Firewall** | Good | UFW allowing SSH + HTTP/HTTPS only |
| **fail2ban** | Good | Auto-blocks IPs after 5 failed SSH attempts (1 hour ban) |
| **Nginx rate limiting** | Good | 30 req/s per IP with burst of 50, applied globally |
| **Nginx** | Good | Reverse proxy terminates SSL, unmatched domains return a clean 404 |
| **Cert renewal** | Good | Certbot auto-renews via Cloudflare DNS challenge |
| **Cross-compilation** | Good | Images built locally, only tarballs transferred — no build tools on the server |

### Known gaps

| Area | Risk | Mitigation path |
|------|------|-----------------|
| **Secrets in images** | `.env` vars baked into image layers during build, visible via `docker inspect` | Runtime-only injection via `--env-file` |
| **Docker group = root** | `deploy` user can mount host filesystem via Docker socket | Accept as Docker limitation, or move to rootless Docker |
| **SSH on port 22** | Default port attracts automated scanning (fail2ban mitigates, doesn't eliminate) | Change port or use Tailscale/WireGuard |
| **Cloudflare token on disk** | `/etc/letsencrypt/cloudflare.ini` readable by root | Restrict scope, rotate periodically |
| **No container network isolation** | Containers can reach each other via Docker bridge network | Custom Docker networks per app |
| **No log aggregation** | Container logs only accessible via `docker logs` | Ship to external logging service |
| **No backups** | State and containers exist only on the droplet | Snapshot schedule or external state store |
| **Small droplet** | 512MB RAM / 1 vCPU — resource limits are tight, limited headroom | Upgrade to 1GB+ for production workloads |

## DigitalOcean droplet setup

Current production setup on a $4/mo droplet (Ubuntu 24.04, 512MB + 1GB swap, London):

### Server config

- **OS:** Ubuntu 24.04 LTS with unattended security updates
- **Docker:** 29.4.0, containers run as `deploy` user
- **nginx:** 1.24.0, reverse proxy with wildcard SSL termination
- **Certbot:** 2.9.0, Cloudflare DNS plugin for wildcard cert renewal
- **fail2ban:** Active on SSH, 5 retries → 1 hour ban
- **UFW:** Enabled, allows SSH (22) + HTTP (80) + HTTPS (443) only
- **Swap:** 1GB (required for 512MB droplets during image loads)

### User model

| User | Purpose | Capabilities |
|------|---------|-------------|
| `root` | Initial provisioning only | Full system access |
| `deploy` | All deployment operations | Docker, write nginx configs, `sudo systemctl reload nginx` |

The `deploy` user cannot:
- Modify system packages
- Change SSH config
- Access other users' home directories
- Run arbitrary sudo commands (only nginx reload is allowed)

The `deploy` user CAN (via Docker group):
- Start/stop/inspect any container
- Pull/push images
- Mount volumes (this is effectively root — Docker limitation)

### Network security

```
Internet → DO Firewall → UFW → nginx (443) → 127.0.0.1:<port> → Container
                          ↓
                        SSH (22) → fail2ban → deploy user
```

- Container ports are bound to `127.0.0.1` — unreachable from the internet
- All HTTP traffic forced to HTTPS via 301 redirect
- nginx rate limiting at 30 req/s per IP
- fail2ban watches SSH logs, auto-bans after 5 failures
- Unmatched subdomains get a branded 404 page, not a server error

### Resource constraints

Each container runs with:
- `--memory=256m` — hard memory limit, OOM-killed if exceeded
- `--cpus=0.5` — maximum half a CPU core
- `--restart=unless-stopped` — auto-restart on crash, survives droplet reboot

On the current 512MB droplet with 1GB swap:
- 5 Bun apps idle at ~21MB total (~4MB each)
- Theoretical max: ~15-20 lightweight Bun apps
- Next.js and Laravel apps use more under load
- Docker image storage is the main disk concern (prune old images periodically)

## Comparison with similar platforms

### vs Laravel Forge

Forge deploys bare-metal (no containers). Each site gets its own system user, PHP-FPM pool, and file permissions. This is necessary because without container boundaries, one compromised site could read another's `.env`.

| Aspect | dovu-app-paas | Laravel Forge |
|--------|-----------|---------------|
| **App isolation** | Docker containers (filesystem + network + process) | System users + file permissions |
| **A compromised app can...** | See its own container only | Potentially read other sites' files if user isolation fails |
| **Resource limits** | 256MB / 0.5 CPU per container (configurable) | Not built-in (OS-level cgroups) |
| **Secret management** | Env vars in container | `.env` files on disk (per-site user owns them) |
| **SSH access model** | Single `deploy` user | Per-site users + sudo for deployment |
| **SSL** | Wildcard cert (one cert, all subdomains) | Per-site cert via Certbot |
| **Server provisioning** | Manual (documented) | Automated via API |
| **Updates/patching** | Manual | Forge handles Ubuntu updates |
| **Firewall** | UFW + fail2ban | UFW (automated via dashboard) |
| **Rate limiting** | nginx global rate limit | Not built-in |
| **Database management** | Not built-in | MySQL/Postgres provisioning built-in |
| **Daemon management** | Docker restart policies | Supervisor/systemd |
| **Cost** | $4/mo droplet + free tooling | $12/mo Forge + droplet cost |

**Bottom line:** Forge has better OS-level management (patching, databases, queue workers). dovu-app-paas has better app isolation via containers and resource limits. Forge solves the multi-tenant bare-metal problem with system users; we solve it with Docker namespaces.

### vs raw DigitalOcean droplet

A fresh DO droplet with Docker installed and manual nginx config.

| Aspect | dovu-app-paas | Raw droplet |
|--------|-----------|-------------|
| **Deploy workflow** | One command | Manual: build, scp, docker run, nginx config, reload |
| **Framework detection** | Automatic | You write the Dockerfile |
| **SSL** | Automatic (wildcard cert) | Manual certbot per domain |
| **Nginx config** | Generated per app with SSL | Written by hand |
| **Re-deploys** | Automatic stop + replace | Manual container management |
| **State tracking** | JSON state file | You remember what's running |
| **Cross-compilation** | Automatic (ARM Mac → AMD64) | You figure out `--platform` |
| **Port security** | Bound to 127.0.0.1 automatically | You remember to do it |
| **Resource limits** | Applied automatically | You add the flags manually |
| **Rate limiting** | Configured globally | You set it up yourself |
| **Security baseline** | deploy user, fail2ban, scoped sudo, UFW | Whatever you set up |

**Bottom line:** dovu-app-paas is a raw droplet with a secure-by-default workflow. Same underlying tech, less manual work, fewer opportunities to forget security config.

### vs Coolify / CapRover

Self-hosted PaaS platforms that run on your own servers.

| Aspect | dovu-app-paas | Coolify / CapRover |
|--------|-----------|-------------------|
| **Architecture** | CLI + Docker + nginx | Web dashboard + Docker Swarm/Compose |
| **Complexity** | ~2K lines, no database, no web UI needed | Full application with database, auth, web UI |
| **Container isolation** | Same (Docker) | Same (Docker) |
| **SSL** | Wildcard cert | Per-app via Traefik/Caddy |
| **Multi-server** | Not yet | Coolify supports multi-node |
| **Resource limits** | 256MB / 0.5 CPU default | Built-in via Docker Compose |
| **Secret management** | Env vars | Encrypted secret store |
| **Attack surface** | SSH only (no web dashboard) | Web dashboard + API (larger surface) |
| **Minimum resources** | 512MB droplet works | 1-2GB minimum recommended |

**Bottom line:** Coolify/CapRover are more featureful but have a larger attack surface (web dashboard, database, API auth). dovu-app-paas has almost no attack surface beyond SSH — there's no web UI, no database, no API to exploit. The CLI runs on your machine, not the server. It also runs on much smaller (cheaper) infrastructure.

## Security roadmap

### Done

- [x] **Bind container ports to 127.0.0.1** — containers unreachable directly from internet
- [x] **Container resource limits** — `--memory=256m --cpus=0.5` with `--restart=unless-stopped`
- [x] **fail2ban** — auto-block SSH brute force (5 attempts → 1 hour ban)
- [x] **Nginx rate limiting** — 30 req/s per IP, burst of 50
- [x] **Non-root deploy user** — scoped sudo for nginx reload only
- [x] **Wildcard SSL** — auto-renewing via Cloudflare DNS challenge

### Phase 2: Better secret management

- [ ] **Runtime-only env injection** — use `--env-file` at `docker run` instead of baking into images
- [ ] **Rotate Cloudflare token** — narrow scope, set expiry
- [ ] **Audit `docker inspect`** — ensure no secrets leak via container metadata

### Phase 3: Network hardening

- [ ] **Tailscale/WireGuard** — SSH only over private mesh, close port 22 publicly
- [ ] **Container networking** — isolate containers from each other (custom Docker networks per app)
- [ ] **DO cloud firewall** — restrict SSH to known IPs at the network level
- [ ] **SSH port change** — move off port 22 (verify firewall rule is live before switching)

### Phase 4: Operational

- [ ] **Automated backups** — droplet snapshots on schedule
- [ ] **Log shipping** — forward container logs to external service
- [ ] **Uptime monitoring** — external health checks per deployed app
- [ ] **Unattended upgrades** — automatic security patches for the host OS
- [ ] **Docker image pruning** — cron job to clean old images and reclaim disk
