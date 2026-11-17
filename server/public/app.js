// Dashboard: hash-routed, no build step.

const view = document.getElementById("view");
const qInput = document.getElementById("q");

const api = async (path, opts) => {
  const res = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
};

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const clock = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  const h = Math.floor(t / 3600);
  return h ? `${h}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}` : `${Math.floor(t / 60)}:${pad(t % 60)}`;
};

const when = (ts) => {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const yd = new Date(today.getTime() - 864e5);
  if (d.toDateString() === yd.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
};

const duration = (m) => {
  if (!m.ended_at) return "in progress";
  const mins = Math.round((m.ended_at - m.started_at) / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
};

// --------------------------------------------------------------- meeting list

async function renderList({ q, tag } = {}) {
  view.innerHTML = `<div class="loading">Loading meetings…</div>`;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tag) params.set("tag", tag);
  const meetings = await api(`/meetings?${params}`);

  const title = q
    ? `Results for “${esc(q)}”`
    : tag
      ? `Tagged <a class="tag" href="#/">${esc(tag)} ✕</a>`
      : "Meetings";

  if (!meetings.length) {
    view.innerHTML = `<h1>${title}</h1>
      <div class="empty">
        ${
          q || tag
            ? "<b>Nothing matched.</b><br/>Try another term."
            : `<b>No meetings captured yet.</b><br/>Join a Google Meet, Zoom or Teams call with the extension
               installed and captions on. The transcript lands here when the call ends.`
        }
      </div>`;
    return;
  }

  view.innerHTML = `
    <h1>${title}</h1>
    <p class="sub">${meetings.length} meeting${meetings.length === 1 ? "" : "s"} captured</p>
    <div class="mlist">
      ${meetings
        .map((m) => {
          const badge =
            m.status === "ready"
              ? ""
              : `<span class="badge ${esc(m.status)}">${
                  m.status === "live" ? "capturing" : esc(m.status)
                }</span>`;
          return `<a class="mitem" href="#/m/${esc(m.id)}">
            <div class="head">
              <span class="t">${esc(m.title || "Untitled meeting")}</span>
              ${badge}
              <span class="when">${when(m.started_at)}</span>
            </div>
            ${m.summary?.headline ? `<p class="headline">${esc(m.summary.headline)}</p>` : ""}
            <div class="meta">
              <span>${esc(m.platform_label || m.platform)}</span>
              <span>${duration(m)}</span>
              <span><b>${m.segmentCount}</b> lines</span>
              ${m.participants.length ? `<span>${esc(m.participants.join(", "))}</span>` : ""}
              ${m.openActions ? `<span><b>${m.openActions}</b> open action${m.openActions === 1 ? "" : "s"}</span>` : ""}
              ${m.inviteeCount ? `<span><b>${m.inviteeCount}</b> invited</span>` : ""}
              ${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
            </div>
          </a>`;
        })
        .join("")}
    </div>`;
}

// ------------------------------------------------------------- meeting detail

async function renderMeeting(id) {
  view.innerHTML = `<div class="loading">Loading meeting…</div>`;
  const m = await api(`/meetings/${id}`);
  const s = m.summary || {};

  view.innerHTML = `
    <div class="detail-head">
      <h1><input class="edit-title" id="mtitle" value="${esc(m.title || "Untitled meeting")}" /></h1>
      <p class="sub">
        ${esc(m.platform_label || m.platform)} · ${when(m.started_at)} · ${duration(m)} ·
        ${m.segments.length} lines${m.participants.length ? ` · ${esc(m.participants.join(", "))}` : ""}
      </p>
      <div class="row">
        ${m.tags.map((t) => `<a class="tag" href="#/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}
        <span class="spacer"></span>
        <button class="btn" id="reprocess">${m.status === "ready" ? "Regenerate summary" : "Generate summary"}</button>
        <button class="btn ghost" id="copy">Copy notes</button>
        <a class="btn ghost" href="/api/meetings/${esc(m.id)}/export.txt" download>Download .txt</a>
        <button class="btn danger" id="delete">Delete</button>
      </div>
    </div>

    ${
      m.status === "captured"
        ? `<div class="card"><h2>No summary yet</h2>
             <p class="muted" style="font-size:13.5px">${esc(s.notice || "")}</p></div>`
        : ""
    }
    ${
      m.status === "failed"
        ? `<div class="card"><h2>Summary unavailable</h2>
             <p class="err">${esc(s.error || "The summary step failed.")}</p>
             <p class="muted" style="font-size:13px">The transcript below was still captured in full.</p></div>`
        : ""
    }
    ${
      m.status === "processing"
        ? `<div class="card"><h2>Writing the summary…</h2>
             <p class="muted" style="font-size:13px">This page refreshes itself when it is ready.</p></div>`
        : ""
    }

    ${
      s.tldr
        ? `<div class="card">
             <h2>Summary</h2>
             <p class="tldr">${esc(s.tldr)}</p>
             ${s.key_points?.length ? `<ul class="points">${s.key_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
           </div>`
        : ""
    }

    <div class="cols">
      <div>
        ${
          s.decisions?.length
            ? `<div class="card"><h2>Decisions</h2><ul class="points">${s.decisions
                .map((d) => `<li>${esc(d)}</li>`)
                .join("")}</ul></div>`
            : ""
        }
        <div class="card">
          <h2>Action items</h2>
          <div id="actions">
            ${
              m.actionItems.length
                ? m.actionItems.map(actionRow).join("")
                : `<p class="muted" style="font-size:13.5px">None found in this meeting.</p>`
            }
          </div>
          <form id="add-action" class="row" style="margin-top:12px">
            <input class="search" style="flex:1;max-width:none" name="text" placeholder="Add an action item…" />
            <button class="btn">Add</button>
          </form>
        </div>
        ${
          s.open_questions?.length
            ? `<div class="card"><h2>Open questions</h2><ul class="points">${s.open_questions
                .map((q) => `<li>${esc(q)}</li>`)
                .join("")}</ul></div>`
            : ""
        }
      </div>

      <div>
        ${calendarCard(m)}
        ${
          m.insights.length
            ? `<div class="card"><h2>Insights</h2>${m.insights
                .map(
                  (i) => `<div class="ins">
                    <div class="kind">${esc(i.kind.replace(/_/g, " "))}${i.speaker ? ` · ${esc(i.speaker)}` : ""}</div>
                    ${i.quote ? `<q>${esc(i.quote)}</q>` : ""}
                    <div class="note">${esc(i.note || "")}</div>
                  </div>`,
                )
                .join("")}</div>`
            : ""
        }
        <div class="card">
          <h2>Ask about this meeting</h2>
          <div class="ai" id="chat">
            <p class="muted" style="font-size:13px;margin:0">
              Questions are answered from this transcript only.
            </p>
            <form id="askf">
              <input name="q" placeholder="What did we decide about pricing?" autocomplete="off" />
              <button class="btn primary">Ask</button>
            </form>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row"><h2 style="margin:0">Transcript</h2>
        <span class="spacer"></span>
        <span class="muted" style="font-size:12px">Click a line to fix it. Click ✎ to rename a speaker everywhere.</span>
      </div>
      <div class="tx" style="margin-top:12px">
        ${m.segments.map(txLine).join("") || `<p class="muted">No captions were captured.</p>`}
      </div>
    </div>`;

  wireDetail(m);
  if (m.status === "processing") setTimeout(() => route(), 6000);
}

function actionRow(a) {
  return `<div class="ai-item ${a.done ? "done" : ""}" data-id="${a.id}">
    <input type="checkbox" ${a.done ? "checked" : ""} />
    <div class="body">
      <div class="txt">${esc(a.text)}</div>
      <div class="sub2">
        ${a.priority ? `<span class="prio ${esc(a.priority)}">${esc(a.priority)}</span>` : ""}
        ${a.owner ? `<span>${esc(a.owner)}</span>` : `<span class="muted">unassigned</span>`}
        ${a.due ? `<span>due ${esc(a.due)}</span>` : ""}
        ${a.source === "manual" ? `<span class="muted">added by you</span>` : ""}
      </div>
    </div>
  </div>`;
}

function txLine(s) {
  return `<div class="line" data-id="${s.id}">
    <div class="ts">${clock(s.start_ms)}</div>
    <div>
      <div class="sp">${esc(s.speaker)}<button title="Rename this speaker everywhere" data-rename="${s.id}">✎</button></div>
      <div class="say" contenteditable="plaintext-only" data-text="${s.id}">${esc(s.text)}</div>
    </div>
  </div>`;
}

function wireDetail(m) {
  const title = document.getElementById("mtitle");
  title.onchange = () =>
    api(`/meetings/${m.id}`, { method: "PATCH", body: JSON.stringify({ title: title.value }) });

  document.getElementById("reprocess").onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Working…";
    try {
      await api(`/meetings/${m.id}/process`, { method: "POST" });
      route();
    } catch (err) {
      e.target.disabled = false;
      e.target.textContent = "Retry summary";
      alert(err.message);
    }
  };

  document.getElementById("copy").onclick = async (e) => {
    const s = m.summary || {};
    const text = [
      m.title,
      new Date(m.started_at).toLocaleString(),
      "",
      s.tldr || "",
      "",
      ...(s.key_points || []).map((p) => `• ${p}`),
      s.decisions?.length ? `\nDecisions:\n${s.decisions.map((d) => `• ${d}`).join("\n")}` : "",
      m.actionItems.length
        ? `\nAction items:\n${m.actionItems
            .map((a) => `• ${a.text}${a.owner ? ` — ${a.owner}` : ""}${a.due ? ` (due ${a.due})` : ""}`)
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard.writeText(text);
    e.target.textContent = "Copied";
    setTimeout(() => (e.target.textContent = "Copy notes"), 1500);
  };

  document.getElementById("pick-event").onclick = () => openEventPicker(m);

  document.getElementById("delete").onclick = async () => {
    // Deleting takes the transcript with it and cannot be undone, so the
    // meeting is named in the prompt rather than just "this meeting".
    const label = `${m.title || "Untitled meeting"} (${m.segments.length} lines)`;
    if (!confirm(`Delete "${label}"?\n\nThe transcript, action items and search entries all go with it. This cannot be undone.`)) {
      return;
    }
    await api(`/meetings/${m.id}`, { method: "DELETE" });
    location.hash = "#/";
  };

  document.getElementById("actions").addEventListener("change", async (e) => {
    const row = e.target.closest(".ai-item");
    if (!row) return;
    row.classList.toggle("done", e.target.checked);
    await api(`/action-items/${row.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: e.target.checked }),
    });
  });

  document.getElementById("add-action").onsubmit = async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    await api(`/meetings/${m.id}/action-items`, { method: "POST", body: JSON.stringify({ text }) });
    route();
  };

  // Transcript edits: blur saves the line; ✎ renames the speaker throughout.
  const tx = view.querySelector(".tx");
  tx.addEventListener(
    "blur",
    async (e) => {
      const el = e.target.closest?.("[data-text]");
      if (!el) return;
      const seg = m.segments.find((s) => String(s.id) === el.dataset.text);
      const next = el.textContent.trim();
      if (!seg || next === seg.text) return;
      seg.text = next;
      await api(`/segments/${seg.id}`, { method: "PATCH", body: JSON.stringify({ text: next }) });
    },
    true,
  );
  tx.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-rename]");
    if (!btn) return;
    const seg = m.segments.find((s) => String(s.id) === btn.dataset.rename);
    const next = prompt(`Rename “${seg.speaker}” everywhere in this meeting:`, seg.speaker);
    if (!next || next === seg.speaker) return;
    await api(`/segments/${seg.id}`, {
      method: "PATCH",
      body: JSON.stringify({ speaker: next, renameAll: true }),
    });
    route();
  });

  // Meeting chat.
  const chat = document.getElementById("chat");
  const form = document.getElementById("askf");
  const history = [];
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) return;
    form.q.value = "";
    chat.insertBefore(bubble("user", q), form);
    const thinking = bubble("bot", "…");
    chat.insertBefore(thinking, form);
    try {
      const { text } = await api(`/meetings/${m.id}/ask`, {
        method: "POST",
        body: JSON.stringify({ question: q, history }),
      });
      thinking.textContent = text;
      history.push({ role: "user", content: q }, { role: "assistant", content: text });
    } catch (err) {
      thinking.textContent = err.message;
      thinking.classList.add("err");
    }
  };
}

