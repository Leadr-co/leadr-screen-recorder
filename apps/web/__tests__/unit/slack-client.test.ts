import { describe, expect, it, vi } from "vitest";
import {
	buildSlackInstallUrl,
	exchangeSlackOAuthCode,
	lookupSlackUserIdByEmail,
	postSlackMessage,
	SLACK_BOT_SCOPES,
	SlackApiError,
	type SlackUnfurlError,
	sendSlackUnfurl,
} from "@/lib/slack/client";

const config = {
	clientId: "client-id",
	clientSecret: "client-secret",
	signingSecret: "signing-secret",
	redirectUrl: "https://cap.so/api/integrations/slack/callback",
};

const slackResponse = (scope = SLACK_BOT_SCOPES.join(",")) =>
	new Response(
		JSON.stringify({
			ok: true,
			access_token: "xoxb-token",
			scope,
			bot_user_id: "B123",
			team: {
				id: "T123",
				name: "Cap",
			},
			enterprise: null,
		}),
		{
			status: 200,
			headers: { "Content-Type": "application/json" },
		},
	);

describe("Slack API client", () => {
	it("builds an install URL with only the required bot scopes", () => {
		const url = new URL(
			buildSlackInstallUrl({ config, state: "signed-state" }),
		);

		expect(url.origin).toBe("https://slack.com");
		expect(url.pathname).toBe("/oauth/v2/authorize");
		expect(url.searchParams.get("client_id")).toBe("client-id");
		expect(url.searchParams.get("scope")).toBe(SLACK_BOT_SCOPES.join(","));
		expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUrl);
		expect(url.searchParams.get("state")).toBe("signed-state");
	});

	it("accepts a complete OAuth response and preserves the workspace identity", async () => {
		const fetchImpl = vi.fn(async () => slackResponse());
		const result = await exchangeSlackOAuthCode({
			code: "oauth-code",
			config,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(result).toEqual({
			accessToken: "xoxb-token",
			scope: SLACK_BOT_SCOPES.join(","),
			botUserId: "B123",
			teamId: "T123",
			teamName: "Cap",
			enterpriseId: null,
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("rejects OAuth responses that omit a required unfurl scope", async () => {
		const fetchImpl = vi.fn(async () =>
			slackResponse("links:read,links:write"),
		);

		await expect(
			exchangeSlackOAuthCode({
				code: "oauth-code",
				config,
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow("missing required unfurl scopes");
	});

	it("requests DM scopes but still accepts installs that only granted unfurl scopes", async () => {
		expect(SLACK_BOT_SCOPES).toEqual([
			"links:read",
			"links:write",
			"links.embed:write",
			"chat:write",
			"users:read",
			"users:read.email",
		]);
		const fetchImpl = vi.fn(async () =>
			slackResponse("links:read,links:write,links.embed:write"),
		);

		await expect(
			exchangeSlackOAuthCode({
				code: "oauth-code",
				config,
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).resolves.toMatchObject({
			scope: "links:read,links:write,links.embed:write",
		});
	});

	it("resolves Slack users by email and treats unknown or inactive users as absent", async () => {
		const respond = (body: unknown) =>
			vi.fn(
				async () =>
					new Response(JSON.stringify(body), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
			);
		const found = respond({ ok: true, user: { id: "U123" } });
		await expect(
			lookupSlackUserIdByEmail({
				token: "xoxb-token",
				email: "owner+demo@leadr.co",
				fetchImpl: found as unknown as typeof fetch,
			}),
		).resolves.toBe("U123");
		expect(found).toHaveBeenCalledWith(
			"https://slack.com/api/users.lookupByEmail?email=owner%2Bdemo%40leadr.co",
			expect.objectContaining({
				method: "GET",
				headers: { Authorization: "Bearer xoxb-token" },
			}),
		);

		for (const body of [
			{ ok: false, error: "users_not_found" },
			{ ok: true, user: { id: "U123", deleted: true } },
			{ ok: true, user: { id: "B123", is_bot: true } },
		]) {
			await expect(
				lookupSlackUserIdByEmail({
					token: "xoxb-token",
					email: "owner@leadr.co",
					fetchImpl: respond(body) as unknown as typeof fetch,
				}),
			).resolves.toBeNull();
		}

		await expect(
			lookupSlackUserIdByEmail({
				token: "xoxb-token",
				email: "owner@leadr.co",
				fetchImpl: respond({
					ok: false,
					error: "missing_scope",
				}) as unknown as typeof fetch,
			}),
		).rejects.toMatchObject({ code: "missing_scope" });
	});

	it("posts DMs without unfurling and surfaces Slack errors", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), { status: 200 }),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ ok: false, error: "channel_not_found" }),
					{ status: 200 },
				),
			);

		await postSlackMessage({
			token: "xoxb-token",
			channel: "U123",
			text: "hello",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://slack.com/api/chat.postMessage");
		expect(JSON.parse(String(init.body))).toEqual({
			channel: "U123",
			text: "hello",
			unfurl_links: false,
			unfurl_media: false,
		});

		const failure = postSlackMessage({
			token: "xoxb-token",
			channel: "U123",
			text: "hello",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(failure).rejects.toBeInstanceOf(SlackApiError);
		await expect(failure).rejects.toThrow("channel_not_found");
	});

	it("retries transient unfurl failures with the stable event locator", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
					status: 429,
					headers: {
						"Content-Type": "application/json",
						"Retry-After": "1",
					},
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		const sleepImpl = vi.fn(async () => undefined);

		await sendSlackUnfurl({
			token: "xoxb-token",
			event: {
				channel: "C123",
				messageTs: "123.456",
				unfurlId: "U123",
				source: "conversations_history",
			},
			unfurls: {
				"https://cap.so/s/abc123": {
					blocks: [{ type: "video" }],
				},
			},
			fetchImpl: fetchImpl as unknown as typeof fetch,
			sleepImpl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(sleepImpl).toHaveBeenCalledWith(1000);
		const request = fetchImpl.mock.calls[1]?.[1] as RequestInit;
		expect(JSON.parse(String(request.body))).toMatchObject({
			unfurl_id: "U123",
			source: "conversations_history",
		});
	});

	it("marks exhausted transient failures for durable recovery", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: false, error: "server_error" }), {
					status: 503,
					headers: { "Content-Type": "application/json" },
				}),
		);

		await expect(
			sendSlackUnfurl({
				token: "xoxb-token",
				event: {
					channel: "C123",
					messageTs: "123.456",
				},
				unfurls: {
					"https://cap.so/s/abc123": {
						blocks: [{ type: "video" }],
					},
				},
				fetchImpl: fetchImpl as unknown as typeof fetch,
				sleepImpl: vi.fn(async () => undefined),
			}),
		).rejects.toMatchObject({
			name: "SlackUnfurlError",
			retryable: true,
		} satisfies Partial<SlackUnfurlError>);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it("marks permanent Slack failures as non-retryable", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);

		await expect(
			sendSlackUnfurl({
				token: "xoxb-token",
				event: {
					channel: "C123",
					messageTs: "123.456",
				},
				unfurls: {
					"https://cap.so/s/abc123": {
						blocks: [{ type: "video" }],
					},
				},
				fetchImpl: fetchImpl as unknown as typeof fetch,
				sleepImpl: vi.fn(async () => undefined),
			}),
		).rejects.toMatchObject({
			name: "SlackUnfurlError",
			retryable: false,
		} satisfies Partial<SlackUnfurlError>);
		expect(fetchImpl).toHaveBeenCalledOnce();
	});
});
