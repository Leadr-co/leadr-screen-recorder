// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// The module caches the loaded Picker, so each test needs a fresh copy.
const loadPickerModule = async () => {
	vi.resetModules();
	return import("@/lib/google-drive-picker");
};

const installFakePicker = (response: {
	action: string;
	docs?: Array<{ id?: string; name?: string }>;
}) => {
	const calls: Record<string, unknown[]> = {};
	const record =
		<T>(target: T, name: string) =>
		(...args: unknown[]) => {
			calls[name] = args;
			return target;
		};

	class DocsView {
		setIncludeFolders = record(this, "setIncludeFolders");
		setSelectFolderEnabled = record(this, "setSelectFolderEnabled");
		setMimeTypes = record(this, "setMimeTypes");
		setEnableDrives = record(this, "setEnableDrives");
	}

	class PickerBuilder {
		private callback: ((value: unknown) => void) | null = null;
		addView = record(this, "addView");
		enableFeature = record(this, "enableFeature");
		setOAuthToken = record(this, "setOAuthToken");
		setDeveloperKey = record(this, "setDeveloperKey");
		setAppId = record(this, "setAppId");
		setTitle = record(this, "setTitle");
		setCallback = (callback: (value: unknown) => void) => {
			this.callback = callback;
			return this;
		};
		build = () => ({
			setVisible: () => this.callback?.(response),
		});
	}

	window.google = {
		picker: {
			DocsView,
			PickerBuilder,
			ViewId: { FOLDERS: "folders" },
			Feature: { SUPPORT_DRIVES: "support-drives" },
			Action: { PICKED: "picked", CANCEL: "cancel" },
		} as never,
	};
	window.gapi = { load: (_name, callback) => callback() };
	return calls;
};

describe("Google Drive folder picker", () => {
	afterEach(() => {
		delete window.gapi;
		delete window.google;
	});

	it("reads the Cloud project number from the OAuth client id", async () => {
		const { getGoogleCloudProjectNumber } = await loadPickerModule();
		expect(
			getGoogleCloudProjectNumber(
				"123456789012-abc.apps.googleusercontent.com",
			),
		).toBe("123456789012");
		expect(getGoogleCloudProjectNumber("not-a-client-id")).toBeNull();
		expect(getGoogleCloudProjectNumber(null)).toBeNull();
	});

	it("offers Shared Drive folders and returns the picked one", async () => {
		const { pickGoogleDriveFolder } = await loadPickerModule();
		const calls = installFakePicker({
			action: "picked",
			docs: [{ id: "folder-1", name: "Recordings" }],
		});

		await expect(
			pickGoogleDriveFolder({
				accessToken: "token",
				apiKey: "key",
				clientId: "123456789012-abc.apps.googleusercontent.com",
			}),
		).resolves.toEqual({ id: "folder-1", name: "Recordings" });

		expect(calls.setEnableDrives).toEqual([true]);
		expect(calls.setSelectFolderEnabled).toEqual([true]);
		expect(calls.setMimeTypes).toEqual(["application/vnd.google-apps.folder"]);
		expect(calls.setOAuthToken).toEqual(["token"]);
		expect(calls.setDeveloperKey).toEqual(["key"]);
		expect(calls.setAppId).toEqual(["123456789012"]);
	});

	it("returns null when the picker is cancelled", async () => {
		const { pickGoogleDriveFolder } = await loadPickerModule();
		installFakePicker({ action: "cancel" });

		await expect(
			pickGoogleDriveFolder({ accessToken: "t", apiKey: "k", clientId: null }),
		).resolves.toBeNull();
	});
});
