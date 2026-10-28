"use server";

import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { sendEmail } from "@cap/database/emails/config";
import { OrganizationInvite } from "@cap/database/emails/organization-invite";
import { nanoId } from "@cap/database/helpers";
import {
	organizationInvites,
	organizationMembers,
	organizations,
	users,
} from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import type { Organisation } from "@cap/web-domain";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { provisionOrganizationInvitee } from "@/lib/organization-provisioning";
import {
	type AssignableOrganizationRole,
	normalizeAssignableOrganizationRole,
} from "@/lib/permissions/roles";
import { requireOrganizationSettingsManager } from "./authorization";

type InviteDelivery = {
	email: string;
	inviteId: string | null;
	created: boolean;
	role?: AssignableOrganizationRole;
};

type OrganizationInviteInput = {
	email: string;
	role?: string | null;
};

export async function sendOrganizationInvites(
	inviteInputs: string[] | OrganizationInviteInput[],
	organizationId: Organisation.OrganisationId,
	roleInput = "member",
	options: { sendEmailNotifications?: boolean } = {},
) {
	const user = await getCurrentUser();

	if (!user) {
		throw new Error("Unauthorized");
	}

	const role = normalizeAssignableOrganizationRole(roleInput);
	if (!role) {
		throw new Error("Invalid organization role");
	}

	const [organization] = await db()
		.select()
		.from(organizations)
		.where(eq(organizations.id, organizationId));

	if (!organization) {
		throw new Error("Organization not found");
	}

	await requireOrganizationSettingsManager(user.id, organizationId);

	const MAX_INVITES = 50;
	if (inviteInputs.length > MAX_INVITES) {
		throw new Error(`Cannot send more than ${MAX_INVITES} invites at once`);
	}

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const inviteMap = new Map<string, AssignableOrganizationRole>();

	for (const inviteInput of inviteInputs) {
		const email =
			typeof inviteInput === "string" ? inviteInput : inviteInput.email;
		const normalizedEmail = email.trim().toLowerCase();
		if (!emailRegex.test(normalizedEmail)) continue;

		const inviteRole =
			typeof inviteInput === "string" || !inviteInput.role
				? role
				: normalizeAssignableOrganizationRole(inviteInput.role);

		if (!inviteRole) {
			throw new Error("Invalid organization role");
		}

		inviteMap.set(normalizedEmail, inviteRole);
	}

	const validInvites = Array.from(inviteMap, ([email, inviteRole]) => ({
		email,
		role: inviteRole,
	}));
	const validEmails = validInvites.map((invite) => invite.email);

	if (validEmails.length === 0) {
		return {
			success: true,
			failedEmails: [] as string[],
			skippedEmails: [] as string[],
		};
	}

	if (options.sendEmailNotifications === false) {
		const provisionResults = await Promise.allSettled(
			validInvites.map((invite) =>
				provisionOrganizationInvitee({
					organizationId,
					email: invite.email,
					invitedByUserId: user.id,
					role: invite.role,
				}),
			),
		);
		const failedEmails = validInvites
			.filter((_, index) => provisionResults[index]?.status === "rejected")
			.map((invite) => invite.email);

		revalidatePath("/dashboard/settings/organization");

		return { success: true, failedEmails, skippedEmails: [] as string[] };
	}

	const inviteRecords = await db().transaction(async (tx) => {
		const [existingInvites, existingMembers] = await Promise.all([
			tx
				.select({
					id: organizationInvites.id,
					invitedEmail: organizationInvites.invitedEmail,
				})
				.from(organizationInvites)
				.where(
					and(
						eq(organizationInvites.organizationId, organizationId),
						inArray(organizationInvites.invitedEmail, validEmails),
					),
				),
			tx
				.select({ email: users.email })
				.from(organizationMembers)
				.innerJoin(users, eq(organizationMembers.userId, users.id))
				.where(
					and(
						eq(organizationMembers.organizationId, organizationId),
						inArray(users.email, validEmails),
					),
				),
		]);

		const existingInviteIds = new Map(
			existingInvites.map((i) => [i.invitedEmail.toLowerCase(), i.id]),
		);

		const existingMemberEmails = new Set(
			existingMembers.map((m) => m.email.toLowerCase()),
		);

		const deliveries: InviteDelivery[] = validInvites.map((invite) => {
			if (existingMemberEmails.has(invite.email)) {
				return { email: invite.email, inviteId: null, created: false };
			}
			const existingInviteId = existingInviteIds.get(invite.email);
			if (existingInviteId) {
				return {
					email: invite.email,
					inviteId: existingInviteId,
					created: false,
				};
			}
			return {
				email: invite.email,
				inviteId: nanoId(),
				created: true,
				role: invite.role,
			};
		});

		const newInvites = deliveries.filter((d) => d.created);
		if (newInvites.length > 0) {
			await tx.insert(organizationInvites).values(
				newInvites.map((d) => ({
					id: d.inviteId as string,
					organizationId: organizationId,
					invitedEmail: d.email,
					invitedByUserId: user.id,
					role: d.role ?? role,
				})),
			);
		}

		return deliveries;
	});

	const webUrl = serverEnv().WEB_URL;
	const emailResults = await Promise.allSettled(
		inviteRecords.map((record) =>
			sendEmail({
				email: record.email,
				subject: `Invitation to join ${organization.name} on LEADR Screen Recorder`,
				react: OrganizationInvite({
					email: record.email,
					url: record.inviteId
						? `${webUrl}/invite/${record.inviteId}`
						: `${webUrl}/dashboard`,
					organizationName: organization.name,
				}),
			}),
		),
	);

	const failedInvites = inviteRecords.filter((_, i) => {
		const result = emailResults[i];
		if (!result || result.status === "rejected") return true;
		const error = result.value?.error;
		return Boolean(error && error.name !== "email_not_configured");
	});
	const failedEmails = failedInvites.map((r) => r.email);
	const failedNewInviteIds = failedInvites
		.filter((r) => r.created && r.inviteId)
		.map((r) => r.inviteId as string);
	const skippedEmails = inviteRecords
		.filter((_, i) => {
			const result = emailResults[i];
			return (
				result?.status === "fulfilled" &&
				result.value?.error?.name === "email_not_configured"
			);
		})
		.map((record) => record.email);

	if (failedNewInviteIds.length > 0) {
		try {
			await db()
				.delete(organizationInvites)
				.where(inArray(organizationInvites.id, failedNewInviteIds));
		} catch (cleanupError) {
			console.error(
				"Failed to clean up invite records after email delivery failure:",
				{
					failedInviteIds: failedNewInviteIds,
					failedEmails,
					error: cleanupError,
				},
			);
		}
	}

	revalidatePath("/dashboard/settings/organization");

	return { success: true, failedEmails, skippedEmails };
}