function bubble(kind, text) {
  const el = document.createElement("div");
  el.className = `msg ${kind}`;
  el.textContent = text;
  return el;
}

// ----------------------------------------------------------------- calendar

/** The calendar card on a meeting: which event it is, who was there, who wasn't. */
function calendarCard(m) {
  const e = m.calendarEvent;
  if (!e) {
    return `<div class="card" id="cal-card">
      <div class="row"><h2 style="margin:0">Calendar</h2><span class="spacer"></span>
        <button class="btn ghost" id="pick-event">Link to an event</button></div>
      <p class="muted" style="font-size:13.5px;margin:10px 0 0">
        Not matched to a calendar event. Impromptu calls usually aren't — and when two
        events overlap, ClearNote asks rather than guesses.
      </p>
      <div id="cal-picker"></div>
    </div>`;
  }

  const when = `${new Date(e.start_at).toLocaleString([], {
    weekday: "short", hour: "numeric", minute: "2-digit",
  })} – ${new Date(e.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  const conf = {
    high: ["ok", "matched by meeting link"],
    confirmed: ["ok", "confirmed by you"],
    medium: ["warn", `matched by ${m.matched_by || "calendar"}`],
    low: ["warn", "matched by time only — worth checking"],
  }[m.match_confidence] || ["warn", "matched"];

  return `<div class="card" id="cal-card">
    <div class="row"><h2 style="margin:0">Calendar</h2>
      <span class="pill ${conf[0]}">${esc(conf[1])}</span>
      <span class="spacer"></span>
      <button class="btn ghost" id="pick-event">Change</button></div>

    <div style="margin-top:10px">
      <div style="font-weight:650">${
        e.html_link
          ? `<a href="${esc(e.html_link)}" target="_blank" rel="noreferrer">${esc(e.title)}</a>`
          : esc(e.title)
      }</div>
      <div class="muted" style="font-size:12.5px">${esc(when)}</div>
    </div>

    ${
      m.spoke?.length
        ? `<div style="margin-top:14px"><h2>Spoke</h2>${m.spoke
            .map(
              (p) =>
                `<div class="person"><span class="dot-ok"></span>${esc(p.name)}${
                  p.email ? `<span class="muted"> ${esc(p.email)}</span>` : ""
                }</div>`,
            )
            .join("")}</div>`
        : ""
    }
    ${
      m.silentInvitees?.length
        ? `<div style="margin-top:12px"><h2>Invited, never spoke</h2>${m.silentInvitees
            .map(
              (p) =>
                `<div class="person muted"><span class="dot-off"></span>${esc(
                  p.name || p.email,
                )}${p.response === "declined" ? " (declined)" : ""}</div>`,
            )
            .join("")}</div>`
        : ""
    }
    <div id="cal-picker"></div>
  </div>`;
}

async function openEventPicker(m) {
  const box = document.getElementById("cal-picker");
  box.innerHTML = `<p class="muted" style="font-size:13px">Loading events…</p>`;
  const { events, suggestion } = await api(`/meetings/${m.id}/match-candidates`);

  if (!events.length) {
    box.innerHTML = `<p class="muted" style="font-size:13px;margin-top:12px">
      No calendar events around this time. Connect Google Calendar in
      <a href="#/settings">Settings</a>, or sync again.</p>`;
    return;
  }

  box.innerHTML = `<div style="margin-top:14px;border-top:1px solid var(--line-soft);padding-top:12px">
    <h2>Which event was this?</h2>
    ${events
      .map(
        (e) => `<label class="pick">
          <input type="radio" name="ev" value="${esc(e.id)}" ${e.id === m.calendar_event_id ? "checked" : ""} />
          <span>
            <b>${esc(e.title)}</b>${e.id === suggestion ? ` <span class="pill ok">suggested</span>` : ""}
            <span class="muted" style="display:block;font-size:12px">
              ${new Date(e.start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              – ${new Date(e.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              · ${e.attendees.length} invited
            </span>
          </span>
        </label>`,
      )
      .join("")}
    <div class="row" style="margin-top:10px">
      <button class="btn primary" id="save-event">Link</button>
      <button class="btn" id="clear-event">Not on the calendar</button>
    </div>
  </div>`;

  document.getElementById("save-event").onclick = async () => {
    const chosen = box.querySelector('input[name="ev"]:checked');
    if (!chosen) return;
    await api(`/meetings/${m.id}/match`, {
      method: "POST",
      body: JSON.stringify({ eventId: chosen.value, adoptTitle: !!m.title_is_generic }),
    });
    route();
  };
  document.getElementById("clear-event").onclick = async () => {
    await api(`/meetings/${m.id}/match`, { method: "POST", body: JSON.stringify({ eventId: null }) });
    route();
  };
}

async function renderSettings() {
  const flash = new URLSearchParams(location.hash.split("?")[1] || "").get("google");
  view.innerHTML = `<div class="loading">Loading…</div>`;
  const status = await api("/google/status");

  view.innerHTML = `
    <h1>Settings</h1>
    <p class="sub">Google Calendar matches each captured meeting to its event, title and invitees.</p>

    ${
      flash
        ? `<div class="card" style="border-color:${
            flash === "connected" ? "rgba(61,220,132,.4)" : "rgba(240,115,74,.4)"
          }">${
            flash === "connected"
              ? "Calendar connected."
              : `Could not connect: ${esc(flash)}`
          }</div>`
        : ""
    }

    <div class="card">
      <div class="row"><h2 style="margin:0">Google Calendar</h2>
        <span class="pill ${status.connected ? "ok" : "off"}">${
          status.connected ? "connected" : status.configured ? "not connected" : "not configured"
        }</span></div>

      ${
        !status.configured
          ? `<p class="muted" style="font-size:13.5px">
               Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the
               server's environment and restart it. The README has the five-minute version of
               creating an OAuth client.
             </p>`
          : status.connected
            ? `<p class="muted" style="font-size:13.5px">
                 Connected as <b>${esc(status.email || "unknown")}</b> ·
                 ${status.eventCount} events cached ·
                 last synced ${status.lastSyncAt ? when(status.lastSyncAt) : "never"}
               </p>
               <div class="row">
                 <button class="btn" id="sync">Sync now</button>
                 <button class="btn ghost" id="disconnect">Disconnect</button>
               </div>`
            : `<p class="muted" style="font-size:13.5px">
                 Read-only access to your calendar events. ClearNote never writes to your calendar.
               </p>
               <a class="btn primary" href="/api/google/connect">Connect Google Calendar</a>`
      }
    </div>

    <div class="card" id="upcoming"></div>`;

  if (status.connected) {
    document.getElementById("sync").onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Syncing…";
      await api("/google/sync", { method: "POST" });
      route();
    };
    document.getElementById("disconnect").onclick = async () => {
      if (!confirm("Disconnect Google Calendar? Cached events and matches are removed.")) return;
      await api("/google/disconnect", { method: "POST" });
      route();
    };
  }

  const box = document.getElementById("upcoming");
  const upcoming = await api("/calendar/upcoming");
  box.innerHTML = `<h2>Upcoming</h2>${
    upcoming.length
      ? upcoming
          .map(
            (e) => `<div class="ai-item">
              <div class="body">
                <div class="txt">${esc(e.title)}</div>
                <div class="sub2">
                  <span>${when(e.start_at)}</span>
                  <span>${e.attendees.length} invited</span>
                  ${
                    e.meeting_id
                      ? `<a href="#/m/${esc(e.meeting_id)}">captured</a>`
                      : `<span class="muted">not captured</span>`
                  }
                </div>
              </div>
            </div>`,
          )
          .join("")
      : `<p class="muted" style="font-size:13.5px">Nothing synced yet.</p>`
  }`;
}

// ------------------------------------------------------------- action items

async function renderActions() {
  view.innerHTML = `<div class="loading">Loading action items…</div>`;
  const items = await api("/action-items");
  if (!items.length) {
    view.innerHTML = `<h1>Action items</h1>
      <div class="empty"><b>Nothing open.</b><br/>Action items extracted from your meetings show up here.</div>`;
    return;
  }
  view.innerHTML = `<h1>Action items</h1>
    <p class="sub">${items.length} open across all meetings</p>
    <div class="card" id="actions">
      ${items
        .map(
          (a) => `<div class="ai-item" data-id="${a.id}">
            <input type="checkbox" />
            <div class="body">
              <div class="txt">${esc(a.text)}</div>
              <div class="sub2">
                ${a.priority ? `<span class="prio ${esc(a.priority)}">${esc(a.priority)}</span>` : ""}
                ${a.owner ? `<span>${esc(a.owner)}</span>` : `<span class="muted">unassigned</span>`}
                ${a.due ? `<span>due ${esc(a.due)}</span>` : ""}
                <a href="#/m/${esc(a.meeting_id)}">${esc(a.title || "meeting")}</a>
                <span>${when(a.started_at)}</span>
              </div>
            </div>
          </div>`,
        )
        .join("")}
    </div>`;

  document.getElementById("actions").addEventListener("change", async (e) => {
    const row = e.target.closest(".ai-item");
    row.classList.add("done");
    await api(`/action-items/${row.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: true }),
    });
  });
}

