import { Organisation } from "@cap/web-domain";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendOrganizationInvites } from "@/actions/organization/send-invites";

const mocks = vi.hoisted(() => ({
	sendEmail: vi.fn(),
	insert: vi.fn(),
	delete: vi.fn(),
	sequence: 0,
	existingInvites: [] as { id: string; invitedEmail: string }[],
	existingMembers: [] as { email: string }[],
}));

vi.mock("@cap/database/auth/session", () => ({
	getCurrentUser: async () => ({ id: "user-1" }),
}));
vi.mock("@cap/database/emails/config", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@cap/database/emails/organization-invite", () => ({
	OrganizationInvite: (props: unknown) => props,
}));
vi.mock("@cap/database/helpers", () => ({
	nanoIdLength: 15,
	nanoId: () => `invite-${++mocks.sequence}`,
}));
vi.mock("@cap/env", () => ({
	serverEnv: () => ({ WEB_URL: "https://cap.example" }),
}));
vi.mock("@/lib/organization-provisioning", () => ({
	provisionOrganizationInvitee: vi.fn(),
}));
vi.mock("@/actions/organization/authorization", () => ({
	requireOrganizationSettingsManager: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@cap/database", () => {
	const tx = {
		select: () => ({
			from: () => ({
				where: async () => mocks.existingInvites,
				innerJoin: () => ({ where: async () => mocks.existingMembers }),
			}),
		}),
		insert: () => ({ values: mocks.insert }),
	};
	return {
		db: () => ({
			select: () => ({
				from: () => ({ where: async () => [{ id: "org-1", name: "Team" }] }),
			}),
			transaction: async (callback: (value: typeof tx) => Promise<unknown>) =>
				callback(tx),
			delete: () => ({ where: mocks.delete }),
		}),
	};
});

describe("organization invite delivery", () => {
	beforeEach(() => {
		mocks.sequence = 0;
		mocks.sendEmail.mockReset();
		mocks.insert.mockReset();
		mocks.delete.mockReset();
		mocks.existingInvites = [];
		mocks.existingMembers = [];
	});

	it("preserves skipped invite records and reports them separately", async () => {
		mocks.sendEmail.mockResolvedValue({
			error: { name: "email_not_configured" },
		});
		const result = await sendOrganizationInvites(
			["person@example.com"],
			Organisation.OrganisationId.make("org-1"),
		);
		expect(result).toMatchObject({
			failedEmails: [],
			skippedEmails: ["person@example.com"],
		});
		expect(mocks.insert).toHaveBeenCalledWith([
			expect.objectContaining({
				id: "invite-1",
				invitedEmail: "person@example.com",
			}),
		]);
		expect(mocks.delete).not.toHaveBeenCalled();
	});

	it("cleans up only failed deliveries in a mixed batch", async () => {
		mocks.sendEmail
			.mockResolvedValueOnce({ error: { name: "email_not_configured" } })
			.mockResolvedValueOnce({ error: { name: "validation_error" } })
			.mockResolvedValueOnce({ data: { id: "sent" }, error: null });
		const result = await sendOrganizationInvites(
			["skipped@example.com", "failed@example.com", "sent@example.com"],
			Organisation.OrganisationId.make("org-1"),
		);
		expect(result).toMatchObject({
			failedEmails: ["failed@example.com"],
			skippedEmails: ["skipped@example.com"],
		});
		const condition = mocks.delete.mock.calls[0]?.[0] as SQL;
		expect(new MySqlDialect().sqlToQuery(condition).params).toEqual([
			"invite-2",
		]);
	});

	it("resends an existing pending invite with its original link", async () => {
		mocks.existingInvites = [
			{ id: "existing-invite", invitedEmail: "pending@example.com" },
		];
		mocks.sendEmail.mockResolvedValue({ data: { id: "sent" }, error: null });
		const result = await sendOrganizationInvites(
			["Pending@Example.com"],
			Organisation.OrganisationId.make("org-1"),
		);
		expect(result).toMatchObject({ failedEmails: [], skippedEmails: [] });
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "pending@example.com",
				react: expect.objectContaining({
					url: "https://cap.example/invite/existing-invite",
				}),
			}),
		);
	});

	it("emails existing members a dashboard link without creating an invite", async () => {
		mocks.existingMembers = [{ email: "member@example.com" }];
		mocks.sendEmail.mockResolvedValue({ data: { id: "sent" }, error: null });
		await sendOrganizationInvites(
			["member@example.com"],
			Organisation.OrganisationId.make("org-1"),
		);
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.sendEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				email: "member@example.com",
				react: expect.objectContaining({
					url: "https://cap.example/dashboard",
				}),
			}),
		);
	});

	it("never deletes an existing invite when resending it fails", async () => {
		mocks.existingInvites = [
			{ id: "existing-invite", invitedEmail: "pending@example.com" },
		];
		mocks.sendEmail.mockResolvedValue({ error: { name: "validation_error" } });
		const result = await sendOrganizationInvites(
			["pending@example.com"],
			Organisation.OrganisationId.make("org-1"),
		);
		expect(result.failedEmails).toEqual(["pending@example.com"]);
		expect(mocks.delete).not.toHaveBeenCalled();
	});
});
