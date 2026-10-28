import { serverEnv } from "@cap/env";
import {
	AI_GENERATION_LANGUAGE_AUTO,
	AI_GENERATION_LANGUAGE_CODES,
	type AiGenerationLanguage,
	SUPPORTED_LANGUAGES,
} from "@cap/web-domain";
import { FatalError } from "workflow";
import type { AssemblyAIEditWord } from "@/lib/edit-transcript";

export const DEFAULT_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
export const DEFAULT_TRANSCRIPTION_MAX_UPLOAD_MB = 25;
// Whisper resamples to 16 kHz mono, so 48 kbps loses nothing and fits ~70
// minutes under the 25 MB cap instead of ~27 at the 128 kbps default.
export const OPENAI_COMPATIBLE_AUDIO_BITRATE = "48k";

const BYTES_PER_MB = 1024 * 1024;
const MAX_ERROR_DETAIL_LENGTH = 500;

export type WordTimingSource = "word" | "segment" | "none";

export type OpenAICompatibleTranscription = {
	words: AssemblyAIEditWord[];
	language_code: string | null;
	speech_model_used: string;
	audio_duration: number | null;
	wordTimingSource: WordTimingSource;
};

const WHISPER_LANGUAGE_NAME_TO_CODE = new Map<string, string>(
	AI_GENERATION_LANGUAGE_CODES.map((code) => [
		SUPPORTED_LANGUAGES[code].toLowerCase().replace(/\s*\(.*\)$/, ""),
		code,
	]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getMaxUploadBytes() {
	const configured = Number(serverEnv().TRANSCRIPTION_MAX_UPLOAD_MB);
	const megabytes =
		Number.isFinite(configured) && configured > 0
			? configured
			: DEFAULT_TRANSCRIPTION_MAX_UPLOAD_MB;
	return Math.floor(megabytes * BYTES_PER_MB);
}

function formatMegabytes(bytes: number) {
	return (bytes / BYTES_PER_MB).toFixed(1);
}

function getUploadFile(contentType: string | null) {
	const type = contentType?.split(";")[0]?.trim().toLowerCase();
	switch (type) {
		case "audio/mp4":
		case "audio/m4a":
		case "audio/x-m4a":
			return { filename: "audio.m4a", type: "audio/mp4" };
		case "audio/wav":
		case "audio/x-wav":
			return { filename: "audio.wav", type: "audio/wav" };
		case "audio/webm":
			return { filename: "audio.webm", type: "audio/webm" };
		case "audio/ogg":
			return { filename: "audio.ogg", type: "audio/ogg" };
		case "audio/flac":
			return { filename: "audio.flac", type: "audio/flac" };
		default:
			return { filename: "audio.mp3", type: "audio/mpeg" };
	}
}

export function isRetryableTranscriptionStatus(status: number) {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function normalizeWhisperLanguage(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return null;
	if (/^[a-z]{2,3}$/.test(normalized)) return normalized;
	return WHISPER_LANGUAGE_NAME_TO_CODE.get(normalized) ?? null;
}

function toMilliseconds(seconds: number) {
	return Math.round(seconds * 1000);
}

function parseWhisperWord(value: unknown): AssemblyAIEditWord | null {
	if (!isRecord(value)) return null;
	const rawText = typeof value.word === "string" ? value.word : value.text;
	const text = typeof rawText === "string" ? rawText.trim() : "";
	const start = finiteNumber(value.start);
	const end = finiteNumber(value.end);
	if (!text || start === null || end === null) return null;
	return {
		text,
		start: toMilliseconds(start),
		end: toMilliseconds(end),
		confidence:
			finiteNumber(value.probability) ?? finiteNumber(value.confidence),
	};
}

function splitSegmentIntoWords(segment: {
	text: string;
	start: number;
	end: number;
}): AssemblyAIEditWord[] {
	const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0 || segment.end <= segment.start) return [];
	const step = (segment.end - segment.start) / tokens.length;
	return tokens.map((text, index) => ({
		text,
		start: toMilliseconds(segment.start + index * step),
		end: toMilliseconds(segment.start + (index + 1) * step),
		confidence: null,
	}));
}

export function parseWhisperVerboseJson(
	body: unknown,
	model: string,
	requestedLanguage: AiGenerationLanguage,
): OpenAICompatibleTranscription {
	if (!isRecord(body)) {
		throw new Error("Transcription provider returned an invalid response");
	}

	const segments = Array.isArray(body.segments)
		? body.segments.filter(isRecord)
		: [];
	const audioDuration = finiteNumber(body.duration);

	let wordTimingSource: WordTimingSource = "word";
	let words = (Array.isArray(body.words) ? body.words : [])
		.map(parseWhisperWord)
		.filter((word): word is AssemblyAIEditWord => word !== null);

	if (words.length === 0) {
		words = segments
			.flatMap((segment) => (Array.isArray(segment.words) ? segment.words : []))
			.map(parseWhisperWord)
			.filter((word): word is AssemblyAIEditWord => word !== null);
	}

	if (words.length === 0) {
		wordTimingSource = "segment";
		const timedSegments = segments.flatMap((segment) => {
			const start = finiteNumber(segment.start);
			const end = finiteNumber(segment.end);
			return typeof segment.text === "string" && start !== null && end !== null
				? [{ text: segment.text, start, end }]
				: [];
		});
		if (
			timedSegments.length === 0 &&
			typeof body.text === "string" &&
			audioDuration !== null
		) {
			timedSegments.push({ text: body.text, start: 0, end: audioDuration });
		}
		words = timedSegments.flatMap(splitSegmentIntoWords);
	}

	if (words.length === 0) wordTimingSource = "none";

	return {
		words,
		language_code:
			normalizeWhisperLanguage(body.language) ??
			(requestedLanguage === AI_GENERATION_LANGUAGE_AUTO
				? null
				: requestedLanguage),
		speech_model_used: model,
		audio_duration: audioDuration,
		wordTimingSource,
	};
}

async function readErrorDetail(response: Response) {
	let text = "";
	try {
		text = await response.text();
	} catch {
		return response.statusText;
	}
	let detail = text;
	try {
		const parsed: unknown = JSON.parse(text);
		if (
			isRecord(parsed) &&
			isRecord(parsed.error) &&
			typeof parsed.error.message === "string"
		) {
			detail = parsed.error.message;
		}
	} catch {}
	return (detail || response.statusText).slice(0, MAX_ERROR_DETAIL_LENGTH);
}

export async function transcribeWithOpenAICompatible({
	audio,
	contentType,
	language,
}: {
	audio: Uint8Array;
	contentType: string | null;
	language: AiGenerationLanguage;
}): Promise<OpenAICompatibleTranscription> {
	const env = serverEnv();
	const baseUrl = env.TRANSCRIPTION_BASE_URL?.trim().replace(/\/+$/, "");
	if (!baseUrl) {
		throw new FatalError(
			"Missing TRANSCRIPTION_BASE_URL for the openai-compatible transcription provider",
		);
	}

	const maxBytes = getMaxUploadBytes();
	if (audio.byteLength > maxBytes) {
		throw new FatalError(
			`Audio file is ${formatMegabytes(audio.byteLength)} MB, over the ${formatMegabytes(maxBytes)} MB upload limit of the openai-compatible transcription provider (TRANSCRIPTION_MAX_UPLOAD_MB)`,
		);
	}

	const model = env.TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL;
	const file = getUploadFile(contentType);
	const form = new FormData();
	form.append(
		"file",
		new Blob([new Uint8Array(audio)], { type: file.type }),
		file.filename,
	);
	form.append("model", model);
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "word");
	form.append("timestamp_granularities[]", "segment");
	if (language !== AI_GENERATION_LANGUAGE_AUTO) {
		form.append("language", language);
	}

	const headers: Record<string, string> = {};
	if (env.TRANSCRIPTION_API_KEY) {
		headers.Authorization = `Bearer ${env.TRANSCRIPTION_API_KEY}`;
	}

	const url = `${baseUrl}/audio/transcriptions`;
	const response = await fetch(url, { method: "POST", headers, body: form });

	if (!response.ok) {
		const detail = await readErrorDetail(response);
		const message = `Transcription request to ${url} failed with ${response.status} (model=${model}, language=${language}): ${detail}`;
		if (isRetryableTranscriptionStatus(response.status)) {
			throw new Error(message);
		}
		if (response.status === 413) {
			throw new FatalError(
				`${message}. The ${formatMegabytes(audio.byteLength)} MB audio file is too large for this provider`,
			);
		}
		throw new FatalError(message);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new Error(
			`Transcription provider at ${url} returned a non-JSON response`,
		);
	}

	return parseWhisperVerboseJson(body, model, language);
}
