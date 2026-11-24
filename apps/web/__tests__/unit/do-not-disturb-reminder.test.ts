// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DND_REMINDER_DISMISSED_KEY,
	DoNotDisturbReminder,
	detectPlatform,
} from "@/app/(org)/dashboard/caps/components/web-recorder-dialog/DoNotDisturbReminder";

const nav = (fields: Record<string, unknown>) => fields as unknown as Navigator;

let container: HTMLDivElement;
let root: Root;

const render = async (visible = true, onSwitchToWindow = vi.fn()) => {
	await act(async () => {
		root.render(
			createElement(DoNotDisturbReminder, { visible, onSwitchToWindow }),
		);
	});
	return onSwitchToWindow;
};

const button = (label: string) =>
	Array.from(container.querySelectorAll("button")).find(
		(element) => element.textContent === label,
	);

describe("detectPlatform", () => {
	it("recognises Mac, Windows and Chromebook from any navigator hint", () => {
		expect(detectPlatform(nav({ platform: "MacIntel", userAgent: "" }))).toBe(
			"mac",
		);
		expect(
			detectPlatform(
				nav({ userAgentData: { platform: "Windows" }, userAgent: "" }),
			),
		).toBe("windows");
		expect(
			detectPlatform(
				nav({
					platform: "",
					userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)",
				}),
			),
		).toBe("chromeos");
		expect(
			detectPlatform(nav({ platform: "Linux x86_64", userAgent: "" })),
		).toBe("other");
	});
});

describe("Do Not Disturb reminder", () => {
	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("warns that pop-ups will be recorded and says how to silence them", async () => {
		await render();

		expect(container.textContent).toContain(
			"Pop-up notifications will show in your recording.",
		);
		expect(container.textContent).toMatch(/Do Not Disturb|Do not disturb/);
	});

	it("stays hidden when the mode doesn't capture the whole screen", async () => {
		await render(false);

		expect(container.textContent).toBe("");
	});

	it("offers a one-click switch to recording a window", async () => {
		const onSwitchToWindow = await render();

		await act(async () => button("Record a window instead")?.click());

		expect(onSwitchToWindow).toHaveBeenCalledTimes(1);
	});

	it("remembers 'Don't show again' across recordings", async () => {
		await render();
		await act(async () => button("Don't show again")?.click());

		expect(container.textContent).toBe("");
		expect(window.localStorage.getItem(DND_REMINDER_DISMISSED_KEY)).toBe(
			"true",
		);

		act(() => root.unmount());
		root = createRoot(container);
		await render();
		expect(container.textContent).toBe("");
	});
});
