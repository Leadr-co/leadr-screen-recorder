import { MySqlDialect } from "drizzle-orm/mysql-core";
import { Exit, Option } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	rows: [] as Record<string, unknown>[],
	vtt: null as string | null,
	generateText: vi.fn(),
	aiConfigured: true,
	write: vi.fn(),
	writeSql: "",
	writeParams: [] as unknown[],
	revalidatePath: vi.fn(),
}));

vi.mock("@cap/database", () => ({
	db: () => ({
		select: () => ({ from: () => ({ where: () => ({ limit: vi.fn() }) }) }),
		update: () => ({
			set: (values: {
				metadata: Parameters<MySqlDialect["sqlToQuery"]>[0];
			}) => {
				const query = new MySqlDialect().sqlToQuery(values.metadata);
				mocks.writeSql = query.sql;
				mocks.writeParams = query.params;
				return { where: mocks.write };
			},
		}),
	}),
}));
vi.mock("@cap/database/auth/session", () => ({
	getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@cap/env", () => ({
	serverEnv: () => ({ WEB_URL: "https://record.test" }),
	buildEnv: { NEXT_PUBLIC_IS_CAP: false },
}));
vi.mock("@cap/web-backend", () => ({
	provideOptionalAuth: (effect: unknown) => effect,
	Storage: { getAccessForVideo: vi.fn() },
	VideosPolicy: {},
}));
vi.mock("@/lib/server", () => ({
	runPromiseExit: async () => Exit.succeed(mocks.rows),
	runPromise: async () =>
		mocks.vtt === null ? Option.none() : Option.some(mocks.vtt),
}));
vi.mock("@/lib/ai/provider", () => ({
	isAiConfigured: () => mocks.aiConfigured,
}));
vi.mock("@/lib/ai/run", () => ({
	runWithAiProviders: async (
		_role: string,
		run: (selection: unknown) => Promise<unknown>,
	) => run({ model: () => "model", defaultMaxOutputTokens: 2_000 }),
}));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import type { Video } from "@cap/web-domain";
import { generateBugReport, getBugReport } from "@/actions/videos/bug-report";

const videoId = "video-1" as Video.VideoId;
const vtt = `WEBVTT

1
00:00:03.000 --> 00:00:06.000
I open the deal and click save

2
00:00:07.000 --> 00:00:09.000
and I get a 403 error`;

const reply = {
	title: "Saving a deal fails with 403",
	summary: "Clicking save on a deal shows a 403 error.",
	steps: [{ timestamp: "0:03", step: "Open the deal and click Save" }],
	expected: "The deal saves",
	actual: "A 403 error appears",
	details: ["403 error"],
	openQuestions: ["Which deal?"],
};

beforeEach(() => {
	mocks.getCurrentUser.mockResolvedValue({ id: "rep" });
	mocks.rows = [
		{
			id: videoId,
			ownerId: "owner",
			duration: 30,
			transcriptionStatus: "COMPLETE",
			metadata: null,
		},
	];
	mocks.vtt = vtt;
	mocks.aiConfigured = true;
	mocks.generateText.mockResolvedValue({ text: JSON.stringify(reply) });
	mocks.write.mockResolvedValue([{ affectedRows: 1 }]);
});

describe("generateBugReport", () => {
	it("drafts the report from the transcript and saves it on the recording", async () => {
		const result = await generateBugReport(videoId);

		expect(result).toMatchObject({
			success: true,
			report: {
				title: "Saving a deal fails with 403",
				steps: [{ atSeconds: 3, text: "Open the deal and click Save" }],
			},
		});
		const prompt = mocks.generateText.mock.calls[0]?.[0].prompt as string;
		expect(prompt).toContain("[0:03] I open the deal and click save");
		expect(prompt).toContain("[0:07] and I get a 403 error");
		expect(mocks.writeSql).toContain("'$.bugReport'");
		expect(JSON.parse(String(mocks.writeParams[0]))).toMatchObject({
			title: "Saving a deal fails with 403",
		});
		expect(result.success && result.markdown).toContain(
			"[0:03](https://record.test/s/video-1?t=3)",
		);
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/s/video-1");
	});

	it("requires a signed-in user", async () => {
		mocks.getCurrentUser.mockResolvedValue(null);

		await expect(generateBugReport(videoId)).resolves.toEqual({
			success: false,
			message: "Sign in to create a bug report.",
		});
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it("waits for the transcript", async () => {
		mocks.rows = [{ ...mocks.rows[0], transcriptionStatus: "PROCESSING" }];

		const result = await generateBugReport(videoId);

		expect(result).toMatchObject({ success: false });
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it("explains a recording with no speech instead of calling the AI", async () => {
		mocks.vtt = "WEBVTT\n";

		await expect(generateBugReport(videoId)).resolves.toEqual({
			success: false,
			message: "This recording has no speech to build a bug report from.",
		});
		expect(mocks.generateText).not.toHaveBeenCalled();
	});

	it("saves nothing when the AI reply can't be read", async () => {
		mocks.generateText.mockResolvedValue({ text: "No JSON here" });

		const result = await generateBugReport(videoId);

		expect(result).toMatchObject({ success: false });
		expect(mocks.write).not.toHaveBeenCalled();
	});
});

describe("getBugReport", () => {
	it("returns a saved report with its ticket text", async () => {
		mocks.rows = [
			{
				...mocks.rows[0],
				metadata: {
					bugReport: {
						...reply,
						steps: [],
						generatedAt: "2026-10-29T00:00:00.000Z",
					},
				},
			},
		];

		const state = await getBugReport(videoId);

		expect(state.report?.title).toBe("Saving a deal fails with 403");
		expect(state.markdown).toContain("## Saving a deal fails with 403");
		expect(state.canGenerate).toBe(true);
	});

	it("doesn't offer generation to anonymous viewers or without AI", async () => {
		mocks.getCurrentUser.mockResolvedValue(null);
		expect((await getBugReport(videoId)).canGenerate).toBe(false);

		mocks.getCurrentUser.mockResolvedValue({ id: "rep" });
		mocks.aiConfigured = false;
		expect((await getBugReport(videoId)).canGenerate).toBe(false);
	});
});
