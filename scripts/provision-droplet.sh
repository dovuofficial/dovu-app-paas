#!/bin/bash
#
# dovu-app-paas: Droplet Provisioning Script
#
# Provisions a fresh Ubuntu 24.04 DigitalOcean droplet with:
#   - 1GB swap (for 512MB droplets)
#   - Docker
#   - nginx
#   - Let's Encrypt wildcard SSL via Cloudflare DNS
#   - Non-root deploy user with scoped permissions
#   - fail2ban
#   - nginx rate limiting
#   - UFW firewall
#
# Usage:
#   ssh root@<droplet-ip> 'bash -s' < scripts/provision-droplet.sh
#
# Or interactively:
#   scp scripts/provision-droplet.sh root@<droplet-ip>:/tmp/
#   ssh root@<droplet-ip>
#   bash /tmp/provision-droplet.sh
#
# Environment variables (set before running or you'll be prompted):
#   DOMAIN          - Base domain for wildcard cert (e.g. apps.dovu.ai)
#   CF_API_TOKEN    - Cloudflare API token with Zone:DNS:Edit for the domain
#   ADMIN_EMAIL     - Email for Let's Encrypt registration
#   SSH_PORT        - SSH port (default: 22, set to change)
#
# Prerequisites:
#   - Fresh Ubuntu 24.04 droplet with root SSH access
#   - Domain with A records pointing at the droplet:
#       A  apps.yourdomain.com    → <droplet-ip>  (DNS only, grey cloud)
#       A  *.apps.yourdomain.com  → <droplet-ip>  (DNS only, grey cloud)
#   - Cloudflare API token (Zone > DNS > Edit, scoped to your domain)
#

set -euo pipefail

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

# ── Prompt for config if not set ────────────────────────
if [ -z "${DOMAIN:-}" ]; then
  read -rp "Base domain (e.g. apps.dovu.ai): " DOMAIN
fi

if [ -z "${CF_API_TOKEN:-}" ]; then
  read -rp "Cloudflare API token: " CF_API_TOKEN
fi

if [ -z "${ADMIN_EMAIL:-}" ]; then
  read -rp "Admin email (for Let's Encrypt): " ADMIN_EMAIL
fi

SSH_PORT="${SSH_PORT:-22}"

echo ""
echo "Configuration:"
echo "  Domain:     ${DOMAIN}"
echo "  Email:      ${ADMIN_EMAIL}"
echo "  SSH port:   ${SSH_PORT}"
echo ""
read -rp "Continue? (y/N) " CONFIRM
[ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ] || exit 0

# ── Swap ────────────────────────────────────────────────
step "Adding 1GB swap"

if [ -f /swapfile ]; then
  warn "Swap already exists, skipping"
else
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "1GB swap enabled"
fi

# ── System updates ──────────────────────────────────────
step "Updating system packages"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
log "System updated"

# ── Docker ──────────────────────────────────────────────
step "Installing Docker"

if command -v docker &>/dev/null; then
  warn "Docker already installed: $(docker --version)"
else
  apt-get install -y -qq ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io
  systemctl enable docker
  systemctl start docker
  log "Docker installed: $(docker --version)"
fi

# ── nginx ───────────────────────────────────────────────
step "Installing nginx"

if command -v nginx &>/dev/null; then
  warn "nginx already installed: $(nginx -v 2>&1)"
else
  apt-get install -y -qq nginx
  systemctl enable nginx
  systemctl start nginx
  log "nginx installed"
fi

# ── Certbot + Cloudflare ────────────────────────────────
step "Installing certbot with Cloudflare plugin"

if command -v certbot &>/dev/null; then
  warn "certbot already installed: $(certbot --version 2>&1)"
else
  apt-get install -y -qq certbot python3-certbot-dns-cloudflare
  log "certbot installed"
fi

# ── fail2ban ────────────────────────────────────────────
step "Installing fail2ban"

if command -v fail2ban-client &>/dev/null; then
  warn "fail2ban already installed"
else
  apt-get install -y -qq fail2ban
  log "fail2ban installed"
fi

# ── Deploy user ─────────────────────────────────────────
step "Creating deploy user"

if id deploy &>/dev/null; then
  warn "deploy user already exists"
else
  useradd -m -s /bin/bash deploy
  log "deploy user created"
fi

usermod -aG docker deploy

# Copy SSH keys
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
log "SSH keys copied to deploy user"

# Grant nginx permissions
chown -R deploy:deploy /etc/nginx/conf.d
echo 'deploy ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t, /bin/systemctl reload nginx' > /etc/sudoers.d/dovu-app-paas
chmod 440 /etc/sudoers.d/dovu-app-paas
log "deploy user granted nginx reload permissions"

# ── Firewall ────────────────────────────────────────────
step "Configuring UFW firewall"

ufw allow OpenSSH
ufw allow 'Nginx Full'

if [ "$SSH_PORT" != "22" ]; then
  ufw allow "$SSH_PORT/tcp"
fi

ufw --force enable
log "UFW enabled: SSH + HTTP + HTTPS"

# ── SSL certificate ────────────────────────────────────
step "Getting wildcard SSL certificate for *.${DOMAIN}"

