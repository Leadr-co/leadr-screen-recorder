"use server";

import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { videos } from "@cap/database/schema";
import type { VideoBugReport, VideoMetadata } from "@cap/database/types";
import { serverEnv } from "@cap/env";
import { provideOptionalAuth, Storage, VideosPolicy } from "@cap/web-backend";
import { Policy, type Video } from "@cap/web-domain";
import { generateText } from "ai";
import { eq, sql } from "drizzle-orm";
import { Effect, Exit, Option } from "effect";
import { revalidatePath } from "next/cache";
import { parseAgentVtt } from "@/lib/agent-api";
import { isAiConfigured } from "@/lib/ai/provider";
import { runWithAiProviders } from "@/lib/ai/run";
import { isAiGenerationEnabledForUser } from "@/lib/ai-generation-entitlement";
import {
	buildBugReportPrompt,
	formatBugReportMarkdown,
	formatTranscriptForBugReport,
	parseBugReport,
} from "@/lib/bug-report";
import * as EffectRuntime from "@/lib/server";
import { runPromise } from "@/lib/server";
import { decodeStorageVideo } from "@/lib/video-storage";

type BugReportState = {
	report: VideoBugReport | null;
	markdown: string | null;
	canGenerate: boolean;
};

type GenerateResult =
	| { success: true; report: VideoBugReport; markdown: string }
	| { success: false; message: string };

const loadViewableVideo = (videoId: Video.VideoId) =>
	Effect.gen(function* () {
		const videosPolicy = yield* VideosPolicy;
		return yield* Effect.promise(() =>
			db().select().from(videos).where(eq(videos.id, videoId)).limit(1),
		).pipe(Policy.withPublicPolicy(videosPolicy.canView(videoId)));
	}).pipe(provideOptionalAuth, EffectRuntime.runPromiseExit);

const recordingUrl = (videoId: string) => `${serverEnv().WEB_URL}/s/${videoId}`;

const toMarkdown = (report: VideoBugReport | null, videoId: string) =>
	report ? formatBugReportMarkdown(report, recordingUrl(videoId)) : null;

export async function getBugReport(
	videoId: Video.VideoId,
): Promise<BugReportState> {
	const empty = { report: null, markdown: null, canGenerate: false };
	if (typeof videoId !== "string" || !videoId) return empty;

	const exit = await loadViewableVideo(videoId);
	if (Exit.isFailure(exit) || !exit.value[0]) return empty;
	const video = exit.value[0];
	const report = (video.metadata as VideoMetadata | null)?.bugReport ?? null;
	const user = await getCurrentUser();

	return {
		report,
		markdown: toMarkdown(report, videoId),
		canGenerate:
			Boolean(user) &&
			isAiGenerationEnabledForUser(user) &&
			isAiConfigured("generation") &&
			video.transcriptionStatus === "COMPLETE",
	};
}

export async function generateBugReport(
	videoId: Video.VideoId,
): Promise<GenerateResult> {
	const user = await getCurrentUser();
	if (!user)
		return { success: false, message: "Sign in to create a bug report." };
	if (!isAiGenerationEnabledForUser(user) || !isAiConfigured("generation")) {
		return { success: false, message: "AI isn't set up on this server." };
	}
	if (typeof videoId !== "string" || !videoId) {
		return { success: false, message: "Recording not found." };
	}

	const exit = await loadViewableVideo(videoId);
	if (Exit.isFailure(exit) || !exit.value[0]) {
		return { success: false, message: "Recording not found." };
	}
	const video = exit.value[0];
	if (video.transcriptionStatus !== "COMPLETE") {
		return {
			success: false,
			message: "The transcript isn't ready yet. Try again in a minute.",
		};
	}

	const vtt = await Effect.gen(function* () {
		const [bucket] = yield* Storage.getAccessForVideo(
			decodeStorageVideo(video),
		);
		return yield* bucket.getObject(
			`${video.ownerId}/${videoId}/transcription.vtt`,
		);
	})
		.pipe(runPromise)
		.catch(() => Option.none<string>());
	const cues = Option.isSome(vtt) ? parseAgentVtt(vtt.value) : [];
	if (cues.length === 0) {
		return {
			success: false,
			message: "This recording has no speech to build a bug report from.",
		};
	}

	const prompt = buildBugReportPrompt(formatTranscriptForBugReport(cues));
	let report: VideoBugReport;
	try {
		report = await runWithAiProviders("generation", async (selection) => {
			const result = await generateText({
				model: selection.model({ jsonRepair: true }),
				prompt,
				maxOutputTokens: selection.defaultMaxOutputTokens,
			});
			// Parsing inside the loop lets a malformed reply fall through to the
			// next provider instead of failing the whole request.
			return parseBugReport(result.text, { durationSeconds: video.duration });
		});
	} catch (error) {
		console.error("[bug-report] generation failed", { videoId, error });
		return {
			success: false,
			message:
				"The AI couldn't write a bug report right now. Try again in a minute.",
		};
	}

	await db()
		.update(videos)
		.set({
			metadata: sql`JSON_SET(COALESCE(${videos.metadata}, JSON_OBJECT()), '$.bugReport', CAST(${JSON.stringify(report)} AS JSON))`,
		})
		.where(eq(videos.id, videoId));
	revalidatePath(`/s/${videoId}`);

	return {
		success: true,
		report,
		markdown: formatBugReportMarkdown(report, recordingUrl(videoId)),
	};
}
