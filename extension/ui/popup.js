const ask = (type, payload) =>
  new Promise((r) => chrome.runtime.sendMessage({ type, payload }, (res) => r(res || {})));

async function paint() {
  const s = await ask("status");
  const server = document.getElementById("server");
  server.textContent = s.reachable ? "connected" : "unreachable";
  server.className = `v ${s.reachable ? "ok" : "bad"}`;

  const pending = document.getElementById("pending");
  pending.textContent = s.pending ? `${s.pending} batches` : "nothing";
  pending.className = `v ${s.pending ? "warn" : "ok"}`;

  document.getElementById("auto").textContent = s.autoCapture ? "on" : "off";
  document.getElementById("dash").href = s.dashboardUrl || "http://localhost:8787";
}

document.getElementById("retry").onclick = async (e) => {
  e.target.textContent = "Syncing…";
  await ask("retryNow");
  e.target.textContent = "Retry sync";
  paint();
};
document.getElementById("opts").onclick = () => chrome.runtime.openOptionsPage();

paint();
