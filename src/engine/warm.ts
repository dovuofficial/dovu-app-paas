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
