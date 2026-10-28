// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/app/(org)/dashboard/caps/components/web-recorder-dialog/SettingsPanel";

vi.mock("@cap/ui", () => ({ Switch: () => null }));

let container: HTMLDivElement;
let root: Root;

const render = (props: Partial<Parameters<typeof SettingsPanel>[0]> = {}) => {
	const onRecordingQualityChange = vi.fn();
	act(() => {
		root.render(
			createElement(SettingsPanel, {
				open: true,
				rememberDevices: false,
				recordingQuality: "auto",
				onClose: vi.fn(),
				onRememberDevicesChange: vi.fn(),
				onRecordingQualityChange,
				...props,
			}),
		);
	});
	return { onRecordingQualityChange };
};

const qualityButtons = () =>
	Array.from(
		container.querySelectorAll<HTMLButtonElement>(
			'fieldset[aria-label="Recording quality"] button',
		),
	);

describe("web recorder quality setting", () => {
	beforeEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("offers Auto, 4K, 1440p and 1080p with the current choice pressed", () => {
		render({ recordingQuality: "1440p" });

		expect(qualityButtons().map((button) => button.textContent)).toEqual([
			"Auto",
			"4K",
			"1440p",
			"1080p",
		]);
		expect(
			qualityButtons().map((button) => button.getAttribute("aria-pressed")),
		).toEqual(["false", "false", "true", "false"]);
	});

	it("reports the chosen quality", () => {
		const { onRecordingQualityChange } = render();

		act(() => qualityButtons()[1]?.click());

		expect(onRecordingQualityChange).toHaveBeenCalledWith("2160p");
	});

	it("locks the choice while a recording is in progress", () => {
		render({ qualityLocked: true });

		expect(qualityButtons().every((button) => button.disabled)).toBe(true);
	});
});
