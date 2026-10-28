import { Organisation } from "@cap/web-domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@cap/database", () => ({
	db: () => {
		throw new Error("Unexpected database access");
	},
}));
vi.mock("@cap/env", () => ({
	serverEnv: () => ({ WEB_URL: "https://record.leadr.co" }),
}));

import {
	buildSlackActivityMessage,
	notifyVideoOwnerInSlack,
	type SlackActivity,
	type SlackActivityContext,
} from "@/lib/slack/activity-notifications";
import {
	lookupSlackUserIdByEmail,
	postSlackMessage,
	SLACK_BOT_SCOPES,
	SlackApiError,
} from "@/lib/slack/client";
import type { SlackInstallationAccess } from "@/lib/slack/installations";

const organizationId = Organisation.OrganisationId.make("org123");

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

const baseContext = (
	overrides: Partial<SlackActivityContext> = {},
): SlackActivityContext => ({
	videoName: "Q3 pipeline review",
	organizationId,
	ownerId: "owner",
	ownerEmail: "owner@leadr.co",
	preferences: null,
	actorName: "Jamie Rivera",
	...overrides,
});

let teamCounter = 0;
const installation = (
	overrides: Partial<SlackInstallationAccess> = {},
): SlackInstallationAccess => {
	teamCounter += 1;
	return {
		teamId: `T${teamCounter}`,
		accessToken: "xoxb-token",
		scopes: [...SLACK_BOT_SCOPES],
		...overrides,
	};
};

const commentActivity: SlackActivity = {
	type: "comment",
	videoId: "video123",
	actorUserId: "viewer",
	commentId: "comment123",
	content: "Love this walkthrough",
};

const viewActivity: SlackActivity = {
	type: "view",
	videoId: "video123",
	actorUserId: "viewer",
};

