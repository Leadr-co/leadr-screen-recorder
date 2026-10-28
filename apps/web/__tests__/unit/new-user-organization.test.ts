import { User } from "@cap/web-domain";
import { getTableName, type Table } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	isOrganizationCreationLocked,
	PERSONAL_ORGANIZATION_NAME,
	provisionNewUserOrganization,
} from "../../../../packages/database/auth/new-user-organization";

const env = vi.hoisted(() => ({
	CAP_DEFAULT_ORGANIZATION_ID: undefined as string | undefined,
}));

vi.mock("@cap/env", () => ({ serverEnv: () => env }));

const USER_ID = User.UserId.make("user-1");

function fakeDatabase(selectResults: Record<string, unknown[]>) {
	const inserts: { table: string; values: Record<string, unknown> }[] = [];
	const updates: { table: string; values: Record<string, unknown> }[] = [];
	const database = {
		select: () => ({
			from: (table: Table) => ({
				where: () => ({
					limit: async () => selectResults[getTableName(table)] ?? [],
				}),
			}),
		}),
		insert: (table: Table) => ({
			values: async (values: Record<string, unknown>) => {
				inserts.push({ table: getTableName(table), values });
			},
		}),
		update: (table: Table) => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					updates.push({ table: getTableName(table), values });
				},
			}),
		}),
	};
	return {
		database: database as unknown as Pick<
			MySql2Database,
			"insert" | "select" | "update"
		>,
		inserts,
		updates,
	};
}

describe("provisionNewUserOrganization", () => {
	beforeEach(() => {
		env.CAP_DEFAULT_ORGANIZATION_ID = undefined;
	});

	it("creates a personal organization owned by the user when no default is set", async () => {
		const { database, inserts, updates } = fakeDatabase({});

		const organization = await provisionNewUserOrganization(database, USER_ID);

		expect(organization.name).toBe(PERSONAL_ORGANIZATION_NAME);
		expect(inserts).toEqual([
			{
				table: "organizations",
				values: expect.objectContaining({
					id: organization.id,
					ownerId: USER_ID,
				}),
			},
			{
				table: "organization_members",
				values: expect.objectContaining({
					organizationId: organization.id,
					userId: USER_ID,
					role: "owner",
				}),
			},
		]);
		expect(updates).toEqual([
			{
				table: "users",
				values: {
					activeOrganizationId: organization.id,
					defaultOrgId: organization.id,
				},
			},
		]);
	});

	it("adds the user to the default organization as a member", async () => {
		env.CAP_DEFAULT_ORGANIZATION_ID = " org-leadr ";
		const { database, inserts, updates } = fakeDatabase({
			organizations: [{ id: "org-leadr", name: "LEADR" }],
			organization_members: [],
		});

		const organization = await provisionNewUserOrganization(database, USER_ID);

		expect(organization).toEqual({ id: "org-leadr", name: "LEADR" });
		expect(inserts).toEqual([
			{
				table: "organization_members",
				values: expect.objectContaining({
					organizationId: "org-leadr",
					userId: USER_ID,
					role: "member",
				}),
			},
		]);
		expect(updates).toEqual([
			{
				table: "users",
				values: {
					activeOrganizationId: "org-leadr",
					defaultOrgId: "org-leadr",
				},
			},
		]);
	});

	it("does not add a second membership when the user already belongs to the default organization", async () => {
		env.CAP_DEFAULT_ORGANIZATION_ID = "org-leadr";
		const { database, inserts, updates } = fakeDatabase({
			organizations: [{ id: "org-leadr", name: "LEADR" }],
			organization_members: [{ id: "membership-1" }],
		});

		await provisionNewUserOrganization(database, USER_ID);

		expect(inserts).toEqual([]);
		expect(updates).toHaveLength(1);
	});

	it("refuses to fall back to a personal organization when the default is missing", async () => {
		env.CAP_DEFAULT_ORGANIZATION_ID = "org-missing";
		const { database, inserts, updates } = fakeDatabase({ organizations: [] });

		await expect(
			provisionNewUserOrganization(database, USER_ID),
		).rejects.toThrow("does not match an active organization");
		expect(inserts).toEqual([]);
		expect(updates).toEqual([]);
	});
});

describe("isOrganizationCreationLocked", () => {
	it("locks organization creation only when a default organization is configured", () => {
		env.CAP_DEFAULT_ORGANIZATION_ID = undefined;
		expect(isOrganizationCreationLocked()).toBe(false);
		env.CAP_DEFAULT_ORGANIZATION_ID = "   ";
		expect(isOrganizationCreationLocked()).toBe(false);
		env.CAP_DEFAULT_ORGANIZATION_ID = "org-leadr";
		expect(isOrganizationCreationLocked()).toBe(true);
	});
});
