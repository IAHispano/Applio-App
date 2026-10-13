import { randomBytes } from "node:crypto";

/** The invitation stays in the URL fragment, never in tunnel/server access logs. */
export interface BridgePairingLanguage {
  code: string;
  dict: Record<string, string>;
}

export const BRIDGE_PAIRING_KEYS = [
  "Bridge Mode",
  "Personal access",
  "Your Applio, here.",
  "Connect to your computer and use its models from this browser.",
  "Give this device a name",
  "My phone",
  "My browser",
  "Request access",
  "Matching approval code",
  "Processing stays on your computer.",
  "Access expires after eight hours. On a borrowed computer, disconnect before leaving.",
  "One last step.",
  "Confirm this connection on your computer.",
  "Approve this device in Settings → Bridge Mode on your host. Check that the code matches:",
  "A fresh link is needed.",
  "Start with an invitation from your host computer.",
  "Open a fresh invitation link or scan the QR code on your host computer.",
  "Your request expired or was rejected. You can request access again while the invitation is valid.",
  "Your host must approve this connection.",
  "Unable to reach the host. Keep Applio open; retrying…",
  "Too many requests. Try again in a minute.",
  "Invalid invitation",
  "This browser is already connected",
  "This invitation has expired. Create a new link on the host computer.",
  "Too many devices. Remove a device on the host first.",
  "The host service is unavailable. Keep Applio running.",
  "Could not request access. Please try again.",
] as const;

export function bridgePairingPage(language: BridgePairingLanguage = { code: "en_US", dict: {} }) {
  const nonce = randomBytes(16).toString("base64");
  const messages = Object.fromEntries(BRIDGE_PAIRING_KEYS.map((key) => [key, language.dict[key] || key]));
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const text = (key: (typeof BRIDGE_PAIRING_KEYS)[number]) => escapeHtml(messages[key]);
  const lang = escapeHtml(language.code.split(/[_-]/)[0] || "en");
  const scriptMessages = JSON.stringify(messages).replace(/</g, "\\u003c");
  return {
    nonce,
    html: `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Applio · ${text("Bridge Mode")}</title><link rel="preload" href="/bridge/syne.ttf" as="font" type="font/ttf" crossorigin>
<style nonce="${nonce}">
@font-face{font-family:Syne;src:url('/bridge/syne.ttf') format('truetype');font-weight:400 800;font-style:normal;font-display:swap}
:root{--bg:#09090b;--panel:#121214;--surface:#151517;--border:rgba(255,255,255,.09);--text:#e7e5e4;--heading:#f5f5f5;--muted:#a3a3a3;--accent:#fff;--accent-soft:rgba(255,255,255,.12)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 Syne,ui-sans-serif,system-ui,sans-serif;min-height:100dvh;display:grid;place-items:center;padding:24px;color-scheme:dark;-webkit-font-smoothing:antialiased}
.card{max-width:420px;width:100%;padding:28px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}
.brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:32px}.brand strong{font-size:17px;letter-spacing:-.04em}.badge{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#aaaab2;background:#ffffff07;border:1px solid #ffffff12;padding:4px 9px;border-radius:100px}
.icon{display:grid;place-items:center;width:48px;height:48px;border:1px solid var(--border);background:var(--accent-soft);border-radius:12px;margin-bottom:20px;color:var(--heading)}
h1{font-size:26px;letter-spacing:-.04em;line-height:1.2;margin:0 0 12px;font-weight:700;color:var(--heading)}.muted{color:var(--muted);margin:0}
label{display:block;margin:26px 0 8px;font-size:12px;font-weight:600}input,button{font:inherit;width:100%;min-height:46px;padding:11px 13px;border-radius:10px;border:1px solid var(--border)}input{font-size:16px;border-radius:8px;color:inherit;background:rgba(0,0,0,.25);outline:none}input:focus-visible{border-color:var(--accent);outline:2px solid var(--accent);outline-offset:2px}button{margin-top:12px;background:var(--accent);color:#060606;font-weight:600;cursor:pointer;border-color:var(--accent)}button:disabled{opacity:.5;cursor:wait}button:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
#code{font:600 clamp(22px,7vw,30px)/1.2 Syne,ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;direction:ltr;letter-spacing:.12em;text-align:center;margin:20px 0 0;border-radius:12px;background:var(--surface);border:1px solid var(--border);padding:22px 12px;color:var(--heading)}#code:empty{display:none}
#status{overflow-wrap:anywhere;font-size:12px;color:#aaaab2;margin:16px 0 0}body[data-phase="pending"] .icon{color:#fbbf24;border-color:#fbbf2433;background:#fbbf2408}body[data-phase="pending"] #status{color:#d4d4d8}
.footer{border-top:1px solid #ffffff0d;margin-top:28px;padding-top:18px;font-size:11px;color:#80808b}.footer strong{display:block;font-weight:500;color:#aaaab2;margin-bottom:4px}
@media(max-width:380px){body{padding:16px}.card{padding:24px}}@media(prefers-reduced-motion:no-preference){.card{animation:enter .3s ease-out}@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
</style></head>
<body><main class="card">
<div class="brand"><strong>Applio</strong><span class="badge">${text("Personal access")}</span></div>
<div class="icon" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/></svg></div>
<h1 id="heading">${text("Your Applio, here.")}</h1><p class="muted" id="subtitle">${text("Connect to your computer and use its models from this browser.")}</p>
<form id="pair"><label for="name">${text("Give this device a name")}</label><input id="name" maxlength="64" autocomplete="off" placeholder="${text("My phone")}" required><button id="connect">${text("Request access")}</button></form>
<p id="status" role="status" aria-live="polite"></p><p id="code" aria-label="${text("Matching approval code")}"></p>
<div class="footer"><strong>${text("Processing stays on your computer.")}</strong>${text("Access expires after eight hours. On a borrowed computer, disconnect before leaving.")}</div>
</main>
<script nonce="${nonce}">
const messages = ${scriptMessages};
const t = key => messages[key] || key;
const form = document.getElementById('pair');
const status = document.getElementById('status');
const code = document.getElementById('code');
const connect = document.getElementById('connect');
const token = new URLSearchParams(location.hash.slice(1)).get('invite');
history.replaceState(null, '', location.pathname);
document.getElementById('name').value = t(/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'My phone' : 'My browser');
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
      document.getElementById('heading').textContent = t('One last step.');
      document.getElementById('subtitle').textContent = t('Confirm this connection on your computer.');
      hadRequest = true;
      form.hidden = true;
      status.textContent = t('Approve this device in Settings → Bridge Mode on your host. Check that the code matches:');
      code.textContent = session.code.slice(0, 4) + ' ' + session.code.slice(4);
      polling = setTimeout(check, 2000);
      return;
    }
    code.textContent = '';
    document.body.dataset.phase = 'ready';
    document.getElementById('heading').textContent = t(token ? 'Your Applio, here.' : 'A fresh link is needed.');
    document.getElementById('subtitle').textContent = t(token ? 'Connect to your computer and use its models from this browser.' : 'Start with an invitation from your host computer.');
    connect.disabled = false;
    form.hidden = !token;
    status.textContent = t(!token ? 'Open a fresh invitation link or scan the QR code on your host computer.'
      : hadRequest ? 'Your request expired or was rejected. You can request access again while the invitation is valid.'
      : 'Your host must approve this connection.');
  } catch {
    status.textContent = t('Unable to reach the host. Keep Applio open; retrying…');
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
    status.textContent = t(error.message || 'Could not request access. Please try again.');
    connect.disabled = false;
  }
});
check();
</script></body></html>`,
  };
}
