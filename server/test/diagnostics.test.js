// Debug mode: the redaction rules that decide what leaves your machine, and
// the verdict that tells you which selector to fix. The DOM-level parts
// (recording, redacting real HTML, replaying it) are covered by
// tools/caption-replay.html, which runs them in a browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.join(here, "..", "..", "extension");

function loadLib() {
  // URL, DOMParser and friends exist in a browser; the sandbox needs URL for redactUrl.
  const sandbox = { window: {}, URL, crypto: { randomUUID: () => Math.random().toString(36) } };
  sandbox.window.window = sandbox.window;
  sandbox.setInterval = () => 0;
  sandbox.clearInterval = () => {};
  sandbox.console = console;
  vm.createContext(sandbox);
  for (const f of ["lib/util.js", "lib/segmenter.js", "lib/diagnostics.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ext, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox.window.ClearNote;
}

const CN = loadLib();
const { looksLikeName, maskWords, redactUrl, verdict, probeList } = CN._diagInternals;

// ----------------------------------------------------------------- redaction

test("masking keeps word shape but removes the words", () => {
  const masked = maskWords("Ship the pricing page on Thursday");
  assert.equal(masked, "Xxxx xxx xxxxxxx xxxx xx Xxxxxxxx");
  assert.equal(
    masked.split(/\s+/).length,
    "Ship the pricing page on Thursday".split(/\s+/).length,
    "word count survives, so replay produces the same segment shape",
  );
  assert.ok(!/ship|pricing|Thursday/i.test(masked));
});

test("masking leaves punctuation and digits recognisable but not readable", () => {
  assert.equal(maskWords("Q4 revenue: $1,250,000 — up 12%"), "X0 xxxxxxx: $0,000,000 — xx 00%");
});

test("a speaker name is recognised so it can be pseudonymised", () => {
  for (const name of ["Ada Lovelace", "Grace Hopper", "Marcus", "Jean-Luc Picard", "Ada O'Neill"]) {
    assert.ok(looksLikeName(name), `${name} should read as a name`);
  }
});

test("a spoken sentence is not mistaken for a speaker name", () => {
  for (const line of [
    "Ship it Thursday.",
    "we should ship the pricing page",
    "Yes, agreed",
    "I think we need to talk about the annual tier before we commit",
  ]) {
    assert.ok(!looksLikeName(line), `"${line}" should not read as a name`);
  }
});

test("the meeting URL is reduced to its origin", () => {
  // Meeting codes are effectively credentials — anyone with one can join.
  assert.equal(redactUrl("https://meet.google.com/abc-defg-hij"), "https://meet.google.com/(redacted)");
  assert.equal(redactUrl("https://zoom.us/wc/9876543210/join?pwd=secret"), "https://zoom.us/(redacted)");
  assert.equal(redactUrl("not a url"), "(redacted)");
});

// ------------------------------------------------------------------- probing

test("probing reports which selectors match and how many nodes", () => {
  const root = {
    querySelectorAll: (sel) => ({ length: sel === "div.nMcdL" ? 3 : 0 }),
  };
  const report = probeList(["div.nMcdL", "div.gone"], root);
  // Field-by-field: the objects come from the sandbox realm, so a structural
  // comparison would be comparing prototypes rather than values.
  assert.equal(report.length, 2);
  assert.equal(report[0].selector, "div.nMcdL");
  assert.equal(report[0].count, 3);
  assert.equal(report[0].error, null);
  assert.equal(report[1].selector, "div.gone");
  assert.equal(report[1].count, 0);
});

test("an invalid selector is reported, not thrown", () => {
  const root = {
    querySelectorAll: () => {
      throw new Error("not a valid selector");
    },
  };
  const [row] = probeList(["::::"], root);
  assert.equal(row.count, 0);
  assert.match(row.error, /not a valid selector/);
});

// ------------------------------------------------------------------ verdicts

test("the verdict names the thing to fix", () => {
  assert.match(verdict({ joined: true, captionRootFound: false, rows: [] }), /captions are off|captionRoot/i);
  assert.match(verdict({ joined: false, captionRootFound: false, rows: [] }), /not in a call/i);
  assert.match(
    verdict({ joined: true, captionRootFound: true, rows: [] }),
    /row selectors/i,
    "a found region with no rows points at the row selectors",
  );
  assert.match(
    verdict({ joined: true, captionRootFound: true, rows: [{ speaker: "Ada" }], usingFallback: true }),
    /fallback/i,
  );
  assert.match(
    verdict({
      joined: true,
      captionRootFound: true,
      rows: [{ speaker: "Unknown speaker" }, { speaker: "Unknown speaker" }],
    }),
    /speaker selectors/i,
    "captions without names point at the speaker selectors",
  );
  assert.match(
    verdict({ joined: true, captionRootFound: true, rows: [{ speaker: "Ada" }] }),
    /healthy/i,
  );
});

// --------------------------------------------------- priming and ordering

test("priming records what a node already said without transcribing it", () => {
  // Joining a call in progress: captions on screen are context, not new speech.
  const out = [];
  const seg = new CN.Segmenter({ startedAt: 0, onSegment: (s) => out.push(s) });
  seg.prime("row-1", "this was said before we joined");
  seg.observe("row-1", "Ada", "this was said before we joined");
  seg.flushAll();
  assert.equal(out.length, 0, "nothing already on screen becomes a transcript line");
});

test("after priming, only newly spoken words are transcribed", () => {
  const out = [];
  const seg = new CN.Segmenter({ startedAt: 0, onSegment: (s) => out.push(s) });
  seg.prime("row-1", "this was said before we joined");
  seg.observe("row-1", "Ada", "this was said before we joined and this came after");
  seg.flushAll();
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "and this came after");
});

test("simultaneous speakers come out in the order they started", () => {
  // Two caption rows close in the same pass; the transcript must read
  // chronologically rather than in whatever order the map holds.
  const out = [];
  let clock = 0;
  const seg = new CN.Segmenter({
    startedAt: 0,
    silenceMs: 100,
    now: () => clock,
    autoFlush: false,
    onSegment: (s) => out.push(s),
  });

  clock = 5000;
  seg.observe("late", "Grace", "I started second");
  clock = 1000; // the other row began earlier in the meeting
  seg.observe("early", "Ada", "I started first");

  clock = 20000;
  seg.flushIdle();

  assert.deepEqual(
    out.map((s) => s.text),
    ["I started first", "I started second"],
  );
  assert.deepEqual(
    out.map((s) => s.seq),
    [0, 1],
  );
});

test("the injectable clock makes replay deterministic", () => {
  const run = () => {
    const out = [];
    let clock = 0;
    const seg = new CN.Segmenter({
      startedAt: 0,
      silenceMs: 1000,
      now: () => clock,
      autoFlush: false,
      onSegment: (s) => out.push(s),
    });
    clock = 500;
    seg.observe("a", "Ada", "first thing");
    clock = 2000;
    seg.flushIdle();
    seg.observe("a", "Ada", "second thing entirely");
    clock = 4000;
    seg.flushAll();
    return out.map((s) => [s.startMs, s.endMs, s.text]);
  };
  assert.deepEqual(run(), run(), "same input, same timings, same output");
});
