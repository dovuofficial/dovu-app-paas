# Next steps

## Shipped

### MCP server

Deploy, dev, list, status, logs, and destroy exposed as MCP tools. Claude Code can build and deploy apps in a single conversation.

### GitHub Action

Push-to-deploy for any repo. Branch-aware naming, auto-cleanup on branch delete, live URL output for PR comments. Available on the [GitHub Marketplace](https://github.com/marketplace/actions/dovu-app-paas).

```yaml
- uses: dovuofficial/dovu-app-paas@v1
  with:
    host: ${{ secrets.DEPLOY_HOST }}
    ssh-key: ${{ secrets.DEPLOY_SSH_KEY }}
    base-domain: apps.yourdomain.com
    app-name: my-app
```

### Local and DigitalOcean providers

Local Docker-in-Docker for development. DigitalOcean droplet via SSH/SCP with wildcard SSL for production. One provisioning script.

---

## Next

### Remote MCP server

Shared MCP server running on a droplet, accessible to the whole team. SSH pubkey auth so multiple developers (or Claude Code instances) can deploy to the same infrastructure without sharing secrets locally.

### Dashboard UI

Web-based control plane for managing deployments. Deploy history, log viewer, resource monitoring, environment management. Self-hosted as a dovu-app deployment.

### Multi-server deployments

Deploy the same app to multiple boxes for redundancy or geographic distribution. Extends the provider interface to target N hosts. Dashboard shows fleet view.

### Additional providers

Hetzner, bare metal, and other cloud providers. Same SSH/SCP pattern as DigitalOcean. Provisioning script per provider.

---

## Future

### Private Hedera solo networks

Deploy private Hedera consensus networks (HCS, HTS, smart contracts, EVM) as standard dovu-app deployments. Zero per-transaction cost for high-frequency internal operations. Anchor proofs to mainnet for public verifiability.

Use cases: carbon credit infrastructure, DePIN validator networks, enterprise isolation, hybrid on-chain/off-chain architectures.

### Compute marketplace

Agent-to-agent compute marketplace running on private Hedera. USDC payments, SLA contracts, per-minute billing. The deploy layer becomes the substrate for an agent economy. This builds on everything above: MCP server, multi-server, private Hedera, dashboard.
