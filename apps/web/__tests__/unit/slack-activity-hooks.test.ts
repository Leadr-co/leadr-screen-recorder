import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queueSlack: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@cap/database", async () => {
	const { drizzle } = await import("drizzle-orm/mysql-proxy");
	const client = drizzle(mocks.query);
	return { db: () => client };
});
vi.mock("@cap/database/emails/config", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/slack/activity-notifications", () => ({
	queueSlackActivityNotification: mocks.queueSlack,
}));

import {
	createAnonymousViewNotification,
	createNotification,
} from "@/lib/Notification";

beforeEach(() => {
	mocks.query.mockReset();
	mocks.queueSlack.mockReset();
	mocks.query.mockRejectedValue(new Error("Unexpected query"));
});

describe("Slack activity hooks", () => {
	it("queues a Slack DM for the first signed-in view by a viewer", async () => {
		mocks.query
			.mockResolvedValueOnce({ rows: [["video", "owner"]] })
			.mockResolvedValueOnce({ rows: [["owner", "owner-org", null]] })
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [{ affectedRows: 1, insertId: 0 }] });

		await createNotification({
			type: "view",
			videoId: "video",
			authorId: "viewer",
		});

		expect(mocks.queueSlack).toHaveBeenCalledWith({
			type: "view",
			videoId: "video",
			actorUserId: "viewer",
		});
	});

	it("reuses the in-app view dedup so repeat views do not DM again", async () => {
		mocks.query
			.mockResolvedValueOnce({ rows: [["video", "owner"]] })
			.mockResolvedValueOnce({ rows: [["owner", "owner-org", null]] })
			.mockResolvedValueOnce({ rows: [["existing-view"]] });

		await createNotification({
			type: "view",
			videoId: "video",
			authorId: "viewer",
		});

		expect(mocks.queueSlack).not.toHaveBeenCalled();
	});

	it("does not queue a DM when the owner muted views", async () => {
		mocks.query
			.mockResolvedValueOnce({ rows: [["video", "owner"]] })
			.mockResolvedValueOnce({
				rows: [["owner", "owner-org", { notifications: { pauseViews: true } }]],
			});

		await createNotification({
			type: "view",
			videoId: "video",
			authorId: "viewer",
		});

		expect(mocks.queueSlack).not.toHaveBeenCalled();
	});

	it("queues a Slack DM with the comment text for a new comment", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		mocks.query
			.mockResolvedValueOnce({ rows: [["video", "owner"]] })
			.mockResolvedValueOnce({ rows: [["owner", "owner-org", null]] })
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [{ affectedRows: 1, insertId: 0 }] });

		await createNotification({
			type: "comment",
			videoId: "video",
			authorId: "viewer",
			comment: { id: "comment", content: "Great demo" },
		});

		expect(mocks.queueSlack).toHaveBeenCalledWith({
			type: "comment",
			videoId: "video",
			actorUserId: "viewer",
			commentId: "comment",
			content: "Great demo",
		});
	});

	it("queues an anonymous view DM only after the deduped notification is stored", async () => {
		mocks.query
			.mockResolvedValueOnce({ rows: [] })
			.mockResolvedValueOnce({ rows: [["video", "owner", "owner-org", null]] })
			.mockResolvedValueOnce({ rows: [[0]] })
			.mockResolvedValueOnce({ rows: [{ affectedRows: 1, insertId: 0 }] });

		await createAnonymousViewNotification({
			videoId: "video",
			sessionId: "session",
			anonName: "Anonymous Otter",
			location: null,
		});

		expect(mocks.queueSlack).toHaveBeenCalledWith({
			type: "view",
			videoId: "video",
			actorUserId: null,
		});

		mocks.queueSlack.mockReset();
		mocks.query.mockReset();
		mocks.query.mockResolvedValueOnce({ rows: [["existing"]] });

		await createAnonymousViewNotification({
			videoId: "video",
			sessionId: "session",
			anonName: "Anonymous Otter",
			location: null,
		});

		expect(mocks.queueSlack).not.toHaveBeenCalled();
	});
});
