import { isOrganizationCreationLocked } from "@cap/database/auth/new-user-organization";
import { getCurrentUser } from "@cap/database/auth/session";
import { serverEnv } from "@cap/env";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSafeNextPath } from "../../safe-next";

export default async function OnboardingStepLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ steps: string[] }>;
}) {
	const user = await getCurrentUser();

	if (!user) {
		redirect("/login");
	}

	const steps = user.onboardingSteps || {};
	const currentStep = (await params).steps?.[0] ?? "welcome";

	// Everyone joins the shared organization, so only the name step applies.
	if (isOrganizationCreationLocked()) {
		if (!steps.welcome || !user.name) {
			if (currentStep !== "welcome") redirect("/onboarding/welcome");
			return children;
		}
		const next = (await cookies()).get("cap_onboarding_next")?.value;
		const path = next ? getSafeNextPath(next, serverEnv().WEB_URL) : null;
		redirect(path && path !== "/dashboard" ? path : "/dashboard/caps");
	}

	const ordered = [
		"welcome",
		"organization-setup",
		"custom-domain",
		"invite-team",
		"download",
	] as const;
	const isComplete = (s: (typeof ordered)[number]) =>
		s === "welcome"
			? Boolean(steps.welcome && user.name)
			: s === "organization-setup"
				? Boolean(steps.organizationSetup)
				: s === "custom-domain"
					? Boolean(steps.customDomain)
					: s === "invite-team"
						? Boolean(steps.inviteTeam)
						: Boolean(steps.download);

	const firstIncomplete = ordered.find((s) => !isComplete(s)) ?? "download";

	if (currentStep !== firstIncomplete) {
		redirect(`/onboarding/${firstIncomplete}`);
	}

	return children;
}