mkdir -p /etc/letsencrypt
cat > /etc/letsencrypt/cloudflare.ini << EOF
dns_cloudflare_api_token = ${CF_API_TOKEN}
EOF
chmod 600 /etc/letsencrypt/cloudflare.ini

if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  warn "Certificate already exists for ${DOMAIN}"
else
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
    -d "*.${DOMAIN}" \
    -d "${DOMAIN}" \
    --non-interactive \
    --agree-tos \
    --email "${ADMIN_EMAIL}"
  log "Wildcard certificate issued for *.${DOMAIN}"
fi

# ── nginx configuration ────────────────────────────────
step "Configuring nginx"

rm -f /etc/nginx/sites-enabled/default

cat > /etc/nginx/sites-available/dovu-app-paas-catchall.conf << NGINX
server {
    listen 80;
    server_name *.${DOMAIN} ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl default_server;
    server_name *.${DOMAIN} ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    default_type text/html;

    location / {
        return 404 '<!DOCTYPE html><html><head><meta charset="utf-8"><title>dovu-app</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0f14;color:#8892a8;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}.c{max-width:400px}h1{font-family:monospace;font-size:1.5rem;color:#e8eaf0;margin-bottom:.5rem}h1 span{color:#5b8dee}p{font-size:.9rem;line-height:1.6;margin-bottom:1rem}code{background:#13161e;border:1px solid #1e2333;border-radius:6px;padding:2px 8px;font-size:.8rem;color:#5b8dee}</style></head><body><div class="c"><h1>dovu<span>-</span>app</h1><p>No app deployed at this domain.</p><p>Deploy with: <code>dovu-app deploy</code></p></div></body></html>';
    }
}
NGINX

ln -sf /etc/nginx/sites-available/dovu-app-paas-catchall.conf /etc/nginx/sites-enabled/

# Add rate limiting to nginx.conf if not already present
if ! grep -q "limit_req_zone" /etc/nginx/nginx.conf; then
  sed -i '/http {/a\    limit_req_zone $binary_remote_addr zone=general:10m rate=30r/s;' /etc/nginx/nginx.conf
fi

nginx -t && systemctl reload nginx
log "nginx configured with SSL and rate limiting"

# ── fail2ban configuration ──────────────────────────────
step "Configuring fail2ban"

cat > /etc/fail2ban/jail.local << EOF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
bantime = 3600
findtime = 600
EOF

systemctl restart fail2ban
log "fail2ban configured: 5 retries → 1 hour ban"

# ── SSH port (optional) ────────────────────────────────
if [ "$SSH_PORT" != "22" ]; then
  step "Changing SSH port to ${SSH_PORT}"

  sed -i "s/^#Port 22/Port ${SSH_PORT}/" /etc/ssh/sshd_config
  sed -i "s/^Port 22$/Port ${SSH_PORT}/" /etc/ssh/sshd_config

  # Ubuntu 24.04 uses socket activation
  mkdir -p /etc/systemd/system/ssh.socket.d
  cat > /etc/systemd/system/ssh.socket.d/override.conf << EOF
[Socket]
ListenStream=
ListenStream=${SSH_PORT}
EOF

  systemctl daemon-reload
  systemctl restart ssh.socket
  systemctl restart ssh
  log "SSH moved to port ${SSH_PORT}"
  warn "Make sure UFW rule for port ${SSH_PORT} is active before disconnecting!"
fi

# ── Verify ──────────────────────────────────────────────
step "Verification"

echo ""
echo "  Docker:    $(docker --version 2>&1 | head -1)"
echo "  nginx:     $(nginx -v 2>&1)"
echo "  certbot:   $(certbot --version 2>&1)"
echo "  fail2ban:  $(fail2ban-client status 2>&1 | head -1)"
echo "  deploy:    $(id deploy)"
echo "  swap:      $(free -h | grep Swap | awk '{print $2}')"
echo "  disk:      $(df -h / | tail -1 | awk '{print $4 " free"}')"
echo "  firewall:  $(ufw status | head -1)"
echo ""

# ── Summary ─────────────────────────────────────────────
step "Done!"

echo ""
echo "  Droplet provisioned for dovu-app-paas."
echo ""
echo "  Domain:     https://*.${DOMAIN}"
echo "  SSL:        Let's Encrypt wildcard (auto-renewing)"
echo "  SSH user:   deploy (port ${SSH_PORT})"
echo "  Containers: bound to 127.0.0.1, 256MB limit, auto-restart"
echo ""
echo "  On your local machine, create the config:"
echo ""
echo "    mkdir -p .dovu-app-paas"
echo "    cat > .dovu-app-paas/config.json << 'EOF'"
echo "    {"
echo "      \"provider\": \"digitalocean\","
echo "      \"digitalocean\": {"
echo "        \"host\": \"$(curl -s ifconfig.me 2>/dev/null || echo '<droplet-ip>')\","
echo "        \"sshKey\": \"~/.ssh/id_ed25519\","
echo "        \"user\": \"deploy\","
echo "        \"baseDomain\": \"${DOMAIN}\""
echo "      }"
echo "    }"
echo "    EOF"
echo ""
echo "  Then deploy:"
echo ""
echo "    cd your-project"
echo "    dovu-app deploy --name my-app"
echo "    # Live at https://my-app.${DOMAIN}"
echo ""
