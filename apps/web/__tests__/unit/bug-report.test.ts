import { describe, expect, it } from "vitest";
import {
	buildBugReportPrompt,
	formatBugReportMarkdown,
	formatTranscriptForBugReport,
	MAX_BUG_REPORT_TRANSCRIPT_CHARS,
	parseBugReport,
	parseTimestamp,
} from "@/lib/bug-report";

const now = new Date("2026-10-29T12:00:00.000Z");

const aiReply = (body: Record<string, unknown>) =>
	`Here is the report:\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``;

describe("bug report transcript", () => {
	it("prefixes each cue with its timestamp", () => {
		expect(
			formatTranscriptForBugReport([
				{ startMs: 4_200, text: "I open the deal" },
				{ startMs: 75_000, text: "and the button is greyed out" },
				{ startMs: 3_725_000, text: "an hour in" },
			]),
		).toEqual({
			text: "[0:04] I open the deal\n[1:15] and the button is greyed out\n[1:02:05] an hour in",
			truncated: false,
		});
	});

	it("stops at whole lines once the transcript is too long for the model", () => {
		const cue = { startMs: 0, text: "x".repeat(1_000) };
		const result = formatTranscriptForBugReport(Array(40).fill(cue));

		expect(result.truncated).toBe(true);
		expect(result.text.length).toBeLessThanOrEqual(
			MAX_BUG_REPORT_TRANSCRIPT_CHARS,
		);
		expect(result.text.split("\n").every((line) => line.endsWith("x"))).toBe(
			true,
		);
		expect(buildBugReportPrompt(result)).toContain(
			"only the start of a longer recording",
		);
	});

	it("tells the model not to invent anything", () => {
		const prompt = buildBugReportPrompt({
			text: "[0:01] hi",
			truncated: false,
		});
		expect(prompt).toContain("Never invent");
		expect(prompt).toContain('"Not stated in the recording."');
		expect(prompt).not.toContain("only the start of a longer recording");
	});
});

describe("parseBugReport", () => {
	it("reads the JSON out of a fenced reply and maps step timestamps", () => {
		const report = parseBugReport(
			aiReply({
				title: "  Can't save a deal stage  ",
				summary: "Saving a stage fails.",
				steps: [
					{ timestamp: "0:12", step: "Open the deal" },
					{ timestamp: "1:02:03", step: "Way past the end" },
					{ timestamp: null, step: "Click Save" },
					{ timestamp: "0:30", step: "   " },
				],
				expected: "The stage saves",
				actual: "An error toast appears",
				details: ["Deal #4521", " ", "Error: 403"],
				openQuestions: ["Which pipeline?"],
			}),
			{ durationSeconds: 95, now },
		);

		expect(report).toEqual({
			title: "Can't save a deal stage",
			summary: "Saving a stage fails.",
			steps: [
				{ atSeconds: 12, text: "Open the deal" },
				{ atSeconds: null, text: "Way past the end" },
				{ atSeconds: null, text: "Click Save" },
			],
			expected: "The stage saves",
			actual: "An error toast appears",
			details: ["Deal #4521", "Error: 403"],
			openQuestions: ["Which pipeline?"],
			generatedAt: "2026-10-29T12:00:00.000Z",
		});
	});

	it("fills in missing sections instead of leaving them blank", () => {
		const report = parseBugReport(
			JSON.stringify({ title: "", summary: "Question about reports" }),
			{ now },
		);

		expect(report.title).toBe("Recording issue");
		expect(report.expected).toBe("Not stated in the recording.");
		expect(report.actual).toBe("Not stated in the recording.");
		expect(report.steps).toEqual([]);
	});

	it("rejects a reply with no JSON so the next provider can try", () => {
		expect(() => parseBugReport("Sorry, I can't help with that.")).toThrow();
	});

	it("parses m:ss and h:mm:ss timestamps only", () => {
		expect(parseTimestamp("2:05")).toBe(125);
		expect(parseTimestamp("1:00:00")).toBe(3600);
		expect(parseTimestamp("about a minute")).toBeNull();
		expect(parseTimestamp(undefined)).toBeNull();
	});
});

describe("formatBugReportMarkdown", () => {
	it("produces a ticket with links that jump to each step", () => {
		const markdown = formatBugReportMarkdown(
			{
				title: "Button greyed out",
				summary: "The Send button never enables.",
				steps: [
					{ atSeconds: 75, text: "Open the sequence" },
					{ atSeconds: null, text: "Click Send" },
				],
				expected: "Send enables",
				actual: "It stays grey",
				details: [],
				openQuestions: ["Which browser?"],
				generatedAt: now.toISOString(),
			},
			"https://record.leadr.co/s/abc",
		);

		expect(markdown).toContain("## Button greyed out");
		expect(markdown).toContain("**Recording:** https://record.leadr.co/s/abc");
		expect(markdown).toContain(
			"1. [1:15](https://record.leadr.co/s/abc?t=75) Open the sequence",
		);
		expect(markdown).toContain("2. Click Send");
		expect(markdown).toContain("### Details\n\nNot stated in the recording.");
		expect(markdown).toContain("- Which browser?");
	});
});