// ------------------------------------------------------------------- router

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [part, arg] = [hash.split("/")[0], hash.split("/").slice(1).join("/")];

  const section = ["actions", "settings"].includes(part) ? part : "meetings";
  for (const a of document.querySelectorAll("[data-nav]")) {
    a.classList.toggle("on", a.dataset.nav === section);
  }

  const show = (p) => p.catch((err) => (view.innerHTML = `<p class="err">${esc(err.message)}</p>`));

  if (part === "m" && arg) return show(renderMeeting(arg));
  if (part === "actions") return show(renderActions());
  if (part === "settings") return show(renderSettings());
  if (part === "tag" && arg) return show(renderList({ tag: decodeURIComponent(arg) }));
  if (part === "search" && arg) {
    qInput.value = decodeURIComponent(arg);
    return show(renderList({ q: decodeURIComponent(arg) }));
  }
  return show(renderList());
}

let searchTimer;
qInput.oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = qInput.value.trim();
    location.hash = q ? `#/search/${encodeURIComponent(q)}` : "#/";
  }, 280);
};

window.addEventListener("hashchange", route);

api("/health")
  .then((h) => {
    const pill = document.getElementById("ai-state");
    pill.textContent = h.ai ? "AI on" : "AI off — set ANTHROPIC_API_KEY";
    pill.className = `pill ${h.ai ? "ok" : "off"}`;
  })
  .catch(() => {});

route();
