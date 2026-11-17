// Replays a recording captured in a real call (debug mode → Record) through
// the real adapter and segmenter.
//
// This is what makes selector tuning possible without rejoining a meeting:
// edit a selector in extension/platforms/*.js, reload this page, drop the same
// file in again, and see whether the transcript improves.

const CNF = window.ClearNote;

const input = document.getElementById("fixture");
const out = document.getElementById("fixture-out");

const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/**
 * @param {{meta:object, frames:{t:number, html:string}[]}} fixture
 */
function replayFixture(fixture) {
  const adapter =
    CNF.adapters.find((a) => a.id === fixture.meta?.adapter) ||
    CNF.adapters.find((a) => a.id === "google_meet");

  const host = document.createElement("div");
  host.style.display = "none";
  document.body.append(host);

  const frames = fixture.frames || [];
  const segments = [];
  // Drive the segmenter off the recording's own timeline, so pauses split
  // utterances exactly where they did in the call.
  let clock = 0;
  const seg = new CNF.Segmenter({
    startedAt: 0,
    silenceMs: fixture.meta?.silenceMs ?? 2500,
    now: () => clock,
    autoFlush: false,
    onSegment: (s) => segments.push(s),
  });

  let rowsSeen = 0;
  let framesWithRows = 0;
  const viaCounts = {};

  for (const frame of frames) {
    clock = frame.t;
    seg.flushIdle(); // close anything that went quiet before this frame

    host.innerHTML = frame.html;
    const root = host.firstElementChild;
    if (!root) continue;

    const rows = adapter.readCaptions(root);
    if (rows.length) framesWithRows++;
    for (const r of rows) {
      rowsSeen++;
      viaCounts[r.via || "unknown"] = (viaCounts[r.via || "unknown"] || 0) + 1;
      // The baseline frame is what was on screen before recording started.
      if (frame.baseline) seg.prime(r.key, r.text);
      else seg.observe(r.key, r.speaker, r.text);
    }
  }

  clock += 10000; // end of meeting: close everything still open
  seg.flushIdle();
  seg.flushAll();

  // Selector health, measured against the busiest frame rather than the first,
  // which is usually an empty caption region.
  const busiest = frames.reduce((best, f) => (f.html.length > (best?.html.length || 0) ? f : best), null);
  let selectors = null;
  if (busiest) {
    host.innerHTML = busiest.html;
    const root = host.firstElementChild;
    const sel = adapter.selectors || {};
    selectors = {
      rows: CNF._diagInternals.probeList(sel.rows, root),
      speaker: CNF._diagInternals.probeList(sel.speaker, root),
      text: CNF._diagInternals.probeList(sel.text, root),
      captionRoot: CNF._diagInternals.probeList(sel.captionRoot, host),
    };
  }

  seg.destroy();
  host.remove();

  return { adapter, segments, selectors, rowsSeen, framesWithRows, viaCounts, frameCount: frames.length };
}

function verdictFor(r) {
  if (!r.frameCount) return ["bad", "The recording has no frames."];
  if (!r.rowsSeen)
    return [
      "bad",
      "No caption rows parsed from any frame. Both the named selectors and the structural fallback failed — open a frame's HTML and work out the new shape.",
    ];
  if (!r.segments.length)
    return ["bad", "Rows were parsed but produced no transcript — check the speaker and text selectors."];
  if (r.viaCounts.fallback)
    return [
      "warn",
      `Parsed, but ${r.viaCounts.fallback} of ${r.rowsSeen} rows came from the structural fallback. The named selectors have gone stale and should be updated.`,
    ];
  return ["good", `Healthy: ${r.segments.length} lines from ${r.rowsSeen} parsed rows, named selectors only.`];
}

function selectorTable(name, list) {
  if (!list?.length) return "";
  return `<h2 style="margin-top:14px">${escape(name)}</h2>
    <table><tr><th>selector</th><th>matches</th></tr>
    ${list
      .map(
        (x) =>
          `<tr><td><code>${escape(x.selector)}</code></td><td class="${x.count ? "hit" : "miss"}">${
            x.error ? `error: ${escape(x.error)}` : x.count || "—"
          }</td></tr>`,
      )
      .join("")}</table>`;
}

function render(fixture, r) {
  const [tone, text] = verdictFor(r);
  out.innerHTML = `
    <div class="verdict ${tone}">${escape(text)}</div>
    <div style="font-size:12.5px;color:#7a8492;margin-bottom:10px">
      ${escape(r.adapter.label)} · ${r.frameCount} frames (${r.framesWithRows} with captions) ·
      ${escape(fixture.meta?.redacted ? "redacted" : "NOT redacted — contains meeting content")}
      ${fixture.meta?.durationMs ? ` · ${Math.round(fixture.meta.durationMs / 1000)}s` : ""}
    </div>
    <h2>Transcript the adapter produced</h2>
    <pre>${
      r.segments.length
        ? escape(
            r.segments.map((s) => `[${CNF.fmtClock(s.startMs)}] ${s.speaker}: ${s.text}`).join("\n"),
          )
        : "(nothing)"
    }</pre>
    ${selectorTable("captionRoot selectors", r.selectors?.captionRoot)}
    ${selectorTable("row selectors", r.selectors?.rows)}
    ${selectorTable("speaker selectors", r.selectors?.speaker)}
    ${selectorTable("text selectors", r.selectors?.text)}`;
}

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  out.innerHTML = `<div class="verdict warn">Replaying…</div>`;
  try {
    const fixture = JSON.parse(await file.text());
    if (!Array.isArray(fixture.frames)) throw new Error("not a ClearNote recording: no frames array");
    const result = replayFixture(fixture);
    render(fixture, result);
    window.__fixtureResult = result;
  } catch (err) {
    out.innerHTML = `<div class="verdict bad">${escape(err.message)}</div>`;
  }
});

// Exposed so the harness can be driven from a test.
window.__replayFixture = replayFixture;
