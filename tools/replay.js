// Drives the Google Meet adapter against a DOM built to match Meet's caption
// region, including the parts that trip up naive scrapers: a caption rewritten
// in place as someone keeps talking, two people captioned at once, and a row
// recycled for the next utterance.
//
// Also replays the same conversation against a DOM whose class names have all
// been changed, to prove the structural fallback holds when Meet reshuffles its
// obfuscated selectors.

const adapter = window.ClearNote.adapters.find((a) => a.id === "google_meet");
const CN = window.ClearNote;

const stage = document.getElementById("stage");

/** Builds a caption row. `obfuscated` mimics Meet having rotated its classes. */
function makeRow(container, speaker, obfuscated) {
  const row = document.createElement("div");
  row.className = obfuscated ? "xK7bQ2" : "nMcdL";

  const left = document.createElement("div");
  const img = document.createElement("img");
  img.width = 0;
  img.height = 0;
  left.append(img);
  const name = document.createElement("div");
  name.className = obfuscated ? "pR3vL9" : "zs7s8d";
  name.textContent = speaker;
  left.append(name);

  const text = document.createElement("div");
  if (obfuscated) text.className = "wQ8mN4";
  else text.setAttribute("jsname", "tgaKEf");

  row.append(left, text);
  container.append(row);
  return { row, text };
}

/**
 * A scripted conversation. Each step is a frame of the caption region:
 *   {speaker, text}  -> that speaker's row now reads `text`
 *   {recycle: true}  -> Meet reused the row for a different utterance
 *   {wait: ms}       -> silence, which closes an utterance
 */
const SCRIPT = [
  { speaker: "Ada Lovelace", text: "so" },
  { speaker: "Ada Lovelace", text: "so about the pricing" },
  { speaker: "Ada Lovelace", text: "so about the pricing page" },
  { speaker: "Ada Lovelace", text: "so about the pricing page we agreed" },
  { speaker: "Ada Lovelace", text: "so about the pricing page we agreed to ship Thursday" },
  { wait: 1 },

  // Two people captioned at the same time, in separate rows.
  { speaker: "Grace Hopper", text: "wait" },
  { speaker: "Ada Lovelace", text: "does that still work" },
  { speaker: "Grace Hopper", text: "wait I need the annual" },
  { speaker: "Ada Lovelace", text: "does that still work for support" },
  { speaker: "Grace Hopper", text: "wait I need the annual tier in first" },
  { wait: 1 },

  // Meet trims the front of a long caption; the adapter must rejoin at the seam.
  { speaker: "Ada Lovelace", text: "I can take the annual tier if you write the release note" },
  {
    speaker: "Ada Lovelace",
    text: "the annual tier if you write the release note and tell the support team",
  },
  { wait: 1 },

  // The row is recycled for a brand-new utterance from the same speaker.
  { speaker: "Grace Hopper", recycle: true, text: "deal" },
  { speaker: "Grace Hopper", text: "deal, I'll have it by Wednesday" },
  { wait: 1 },
];

/** What a human reading that call would write down. */
const EXPECTED = [
  ["Ada Lovelace", "so about the pricing page we agreed to ship Thursday"],
  ["Grace Hopper", "wait I need the annual tier in first"],
  ["Ada Lovelace", "does that still work for support"],
  [
    "Ada Lovelace",
    "I can take the annual tier if you write the release note and tell the support team",
  ],
  ["Grace Hopper", "deal, I'll have it by Wednesday"],
];

async function replay({ obfuscated, visible, onSegmenter }) {
  const container = visible
    ? stage.querySelector('[jsname="dsyhDe"]')
    : document.createElement("div");
  container.innerHTML = "";
  if (!visible) stage.append(container);

  const rows = new Map(); // speaker -> {row, text}
  const segments = [];
  const seg = new CN.Segmenter({
    startedAt: Date.now(),
    // Real calls run 2500ms of silence against caption updates every few
    // hundred ms — roughly an 8x margin. The harness keeps that ratio rather
    // than shrinking it, or interleaved speakers sit right on the threshold
    // and the run turns timing-dependent.
    silenceMs: 400,
    onSegment: (s) => segments.push(s),
  });
  // Lets the recorder know which segmenter is running, so the recording carries
  // the silence threshold replay must reproduce.
  onSegmenter?.(seg);

  const pump = () => {
    for (const { key, speaker, text } of adapter.readCaptions(container)) {
      seg.observe(key, speaker, text);
    }
  };

  for (const step of SCRIPT) {
    if (step.wait) {
      // Longer than silenceMs, so a scripted pause always closes the line.
      await new Promise((r) => setTimeout(r, 600));
      seg.flushIdle();
      continue;
    }
    if (step.recycle) rows.delete(step.speaker);
    let row = rows.get(step.speaker);
    if (!row) {
      row = makeRow(container, step.speaker, obfuscated);
      rows.set(step.speaker, row);
    }
    row.text.textContent = step.text;
    pump();
    if (visible) await new Promise((r) => setTimeout(r, 55));
  }

  await new Promise((r) => setTimeout(r, 600));
  seg.destroy();
  if (!visible) container.remove();
  return { segments, speakers: Array.from(seg.speakers) };
}

