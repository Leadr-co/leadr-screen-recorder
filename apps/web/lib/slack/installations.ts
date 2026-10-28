import type { Organisation, User } from "@cap/web-domain";
import {
	deleteIntegrationInstallation,
	deleteIntegrationInstallationByExternalId,
	getIntegrationCredentials,
	listIntegrationCredentials,
	listIntegrationInstallations,
	saveIntegrationInstallation,
} from "@/lib/integrations/installations";
import { missingSlackDirectMessageScopes, parseSlackScopes } from "./scopes";

const SLACK_PROVIDER = "slack";

export type SlackInstallationSummary = {
	id: string;
	teamId: string;
	teamName: string;
	missingScopes: string[];
	createdAt: Date;
	updatedAt: Date;
};

export type SlackInstallationAccess = {
	teamId: string;
	accessToken: string;
	scopes: string[];
};

const readAccessToken = (credentials: unknown) => {
	if (
		!credentials ||
		typeof credentials !== "object" ||
		Array.isArray(credentials) ||
		typeof (credentials as { accessToken?: unknown }).accessToken !== "string"
	) {
		throw new Error("Slack installation credentials are invalid");
	}
	return (credentials as { accessToken: string }).accessToken;
};

export const saveSlackInstallation = async ({
	organizationId,
	installedByUserId,
	teamId,
	teamName,
	enterpriseId,
	botUserId,
	accessToken,
	scope,
}: {
	organizationId: Organisation.OrganisationId;
	installedByUserId: User.UserId;
	teamId: string;
	teamName: string;
	enterpriseId: string | null;
	botUserId: string | null;
	accessToken: string;
	scope: string;
}) => {
	await saveIntegrationInstallation({
		provider: SLACK_PROVIDER,
		externalId: teamId,
		displayName: teamName,
		organizationId,
		installedByUserId,
		credentials: { accessToken },
		metadata: {
			enterpriseId,
			botUserId,
			scopes: parseSlackScopes(scope),
		},
	});
};

export const listSlackInstallations = async (
	organizationId: Organisation.OrganisationId,
): Promise<SlackInstallationSummary[]> =>
	listIntegrationInstallations({
		organizationId,
		provider: SLACK_PROVIDER,
	}).then((installations) =>
		installations.map((installation) => ({
			id: installation.id,
			teamId: installation.externalId,
			teamName: installation.displayName,
			missingScopes: missingSlackDirectMessageScopes(
				parseSlackScopes(installation.metadata?.scopes),
			),
			createdAt: installation.createdAt,
			updatedAt: installation.updatedAt,
		})),
	);

export const getSlackInstallationToken = async (teamId: string) => {
	const credentials = await getIntegrationCredentials({
		provider: SLACK_PROVIDER,
		externalId: teamId,
	});
	if (credentials === null) return null;
	return readAccessToken(credentials);
};

export const listSlackInstallationAccess = async (
	organizationId: Organisation.OrganisationId,
): Promise<SlackInstallationAccess[]> =>
	listIntegrationCredentials({
		organizationId,
		provider: SLACK_PROVIDER,
	}).then((installations) =>
		installations.map((installation) => ({
			teamId: installation.externalId,
			accessToken: readAccessToken(installation.credentials),
			scopes: parseSlackScopes(installation.metadata?.scopes),
		})),
	);

export const deleteSlackInstallation = async ({
	organizationId,
	installationId,
}: {
	organizationId: Organisation.OrganisationId;
	installationId: string;
}) => {
	await deleteIntegrationInstallation({
		provider: SLACK_PROVIDER,
		organizationId,
		installationId,
	});
};

export const deleteSlackInstallationByTeamId = async (teamId: string) => {
	await deleteIntegrationInstallationByExternalId({
		provider: SLACK_PROVIDER,
		externalId: teamId,
	});
};
