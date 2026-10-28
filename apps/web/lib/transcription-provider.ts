import { serverEnv } from "@cap/env";

export type TranscriptionProviderId = "assemblyai" | "openai-compatible";

function isProviderConfigured(
	provider: TranscriptionProviderId,
	env: ReturnType<typeof serverEnv>,
) {
	switch (provider) {
		case "assemblyai":
			return Boolean(env.ASSEMBLY_API_KEY);
		case "openai-compatible":
			return Boolean(env.TRANSCRIPTION_BASE_URL);
	}
}

export function getTranscriptionProvider(): TranscriptionProviderId | null {
	const env = serverEnv();
	const explicit = env.TRANSCRIPTION_PROVIDER;
	if (explicit) return isProviderConfigured(explicit, env) ? explicit : null;
	if (env.ASSEMBLY_API_KEY) return "assemblyai";
	if (env.TRANSCRIPTION_BASE_URL && env.TRANSCRIPTION_API_KEY) {
		return "openai-compatible";
	}
	return null;
}

export function isTranscriptionConfigured() {
	return getTranscriptionProvider() !== null;
}

export function getTranscriptionConfigError() {
	switch (serverEnv().TRANSCRIPTION_PROVIDER) {
		case "assemblyai":
			return "Missing ASSEMBLY_API_KEY";
		case "openai-compatible":
			return "Missing TRANSCRIPTION_BASE_URL for the openai-compatible transcription provider";
		default:
			return "Missing ASSEMBLY_API_KEY (or TRANSCRIPTION_BASE_URL and TRANSCRIPTION_API_KEY for an OpenAI-compatible Whisper API)";
	}
}
