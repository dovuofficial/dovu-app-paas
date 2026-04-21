# DigitalOcean Provider

Deploy to a remote DigitalOcean droplet with automatic SSL via Let's Encrypt wildcard certificates.

## Overview

The DO provider builds Docker images locally (cross-compiled for `linux/amd64`), transfers them via SCP, and runs them on a remote droplet. nginx handles HTTPS termination with a wildcard Let's Encrypt certificate. All apps get SSL automatically at `https://<name>.apps.yourdomain.com`.

## Prerequisites

- A DigitalOcean droplet (Ubuntu 24.04 recommended)
- A domain with DNS pointed at the droplet
- SSH key access to the droplet
- Cloudflare (or similar) for DNS management (needed for wildcard cert)

## Provisioning a new droplet

### 1. Create the droplet

Any Ubuntu 24.04 droplet will work. Minimum specs:

- **RAM:** 512MB + 1GB swap (bare minimum), 1GB+ recommended
- **Disk:** 10GB+
- **Region:** any

Make sure your SSH key is added to the droplet.

### 2. Add DNS records

Point your wildcard domain at the droplet IP. In Cloudflare (or your DNS provider):

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `apps.yourdomain.com` | `<droplet-ip>` | DNS only |
| A | `*.apps.yourdomain.com` | `<droplet-ip>` | DNS only |

If using Cloudflare, set both records to **DNS only** (grey cloud). Orange cloud will intercept SSL and break the Let's Encrypt challenge.

### 3. Provision the droplet

SSH into the droplet as root and run:

```bash
# Add swap (required for 512MB droplets)
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Install Docker
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io

# Install nginx
apt-get install -y nginx

# Install certbot with Cloudflare plugin
apt-get install -y certbot python3-certbot-dns-cloudflare

# Create deploy user (non-root, Docker access, limited sudo for nginx)
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Grant deploy user write access to nginx conf.d
chown -R deploy:deploy /etc/nginx/conf.d

# Allow deploy user to reload nginx without password
echo 'deploy ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t, /bin/systemctl reload nginx' > /etc/sudoers.d/deploy-ops
chmod 440 /etc/sudoers.d/deploy-ops

# Configure firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Enable services
systemctl enable docker nginx
systemctl start docker nginx
```

Verify everything:

```bash
docker --version      # Docker 29.x
nginx -v              # nginx/1.24.x
certbot --version     # certbot 2.x
id deploy             # uid=1000(deploy) gid=1000(deploy) groups=...,docker
```

### 4. Get a wildcard SSL certificate

You need a Cloudflare API token for the DNS challenge. Create one at:

**Cloudflare Dashboard > My Profile > API Tokens > Create Token**

Use the **Edit zone DNS** template:
- Permissions: Zone > DNS > Edit
- Zone Resources: Include > Specific zone > `yourdomain.com`

Save the token, then on the droplet:

```bash
# Save Cloudflare credentials
mkdir -p /etc/letsencrypt
cat > /etc/letsencrypt/cloudflare.ini << EOF
dns_cloudflare_api_token = YOUR_CLOUDFLARE_TOKEN
EOF
chmod 600 /etc/letsencrypt/cloudflare.ini

# Get the wildcard cert
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d "*.apps.yourdomain.com" \
  -d "apps.yourdomain.com" \
  --non-interactive \
  --agree-tos \
  --email your@email.com
```

Certbot sets up automatic renewal. The cert lives at:
- `/etc/letsencrypt/live/apps.yourdomain.com/fullchain.pem`
- `/etc/letsencrypt/live/apps.yourdomain.com/privkey.pem`

### 5. Configure nginx

```bash
# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Create catch-all HTTPS config
cat > /etc/nginx/sites-available/deploy-ops-catchall.conf << 'NGINX'
server {
    listen 80;
    server_name *.apps.yourdomain.com apps.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl default_server;
    server_name *.apps.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/apps.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/apps.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        return 503 '{"error": "No deployment found for this domain"}';
        add_header Content-Type application/json;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/deploy-ops-catchall.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Verify: `curl https://test.apps.yourdomain.com` should return a 503 JSON error with a valid SSL cert.

## Configuring deploy-ops

On your local machine:

```bash
bun run dev init
# Select "digitalocean"
# Droplet IP: <droplet-ip>
# SSH key path: ~/.ssh/id_ed25519
# SSH user: deploy
# Wildcard base domain: apps.yourdomain.com
```

Or write the config directly:

```json
{
  "provider": "digitalocean",
  "digitalocean": {
    "host": "<droplet-ip>",
    "sshKey": "~/.ssh/id_ed25519",
    "user": "deploy",
    "baseDomain": "apps.yourdomain.com"
  }
}
```

