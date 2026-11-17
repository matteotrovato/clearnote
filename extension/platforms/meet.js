// Google Meet adapter.
//
// Meet's class names are compiler-generated and rotate every few releases, so
// nothing here depends on a single selector: each lookup tries a list of known
// selectors and then falls back to the structure of a caption row (an avatar,
// a short name node, and a long text node).
(function () {
  const CN = (window.ClearNote = window.ClearNote || {});

  const CAPTION_ROOT = [
    'div[jsname="dsyhDe"]',
    "div.a4cQT",
    '[role="region"][aria-label*="aptions" i]',
    '[aria-live="polite"][class*="a4cQT"]',
  ];

  const ROWS = ["div.nMcdL", "div.iTTPOb", "div.TBMuR", "div.ygicle"];

  // Meet puts controls inside the caption region — a "Jump to bottom" button,
  // Material Icons whose text content is the ligature name ("arrow_downward").
  // Scraped blindly these become speakers and utterances, so they are excluded
  // wherever rows and leaves are collected.
  const CHROME =
    'button, [role="button"], i, [class*="material-icons"], [class*="google-symbols"], [aria-hidden="true"]';

  function isChrome(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      return el.matches(CHROME) || !!el.closest('button, [role="button"]');
    } catch {
      return false;
    }
  }

  const SPEAKER = ['[class*="zs7s8d"]', '[class*="NWpY1d"]', '[class*="KcIKyf"] [class*="jxofbc"]'];
  const TEXT = ['[jsname="tgaKEf"]', '[class*="ygicle"]', '[class*="bh44bd"]', '[class*="VbkSUe"]'];

  const LEAVE = [
    'button[aria-label*="Leave call" i]',
    'button[aria-label*="End call" i]',
    'button[jsname="CQylAd"]',
  ];

  // Meet serves calls at both /abc-defg-hij and /meet/abc-defg-hij, and has
  // moved between them, so find the code anywhere in the path rather than
  // assuming it sits at the root.
  const CODE_RE = /(?:^|\/)([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/i;
  const LOOKUP_RE = /\/lookup\/([a-z0-9_-]{6,})/i;

  function meetingCode(pathname = location.pathname) {
    const code = pathname.match(CODE_RE);
    if (code) return code[1].toLowerCase();
    // Named rooms (/lookup/team-standup) have no dashed code.
    const lookup = pathname.match(LOOKUP_RE);
    if (lookup) return `lookup-${lookup[1].toLowerCase()}`;
    return null;
  }

  const adapter = {
    id: "google_meet",
    label: "Google Meet",
    meetingCode,

    // Published so the diagnostics can report which selectors still match in a
    // real call — the first thing you need when Meet rotates its class names.
    selectors: {
      captionRoot: CAPTION_ROOT,
      rows: ROWS,
      speaker: SPEAKER,
      text: TEXT,
      leave: LEAVE,
      // The visible caption overlay, which can be hidden without stopping Meet
      // from updating it — that is what we read.
      overlay: ['[role="region"][aria-label*="aptions" i]', "div.a4cQT"],
    },

    matches() {
      // A meeting code somewhere in the path, not the landing page.
      return location.hostname === "meet.google.com" && !!meetingCode();
    },

    // Resolves once we are actually inside the call (not the green room).
    async waitForJoin() {
      return CN.waitFor(() => CN.pick(LEAVE), { timeout: 0x7fffffff, interval: 1000 });
    },

    hasLeft() {
      return !CN.pick(LEAVE);
    },

    /**
     * Are captions running? The control flips its own label, which is a far
     * better signal than aria-pressed — Meet does not set it on this button.
     */
    captionState() {
      if (CN.buttonByLabel(/turn off (captions|subtitles)/i)) return "on";
      if (CN.buttonByLabel(/turn on (captions|subtitles)/i)) return "off";
      return CN.pick(CAPTION_ROOT) ? "on" : "unknown";
    },

    /**
     * Turn captions on without the user having to. Only ever clicks a control
     * that says it turns them ON: a looser match also hits "Turn off
     * captions", which would switch off the very thing we read from.
     */
    async enableCaptions() {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (adapter.captionState() === "on") return true;

        let btn = CN.buttonByLabel(/turn on (captions|subtitles)/i);

        if (!btn) {
          // Recent layouts tuck it under "More options", and on a narrow
          // window the toolbar overflows there too.
          const more = CN.buttonByLabel(/more options|more actions/i);
          if (more) {
            more.click();
            await CN.sleep(700);
            btn = CN.buttonByLabel(/turn on (captions|subtitles)|^captions$/i);
            if (!btn) {
              // Leave the menu as we found it.
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            }
          }
        }

        if (btn) {
          btn.click();
          CN.log("turned Meet captions on");
        } else if (attempt === 0) {
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "c", code: "KeyC", bubbles: true }),
          );
          CN.log("no captions control found; sent the 'c' shortcut");
        }

        if (await CN.waitFor(() => adapter.captionState() === "on", { timeout: 4000 })) return true;
        await CN.sleep(800);
      }
      return adapter.captionState() === "on";
    },

    captionRoot() {
      return CN.pick(CAPTION_ROOT);
    },

    /** @returns {{key:string,speaker:string,text:string}[]} */
    readCaptions(root) {
      if (!root) return [];
      let rowsVia = "selector";
      let rows = CN.pickAll(ROWS, root);
      if (!rows.length) {
        rowsVia = "fallback";
        // Structural fallback: direct children that carry both a short node and
        // a long node are caption rows.
        rows = Array.from(root.children).filter((el) => el.textContent.trim().length > 1);
      }
      // Controls are not captions, whichever path found them.
      rows = rows.filter((row) => !isChrome(row));

      const out = [];
      for (const row of rows) {
        if (!row.dataset.cnKey) row.dataset.cnKey = CN.uuid();

        const textEl = CN.pick(TEXT, row);
        const speakerEl = CN.pick(SPEAKER, row);

        let speaker = CN.normalize(speakerEl?.textContent);
        let text = CN.normalize(textEl?.textContent);
        let via = textEl ? rowsVia : "fallback";

        if (!text) {
          // Structural fallback for when Meet has rotated its class names.
          // Position, not text length, tells name from utterance: a short
          // utterance ("so") would otherwise be read as the speaker's name.
          // Meet groups the avatar and the name together, so the name is the
          // leaf beside the <img>; everything outside that group is speech.
          const leaves = Array.from(row.querySelectorAll("*")).filter(
            (el) => el.children.length === 0 && CN.normalize(el.textContent) && !isChrome(el),
          );
          if (!leaves.length) continue;

          const nameScope = row.querySelector("img")?.parentElement;
          const inScope = nameScope ? leaves.filter((el) => nameScope.contains(el)) : [];
          const outScope = nameScope ? leaves.filter((el) => !nameScope.contains(el)) : leaves;

          if (inScope.length && outScope.length) {
            speaker = speaker || CN.normalize(inScope[0].textContent);
            text = outScope.map((el) => CN.normalize(el.textContent)).join(" ");
          } else {
            // No avatar to anchor on: Meet writes the name first in DOM order.
            speaker = speaker || CN.normalize(leaves[0].textContent);
            text = leaves
              .slice(1)
              .map((el) => CN.normalize(el.textContent))
              .join(" ");
          }
        }

        if (!text) continue;
        if (speaker && text.startsWith(speaker)) text = CN.normalize(text.slice(speaker.length));
        out.push({ key: row.dataset.cnKey, speaker: speaker || "Unknown speaker", text, via });
      }
      return out;
    },

    meetingTitle() {
      const attr = document
        .querySelector("[data-meeting-title]")
        ?.getAttribute("data-meeting-title");
      if (attr) return CN.normalize(attr);
      const t = CN.normalize(document.title).replace(/^Meet\s*[–-]\s*/i, "");
      // Meet's tab title is often just the room code, which is not a name.
      const named = t && !/^Google Meet$/i.test(t) && !CODE_RE.test(t);
      return named ? t : `Meet ${meetingCode() ?? "call"}`;
    },

    // The room code alone, so the same call keys the same whichever URL shape
    // Meet happens to serve it under.
    meetingKey() {
      return `meet:${meetingCode() ?? location.pathname.replace(/^\//, "")}`;
    },
  };

  (CN.adapters = CN.adapters || []).push(adapter);
})();
