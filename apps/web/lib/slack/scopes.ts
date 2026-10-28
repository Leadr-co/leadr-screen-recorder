export const SLACK_UNFURL_SCOPES = [
	"links:read",
	"links:write",
	"links.embed:write",
] as const;

export const SLACK_DIRECT_MESSAGE_SCOPES = [
	"chat:write",
	"users:read",
	"users:read.email",
] as const;

export const SLACK_BOT_SCOPES = [
	...SLACK_UNFURL_SCOPES,
	...SLACK_DIRECT_MESSAGE_SCOPES,
] as const;

export const parseSlackScopes = (value: unknown): string[] => {
	if (typeof value === "string") {
		return value
			.split(",")
			.map((scope) => scope.trim())
			.filter(Boolean);
	}
	if (Array.isArray(value)) {
		return value.filter(
			(scope): scope is string => typeof scope === "string" && scope !== "",
		);
	}
	return [];
};

export const missingSlackDirectMessageScopes = (grantedScopes: string[]) =>
	SLACK_DIRECT_MESSAGE_SCOPES.filter((scope) => !grantedScopes.includes(scope));