function compare(got) {
  const actual = got.segments.map((s) => [s.speaker, s.text]);
  const fails = [];
  const n = Math.max(actual.length, EXPECTED.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const e = EXPECTED[i];
    if (!a) fails.push(`line ${i + 1} missing: expected ${JSON.stringify(e)}`);
    else if (!e) fails.push(`line ${i + 1} unexpected: ${JSON.stringify(a)}`);
    else if (a[0] !== e[0] || a[1] !== e[1])
      fails.push(`line ${i + 1}\n  expected ${JSON.stringify(e)}\n  got      ${JSON.stringify(a)}`);
  }
  return fails;
}

const caseEl = document.getElementById("cases");
function report(name, fails, extra = "") {
  const el = document.createElement("div");
  el.className = "case";
  el.innerHTML = `<b class="${fails.length ? "bad" : "ok"}">${fails.length ? "FAIL" : "PASS"}</b> ${name}${
    extra ? ` <span style="color:#7a8492">— ${extra}</span>` : ""
  }${fails.length ? `<div class="diff">${fails.join("<br/>")}</div>` : ""}`;
  caseEl.append(el);
  return fails.length === 0;
}

(async () => {
  let allPass = true;

  // 1. Meet's current selectors, replayed visibly so the run can be watched.
  const live = await replay({ obfuscated: false, visible: true });
  document.getElementById("out").textContent = live.segments
    .map((s) => `[${CN.fmtClock(s.startMs)}] ${s.speaker}: ${s.text}`)
    .join("\n");
  allPass &= report(
    "Meet's known selectors produce the expected transcript",
    compare(live),
    `${live.segments.length} lines from ${SCRIPT.filter((s) => !s.wait).length} caption frames`,
  );

  // 2. Every class name changed: the structural fallback has to carry it.
  const rotated = await replay({ obfuscated: true, visible: false });
  allPass &= report(
    "obfuscated class names still produce the expected transcript",
    compare(rotated),
    "structural fallback",
  );

  // 3. Participants come from the speakers seen, per the product's own spec.
  allPass &= report(
    "participants are derived from detected speakers",
    live.speakers.sort().join(",") === "Ada Lovelace,Grace Hopper"
      ? []
      : [`got ${JSON.stringify(live.speakers)}`],
  );

  // 4. The 16 caption frames must not become 16 transcript lines.
  const frames = SCRIPT.filter((s) => !s.wait).length;
  allPass &= report(
    "rolling captions are collapsed, not duplicated",
    live.segments.length < frames / 2 ? [] : [`${live.segments.length} lines from ${frames} frames`],
  );

  // 5-7. The debug pipeline itself: record the caption region while a call is
  // replaying, redact it, and replay the recording back. If this round trip
  // holds, a recording from a real call is a usable fixture.
  const diag = new CN.Diagnostics(adapter, null);
  const recorded = await replay({
    obfuscated: false,
    visible: true,
    onSegmenter: (seg) => {
      diag.segmenter = seg;
      diag.record();
    },
  });
  await new Promise((r) => setTimeout(r, 700)); // let the last frames land
  const recording = diag.stop();

  allPass &= report(
    "debug mode records the caption region",
    recording && recording.frames.length > 5 ? [] : [`captured ${recording?.frames.length ?? 0} frames`],
    `${recording?.frames.length ?? 0} frames`,
  );

  const redacted = CN.Diagnostics.redact(recording);
  const leaked = redacted.frames.filter((f) =>
    /pricing|Thursday|annual|release note|Lovelace|Hopper/i.test(f.html),
  );
  allPass &= report(
    "redaction removes meeting content but keeps the DOM",
    leaked.length === 0 && /class="nMcdL"/.test(redacted.frames.at(-1)?.html || "")
      ? []
      : leaked.length
        ? [`${leaked.length} frames still contain meeting words`]
        : ["class names did not survive redaction"],
    `speakers mapped to ${Object.keys(redacted.speakerMap).length} pseudonyms`,
  );

  const replayed = window.__replayFixture(redacted);
  const sameShape =
    replayed.segments.length === recorded.segments.length &&
    replayed.segments.every(
      (s, i) => s.text.split(/\s+/).length === recorded.segments[i].text.split(/\s+/).length,
    );
  allPass &= report(
    "a redacted recording replays to the same transcript shape",
    sameShape
      ? []
      : [
          `live produced ${recorded.segments.length} lines, the recording produced ${replayed.segments.length}`,
          ...replayed.segments.map(
            (s, i) => `  ${i + 1}: ${s.speaker}: ${s.text} (live: ${recorded.segments[i]?.text ?? "—"})`,
          ),
        ],
    `${replayed.segments.length} lines, via ${JSON.stringify(replayed.viaCounts)}`,
  );

  const res = document.getElementById("result");
  res.className = `res ${allPass ? "pass" : "fail"}`;
  res.textContent = allPass
    ? "All replay cases passed."
    : "Some replay cases failed — see the list.";
  window.__replayDone = { pass: !!allPass, transcript: live.segments };
})();
