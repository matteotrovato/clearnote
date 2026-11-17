// Service worker: owns settings, the outbound queue and the server handshake.
//
// MV3 workers are killed aggressively, so every segment goes into a
// chrome.storage.local queue before it is sent, and an alarm drains the queue.
// Nothing is lost if the worker is torn down mid-meeting.

const DEFAULTS = {
  serverUrl: "http://localhost:8787",
  dashboardUrl: "http://localhost:8787",
  token: "",
  displayName: "",
  autoCapture: true,
  hideCaptions: true,
  debug: false,
};

const QUEUE_KEY = "cn_queue";
const CLAIMS_KEY = "cn_claims";

async function settings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function api(path, body, method = "POST") {
  const { serverUrl, token } = await settings();
  const res = await fetch(`${serverUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-clearnote-token": token || "" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}

// ---------------------------------------------------------------- queue

async function enqueue(item) {
  const { [QUEUE_KEY]: q = [] } = await chrome.storage.local.get(QUEUE_KEY);
  q.push(item);
  await chrome.storage.local.set({ [QUEUE_KEY]: q });
}

let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const { [QUEUE_KEY]: q = [] } = await chrome.storage.local.get(QUEUE_KEY);
      if (!q.length) break;

      // Coalesce consecutive segment batches for the same session into one call.
      const head = q[0];
      let take = 1;
      let payload = head.body;
      if (head.path.endsWith("/segments")) {
        while (take < q.length && q[take].path === head.path) {
          payload = { segments: payload.segments.concat(q[take].body.segments) };
          take++;
        }
      }

      try {
        await api(head.path, payload, head.method || "POST");
      } catch (err) {
        console.warn("[ClearNote] send failed, will retry:", err.message);
        break; // leave the queue intact; the next alarm retries
      }
      const { [QUEUE_KEY]: cur = [] } = await chrome.storage.local.get(QUEUE_KEY);
      await chrome.storage.local.set({ [QUEUE_KEY]: cur.slice(take) });
    }
  } finally {
    draining = false;
    await badge();
  }
}

async function badge() {
  const { [QUEUE_KEY]: q = [] } = await chrome.storage.local.get(QUEUE_KEY);
  await chrome.action.setBadgeBackgroundColor({ color: q.length ? "#f0b429" : "#3ddc84" });
  await chrome.action.setBadgeText({ text: q.length ? String(Math.min(q.length, 99)) : "" });
}

chrome.alarms.create("cn-drain", { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "cn-drain") drain();
});

// ---------------------------------------------------------------- messages

const handlers = {
  async getSettings() {
    return settings();
  },

  // Keeps two frames of the same meeting from both opening a session.
  async claimSession({ meetingKey }, sender) {
    const { [CLAIMS_KEY]: claims = {} } = await chrome.storage.local.get(CLAIMS_KEY);
    const mine = `${sender.tab?.id}:${sender.frameId}`;
    const held = claims[meetingKey];
    if (held && held.owner !== mine && Date.now() - held.at < 60000) return { owner: false };
    claims[meetingKey] = { owner: mine, at: Date.now() };
    await chrome.storage.local.set({ [CLAIMS_KEY]: claims });
    return { owner: true };
  },

  async startSession(payload) {
    // Created synchronously so the content script gets a real id to stream to.
    try {
      const { id } = await api("/api/sessions", payload);
      await chrome.action.setBadgeText({ text: "REC" });
      await chrome.action.setBadgeBackgroundColor({ color: "#3ddc84" });
      return { sessionId: id };
    } catch (err) {
      console.warn("[ClearNote] could not reach the server:", err.message);
      // Fall back to the deterministic key; the server upserts on it, so the
      // queued segments still land in the right meeting once it comes back.
      await enqueue({ path: "/api/sessions", body: payload });
      return { sessionId: payload.meetingKey };
    }
  },

  async segments({ sessionId, segments }) {
    await enqueue({
      path: `/api/sessions/${encodeURIComponent(sessionId)}/segments`,
      body: { segments },
    });
    drain();
    return { ok: true };
  },

  async endSession(payload) {
    await enqueue({
      path: `/api/sessions/${encodeURIComponent(payload.sessionId)}/end`,
      body: payload,
    });
    await drain();
    await chrome.action.setBadgeText({ text: "" });
    return { ok: true };
  },

  async retryNow() {
    await drain();
    const { [QUEUE_KEY]: q = [] } = await chrome.storage.local.get(QUEUE_KEY);
    return { pending: q.length };
  },

  async status() {
    const { [QUEUE_KEY]: q = [] } = await chrome.storage.local.get(QUEUE_KEY);
    const s = await settings();
    let reachable = false;
    try {
      await api("/api/health", undefined, "GET");
      reachable = true;
    } catch {
      /* server down */
    }
    return { pending: q.length, reachable, ...s };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn(msg.payload || {}, sender))
    .then(respond)
    .catch((err) => {
      console.error(`[ClearNote] ${msg.type} failed`, err);
      respond({ error: err.message });
    });
  return true; // async response
});
