// Zoom web client adapter (zoom.us/wc/... — the in-browser client only; the
// native desktop app renders nothing a content script can read).
//
// Zoom has two caption surfaces: the one-or-two-line subtitle bar over the
// video, and the full "Transcript" side panel. The panel carries speaker names
// and is append-only, so prefer it; the subtitle bar is the fallback.
(function () {
  const CN = (window.ClearNote = window.ClearNote || {});

  const PANEL_ITEMS = [
    ".live-transcription-panel__item",
    "[class*='transcript-list-item']",
    ".live-transcription-subtitle__item",
  ];
  const PANEL_ROOT = [
    ".live-transcription-panel",
    "[class*='transcript-panel']",
    "#live-transcription-subtitle",
    ".live-transcription-subtitle",
  ];
  const SUBTITLE_ROOT = [
    "#live-transcription-subtitle",
    ".live-transcription-subtitle__content",
    "[class*='closed-caption-wrapper']",
  ];

  const NAME = [
    ".live-transcription-panel__item-name",
    "[class*='item-name']",
    "[class*='__name']",
    "[class*='speaker']",
  ];
  const BODY = [
    ".live-transcription-panel__item-text",
    "[class*='item-text']",
    "[class*='__text']",
    "[class*='content']",
  ];

  const LEAVE = [
    "button.footer__leave-btn",
    "[class*='footer__leave']",
    'button[aria-label*="Leave" i]',
  ];

  const adapter = {
    id: "zoom",
    label: "Zoom",

    selectors: {
      captionRoot: [...PANEL_ROOT, ...SUBTITLE_ROOT],
      rows: PANEL_ITEMS,
      speaker: NAME,
      text: BODY,
      leave: LEAVE,
    },

    matches() {
      return /(^|\.)zoom\.us$/.test(location.hostname) && /\/(wc|j)\//.test(location.pathname);
    },

    async waitForJoin() {
      return CN.waitFor(
        () => CN.pick(LEAVE) || CN.pick(["#wc-container-right", "[class*='meeting-client']"]),
        { timeout: 0x7fffffff, interval: 1000 },
      );
    },

    hasLeft() {
      return !CN.pick(LEAVE) && !document.querySelector("[class*='meeting-client']");
    },

    async enableCaptions() {
      if (CN.pick(PANEL_ROOT) || CN.pick(SUBTITLE_ROOT)) return true;

      // "More" overflow -> Captions -> Show Captions. Zoom moves this around,
      // so try the direct controls first.
      const direct =
        CN.buttonByLabel(/show captions|closed caption|^captions|live transcript/i) ||
        CN.pick(['button[aria-label*="aption" i]', 'button[aria-label*="ranscript" i]']);
      if (direct) {
        direct.click();
        CN.log("clicked the Zoom captions control");
      } else {
        const more = CN.buttonByLabel(/^more$|more meeting controls/i);
        if (more) {
          more.click();
          await CN.sleep(500);
          const item = CN.buttonByLabel(/caption|transcript/i);
          if (item) item.click();
        }
      }
      return !!(await CN.waitFor(() => CN.pick(PANEL_ROOT) || CN.pick(SUBTITLE_ROOT), {
        timeout: 8000,
      }));
    },

    captionRoot() {
      return CN.pick(PANEL_ROOT) || CN.pick(SUBTITLE_ROOT);
    },

    readCaptions(root) {
      if (!root) return [];
      const items = CN.pickAll(PANEL_ITEMS, root);

      if (items.length) {
        const out = [];
        for (const item of items) {
          if (!item.dataset.cnKey) item.dataset.cnKey = CN.uuid();
          const speaker = CN.normalize(CN.pick(NAME, item)?.textContent) || "Unknown speaker";
          let via = "selector";
          let text = CN.normalize(CN.pick(BODY, item)?.textContent);
          if (!text) {
            via = "fallback";
            text = CN.normalize(item.textContent);
            if (speaker !== "Unknown speaker" && text.startsWith(speaker)) {
              text = CN.normalize(text.slice(speaker.length).replace(/^[:\-–]\s*/, ""));
            }
          }
          if (text) out.push({ key: item.dataset.cnKey, speaker, text, via });
        }
        return out;
      }

      // Subtitle bar: a single recycled node, usually "Name: text".
      const raw = CN.normalize(root.textContent);
      if (!raw) return [];
      const m = raw.match(/^([^:]{2,40}):\s*(.+)$/);
      return [
        {
          key: "zoom-subtitle",
          speaker: m ? CN.normalize(m[1]) : "Unknown speaker",
          text: m ? CN.normalize(m[2]) : raw,
          via: "subtitle-bar",
        },
      ];
    },

    meetingTitle() {
      const el = CN.pick([
        ".meeting-info-container__meeting-topic",
        "[class*='meeting-topic']",
        "[class*='meeting-title']",
      ]);
      const t = CN.normalize(el?.textContent) || CN.normalize(document.title);
      return t && !/^zoom/i.test(t) ? t : "Zoom meeting";
    },

    meetingKey() {
      const id = location.pathname.match(/\/(?:wc|j)\/(\d+)/)?.[1] || location.pathname;
      return `zoom:${id}`;
    },
  };

  (CN.adapters = CN.adapters || []).push(adapter);
})();
