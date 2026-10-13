import { randomBytes } from "node:crypto";

/** The invitation stays in the URL fragment, never in tunnel/server access logs. */
export function bridgePairingPage() {
  const nonce = randomBytes(16).toString("base64");
  return {
    nonce,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Applio · Bridge Mode</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#09090b;color:#e7e5e4;font:14px/1.6 system-ui;min-height:100dvh;display:grid;place-items:center;padding:24px;color-scheme:dark}
.card{max-width:420px;width:100%;padding:32px;border:1px solid #2b2b30;border-radius:20px;background:#131315;box-shadow:0 24px 80px #0005}
.brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:32px}.brand strong{font-size:17px;letter-spacing:-.04em}.badge{font-size:10px;letter-spacing:.04em;color:#aaaab2;background:#ffffff07;border:1px solid #ffffff12;padding:4px 9px;border-radius:100px}
.icon{display:grid;place-items:center;width:52px;height:52px;border:1px solid #33333b;background:#1c1c20;border-radius:15px;margin-bottom:20px;color:#d4d4d8}
h1{font-size:26px;letter-spacing:-.04em;line-height:1.2;margin:0 0 12px;font-weight:650}.muted{color:#94949e;margin:0}
label{display:block;margin:26px 0 8px;font-size:12px;font-weight:600}input,button{font:inherit;width:100%;min-height:46px;padding:11px 13px;border-radius:10px;border:1px solid #34343b}input{color:inherit;background:#0b0b0d;outline:none}input:focus-visible{border-color:#aaaab2;box-shadow:0 0 0 3px #ffffff0d}button{margin-top:12px;background:#f4f4f5;color:#111;font-weight:600;cursor:pointer;border-color:#f4f4f5}button:disabled{opacity:.5;cursor:wait}button:focus-visible{outline:2px solid white;outline-offset:4px}
#code{font:600 clamp(22px,7vw,30px)/1.2 ui-monospace,monospace;letter-spacing:.17em;text-align:center;margin:20px 0 0;border-radius:12px;background:#0b0b0d;border:1px solid #35353c;padding:22px 12px;color:#fafafa}#code:empty{display:none}
#status{overflow-wrap:anywhere;font-size:12px;color:#aaaab2;margin:16px 0 0}body[data-phase="pending"] .icon{color:#fbbf24;border-color:#fbbf2433;background:#fbbf2408}body[data-phase="pending"] #status{color:#d4d4d8}
.footer{border-top:1px solid #ffffff0d;margin-top:28px;padding-top:18px;font-size:11px;color:#80808b}.footer strong{display:block;font-weight:500;color:#aaaab2;margin-bottom:4px}
@media(max-width:380px){body{padding:16px}.card{padding:24px}}@media(prefers-reduced-motion:no-preference){.card{animation:enter .3s ease-out}@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
</style></head>
<body><main class="card">
<div class="brand"><strong>Applio</strong><span class="badge">PERSONAL ACCESS</span></div>
<div class="icon" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/></svg></div>
<h1 id="heading">Your Applio, here.</h1><p class="muted" id="subtitle">Connect to your computer and use its models from this browser.</p>
<form id="pair"><label for="name">Give this device a name</label><input id="name" maxlength="64" autocomplete="off" placeholder="My phone" required><button id="connect">Request access</button></form>
<p id="status" role="status" aria-live="polite"></p><p id="code" aria-label="Matching approval code"></p>
<div class="footer"><strong>Processing stays on your computer.</strong>Access expires after eight hours. On a borrowed computer, disconnect before leaving.</div>
</main>
<script nonce="${nonce}">
const form = document.getElementById('pair');
const status = document.getElementById('status');
const code = document.getElementById('code');
const connect = document.getElementById('connect');
const token = new URLSearchParams(location.hash.slice(1)).get('invite');
history.replaceState(null, '', location.pathname);
document.getElementById('name').value = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'My phone' : 'My browser';
let polling;
let hadRequest = false;
async function check() {
  try {
    const response = await fetch('/bridge/session', {cache: 'no-store'});
    const session = await response.json();
    if (session.status === 'approved') {
      try { sessionStorage.setItem('applio:remote-bridge', '1'); } catch {}
      location.replace('/inference');
      return;
    }
    if (session.status === 'pending') {
      document.body.dataset.phase = 'pending';
      document.getElementById('heading').textContent = 'One last step.';
      document.getElementById('subtitle').textContent = 'Confirm this connection on your computer.';
      hadRequest = true;
      form.hidden = true;
      status.textContent = 'Approve this device in Settings → Bridge Mode on your host. Check that the code matches:';
      code.textContent = session.code.slice(0, 4) + ' ' + session.code.slice(4);
      polling = setTimeout(check, 2000);
      return;
    }
    code.textContent = '';
    document.body.dataset.phase = 'ready';
    document.getElementById('heading').textContent = token ? 'Your Applio, here.' : 'A fresh link is needed.';
    document.getElementById('subtitle').textContent = token ? 'Connect to your computer and use its models from this browser.' : 'Start with an invitation from your host computer.';
    connect.disabled = false;
    form.hidden = !token;
    status.textContent = !token ? 'Open a fresh invitation link or scan the QR code on your host computer.'
      : hadRequest ? 'Your request expired or was rejected. You can request access again while the invitation is valid.'
      : 'Your host must approve this connection.';
  } catch {
    status.textContent = 'Unable to reach the host. Keep Applio open; retrying…';
    polling = setTimeout(check, 3000);
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  clearTimeout(polling);
  connect.disabled = true;
  try {
    const response = await fetch('/bridge/pair', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({invite: token, name: document.getElementById('name').value}),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    await check();
  } catch (error) {
    status.textContent = error.message;
    connect.disabled = false;
  }
});
check();
</script></body></html>`,
  };
}
