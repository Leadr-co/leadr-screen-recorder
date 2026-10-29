// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getBugReport: vi.fn(),
	generateBugReport: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/videos/bug-report", () => ({
	getBugReport: mocks.getBugReport,
	generateBugReport: mocks.generateBugReport,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@cap/ui", () => ({
	Button: ({ children, ...props }: Record<string, unknown>) =>
		createElement("button", { type: "button", ...props }, children as never),
}));

import type { Video } from "@cap/web-domain";
import { BugReportPanel } from "@/app/s/[videoId]/_components/tabs/BugReport";

const report = {
	title: "Send button stays grey",
	summary: "The Send button never enables.",
	steps: [{ atSeconds: 75, text: "Open the sequence" }],
	expected: "Send enables",
	actual: "It stays grey",
	details: ["Sequence #12"],
	openQuestions: [],
	generatedAt: "2026-10-29T00:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

const flush = () => act(async () => {});

const render = async (onSeek = vi.fn()) => {
	await act(async () => {
		root.render(
			createElement(BugReportPanel, {
				videoId: "video-1" as Video.VideoId,
				transcriptionStatus: "COMPLETE",
				onSeek,
			}),
		);
	});
	await flush();
	return onSeek;
};

const button = (label: string) =>
	Array.from(container.querySelectorAll("button")).find((element) =>
		element.textContent?.includes(label),
	);

describe("bug report panel", () => {
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

	it("renders nothing for viewers who can't create one and none exists", async () => {
		mocks.getBugReport.mockResolvedValue({
			report: null,
			markdown: null,
			canGenerate: false,
		});

		await render();

		expect(container.textContent).toBe("");
	});

	it("creates a report on request and shows it", async () => {
		mocks.getBugReport.mockResolvedValue({
			report: null,
			markdown: null,
			canGenerate: true,
		});
		mocks.generateBugReport.mockResolvedValue({
			success: true,
			report,
			markdown: "## Send button stays grey",
		});

		await render();
		await act(async () => button("Create bug report")?.click());
		await flush();

		expect(mocks.generateBugReport).toHaveBeenCalledWith("video-1");
		expect(container.textContent).toContain("Send button stays grey");
		expect(container.textContent).toContain("Sequence #12");
		expect(container.textContent).toContain("Not stated in the recording.");
	});

	it("shows the error when generation fails", async () => {
		mocks.getBugReport.mockResolvedValue({
			report: null,
			markdown: null,
			canGenerate: true,
		});
		mocks.generateBugReport.mockResolvedValue({
			success: false,
			message: "The transcript isn't ready yet. Try again in a minute.",
		});

		await render();
		await act(async () => button("Create bug report")?.click());
		await flush();

		expect(container.textContent).toContain("The transcript isn't ready yet");
	});

	it("seeks to a step and copies the ticket text", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		mocks.getBugReport.mockResolvedValue({
			report,
			markdown: "## Send button stays grey",
			canGenerate: false,
		});

		const onSeek = await render();
		await act(async () => button("1:15")?.click());
		await act(async () => button("Copy for ticket")?.click());

		expect(onSeek).toHaveBeenCalledWith(75);
		expect(writeText).toHaveBeenCalledWith("## Send button stays grey");
		expect(mocks.toast.success).toHaveBeenCalled();
		expect(button("Regenerate")).toBeUndefined();
	});
});
