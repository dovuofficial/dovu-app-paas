function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generatePlaceholderHtml(name: string): string {
  const safe = escapeHtml(name);
  return `<!doctype html>
<meta charset="utf-8">
<title>${safe} — provisioning…</title>
<style>body{font:16px system-ui;max-width:40ch;margin:10vh auto;padding:1rem;color:#444}</style>
<h1>${safe}</h1>
<p>This app is being provisioned. The agent is working on it — check back in a moment.</p>
`;
}

export interface StaticNginxOptions {
  serverName: string;
  sitePath: string;
  ssl?: { certPath: string; keyPath: string };
}

export function generateStaticNginxConfig(options: StaticNginxOptions): string {
  const commonBody = `    root ${options.sitePath};
    index index.html;

    disable_symlinks on from=$document_root;

    location ~ /\\. {
        deny all;
        return 404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
`;

  if (options.ssl) {
    return `server {
    listen 80;
    server_name ${options.serverName};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${options.serverName};

    ssl_certificate ${options.ssl.certPath};
    ssl_certificate_key ${options.ssl.keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

${commonBody}}
`;
  }

  return `server {
    listen 80;
    server_name ${options.serverName};

${commonBody}}
`;
}
