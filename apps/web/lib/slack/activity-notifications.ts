import { db } from "@cap/database";
import { users, videos } from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import { type Organisation, User, Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";
import { after } from "next/server";
import type { UserPreferences } from "@/app/(org)/dashboard/dashboard-data";
import {
	lookupSlackUserIdByEmail,
	postSlackMessage,
	SlackApiError,
} from "./client";
import {
	listSlackInstallationAccess,
	type SlackInstallationAccess,
} from "./installations";
import {
	missingSlackDirectMessageScopes,
	SLACK_DIRECT_MESSAGE_SCOPES,
} from "./scopes";

const COMMENT_SNIPPET_LENGTH = 140;

export type SlackActivity =
	| {
			type: "view";
			videoId: string;
			actorUserId: string | null;
	  }
	| {
			type: "comment";
			videoId: string;
			actorUserId: string;
			commentId: string;
			content: string;
	  };

export type SlackActivityContext = {
	videoName: string;
	organizationId: Organisation.OrganisationId;
	ownerId: string;
	ownerEmail: string;
	preferences: UserPreferences;
	actorName: string | null;
};

type SlackActivityDependencies = {
	loadContext: (
		activity: SlackActivity,
	) => Promise<SlackActivityContext | null>;
	listInstallations: (
		organizationId: Organisation.OrganisationId,
	) => Promise<SlackInstallationAccess[]>;
	lookupUserIdByEmail: (input: {
		token: string;
		email: string;
	}) => Promise<string | null>;
	postMessage: (input: {
		token: string;
		channel: string;
		text: string;
	}) => Promise<void>;
	webUrl: () => string;
};

const loadSlackActivityContext = async (
	activity: SlackActivity,
): Promise<SlackActivityContext | null> => {
	const [video] = await db()
		.select({
			videoName: videos.name,
			organizationId: videos.orgId,
			ownerId: users.id,
			ownerEmail: users.email,
			preferences: users.preferences,
		})
		.from(videos)
		.innerJoin(users, eq(users.id, videos.ownerId))
		.where(eq(videos.id, Video.VideoId.make(activity.videoId)))
		.limit(1);
	if (!video) return null;

	let actorName: string | null = null;
	if (activity.actorUserId && activity.actorUserId !== video.ownerId) {
		const [actor] = await db()
			.select({
				name: users.name,
				lastName: users.lastName,
				email: users.email,
			})
			.from(users)
			.where(eq(users.id, User.UserId.make(activity.actorUserId)))
			.limit(1);
		const fullName = [actor?.name, actor?.lastName]
			.map((part) => part?.trim())
			.filter(Boolean)
			.join(" ");
		actorName = fullName || actor?.email || null;
	}

	return { ...video, actorName };
};

const defaultDependencies: SlackActivityDependencies = {
	loadContext: loadSlackActivityContext,
	listInstallations: listSlackInstallationAccess,
	lookupUserIdByEmail: lookupSlackUserIdByEmail,
	postMessage: postSlackMessage,
	webUrl: () => serverEnv().WEB_URL,
};

const escapeSlackText = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const commentSnippet = (content: string) => {
	const characters = Array.from(content.replace(/\s+/g, " ").trim());
	if (characters.length <= COMMENT_SNIPPET_LENGTH) return characters.join("");
	return `${characters
		.slice(0, COMMENT_SNIPPET_LENGTH - 1)
		.join("")
		.trimEnd()}…`;
};

export const buildSlackActivityMessage = ({
	activity,
	actorName,
	videoName,
	webUrl,
}: {
	activity: SlackActivity;
	actorName: string | null;
	videoName: string;
	webUrl: string;
}) => {
	const shareUrl = new URL(`/s/${activity.videoId}`, webUrl);
	if (activity.type === "comment") {
		shareUrl.searchParams.set("comment", activity.commentId);
	}
	const actor = `*${escapeSlackText(actorName?.trim() || "Someone")}*`;
	const title = `*${escapeSlackText(videoName.trim() || "Untitled recording")}*`;
	const headline =
		activity.type === "comment"
			? `💬 ${actor} commented on ${title}: “${escapeSlackText(commentSnippet(activity.content))}”`
			: `👀 ${actor} viewed your recording ${title}`;
	return `${headline}\n<${shareUrl.toString()}|Open recording>`;
};

const isActivityMuted = (
	activity: SlackActivity,
	preferences: UserPreferences,
) => {
	const settings = preferences?.notifications;
	if (!settings) return false;
	if (activity.type === "comment") return settings.pauseComments === true;
	return activity.actorUserId
		? settings.pauseViews === true
		: settings.pauseAnonViews === true;
};

const teamsWarnedAboutScopes = new Set<string>();

const warnMissingScopesOnce = (teamId: string, missingScopes: string[]) => {
	if (teamsWarnedAboutScopes.has(teamId)) return;
	teamsWarnedAboutScopes.add(teamId);
	console.warn(
		`[slack-activity] Slack workspace ${teamId} must be reconnected to grant ${missingScopes.join(", ")}; skipping direct messages`,
	);
};

export const notifyVideoOwnerInSlack = async ({
	activity,
	dependencies = defaultDependencies,
}: {
	activity: SlackActivity;
	dependencies?: SlackActivityDependencies;
}) => {
	try {
		const context = await dependencies.loadContext(activity);
		if (!context?.ownerEmail) return;
		if (activity.actorUserId === context.ownerId) return;
		if (isActivityMuted(activity, context.preferences)) return;

		const installations = await dependencies.listInstallations(
			context.organizationId,
		);
		if (installations.length === 0) return;

		let text: string | null = null;
		for (const installation of installations) {
			const missingScopes = missingSlackDirectMessageScopes(
				installation.scopes,
			);
			if (missingScopes.length > 0) {
				warnMissingScopesOnce(installation.teamId, missingScopes);
				continue;
			}
			try {
				const slackUserId = await dependencies.lookupUserIdByEmail({
					token: installation.accessToken,
					email: context.ownerEmail,
				});
				if (!slackUserId) continue;
				text ??= buildSlackActivityMessage({
					activity,
					actorName: context.actorName,
					videoName: context.videoName,
					webUrl: dependencies.webUrl(),
				});
				await dependencies.postMessage({
					token: installation.accessToken,
					channel: slackUserId,
					text,
				});
				return;
			} catch (error) {
				if (error instanceof SlackApiError && error.code === "missing_scope") {
					warnMissingScopesOnce(installation.teamId, [
						...SLACK_DIRECT_MESSAGE_SCOPES,
					]);
					continue;
				}
				console.error(
					`[slack-activity] Failed to message the owner in Slack workspace ${installation.teamId}:`,
					error instanceof Error ? error.message : error,
				);
			}
		}
	} catch (error) {
		console.error(
			"[slack-activity] Failed to send Slack activity notification:",
			error instanceof Error ? error.message : error,
		);
	}
};

export const queueSlackActivityNotification = (activity: SlackActivity) => {
	const delivery = notifyVideoOwnerInSlack({ activity });
	try {
		after(delivery);
	} catch {
		void delivery;
	}
};
