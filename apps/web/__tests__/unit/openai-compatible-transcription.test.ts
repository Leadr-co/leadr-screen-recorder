import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverEnvMock = vi.hoisted(() =>
	vi.fn<() => Record<string, string | undefined>>(() => ({})),
);

vi.mock("@cap/env", () => ({
	serverEnv: serverEnvMock,
}));

vi.mock("workflow", () => ({
	FatalError: class FatalError extends Error {},
}));

import { FatalError } from "workflow";
import {
	createEditTranscript,
	editTranscriptWordsToCaptionVtt,
} from "@/lib/edit-transcript";
import {
	normalizeWhisperLanguage,
	parseWhisperVerboseJson,
	transcribeWithOpenAICompatible,
} from "@/lib/openai-compatible-transcription";

const groqEnv = {
	TRANSCRIPTION_BASE_URL: "https://api.groq.com/openai/v1/",
	TRANSCRIPTION_API_KEY: "gsk_test",
};

const verboseJson = {
	task: "transcribe",
	language: "English",
	duration: 2.5,
	text: " Hello there, um, world.",
	segments: [{ id: 0, start: 0, end: 2.5, text: " Hello there, um, world." }],
	words: [
		{ word: " Hello", start: 0.0, end: 0.42 },
		{ word: " there,", start: 0.42, end: 0.9 },
		{ word: " um,", start: 1.0, end: 1.3 },
		{ word: " world.", start: 1.5, end: 2.04 },
	],
};

const fetchMock = vi.fn<
	(input: string, init?: RequestInit) => Promise<Response>
>(async () => Response.json(verboseJson));

const audio = new Uint8Array([1, 2, 3, 4]);

function lastRequest() {
	const call = fetchMock.mock.calls.at(-1);
	if (!call) throw new Error("fetch was not called");
	const [url, init] = call;
	return { url, init, form: init?.body as FormData };
}

