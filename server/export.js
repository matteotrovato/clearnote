// Plain-text export of a meeting: something you can paste into an email, keep
// in a notes app, or hand to someone who will never run this server.
//
// Sections appear only when there is something in them, so a transcript with
// no summary does not export a page of empty headings.

const clock = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(t % 60)}` : `${pad(m)}:${pad(t % 60)}`;
};

const when = (ts) =>
  new Date(ts).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function duration(meeting) {
  if (!meeting.ended_at) return null;
  const mins = Math.round((meeting.ended_at - meeting.started_at) / 60000);
  if (mins < 1) return "under a minute";
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
}

const section = (heading, lines) =>
  lines && lines.length ? [heading.toUpperCase(), ...lines, ""] : [];

/**
 * @param {object} meeting a row from getMeeting() — segments and all
 * @returns {string} the whole meeting as plain text
 */
export function toText(meeting) {
  const s = meeting.summary || {};
  const out = [];

  out.push(meeting.title || "Untitled meeting");
  out.push(
    [meeting.platform_label || meeting.platform, when(meeting.started_at), duration(meeting)]
      .filter(Boolean)
      .join(" · "),
  );
  if (meeting.participants?.length) out.push(`Participants: ${meeting.participants.join(", ")}`);
  if (meeting.calendarEvent?.title && meeting.calendarEvent.title !== meeting.title) {
    out.push(`Calendar: ${meeting.calendarEvent.title}`);
  }
  if (meeting.silentInvitees?.length) {
    out.push(
      `Invited, never spoke: ${meeting.silentInvitees.map((p) => p.name || p.email).join(", ")}`,
    );
  }
  out.push("");

  if (s.tldr) out.push("SUMMARY", s.tldr, "");
  out.push(...section("Key points", (s.key_points || []).map((p) => `- ${p}`)));
  out.push(...section("Decisions", (s.decisions || []).map((d) => `- ${d}`)));
  out.push(
    ...section(
      "Action items",
      (meeting.actionItems || []).map((a) => {
        const bits = [a.owner, a.due && `due ${a.due}`].filter(Boolean).join(", ");
        return `- [${a.done ? "x" : " "}] ${a.text}${bits ? ` (${bits})` : ""}`;
      }),
    ),
  );
  out.push(...section("Open questions", (s.open_questions || []).map((q) => `- ${q}`)));
  out.push(
    ...section(
      "Insights",
      (meeting.insights || []).map((i) =>
        [
          `- ${i.kind.replace(/_/g, " ")}${i.speaker ? ` (${i.speaker})` : ""}: ${i.note || ""}`,
          i.quote ? `    "${i.quote}"` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      ),
    ),
  );

  if (s.notice) out.push(s.notice, "");
  else if (s.error) out.push(`Summary unavailable: ${s.error}`, "");

  out.push("TRANSCRIPT");
  if (meeting.segments?.length) {
    for (const seg of meeting.segments) {
      out.push(`[${clock(seg.start_ms)}] ${seg.speaker}: ${seg.text}`);
    }
  } else {
    out.push("(no captions were captured)");
  }

  out.push("", `Captured by ClearNote — no bot joined this call.`);
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** A filename that survives every filesystem, dated so exports sort by date. */
export function filenameFor(meeting) {
  const d = new Date(meeting.started_at);
  const date = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");

  const title = (meeting.title || "meeting")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .replace(/\s/g, "-");

  return `${date}-${title || "meeting"}.txt`;
}
