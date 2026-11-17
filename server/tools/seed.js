// Puts one finished meeting in the database so the dashboard can be looked at
// before you have captured a real call. The summary here is canned, not
// generated — it is only there to show the layout.
//
//   CLEARNOTE_DB=demo.db node tools/seed.js
import { db, openMeeting, addSegments, closeMeeting, saveAnalysis, linkMeetingToEvent } from "../db.js";

const startedAt = Date.now() - 52 * 60000;
const endedAt = startedAt + 34 * 60000;

const id = openMeeting({
  meetingKey: `meet:demo-${Date.now()}`,
  platform: "google_meet",
  platformLabel: "Google Meet",
  title: "Pricing page — go/no-go",
  url: "https://meet.google.com/abc-defg-hij",
  startedAt,
});

const lines = [
  ["Ada Lovelace", "Right, the only thing on the agenda is whether the pricing page ships Thursday."],
  ["Grace Hopper", "I'd rather it didn't until the annual tier is in. Half the traffic lands on that toggle."],
  ["Ada Lovelace", "How much work is the annual tier?"],
  ["Grace Hopper", "A day, maybe a day and a half with the proration edge cases."],
  ["Marcus Chen", "Support will get questions either way. What I need is a line I can paste."],
  ["Ada Lovelace", "Fair. So Thursday for the page, annual tier lands Wednesday, and Marcus gets a FAQ note."],
  ["Grace Hopper", "I can have the annual tier done by Wednesday morning if nobody adds scope."],
  ["Marcus Chen", "I'll write the FAQ once I can see the final copy. Thursday morning works."],
  ["Ada Lovelace", "One risk — if the proration maths is wrong we'll be refunding people by hand."],
  ["Grace Hopper", "I'll put a cap on it and alert rather than charge if the numbers disagree."],
  ["Marcus Chen", "Competitor-wise, Linear just moved their annual discount to 20%. We're at 15."],
  ["Ada Lovelace", "Noted, but that's a separate conversation. Let's not reopen pricing today."],
  ["Grace Hopper", "Agreed. Thursday it is."],
];

let t = 42000;
addSegments(
  id,
  lines.map(([speaker, text], i) => {
    const startMs = t;
    t += 7000 + text.length * 55;
    return { seq: i, speaker, text, startMs, endMs: t - 1500 };
  }),
);

closeMeeting(id, { endedAt, speakers: ["Ada Lovelace", "Grace Hopper", "Marcus Chen"] });

// A calendar event as a sync would have stored it, already matched. Priya was
// invited and never spoke, which is the thing a transcript alone cannot show.
db.prepare(
  `INSERT OR REPLACE INTO calendar_events
     (id, calendar_id, title, description, location, start_at, end_at, organizer,
      conference_codes, html_link, status, synced_at)
   VALUES ('demo-event', 'primary', 'Pricing page — go/no-go',
           'Decide whether the pricing page ships this week.', NULL, ?, ?, 'ada@example.com',
           ?, 'https://calendar.google.com/', 'confirmed', ?)`,
).run(startedAt, endedAt, JSON.stringify(["meet:abc-defg-hij"]), Date.now());

for (const [email, name, organizer] of [
  ["ada@example.com", "Ada Lovelace", 1],
  ["grace@example.com", "Grace Hopper", 0],
  ["marcus@example.com", "Marcus Chen", 0],
  ["priya@example.com", "Priya Raman", 0],
]) {
  db.prepare(
    `INSERT OR REPLACE INTO event_attendees (event_id, email, name, organizer, response)
     VALUES ('demo-event', ?, ?, ?, 'accepted')`,
  ).run(email, name, organizer);
}

linkMeetingToEvent(id, "demo-event", { confidence: "high", matchedBy: "link+time" });

saveAnalysis(id, {
  summary: {
    headline: "Pricing page ships Thursday, with the annual tier landing the day before.",
    tldr:
      "The team agreed to ship the pricing page on Thursday rather than delay it, on the condition that the annual tier is in first. Grace takes the annual tier for Wednesday morning, Marcus writes a support FAQ once the copy is final. The open risk is proration maths, which Grace will cap and alert on rather than charge incorrectly.",
    key_points: [
      "Shipping the page without the annual tier was rejected: most traffic lands on that toggle.",
      "The annual tier is roughly a day of work, longer with proration edge cases.",
      "Support needs a pasteable answer before launch, not after.",
      "A competitor moved their annual discount to 20% against our 15%, deliberately left for later.",
    ],
    decisions: [
      "Pricing page ships Thursday.",
      "The annual tier is a blocker for the page and lands Wednesday morning.",
      "Proration mismatches alert instead of charging the customer.",
    ],
    open_questions: ["Whether to match the competitor's 20% annual discount."],
    next_meeting: "Pricing revisit, deliberately not scheduled in this call",
  },
  actionItems: [
    {
      text: "Finish the annual tier, including proration edge cases",
      owner: "Grace Hopper",
      due: "Wednesday morning",
      priority: "high",
      quote: "I can have the annual tier done by Wednesday morning if nobody adds scope.",
    },
    {
      text: "Write the support FAQ note for the new pricing page",
      owner: "Marcus Chen",
      due: "Thursday morning",
      priority: "medium",
      quote: "I'll write the FAQ once I can see the final copy.",
    },
    {
      text: "Add a cap and alert on proration mismatches instead of charging",
      owner: "Grace Hopper",
      due: null,
      priority: "high",
      quote: "I'll put a cap on it and alert rather than charge if the numbers disagree.",
    },
  ],
  insights: [
    {
      kind: "risk",
      speaker: "Ada Lovelace",
      quote: "if the proration maths is wrong we'll be refunding people by hand",
      note: "Manual refunds are the failure mode if the billing maths is off at launch.",
    },
    {
      kind: "competitor",
      speaker: "Marcus Chen",
      quote: "Linear just moved their annual discount to 20%. We're at 15.",
      note: "A competitor undercut the annual discount; the team chose not to react today.",
    },
    {
      kind: "commitment",
      speaker: "Grace Hopper",
      quote: "Thursday it is.",
      note: "Explicit agreement to the ship date after initially pushing back.",
    },
  ],
  tags: ["pricing", "launch", "billing", "go-no-go"],
  usage: null,
});

console.log(`seeded demo meeting ${id}`);
