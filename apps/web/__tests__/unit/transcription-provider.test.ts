import { describe, expect, it, vi } from "vitest";

const serverEnvMock = vi.hoisted(() =>
	vi.fn<() => Record<string, string | undefined>>(() => ({})),
);

vi.mock("@cap/env", () => ({
	serverEnv: serverEnvMock,
}));

import {
	getTranscriptionConfigError,
	getTranscriptionProvider,
	isTranscriptionConfigured,
} from "@/lib/transcription-provider";

const envWith = (env: Record<string, string | undefined>) => {
	serverEnvMock.mockReturnValue(env);
};

const groq = {
	TRANSCRIPTION_BASE_URL: "https://api.groq.com/openai/v1",
	TRANSCRIPTION_API_KEY: "gsk_test",
};

describe("getTranscriptionProvider", () => {
	it("is unconfigured with no transcription env", () => {
		envWith({});
		expect(getTranscriptionProvider()).toBeNull();
		expect(isTranscriptionConfigured()).toBe(false);
		expect(getTranscriptionConfigError()).toContain("ASSEMBLY_API_KEY");
		expect(getTranscriptionConfigError()).toContain("TRANSCRIPTION_BASE_URL");
	});

	it("defaults to assemblyai when ASSEMBLY_API_KEY is set, even with an OpenAI-compatible config", () => {
		envWith({ ASSEMBLY_API_KEY: "assembly-key", ...groq });
		expect(getTranscriptionProvider()).toBe("assemblyai");
	});

	it("defaults to openai-compatible when the base URL and API key are set", () => {
		envWith(groq);
		expect(getTranscriptionProvider()).toBe("openai-compatible");
		expect(isTranscriptionConfigured()).toBe(true);
	});

	it("does not auto-detect openai-compatible from a base URL alone", () => {
		envWith({ TRANSCRIPTION_BASE_URL: groq.TRANSCRIPTION_BASE_URL });
		expect(getTranscriptionProvider()).toBeNull();
	});

	it("does not auto-detect openai-compatible from an API key alone", () => {
		envWith({ TRANSCRIPTION_API_KEY: groq.TRANSCRIPTION_API_KEY });
		expect(getTranscriptionProvider()).toBeNull();
	});

	it("honours an explicit openai-compatible provider over ASSEMBLY_API_KEY", () => {
		envWith({
			TRANSCRIPTION_PROVIDER: "openai-compatible",
			ASSEMBLY_API_KEY: "assembly-key",
			...groq,
		});
		expect(getTranscriptionProvider()).toBe("openai-compatible");
	});

	it("allows a keyless self-hosted server when openai-compatible is explicit", () => {
		envWith({
			TRANSCRIPTION_PROVIDER: "openai-compatible",
			TRANSCRIPTION_BASE_URL: "http://speaches:8000/v1",
		});
		expect(getTranscriptionProvider()).toBe("openai-compatible");
	});

	it("is unconfigured when the explicit openai-compatible provider has no base URL", () => {
		envWith({
			TRANSCRIPTION_PROVIDER: "openai-compatible",
			ASSEMBLY_API_KEY: "assembly-key",
		});
		expect(getTranscriptionProvider()).toBeNull();
		expect(getTranscriptionConfigError()).toContain("TRANSCRIPTION_BASE_URL");
	});

	it("is unconfigured when the explicit assemblyai provider has no key", () => {
		envWith({ TRANSCRIPTION_PROVIDER: "assemblyai", ...groq });
		expect(getTranscriptionProvider()).toBeNull();
		expect(getTranscriptionConfigError()).toBe("Missing ASSEMBLY_API_KEY");
	});
});
