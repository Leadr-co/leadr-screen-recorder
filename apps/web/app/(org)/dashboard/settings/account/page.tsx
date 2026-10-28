import { getCurrentUser } from "@cap/database/auth/session";
import type { Metadata } from "next";
import { getOrganizationAccess } from "@/actions/organization/authorization";
import { canViewOrganizationSettings } from "@/lib/permissions/roles";
import { CliApiKeys } from "./components/CliApiKeys";
import { Settings } from "./Settings";
import { listCliApiKeys } from "./server";

export const metadata: Metadata = {
	title: "Settings — LEADR Screen Recorder",
};

const canSeeCliAccess = async () => {
	const user = await getCurrentUser();
	if (!user?.activeOrganizationId) return false;
	const access = await getOrganizationAccess(
		user.id,
		user.activeOrganizationId,
	).catch(() => null);
	return canViewOrganizationSettings(access?.role);
};

export default async function SettingsPage() {
	// CLI keys are a developer tool; members only get their profile settings.
	if (!(await canSeeCliAccess())) return <Settings />;

	// A failed key query must not 500 the whole settings page, but it also must not render as
	// an empty list, which would hide still-active keys the user may need to revoke.
	const cliApiKeys = await listCliApiKeys().catch(() => null);
	return (
		<>
			<Settings />
			<CliApiKeys
				initialKeys={cliApiKeys ?? []}
				loadFailed={cliApiKeys === null}
			/>
		</>
	);
}
