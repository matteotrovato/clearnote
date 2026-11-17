// Shared helpers for the content-script bundle. Attaches to window.ClearNote
// because MV3 content scripts share one scope but are not modules.
(function () {
  const CN = (window.ClearNote = window.ClearNote || {});

  CN.log = (...args) => {
    if (CN.debug) console.log("%c[ClearNote]", "color:#4aa3df;font-weight:600", ...args);
  };

  CN.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Poll until fn() returns something truthy, or give up.
  CN.waitFor = async function waitFor(fn, { timeout = 60000, interval = 400 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      try {
        const v = fn();
        if (v) return v;
      } catch {
        /* selector churn during page load */
      }
      if (Date.now() > deadline) return null;
      await CN.sleep(interval);
    }
  };

  // First element matching any of the candidate selectors. Platform DOMs are
  // obfuscated and change often, so every lookup takes a list, newest first.
  CN.pick = function pick(selectors, root = document) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  CN.pickAll = function pickAll(selectors, root = document) {
    for (const sel of selectors) {
      const els = root.querySelectorAll(sel);
      if (els.length) return Array.from(els);
    }
    return [];
  };

  // Find a button by its accessible name.
  CN.buttonByLabel = function buttonByLabel(re, root = document) {
    const nodes = root.querySelectorAll(
      'button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"]',
    );
    for (const n of nodes) {
      const label = `${n.getAttribute("aria-label") || ""} ${n.getAttribute("data-tooltip") || ""} ${
        n.textContent || ""
      }`;
      if (re.test(label)) return n;
    }
    return null;
  };

  CN.normalize = (s) => (s || "").replace(/\s+/g, " ").trim();

  // Every platform labels the local participant "You" rather than by name, so
  // your own lines read oddly and can never be matched to a calendar invitee.
  // With a display name configured, swap it in at capture time.
  const SELF_LABELS = /^(you|me|you \(you\)|me \(me\)|you \(host\))$/i;

  CN.isSelfLabel = (name) => SELF_LABELS.test(CN.normalize(name));

  CN.resolveSpeaker = (name, displayName) =>
    displayName && CN.isSelfLabel(name) ? displayName : CN.normalize(name);

  CN.uuid = () =>
    (crypto.randomUUID && crypto.randomUUID()) ||
    `cn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  CN.fmtClock = (ms) => {
    const t = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };
})();