Save to `.deploy-ops/config.json` in your project root.

## Deploying

```bash
cd my-project
bun run dev deploy --name my-app
```

What happens:

1. Project inspected (runtime, framework, port detected)
2. Docker image built locally with `--platform linux/amd64`
3. Image saved as tarball, SCP'd to the droplet
4. Image loaded into Docker on the droplet
5. Container started with port mapping
6. nginx config written with SSL (using the wildcard cert)
7. nginx reloaded

Your app is live at `https://my-app.apps.yourdomain.com`.

## How SSL works

The wildcard cert covers all `*.apps.yourdomain.com` subdomains. Each deployed app gets an nginx config like:

```nginx
server {
    listen 80;
    server_name my-app.apps.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name my-app.apps.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/apps.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/apps.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:<hostPort>;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

HTTP is automatically redirected to HTTPS. WebSocket connections are supported.

## Config location

deploy-ops reads `.deploy-ops/config.json` from the current working directory. When deploying sandbox demos or projects in subdirectories, make sure the config file is in the directory you run the deploy command from.

## Managing deployments

All standard commands work:

```bash
bun run dev ls                    # List deployments
bun run dev status my-app         # Container stats
bun run dev logs my-app           # Stream logs
bun run dev stop my-app           # Stop (keeps container)
bun run dev destroy my-app        # Full removal
```

## Remote MCP server + `/upload` endpoint

If you ran `scripts/provision-droplet.sh`, the droplet also hosts the remote MCP server at `https://mcp.<baseDomain>/mcp` behind bearer-token auth. The MCP server exposes two HTTPS routes:

| Route | Purpose |
|---|---|
| `POST /mcp` | JSON-RPC tool calls (`prewarm`, `deploy`, `ls`, `status`, `logs`, `destroy`, `dev`) |
| `POST /upload` | Raw-bytes upload of a project tarball — returns `{uploadId}` to reference from a subsequent `deploy` call. Preferred path for any non-trivial deploy; sub-second for any payload up to 10 MB. |
| `GET /health` | Health probe |

### nginx body size

The `/upload` endpoint accepts tarballs up to 10 MB. The provisioner sets `client_max_body_size 12m;` in the generated `/etc/nginx/conf.d/deploy-ops-mcp.conf` to cover that plus HTTP overhead.

If you're retrofitting an older droplet that pre-dates the `/upload` endpoint (provisioned before 2026-04-21), the nginx MCP config may still have the default 1 MB cap — uploads will 413 above that. Fix by adding the line:

```nginx
client_max_body_size 12m;
```

inside the MCP `server` block (alongside the `ssl_ciphers` line), then `nginx -t && systemctl reload nginx`.

### Bearer token rotation

```bash
ssh root@your-droplet
echo "TEAM_SECRET=$(openssl rand -hex 24)" > /etc/deploy-ops/env
systemctl restart deploy-ops-mcp
```

Share the new token with your team. Each team member re-runs the `claude mcp add` onboarding command with the updated token.

## Resetting

To remove all deployments from the droplet:

```bash
ssh deploy@<droplet-ip> 'docker stop $(docker ps -q); docker rm $(docker ps -aq); docker rmi $(docker images -q); rm /etc/nginx/conf.d/deploy-ops-*; sudo systemctl reload nginx'
```

To reset local state:

```bash
echo '{"deployments":{}}' > .deploy-ops/state.json
```

## Troubleshooting

**"exec format error" in container logs**
The image was built for the wrong architecture. Make sure the deploy command is using the DO provider (check `.deploy-ops/config.json`). The DO provider automatically builds with `--platform linux/amd64`.

**SCP transfer fails silently**
Verify SSH access: `ssh deploy@<droplet-ip> "echo ok"`. Check that the SSH key path in config is correct and the key has no passphrase.

**503 after deploy**
Check that nginx reloaded: `ssh deploy@<ip> "sudo systemctl reload nginx"`. Check the container is running: `ssh deploy@<ip> "docker ps"`. Check logs: `ssh deploy@<ip> "docker logs deploy-ops-<name>"`.

**SSL certificate errors**
Verify the cert exists: `ssh root@<ip> "ls /etc/letsencrypt/live/"`. Check cert expiry: `ssh root@<ip> "certbot certificates"`. Force renewal: `ssh root@<ip> "certbot renew --force-renewal"` (cert management requires root).

**Config not found**
deploy-ops reads config from the current working directory's `.deploy-ops/config.json`. Make sure you're running the command from a directory that has this file.