const createDependencies = ({
	context = baseContext(),
	installations = [installation()],
	fetchImpl = vi.fn(async (input: string | URL | Request) =>
		String(input).includes("users.lookupByEmail")
			? jsonResponse({ ok: true, user: { id: "U123" } })
			: jsonResponse({ ok: true }),
	),
}: {
	context?: SlackActivityContext | null;
	installations?: SlackInstallationAccess[];
	fetchImpl?: ReturnType<typeof vi.fn>;
} = {}) => {
	const dependencies = {
		loadContext: vi.fn(async () => context),
		listInstallations: vi.fn(async () => installations),
		lookupUserIdByEmail: vi.fn((input: { token: string; email: string }) =>
			lookupSlackUserIdByEmail({
				...input,
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		),
		postMessage: vi.fn(
			(input: { token: string; channel: string; text: string }) =>
				postSlackMessage({
					...input,
					fetchImpl: fetchImpl as unknown as typeof fetch,
				}),
		),
		webUrl: () => "https://record.leadr.co",
	};
	return { dependencies, fetchImpl };
};

describe("Slack owner activity DMs", () => {
	let warn: ReturnType<typeof vi.spyOn>;
	let error: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		error = vi.spyOn(console, "error").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("looks the owner up by email and DMs them in the org's workspace", async () => {
		const { dependencies, fetchImpl } = createDependencies();

		await notifyVideoOwnerInSlack({
			activity: commentActivity,
			dependencies,
		});

		expect(dependencies.listInstallations).toHaveBeenCalledWith(organizationId);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const [lookupUrl, lookupInit] = fetchImpl.mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(new URL(lookupUrl).pathname).toBe("/api/users.lookupByEmail");
		expect(new URL(lookupUrl).searchParams.get("email")).toBe("owner@leadr.co");
		expect(lookupInit.headers).toMatchObject({
			Authorization: "Bearer xoxb-token",
		});

		const [postUrl, postInit] = fetchImpl.mock.calls[1] as [
			string,
			RequestInit,
		];
		expect(postUrl).toBe("https://slack.com/api/chat.postMessage");
		expect(JSON.parse(String(postInit.body))).toEqual({
			channel: "U123",
			text: "💬 *Jamie Rivera* commented on *Q3 pipeline review*: “Love this walkthrough”\n<https://record.leadr.co/s/video123?comment=comment123|Open recording>",
			unfurl_links: false,
			unfurl_media: false,
		});
	});

	it("names anonymous viewers Someone and links to the share page", async () => {
		const { dependencies } = createDependencies({
			context: baseContext({ actorName: null }),
		});

		await notifyVideoOwnerInSlack({
			activity: { type: "view", videoId: "video123", actorUserId: null },
			dependencies,
		});

		expect(dependencies.postMessage).toHaveBeenCalledWith({
			token: "xoxb-token",
			channel: "U123",
			text: "👀 *Someone* viewed your recording *Q3 pipeline review*\n<https://record.leadr.co/s/video123|Open recording>",
		});
	});

	it("skips silently when the organization has no Slack installation", async () => {
		const { dependencies, fetchImpl } = createDependencies({
			installations: [],
		});

		await notifyVideoOwnerInSlack({ activity: viewActivity, dependencies });

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it("skips silently when the owner is not in the Slack workspace", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ ok: false, error: "users_not_found" }),
		);
		const { dependencies } = createDependencies({ fetchImpl });

		await notifyVideoOwnerInSlack({ activity: viewActivity, dependencies });

		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(dependencies.postMessage).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it("tries the next workspace when the owner is only in another one", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({ ok: false, error: "users_not_found" }),
			)
			.mockResolvedValueOnce(jsonResponse({ ok: true, user: { id: "U999" } }))
			.mockResolvedValueOnce(jsonResponse({ ok: true }));
		const { dependencies } = createDependencies({
			fetchImpl,
			installations: [
				installation({ accessToken: "xoxb-first" }),
				installation({ accessToken: "xoxb-second" }),
			],
		});

		await notifyVideoOwnerInSlack({ activity: viewActivity, dependencies });

		expect(dependencies.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ token: "xoxb-second", channel: "U999" }),
		);
	});

	it("never DMs owners about their own views or comments", async () => {
		const { dependencies, fetchImpl } = createDependencies();

		await notifyVideoOwnerInSlack({
			activity: { ...commentActivity, actorUserId: "owner" },
			dependencies,
		});
		await notifyVideoOwnerInSlack({
			activity: { ...viewActivity, actorUserId: "owner" },
			dependencies,
		});

		expect(dependencies.listInstallations).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: "comments are paused",
			activity: commentActivity,
			notifications: { pauseComments: true },
		},
		{
			name: "views are paused",
			activity: viewActivity,
			notifications: { pauseViews: true },
		},
		{
			name: "anonymous views are paused",
			activity: {
				type: "view",
				videoId: "video123",
				actorUserId: null,
			} satisfies SlackActivity,
			notifications: { pauseAnonViews: true },
		},
	])(
		"respects the owner's preferences when $name",
		async ({ activity, notifications }) => {
			const { dependencies, fetchImpl } = createDependencies({
				context: baseContext({
					preferences: {
						notifications: {
							pauseComments: false,
							pauseReplies: false,
							pauseViews: false,
							pauseReactions: false,
							...notifications,
						},
					},
				}),
			});

			await notifyVideoOwnerInSlack({ activity, dependencies });

			expect(dependencies.listInstallations).not.toHaveBeenCalled();
			expect(fetchImpl).not.toHaveBeenCalled();
		},
	);

	it("skips installations missing DM scopes and warns once per workspace", async () => {
		const legacyInstallation = installation({
			scopes: ["links:read", "links:write", "links.embed:write"],
		});
		const { dependencies, fetchImpl } = createDependencies({
			installations: [legacyInstallation],
		});

		await notifyVideoOwnerInSlack({ activity: viewActivity, dependencies });
		await notifyVideoOwnerInSlack({ activity: commentActivity, dependencies });

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledOnce();
		expect(String(warn.mock.calls[0]?.[0])).toContain(
			`${legacyInstallation.teamId} must be reconnected to grant chat:write, users:read, users:read.email`,
		);
	});

	it("treats a Slack missing_scope error as a reconnect signal", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ ok: false, error: "missing_scope" }),
		);
		const { dependencies } = createDependencies({ fetchImpl });

		await expect(
			notifyVideoOwnerInSlack({ activity: viewActivity, dependencies }),
		).resolves.toBeUndefined();
		await notifyVideoOwnerInSlack({ activity: viewActivity, dependencies });

		expect(warn).toHaveBeenCalledOnce();
		expect(error).not.toHaveBeenCalled();
		expect(dependencies.postMessage).not.toHaveBeenCalled();
	});

	it("never throws when Slack or the database fails", async () => {
		const failingSlack = createDependencies({
			fetchImpl: vi.fn(async () =>
				jsonResponse({ ok: false, error: "invalid_auth" }, 200),
			),
		});
		await expect(
			notifyVideoOwnerInSlack({
				activity: viewActivity,
				dependencies: failingSlack.dependencies,
			}),
		).resolves.toBeUndefined();

		const failingPost = createDependencies();
		failingPost.dependencies.postMessage.mockRejectedValue(
			new SlackApiError("chat.postMessage", "channel_not_found"),
		);
		await expect(
			notifyVideoOwnerInSlack({
				activity: commentActivity,
				dependencies: failingPost.dependencies,
			}),
		).resolves.toBeUndefined();

		const failingNetwork = createDependencies({
			fetchImpl: vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		});
		await expect(
			notifyVideoOwnerInSlack({
				activity: viewActivity,
				dependencies: failingNetwork.dependencies,
			}),
		).resolves.toBeUndefined();

		const failingDatabase = createDependencies();
		failingDatabase.dependencies.loadContext.mockRejectedValue(
			new Error("database unavailable"),
		);
		await expect(
			notifyVideoOwnerInSlack({
				activity: viewActivity,
				dependencies: failingDatabase.dependencies,
			}),
		).resolves.toBeUndefined();

		expect(error).toHaveBeenCalledTimes(4);
	});

	it("skips when the recording no longer exists", async () => {
		const { dependencies, fetchImpl } = createDependencies({ context: null });

		await notifyVideoOwnerInSlack({ activity: viewActivity, dependencies });

		expect(dependencies.listInstallations).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe("Slack activity message", () => {
	it("escapes Slack control characters and trims long comments", () => {
		const text = buildSlackActivityMessage({
			activity: {
				...commentActivity,
				content: `<!channel> ${"a".repeat(200)}`,
			},
			actorName: "Sam & <Co>",
			videoName: "  ",
			webUrl: "https://record.leadr.co",
		});

		expect(text).toContain("*Sam &amp; &lt;Co&gt;*");
		expect(text).toContain("*Untitled recording*");
		expect(text).not.toContain("<!channel>");
		const snippet = text.slice(text.indexOf("“") + 1, text.indexOf("”"));
		expect(snippet.endsWith("…")).toBe(true);
		expect(
			Array.from(snippet.replace("&lt;", "<").replace("&gt;", ">")),
		).toHaveLength(140);
	});
});
