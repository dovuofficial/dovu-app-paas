import { $ } from "bun";

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

/**
 * Parse one line of `tar -tzvf` long-listing output and return the entry's
 * permission string and (logical) name. Works on both GNU tar and BSD tar.
 *
 * GNU tar line format (6 whitespace-separated cols before name):
 *   drwxr-xr-x root/root 0 2026-04-20 12:00 path/to/entry
 *   lrwxrwxrwx root/root 0 2026-04-20 12:00 evil -> /etc/passwd
 *
 * BSD tar (macOS default) line format (9 cols — owner and group are
 * separate, plus a standalone "0" column before owner):
 *   -rw-r--r--  0 hecate wheel       3 Apr 20 10:03 a.txt
 *   lrwxr-xr-x  0 hecate wheel       0 Apr 20 10:03 evil -> /etc/passwd
 *   hrw-r--r--  0 hecate wheel       0 Apr 20 10:03 b.txt link to a.txt
 *
 * Detection: on GNU, the second column contains `/` ("owner/group"); on
 * BSD it's a bare number ("0"). We use that to know where the name column
 * starts.
 */
export function parseTarListingLine(line: string): { perms: string; name: string } | null {
  const cols = line.split(/\s+/).filter((c) => c.length > 0);
  if (cols.length === 0) return null;
  const perms = cols[0] ?? "";
  if (perms.length === 0) return null;

  // GNU tar merges owner/group into one token containing "/".
  // BSD tar emits them as two separate tokens and also a leading "0" column.
  const isGnu = (cols[1] ?? "").includes("/");
  const nameStartIdx = isGnu ? 5 : 8;
  if (cols.length <= nameStartIdx) return null;

  const rest = cols.slice(nameStartIdx).join(" ");
  // Symlinks are displayed as "name -> target"; hardlinks on BSD as
  // "name link to target". Strip both so we validate the entry's own name,
  // not its target.
  let name = rest.split(" -> ")[0] ?? rest;
  name = name.split(" link to ")[0] ?? name;

  return { perms, name };
}

export async function validateTarball(localPath: string): Promise<void> {
  const result = await $`tar -tzvf ${localPath}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(`Tarball is unreadable: ${result.stderr.toString()}`);
  }
  const lines = result.stdout.toString().split("\n").filter((l) => l.length > 0);

  for (const line of lines) {
    const parsed = parseTarListingLine(line);
    if (!parsed) continue;
    const { perms, name } = parsed;

    if (perms.startsWith("l")) {
      throw new Error(`Tarball rejected: symlink entry "${name}" is not allowed`);
    }
    if (perms.startsWith("h")) {
      throw new Error(`Tarball rejected: hardlink entry "${name}" is not allowed`);
    }
    if (name.startsWith("/")) {
      throw new Error(`Tarball rejected: absolute path "${name}" is not allowed`);
    }
    if (name.split("/").includes("..")) {
      throw new Error(`Tarball rejected: path traversal in "${name}"`);
    }
  }
}
