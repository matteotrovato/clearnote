// The AI layer: one structured pass over a finished transcript that produces
// the summary, action items, insights and tags, plus a chat endpoint for
// questions about a meeting.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const MODEL = process.env.CLEARNOTE_MODEL || "claude-opus-5-5";

// Lazily constructed so the server starts and captures transcripts even with
// no API key configured.
let _client = null;
function client() {
  if (!_client) _client = new Anthropic();
  return _client;
}

export function aiConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// Every field is required and nullable: strict JSON schemas do not take
// optional keys, and a null reads more clearly than an invented value.
const Analysis = z.object({
  summary: z.object({
    headline: z.string().describe("One sentence a reader can scan in the meeting list"),
    tldr: z.string().describe("Two to four sentences on what happened and what it means"),
    key_points: z.array(z.string()).describe("The substantive points, in the order discussed"),
    decisions: z.array(z.string()).describe("Decisions actually made. Empty if none were."),
    open_questions: z.array(z.string()).describe("Questions raised and left unresolved"),
    next_meeting: z.string().nullable().describe("Agreed follow-up or next session, else null"),
  }),
  action_items: z.array(
    z.object({
      text: z.string().describe("The task, phrased as an instruction"),
      owner: z.string().nullable().describe("Speaker name who owns it, else null"),
      due: z.string().nullable().describe("Due date as stated, ISO where possible, else null"),
      priority: z.enum(["high", "medium", "low"]),
      quote: z.string().nullable().describe("The short line in the transcript it came from"),
    }),
  ),
  insights: z.array(
    z.object({
      kind: z
        .enum([
          "objection",
          "buying_signal",
          "risk",
          "competitor",
          "pricing",
          "next_step",
          "commitment",
          "question",
          "sentiment",
        ])
        .describe("What kind of moment this was"),
      speaker: z.string().nullable(),
      quote: z.string().nullable().describe("Verbatim line from the transcript"),
      note: z.string().describe("Why it matters, in one sentence"),
    }),
  ),
  tags: z.array(z.string()).describe("Three to six lowercase topic tags, e.g. pricing, hiring, q4-roadmap"),
});

const SYSTEM = `You write meeting notes from live-caption transcripts.

The transcript comes from a meeting platform's automatic captions, so expect
misheard words, missing punctuation, and names attached to the wrong line when
people talk over each other. Read through the noise: infer what was meant, and
never quote a garbled line as if it were exact.

Rules:
- Only report what the transcript supports. No invented owners, dates or decisions.
- An action item needs a real commitment, not a passing idea. If nobody committed
  to anything, return an empty list.
- Attribute by the speaker names in the transcript. Where a name is "Unknown
  speaker", leave the owner null rather than guessing.
- When an invitee list is given, prefer those spellings for owners, and treat
  anyone on it as a plausible owner even if the captions garbled their name.
  Never invent an owner who is neither a speaker nor an invitee.
- Write plainly, in the participants' own vocabulary. No corporate filler.
- Insights are notable moments, not a second summary. Return none rather than padding.`;

/** `[12:05] Ada: text` — timestamps let the dashboard jump into the transcript. */
export function renderTranscript(segments) {
  const clock = (ms) => {
    const t = Math.max(0, Math.round(ms / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
  };
  return segments.map((s) => `[${clock(s.start_ms)}] ${s.speaker}: ${s.text}`).join("\n");
}

function header(meeting, segments, context = {}) {
  const mins = meeting.ended_at
    ? Math.round((meeting.ended_at - meeting.started_at) / 60000)
    : null;
  const { event, attendees = [] } = context;

  // Calendar context is worth a lot here: it gives the model the real agenda
  // and real names, so owners stop being guessed from a caption spelling.
  const invited = attendees.length
    ? `Invited: ${attendees
        .map((a) => `${a.name || a.email}${a.organizer ? " (organizer)" : ""}`)
        .join(", ")}`
    : null;

  return [
    `Title: ${meeting.title || "Untitled meeting"}`,
    `Platform: ${meeting.platform_label || meeting.platform}`,
    `Date: ${new Date(meeting.started_at).toISOString()}`,
    mins !== null ? `Duration: ${mins} minutes` : null,
    event?.description ? `Calendar description: ${event.description.slice(0, 1500)}` : null,
    invited,
    `Transcript lines: ${segments.length}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {object} meeting row from the meetings table
 * @param {object[]} segments rows from the segments table
 * @param {string=} template extra instructions for the summary shape
 */
export async function analyzeMeeting(meeting, segments, template, context = {}) {
  if (!segments.length) throw new Error("nothing to analyze: the transcript is empty");

  const system = template
    ? `${SYSTEM}\n\nThe reader asked for this summary shape — follow it:\n${template}`
    : SYSTEM;

  const response = await client().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(Analysis) },
    messages: [
      {
        role: "user",
        content: `${header(meeting, segments, context)}\n\n--- transcript ---\n${renderTranscript(segments)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `the model declined to summarize this meeting (${response.stop_details?.category ?? "unknown"})`,
    );
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("the model returned a summary that did not match the schema");

  return {
    summary: parsed.summary,
    actionItems: parsed.action_items,
    insights: parsed.insights,
    tags: parsed.tags.map((t) => t.toLowerCase().trim()).filter(Boolean),
    usage: response.usage,
  };
}

/**
 * Question answering over one meeting. The transcript sits behind a cache
 * breakpoint so a back-and-forth about the same meeting only pays for it once.
 */
export async function askMeeting(meeting, segments, question, history = [], context = {}) {
  const transcript = `${header(meeting, segments, context)}\n\n--- transcript ---\n${renderTranscript(segments)}`;

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [
      {
        type: "text",
        text: `You answer questions about one meeting, using only its transcript.

The transcript is from automatic captions, so it contains mishearings. Answer
what the transcript supports and say plainly when it does not settle the
question. Cite the timestamp in brackets when you refer to a specific moment.
Be brief — a couple of sentences unless more is genuinely needed.`,
      },
      { type: "text", text: transcript, cache_control: { type: "ephemeral" } },
    ],
    messages: [...history, { role: "user", content: question }],
  });

  if (response.stop_reason === "refusal") {
    return { text: "I can't answer that one.", usage: response.usage };
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { text, usage: response.usage };
}
