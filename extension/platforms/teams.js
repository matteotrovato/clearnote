// Microsoft Teams web client adapter.
//
// The "new Teams" (teams.live.com / teams.cloud.microsoft.com) dropped most of
// the classic data-tid attributes. This adapter tries named selectors first and
// falls back to aria-label and structural heuristics so it works across both
// the classic and new clients.
(function () {
  const CN = (window.ClearNote = window.ClearNote || {});

  // ---- caption root: the container Teams puts the live captions into ----

  const CAPTION_ROOT = [
    // Classic Teams
    '[data-tid="closed-caption-renderer-wrapper"]',
    '[data-tid="closed-caption-v2-window-wrapper"]',
    ".ts-closed-caption-renderer",
    // New Teams — aria-label on the region
    '[aria-label*="caption" i][role="region"]',
    '[aria-label*="caption" i][role="log"]',
    // Class-name fallback (both clients)
    '[class*="closedCaption"]',
    '[class*="closed-caption"]',
    '[class*="captionRegion"]',
    '[class*="captionsContainer"]',
    '[class*="caption-region"]',
  ];

  // ---- individual caption rows ----

  const ROWS = [
    // Classic
    '[data-tid="closed-caption-message-content"]',
    ".ui-chat__item",
    // New Teams
    '[class*="captionMessage"]',
    '[class*="caption-message"]',
    '[class*="captionItem"]',
    '[class*="caption-item"]',
    '[data-tid*="caption"]',
  ];

  // ---- speaker name within a row ----

  const NAME = [
    // Classic
    '[data-tid="author"]',
    ".ui-chat__message__author",
    // New Teams
    '[class*="authorName"]',
    '[class*="speakerName"]',
    '[class*="speaker-name"]',
    '[class*="captionAuthor"]',
    '[class*="caption-author"]',
    '[data-tid="caption-author"]',
  ];

  // ---- caption text within a row ----

  const BODY = [
    // Classic
    '[data-tid="closed-caption-text"]',
    // New Teams
    '[class*="captionText"]',
    '[class*="caption-text"]',
    '[class*="captionContent"]',
    '[class*="caption-content"]',
    '[data-tid="caption-text"]',
  ];

  // ---- leave / hangup button ----

  const LEAVE = [
    '[data-tid="hangup-button"]',
    '[data-tid="call-hangup"]',
    'button[aria-label*="Leave" i]',
    'button[aria-label*="Hang up" i]',
    '#hangup-button',
  ];

  // ---- enable captions controls ----

  const CAPTIONS_TOGGLE = [
    '[data-tid="toggle-captions"]',
    '[data-tid="closed-captions-button"]',
    'button[aria-label*="captions" i]',
    '#captions-button',
  ];

  const MORE_BUTTON = [
    '[data-tid="more-button"]',
    '[data-tid="callingButtons-showMoreBtn"]',
  ];

  // ---- structural fallback for finding caption rows ----

  // When none of the named selectors match, scan the caption root for a
  // repeating structure: each row is typically a <div> with two children —
  // one short (the name) and one longer (the text). This heuristic is
  // fragile but better than returning nothing.
  function structuralRows(root) {
    const children = Array.from(root.children);
    // If the root has just one child (a wrapper), look inside it
    const candidates =
      children.length === 1 && children[0].children.length > 0
        ? Array.from(children[0].children)
        : children;

    return candidates.filter((el) => {
      const text = CN.normalize(el.textContent);
      return text.length > 0 && el.children.length >= 1;
    });
  }

  // Extract speaker + text from a row using structural heuristics when
  // named selectors fail. Looks for two text nodes: a shorter one (name)
  // and a longer one (caption text).
  function structuralParse(row) {
    const spans = Array.from(row.querySelectorAll("span, p, div")).filter(
      (el) => el.children.length === 0 && CN.normalize(el.textContent),
    );

    if (spans.length >= 2) {
      // First short span is typically the name; rest is the caption
      const sorted = [...spans].sort(
        (a, b) => a.textContent.length - b.textContent.length,
      );
      const nameEl = sorted[0];
      const textEls = spans.filter((s) => s !== nameEl);
      return {
        speaker: CN.normalize(nameEl.textContent),
        text: CN.normalize(textEls.map((s) => s.textContent).join(" ")),
      };
    }

    // Single text node — no speaker info
    const text = CN.normalize(row.textContent);
    return text ? { speaker: "", text } : null;
  }

  const adapter = {
    id: "teams",
    label: "Microsoft Teams",

    selectors: {
      captionRoot: CAPTION_ROOT,
      rows: ROWS,
      speaker: NAME,
      text: BODY,
      leave: LEAVE,
      overlay: CAPTION_ROOT,
    },

    matches() {
      return /teams\.(microsoft|live|cloud\.microsoft)\.com$/.test(
        location.hostname,
      );
    },

    // Teams is a SPA — the content script loads once on the calendar/chat
    // page and stays alive when the user navigates into a call. waitForJoin
    // must detect the actual in-call state, not just the existence of a
    // button that might belong to a different view.
    async waitForJoin() {
      return CN.waitFor(
        () => {
          // The Leave button is the primary signal
          const leave = CN.pick(LEAVE);
          if (!leave) return null;
          // Double-check we're really in a call: the call toolbar or a
          // video/participant area should be present
          const inCall =
            !!document.querySelector('[data-tid*="call"]') ||
            !!document.querySelector('[class*="calling"]') ||
            !!document.querySelector('[class*="callMonitor"]') ||
            !!document.querySelector('video') ||
            !!document.querySelector('[aria-label*="meeting" i]') ||
            !!document.querySelector('[class*="meeting"]');
          return inCall ? leave : null;
        },
        { timeout: 0x7fffffff, interval: 1000 },
      );
    },

    hasLeft() {
      return !CN.pick(LEAVE);
    },

    async enableCaptions() {
      if (CN.pick(CAPTION_ROOT)) return true;

      // Try a direct captions button first
      const direct = CN.pick(CAPTIONS_TOGGLE);
      if (direct) {
        direct.click();
        CN.log("clicked the Teams captions control");
      } else {
        // Try the More menu path
        const more = CN.pick(MORE_BUTTON) || CN.buttonByLabel(/more actions|more options/i);
        if (more) {
          more.click();
          await CN.sleep(800);
          // New Teams sometimes has a "Language & speech" submenu
          const lang = CN.buttonByLabel(/language and speech|caption|live caption/i);
          if (lang) {
            lang.click();
            await CN.sleep(600);
          }
          const turnOn = CN.buttonByLabel(
            /turn on live captions|show live captions|start captions|enable captions/i,
          );
          if (turnOn) {
            turnOn.click();
          } else {
            // In new Teams, the caption toggle might be directly in the More menu
            const captionItem = CN.buttonByLabel(/caption/i);
            if (captionItem) captionItem.click();
          }
        }
      }
      return !!(await CN.waitFor(() => CN.pick(CAPTION_ROOT), { timeout: 15000 }));
    },

    captionRoot() {
      return CN.pick(CAPTION_ROOT);
    },

    readCaptions(root) {
      if (!root) return [];

      // Strategy 1: named row selectors
      let rows = CN.pickAll(ROWS, root);
      let strategy = "selector";

      // Strategy 2: body-text elements, walk up to their row container
      if (!rows.length) {
        rows = CN.pickAll(BODY, root).map((el) => el.closest("div") || el);
        strategy = "body-up";
      }

      // Strategy 3: structural heuristic
      if (!rows.length) {
        rows = structuralRows(root);
        strategy = "structural";
      }

      if (!rows.length) return [];

      const out = [];
      for (const row of rows) {
        if (!row.dataset.cnKey) row.dataset.cnKey = CN.uuid();

        let speaker, text;

        if (strategy === "structural") {
          const parsed = structuralParse(row);
          if (!parsed || !parsed.text) continue;
          speaker = parsed.speaker || "Unknown speaker";
          text = parsed.text;
        } else {
          // Try named selectors for speaker and text
          speaker =
            CN.normalize(CN.pick(NAME, row)?.textContent) || "";
          const bodyEl = CN.pick(BODY, row);
          text =
            CN.normalize(bodyEl?.textContent) ||
            CN.normalize(row.textContent)
              .replace(speaker, "")
              .trim();

          // If we still have no speaker, try structural parse on this row
          if (!speaker && text) {
            const parsed = structuralParse(row);
            if (parsed) {
              speaker = parsed.speaker || "";
              text = parsed.text || text;
            }
          }

          speaker = speaker || "Unknown speaker";
        }

        if (text) {
          out.push({ key: row.dataset.cnKey, speaker, text, via: strategy });
        }
      }
      return out;
    },

    meetingTitle() {
      // Try DOM elements first
      const el = CN.pick([
        '[data-tid="call-title"]',
        '[data-tid="meeting-title"]',
        '[class*="callTitle"]',
        '[class*="meetingTitle"]',
        '[class*="meeting-title"]',
      ]);
      if (el) {
        const t = CN.normalize(el.textContent);
        if (t && !/microsoft teams/i.test(t)) return t;
      }
      // Fall back to document title, stripping "Microsoft Teams" suffix
      const dt = CN.normalize(document.title)
        .replace(/\s*[-|]\s*microsoft teams$/i, "")
        .trim();
      return dt && !/^microsoft teams$/i.test(dt) ? dt : "Teams meeting";
    },

    meetingKey() {
      // Re-read URL at call time — Teams is a SPA, so the URL at script
      // load may be the calendar page, not the meeting.
      const url = new URL(location.href);
      const id =
        url.searchParams.get("meetingId") ||
        // Thread IDs in the path: 19:meeting_xxx@thread.v2
        url.pathname.match(/19[:%][^/]+/)?.[0] ||
        // Hash-based meeting ID (new Teams)
        url.hash.match(/meetingId=([^&]+)/)?.[1] ||
        // Context param (scheduled meeting join links)
        url.searchParams.get("ctx") ||
        // If nothing specific, use a combo of path + title for uniqueness
        `${url.pathname}:${Date.now()}`;
      return `teams:${id}`;
    },
  };

  (CN.adapters = CN.adapters || []).push(adapter);
})();
