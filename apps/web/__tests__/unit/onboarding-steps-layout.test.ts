import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	locked: true,
	nextCookie: undefined as string | undefined,
	redirect: vi.fn((url: string): never => {
		throw new Error(`redirect:${url}`);
	}),
}));

vi.mock("@cap/database/auth/session", () => ({
	getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@cap/database/auth/new-user-organization", () => ({
	isOrganizationCreationLocked: () => mocks.locked,
}));
vi.mock("@cap/env", () => ({
	serverEnv: () => ({ WEB_URL: "https://record.test" }),
}));
vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (name: string) =>
			name === "cap_onboarding_next" && mocks.nextCookie !== undefined
				? { value: mocks.nextCookie }
				: undefined,
	}),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const renderStep = async (step: string) => {
	const { default: OnboardingStepLayout } = await import(
		"@/app/(org)/onboarding/[...steps]/layout"
	);
	return OnboardingStepLayout({
		children: "step-content",
		params: Promise.resolve({ steps: [step] }),
	});
};

describe("onboarding steps with one shared organization", () => {
	beforeEach(() => {
		mocks.locked = true;
		mocks.nextCookie = undefined;
	});

	it("shows the welcome step to a user without a name", async () => {
		mocks.getCurrentUser.mockResolvedValue({ name: null, onboardingSteps: {} });

		await expect(renderStep("welcome")).resolves.toBe("step-content");
	});

	it("sends a nameless user on any other step back to welcome", async () => {
		mocks.getCurrentUser.mockResolvedValue({ name: null, onboardingSteps: {} });

		await expect(renderStep("organization-setup")).rejects.toThrow(
			"redirect:/onboarding/welcome",
		);
	});

	it("skips organization, domain, invite and download steps after welcome", async () => {
		mocks.getCurrentUser.mockResolvedValue({
			name: "Rep",
			onboardingSteps: { welcome: true },
		});

		for (const step of ["organization-setup", "custom-domain", "download"]) {
			await expect(renderStep(step)).rejects.toThrow(
				"redirect:/dashboard/caps",
			);
		}
	});

	it("returns to the page the user was heading to", async () => {
		mocks.getCurrentUser.mockResolvedValue({
			name: "Rep",
			onboardingSteps: { welcome: true },
		});
		mocks.nextCookie = "/s/video-1";

		await expect(renderStep("organization-setup")).rejects.toThrow(
			"redirect:/s/video-1",
		);
	});

	it("ignores a next path on another origin", async () => {
		mocks.getCurrentUser.mockResolvedValue({
			name: "Rep",
			onboardingSteps: { welcome: true },
		});
		mocks.nextCookie = "https://evil.example/phish";

		await expect(renderStep("organization-setup")).rejects.toThrow(
			"redirect:/dashboard/caps",
		);
	});

	it("keeps every step when organizations are not locked", async () => {
		mocks.locked = false;
		mocks.getCurrentUser.mockResolvedValue({
			name: "Rep",
			onboardingSteps: { welcome: true },
		});

		await expect(renderStep("organization-setup")).resolves.toBe(
			"step-content",
		);
	});
});
