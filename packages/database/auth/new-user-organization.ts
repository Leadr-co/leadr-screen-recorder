import { serverEnv } from "@cap/env";
import { Organisation, type User } from "@cap/web-domain";
import { and, eq, isNull } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { nanoId } from "../helpers.ts";
import { organizationMembers, organizations, users } from "../schema.ts";

type Database = Pick<MySql2Database, "insert" | "select" | "update">;

export const PERSONAL_ORGANIZATION_NAME = "My Organization";

export function getDefaultOrganizationId() {
	const id = serverEnv().CAP_DEFAULT_ORGANIZATION_ID?.trim();
	return id ? Organisation.OrganisationId.make(id) : null;
}

export function isOrganizationCreationLocked() {
	return getDefaultOrganizationId() !== null;
}

export async function provisionNewUserOrganization(
	database: Database,
	userId: User.UserId,
): Promise<{ id: Organisation.OrganisationId; name: string }> {
	const defaultOrganizationId = getDefaultOrganizationId();
	let organization: { id: Organisation.OrganisationId; name: string };

	if (defaultOrganizationId) {
		const [existing] = await database
			.select({ id: organizations.id, name: organizations.name })
			.from(organizations)
			.where(
				and(
					eq(organizations.id, defaultOrganizationId),
					isNull(organizations.tombstoneAt),
				),
			)
			.limit(1);
		if (!existing) {
			throw new Error(
				"CAP_DEFAULT_ORGANIZATION_ID does not match an active organization",
			);
		}
		organization = existing;

		const [membership] = await database
			.select({ id: organizationMembers.id })
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.organizationId, defaultOrganizationId),
					eq(organizationMembers.userId, userId),
				),
			)
			.limit(1);
		if (!membership) {
			await database.insert(organizationMembers).values({
				id: nanoId(),
				organizationId: defaultOrganizationId,
				userId,
				role: "member",
			});
		}
	} else {
		organization = {
			id: Organisation.OrganisationId.make(nanoId()),
			name: PERSONAL_ORGANIZATION_NAME,
		};
		await database.insert(organizations).values({
			id: organization.id,
			ownerId: userId,
			name: organization.name,
		});
		await database.insert(organizationMembers).values({
			id: nanoId(),
			organizationId: organization.id,
			userId,
			role: "owner",
		});
	}

	await database
		.update(users)
		.set({
			activeOrganizationId: organization.id,
			defaultOrgId: organization.id,
		})
		.where(eq(users.id, userId));

	return organization;
}
