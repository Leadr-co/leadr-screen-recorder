import type { VideoBugReport } from "@cap/database/types";
import { z } from "zod";

// Groq's free tier allows 8,000 tokens a minute; ~16k characters of transcript
// (~4k tokens) leaves room for the instructions and the reply.
export const MAX_BUG_REPORT_TRANSCRIPT_CHARS = 16_000;

const MAX_TEXT = 2_000;
const MAX_ITEMS = 25;
const NOT_STATED = "Not stated in the recording.";

export type TranscriptCue = { startMs: number; text: string };

const formatTimestamp = (totalSeconds: number) => {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = String(seconds % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
		: `${minutes}:${rest}`;
};

export const parseTimestamp = (value: string | null | undefined) => {
	const match = value?.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
	if (!match) return null;
	const [, hours, minutes, seconds] = match;
	return (
		Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds ?? 0)
	);
};

export const formatTranscriptForBugReport = (cues: TranscriptCue[]) => {
	const lines = cues.map(
		(cue) => `[${formatTimestamp(cue.startMs / 1000)}] ${cue.text}`,
	);
	let text = "";
	for (const line of lines) {
		if (text.length + line.length + 1 > MAX_BUG_REPORT_TRANSCRIPT_CHARS) {
			return { text, truncated: true };
		}
		text += text ? `\n${line}` : line;
	}
	return { text, truncated: false };
};

export const buildBugReportPrompt = (transcript: {
	text: string;
	truncated: boolean;
}) => `You turn a screen recording into a bug report for an internal support team. The speaker is a sales rep showing a problem with a tool, or asking how to do something.

Rules:
- Use only what the transcript says. Never invent steps, error messages, record IDs, URLs, names or causes.
- When something is not stated, write exactly "${NOT_STATED}"
- Steps to reproduce are the actions the speaker describes, in order. Give each the [m:ss] timestamp from the transcript where it happens.
- If the recording is a question rather than a problem, make the title the question and use the steps for what the speaker showed.
- "details" lists pages, buttons, fields, error messages, record IDs or names the speaker mentions, quoted as said.
- "openQuestions" lists what support would still need to ask to act on this.
- Write in the same language as the transcript.${
	transcript.truncated
		? "\n- The transcript below is only the start of a longer recording; say so in the summary."
		: ""
}

Reply with only this JSON object:
{"title": "under 80 characters", "summary": "one to three sentences", "steps": [{"timestamp": "m:ss", "step": "what the speaker did"}], "expected": "what should happen", "actual": "what happens instead", "details": ["..."], "openQuestions": ["..."]}

Transcript:
${transcript.text}`;

const aiBugReportSchema = z.object({
	title: z.string(),
	summary: z.string(),
	steps: z
		.array(
			z.object({
				timestamp: z.string().nullish(),
				step: z.string(),
			}),
		)
		.default([]),
	expected: z.string().default(NOT_STATED),
	actual: z.string().default(NOT_STATED),
	details: z.array(z.string()).default([]),
	openQuestions: z.array(z.string()).default([]),
});

const extractJsonObject = (content: string) => {
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start < 0 || end <= start) {
		throw new Error("The AI reply did not contain a bug report");
	}
	return content.slice(start, end + 1);
};

const clean = (value: string, fallback = NOT_STATED) =>
	value.trim().slice(0, MAX_TEXT) || fallback;

const cleanList = (values: string[]) =>
	values
		.map((value) => value.trim().slice(0, MAX_TEXT))
		.filter(Boolean)
		.slice(0, MAX_ITEMS);

export const parseBugReport = (
	content: string,
	options: { durationSeconds?: number | null; now?: Date } = {},
): VideoBugReport => {
	const parsed = aiBugReportSchema.parse(
		JSON.parse(extractJsonObject(content)),
	);
	const duration = options.durationSeconds ?? null;

	return {
		title: clean(parsed.title, "Recording issue").slice(0, 120),
		summary: clean(parsed.summary),
		steps: parsed.steps
			.map((step) => {
				const atSeconds = parseTimestamp(step.timestamp);
				return {
					atSeconds:
						atSeconds !== null && (duration === null || atSeconds <= duration)
							? atSeconds
							: null,
					text: step.step.trim().slice(0, MAX_TEXT),
				};
			})
			.filter((step) => step.text)
			.slice(0, MAX_ITEMS),
		expected: clean(parsed.expected),
		actual: clean(parsed.actual),
		details: cleanList(parsed.details),
		openQuestions: cleanList(parsed.openQuestions),
		generatedAt: (options.now ?? new Date()).toISOString(),
	};
};

export const formatBugReportMarkdown = (
	report: VideoBugReport,
	recordingUrl: string,
) => {
	const link = (seconds: number) =>
		`[${formatTimestamp(seconds)}](${recordingUrl}?t=${seconds})`;
	const list = (items: string[]) =>
		items.length ? items.map((item) => `- ${item}`).join("\n") : NOT_STATED;

	return [
		`## ${report.title}`,
		report.summary,
		`**Recording:** ${recordingUrl}`,
		"### Steps to reproduce",
		report.steps.length
			? report.steps
					.map(
						(step, index) =>
							`${index + 1}. ${step.atSeconds !== null ? `${link(step.atSeconds)} ` : ""}${step.text}`,
					)
					.join("\n")
			: NOT_STATED,
		"### Expected",
		report.expected,
		"### Actual",
		report.actual,
		"### Details",
		list(report.details),
		"### Open questions",
		list(report.openQuestions),
	].join("\n\n");
};

export { formatTimestamp as formatBugReportTimestamp };