describe("transcribeWithOpenAICompatible", () => {
	beforeEach(() => {
		serverEnvMock.mockReturnValue(groqEnv);
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		fetchMock.mockReset();
		fetchMock.mockImplementation(async () => Response.json(verboseJson));
	});

	it("posts a verbose_json multipart request with word and segment granularities", async () => {
		await transcribeWithOpenAICompatible({
			audio,
			contentType: "audio/mpeg",
			language: "auto",
		});

		const { url, init, form } = lastRequest();
		expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
		expect(init?.method).toBe("POST");
		expect(init?.headers).toEqual({ Authorization: "Bearer gsk_test" });
		expect(form.get("model")).toBe("whisper-large-v3-turbo");
		expect(form.get("response_format")).toBe("verbose_json");
		expect(form.getAll("timestamp_granularities[]")).toEqual([
			"word",
			"segment",
		]);
		expect(form.has("language")).toBe(false);

		const file = form.get("file") as File;
		expect(file.name).toBe("audio.mp3");
		expect(file.type).toBe("audio/mpeg");
		expect(file.size).toBe(audio.byteLength);
	});

	it("sends the configured model, the language code and an m4a filename for mp4 audio", async () => {
		serverEnvMock.mockReturnValue({
			...groqEnv,
			TRANSCRIPTION_MODEL: "Systran/faster-whisper-small",
		});

		await transcribeWithOpenAICompatible({
			audio,
			contentType: "audio/mp4",
			language: "de",
		});

		const { form } = lastRequest();
		expect(form.get("model")).toBe("Systran/faster-whisper-small");
		expect(form.get("language")).toBe("de");
		expect((form.get("file") as File).name).toBe("audio.m4a");
	});

	it("omits the Authorization header for keyless servers", async () => {
		serverEnvMock.mockReturnValue({
			TRANSCRIPTION_PROVIDER: "openai-compatible",
			TRANSCRIPTION_BASE_URL: "http://speaches:8000/v1",
		});

		await transcribeWithOpenAICompatible({
			audio,
			contentType: null,
			language: "auto",
		});

		const { url, init } = lastRequest();
		expect(url).toBe("http://speaches:8000/v1/audio/transcriptions");
		expect(init?.headers).toEqual({});
	});

	it("maps word timestamps in seconds into the edit transcript and caption VTT", async () => {
		const result = await transcribeWithOpenAICompatible({
			audio,
			contentType: "audio/mpeg",
			language: "auto",
		});

		expect(result.wordTimingSource).toBe("word");
		expect(result.language_code).toBe("en");
		expect(result.audio_duration).toBe(2.5);

		const transcript = createEditTranscript(result, 2_500);
		expect(transcript.speechModelUsed).toBe("whisper-large-v3-turbo");
		expect(transcript.languageCode).toBe("en");
		expect(transcript.durationMs).toBe(2_500);
		expect(
			transcript.words.map(({ text, startMs, endMs, confidence }) => ({
				text,
				startMs,
				endMs,
				confidence,
			})),
		).toEqual([
			{ text: "Hello", startMs: 0, endMs: 420, confidence: null },
			{ text: "there,", startMs: 420, endMs: 900, confidence: null },
			{ text: "um,", startMs: 1_000, endMs: 1_300, confidence: null },
			{ text: "world.", startMs: 1_500, endMs: 2_040, confidence: null },
		]);

		const vtt = editTranscriptWordsToCaptionVtt(transcript.words);
		expect(vtt.startsWith("WEBVTT")).toBe(true);
		expect(vtt).toContain("00:00:00.000 -->");
		expect(vtt).toContain("Hello there,");
		expect(vtt).toContain("world.");
		expect(vtt).not.toContain("um,");
	});

	it.each([
		[429, "rate limited"],
		[500, "internal error"],
		[503, "unavailable"],
	])("throws a retryable Error for %s", async (status, detail) => {
		fetchMock.mockResolvedValueOnce(
			Response.json({ error: { message: detail } }, { status }),
		);

		const error = await transcribeWithOpenAICompatible({
			audio,
			contentType: "audio/mpeg",
			language: "auto",
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(FatalError);
		expect((error as Error).message).toContain(`${status}`);
		expect((error as Error).message).toContain(detail);
	});

	it.each([
		[400, "invalid model"],
		[401, "Invalid API Key"],
		[404, "not found"],
	])("throws a FatalError for %s", async (status, detail) => {
		fetchMock.mockResolvedValueOnce(
			Response.json({ error: { message: detail } }, { status }),
		);

		const error = await transcribeWithOpenAICompatible({
			audio,
			contentType: "audio/mpeg",
			language: "auto",
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(FatalError);
		expect((error as Error).message).toContain(`${status}`);
		expect((error as Error).message).toContain(detail);
		expect((error as Error).message).not.toContain("gsk_test");
	});

	it("throws a FatalError mentioning the size when the provider returns 413", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response("Request Entity Too Large", { status: 413 }),
		);

		await expect(
			transcribeWithOpenAICompatible({
				audio,
				contentType: "audio/mpeg",
				language: "auto",
			}),
		).rejects.toThrow(/413.*too large/);
	});

	it("refuses audio over the upload limit without calling the provider", async () => {
		serverEnvMock.mockReturnValue({
			...groqEnv,
			TRANSCRIPTION_MAX_UPLOAD_MB: "1",
		});
		const oversized = new Uint8Array(1024 * 1024 + 1);

		const error = await transcribeWithOpenAICompatible({
			audio: oversized,
			contentType: "audio/mpeg",
			language: "auto",
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(FatalError);
		expect((error as Error).message).toContain(
			"Audio file is 1.0 MB, over the 1.0 MB upload limit",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("uses a 25 MB upload limit by default", async () => {
		const error = await transcribeWithOpenAICompatible({
			audio: new Uint8Array(25 * 1024 * 1024 + 1),
			contentType: "audio/mpeg",
			language: "auto",
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(FatalError);
		expect((error as Error).message).toContain("25.0 MB upload limit");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("propagates network failures as retryable errors", async () => {
		fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

		const error = await transcribeWithOpenAICompatible({
			audio,
			contentType: "audio/mpeg",
			language: "auto",
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(TypeError);
		expect(error).not.toBeInstanceOf(FatalError);
	});
});

describe("parseWhisperVerboseJson", () => {
	it("reads per-segment words and probabilities from faster-whisper style responses", () => {
		const result = parseWhisperVerboseJson(
			{
				language: "fr",
				duration: 1,
				segments: [
					{
						start: 0,
						end: 1,
						text: " Bonjour tout",
						words: [
							{ word: " Bonjour", start: 0, end: 0.5, probability: 0.92 },
							{ word: " tout", start: 0.5, end: 1, probability: 1.4 },
						],
					},
				],
			},
			"whisper-1",
			"auto",
		);

		expect(result.wordTimingSource).toBe("word");
		expect(result.language_code).toBe("fr");
		const transcript = createEditTranscript(result, 1_000);
		expect(transcript.words.map((word) => word.confidence)).toEqual([0.92, 1]);
	});

	it("splits segment timing evenly across words when the server returns no words", () => {
		const result = parseWhisperVerboseJson(
			{
				duration: 3,
				segments: [
					{ start: 0, end: 1.5, text: " one two three" },
					{ start: 2, end: 3, text: " four" },
				],
			},
			"whisper-large-v3-turbo",
			"es",
		);

		expect(result.wordTimingSource).toBe("segment");
		expect(result.language_code).toBe("es");
		expect(result.words).toEqual([
			{ text: "one", start: 0, end: 500, confidence: null },
			{ text: "two", start: 500, end: 1_000, confidence: null },
			{ text: "three", start: 1_000, end: 1_500, confidence: null },
			{ text: "four", start: 2_000, end: 3_000, confidence: null },
		]);
	});

	it("spreads plain text across the audio duration when there are no segments", () => {
		const result = parseWhisperVerboseJson(
			{ text: "hello world", duration: 2 },
			"whisper-1",
			"auto",
		);

		expect(result.wordTimingSource).toBe("segment");
		expect(result.words).toEqual([
			{ text: "hello", start: 0, end: 1_000, confidence: null },
			{ text: "world", start: 1_000, end: 2_000, confidence: null },
		]);
	});

	it("reports no words for silent audio", () => {
		const result = parseWhisperVerboseJson(
			{ text: "", duration: 2, segments: [], words: [] },
			"whisper-1",
			"auto",
		);

		expect(result.wordTimingSource).toBe("none");
		expect(result.words).toEqual([]);
	});

	it("rejects a non-object response", () => {
		expect(() => parseWhisperVerboseJson("nope", "whisper-1", "auto")).toThrow(
			"invalid response",
		);
	});
});

describe("normalizeWhisperLanguage", () => {
	it.each([
		["english", "en"],
		["English", "en"],
		["chinese", "zh"],
		["persian", "fa"],
		["en", "en"],
		["klingon", null],
		["", null],
		[undefined, null],
	])("maps %s to %s", (input, expected) => {
		expect(normalizeWhisperLanguage(input)).toBe(expected);
	});
});
