const FIELDS = ["serverUrl", "token", "displayName", "autoCapture", "hideCaptions", "debug"];
const DEFAULTS = {
  serverUrl: "http://localhost:8787",
  token: "",
  displayName: "",
  autoCapture: true,
  hideCaptions: true,
  debug: false,
};

chrome.storage.sync.get(DEFAULTS).then((s) => {
  for (const k of FIELDS) {
    const el = document.getElementById(k);
    if (el.type === "checkbox") el.checked = !!s[k];
    else el.value = s[k] ?? "";
  }
});

document.getElementById("save").onclick = async () => {
  const patch = {};
  for (const k of FIELDS) {
    const el = document.getElementById(k);
    patch[k] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  // The dashboard lives on the same origin as the API.
  patch.dashboardUrl = patch.serverUrl || DEFAULTS.serverUrl;
  await chrome.storage.sync.set(patch);
  const saved = document.getElementById("saved");
  saved.classList.add("show");
  setTimeout(() => saved.classList.remove("show"), 1600);
};
