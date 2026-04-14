const PORT = 3000;

const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Key-Value Store</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
      color: #222;
      margin: 0;
      padding: 24px;
    }

    h1 {
      font-size: 1.4rem;
      font-weight: 600;
      margin: 0 0 20px;
      color: #111;
    }

    section {
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }

    section h2 {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
      margin: 0 0 14px;
    }

    .api-url-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .api-url-row label {
      font-size: 0.875rem;
      color: #555;
      white-space: nowrap;
    }

    input[type="text"], textarea {
      width: 100%;
      padding: 8px 10px;
      font-size: 0.875rem;
      border: 1px solid #ccc;
      border-radius: 5px;
      outline: none;
      transition: border-color 0.15s;
      font-family: inherit;
    }

    input[type="text"]:focus, textarea:focus {
      border-color: #4f8ef7;
    }

    .api-url-row input[type="text"] {
      flex: 1;
    }

    textarea {
      resize: vertical;
      min-height: 80px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 12px;
      align-items: start;
    }

    .form-grid label {
      font-size: 0.8125rem;
      color: #555;
      padding-top: 9px;
    }

    .form-actions {
      grid-column: 2;
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    button {
      padding: 7px 16px;
      font-size: 0.8125rem;
      font-weight: 500;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      transition: opacity 0.15s, background 0.15s;
    }

    button:hover { opacity: 0.85; }
    button:active { opacity: 0.7; }

    .btn-primary { background: #4f8ef7; color: #fff; }
    .btn-secondary { background: #e9e9e9; color: #333; }
    .btn-danger { background: #f75f4f; color: #fff; }
    .btn-sm { padding: 4px 10px; font-size: 0.75rem; }

    #form-mode-label {
      font-size: 0.8125rem;
      color: #888;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    thead th {
      text-align: left;
      padding: 8px 10px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #888;
      border-bottom: 1px solid #e8e8e8;
    }

    tbody tr {
      border-bottom: 1px solid #f0f0f0;
    }

    tbody tr:last-child { border-bottom: none; }

    tbody tr:hover { background: #fafafa; }

    td {
      padding: 9px 10px;
      vertical-align: middle;
    }

    .td-key {
      font-weight: 600;
      color: #333;
      width: 22%;
      word-break: break-all;
    }

    .td-value {
      color: #555;
      word-break: break-all;
      white-space: pre-wrap;
    }

    .td-date {
      color: #999;
      font-size: 0.75rem;
      white-space: nowrap;
      width: 14%;
    }

    .td-actions {
      width: 110px;
      text-align: right;
      white-space: nowrap;
    }

    .td-actions button { margin-left: 5px; }

    #status {
      font-size: 0.8125rem;
      min-height: 1.4em;
      padding: 2px 0;
    }

    .status-ok  { color: #2b9e5a; }
    .status-err { color: #d93b2a; }

    #empty-state {
      text-align: center;
      padding: 28px;
      color: #bbb;
      font-size: 0.875rem;
    }

    #loading {
      text-align: center;
      padding: 20px;
      color: #aaa;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>

<h1>Key-Value Store</h1>

<!-- API URL config -->
<section>
  <h2>API</h2>
  <div class="api-url-row">
    <label for="api-url">Base URL</label>
    <input type="text" id="api-url" value="http://api.ops.localhost" spellcheck="false" />
  </div>
</section>

<!-- Create / Edit form -->
<section>
  <h2>Create / Edit</h2>
  <div class="form-grid">
    <label for="input-key">Key</label>
    <input type="text" id="input-key" placeholder="my-key" spellcheck="false" />

    <label for="input-value">Value</label>
    <textarea id="input-value" placeholder="some value"></textarea>

    <div></div>
    <div class="form-actions">
      <button class="btn-primary" id="btn-submit" onclick="handleSubmit()">Create</button>
      <button class="btn-secondary" id="btn-cancel" style="display:none" onclick="cancelEdit()">Cancel</button>
      <span id="form-mode-label"></span>
    </div>
  </div>
  <div id="status"></div>
</section>

<!-- Key list -->
<section>
  <h2>Keys</h2>
  <div id="loading">Loading&hellip;</div>
  <table id="keys-table" style="display:none">
    <thead>
      <tr>
        <th>Key</th>
        <th>Value</th>
        <th>Updated</th>
        <th></th>
      </tr>
    </thead>
    <tbody id="keys-body"></tbody>
  </table>
  <div id="empty-state" style="display:none">No keys yet. Create one above.</div>
</section>

<script>
  // ── State ────────────────────────────────────────────────────────────────────

  let editingKey = null; // null = create mode, string = edit mode

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function apiUrl() {
    return document.getElementById('api-url').value.replace(/\\/+$/, '');
  }

  function setStatus(msg, isError) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = isError ? 'status-err' : 'status-ok';
  }

  function clearStatus() {
    const el = document.getElementById('status');
    el.textContent = '';
    el.className = '';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── API calls ─────────────────────────────────────────────────────────────────

  async function apiFetch(path, options) {
    const res = await fetch(apiUrl() + path, options);
    if (!res.ok) {
      let msg;
      try { msg = (await res.json()).error || res.statusText; } catch (_) { msg = res.statusText; }
      throw new Error(msg);
    }
    // 204 No Content
    if (res.status === 204) return null;
    return res.json();
  }

  async function listKeys() {
    const data = await apiFetch('/keys');
    return data.keys ?? [];
  }

  async function createKey(key, value) {
    return apiFetch('/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  }

  async function updateKey(key, value) {
    return apiFetch('/keys/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  }

  async function deleteKey(key) {
    return apiFetch('/keys/' + encodeURIComponent(key), { method: 'DELETE' });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  async function refreshList() {
    const loading   = document.getElementById('loading');
    const table     = document.getElementById('keys-table');
    const emptyMsg  = document.getElementById('empty-state');

    loading.style.display = 'block';
    table.style.display   = 'none';
    emptyMsg.style.display = 'none';

    let keys;
    try {
      keys = await listKeys();
    } catch (err) {
      loading.textContent = 'Error loading keys: ' + err.message;
      return;
    }

    loading.style.display = 'none';

    if (keys.length === 0) {
      emptyMsg.style.display = 'block';
      return;
    }

    const tbody = document.getElementById('keys-body');
    tbody.innerHTML = '';

    keys.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = \`
        <td class="td-key">\${esc(row.key)}</td>
        <td class="td-value">\${esc(row.value)}</td>
        <td class="td-date">\${fmtDate(row.updated_at)}</td>
        <td class="td-actions">
          <button class="btn-secondary btn-sm" onclick="startEdit(\${JSON.stringify(row.key)}, \${JSON.stringify(row.value)})">Edit</button>
          <button class="btn-danger btn-sm" onclick="handleDelete(\${JSON.stringify(row.key)})">Delete</button>
        </td>
      \`;
      tbody.appendChild(tr);
    });

    table.style.display = 'table';
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Form logic ────────────────────────────────────────────────────────────────

  function startEdit(key, value) {
    editingKey = key;
    document.getElementById('input-key').value = key;
    document.getElementById('input-key').disabled = true;
    document.getElementById('input-value').value = value;
    document.getElementById('btn-submit').textContent = 'Update';
    document.getElementById('btn-cancel').style.display = '';
    document.getElementById('form-mode-label').textContent = 'Editing "' + key + '"';
    clearStatus();
    document.getElementById('input-value').focus();
  }

  function cancelEdit() {
    editingKey = null;
    document.getElementById('input-key').value = '';
    document.getElementById('input-key').disabled = false;
    document.getElementById('input-value').value = '';
    document.getElementById('btn-submit').textContent = 'Create';
    document.getElementById('btn-cancel').style.display = 'none';
    document.getElementById('form-mode-label').textContent = '';
    clearStatus();
  }

  async function handleSubmit() {
    const key   = document.getElementById('input-key').value.trim();
    const value = document.getElementById('input-value').value;

    if (!key) { setStatus('Key is required.', true); return; }

    const btn = document.getElementById('btn-submit');
    btn.disabled = true;

    try {
      if (editingKey !== null) {
        await updateKey(editingKey, value);
        setStatus('Updated "' + editingKey + '".', false);
        cancelEdit();
      } else {
        await createKey(key, value);
        setStatus('Created "' + key + '".', false);
        document.getElementById('input-key').value = '';
        document.getElementById('input-value').value = '';
      }
      await refreshList();
    } catch (err) {
      setStatus('Error: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  async function handleDelete(key) {
    if (!confirm('Delete key "' + key + '"?')) return;

    try {
      await deleteKey(key);
      // If we were editing this key, cancel the form
      if (editingKey === key) cancelEdit();
      setStatus('Deleted "' + key + '".', false);
      await refreshList();
    } catch (err) {
      setStatus('Error: ' + err.message, true);
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  // Allow pressing Enter in the key input to jump to the value textarea
  document.getElementById('input-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('input-value').focus();
    }
  });

  // Refresh when the API URL changes (debounced)
  let urlDebounce;
  document.getElementById('api-url').addEventListener('input', () => {
    clearTimeout(urlDebounce);
    urlDebounce = setTimeout(refreshList, 600);
  });

  refreshList();
</script>
</body>
</html>
`;

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`UI server running at http://localhost:${PORT}`);
