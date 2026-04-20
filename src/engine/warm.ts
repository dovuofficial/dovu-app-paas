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
 * Detection: on BSD, the second column is a bare integer (file-count);
 * on GNU it's an `owner/group` token. We test col[1] with /^\d+$/ — this
 * is more robust than a `/` substring check against exotic owner names.
 */
export function parseTarListingLine(line: string): { perms: string; name: string } | null {
  const cols = line.split(/\s+/).filter((c) => c.length > 0);
  if (cols.length === 0) return null;
  const perms = cols[0] ?? "";
  if (perms.length === 0) return null;

  // If col[1] is a bare integer, it's BSD's file-count column; otherwise
  // it's GNU's `owner/group` token. This is robust against edge cases
  // (e.g. a GNU owner name that happens to lack a "/").
  const isGnu = !/^\d+$/.test(cols[1] ?? "");
  const nameStartIdx = isGnu ? 5 : 8;
  if (cols.length <= nameStartIdx) return null;

  const rest = cols.slice(nameStartIdx).join(" ");
  // Link-target suffixes are only meaningful for link typeflags: symlinks
  // render as "name -> target" (perms start with 'l') and BSD hardlinks
  // render as "name link to target" (perms start with 'h'). Stripping
  // these suffixes unconditionally would truncate a regular file whose
  // literal name contains " -> " or " link to " — an attacker-controlled
  // path like "safe -> ../../etc/evil" would then parse as "safe" and
  // bypass the traversal check. Only strip when the typeflag matches.
  let name = rest;
  if (perms.startsWith("l")) {
    name = name.split(" -> ")[0] ?? name;
  } else if (perms.startsWith("h")) {
    name = name.split(" link to ")[0] ?? name;
  }

  return { perms, name };
}

export async function validateTarball(localPath: string): Promise<void> {
  const result = await $`tar -tzvf ${localPath}`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error(
      `Tarball is unreadable (exit ${result.exitCode}): ${result.stderr.toString()}`,
    );
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
    // Rejecting all PaxHeader-bearing entries; PAX long-name extension is
    // not handled; agents must keep paths under 100 bytes. Otherwise, GNU
    // tar in PAX mode would split a long path across a "./PaxHeader/<pid>/
    // <name>" listing line plus an x-typeflag entry carrying the real path
    // in a PAX attribute — and the real path (the one tar extracts at)
    // wouldn't be in any listing-line name field we could inspect.
    if (name.split("/").includes("PaxHeader")) {
      throw new Error(
        `Tarball rejected: PAX long-name entry "${name}" is not supported (keep paths < 100 bytes)`,
      );
    }
  }
}
