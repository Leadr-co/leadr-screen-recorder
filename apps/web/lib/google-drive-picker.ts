"use client";

type PickerDocument = { id?: string; name?: string; mimeType?: string };
type PickerResponse = { action?: string; docs?: PickerDocument[] };

type PickerBuilder = {
	addView(view: unknown): PickerBuilder;
	enableFeature(feature: unknown): PickerBuilder;
	setOAuthToken(token: string): PickerBuilder;
	setDeveloperKey(key: string): PickerBuilder;
	setAppId(appId: string): PickerBuilder;
	setTitle(title: string): PickerBuilder;
	setCallback(callback: (response: PickerResponse) => void): PickerBuilder;
	build(): { setVisible(visible: boolean): void };
};

type DocsView = {
	setIncludeFolders(include: boolean): DocsView;
	setSelectFolderEnabled(enabled: boolean): DocsView;
	setMimeTypes(mimeTypes: string): DocsView;
	setEnableDrives(enabled: boolean): DocsView;
};

type GooglePickerNamespace = {
	DocsView: new (viewId?: unknown) => DocsView;
	PickerBuilder: new () => PickerBuilder;
	ViewId: { FOLDERS: unknown };
	Feature: { SUPPORT_DRIVES: unknown };
	Action: { PICKED: string; CANCEL: string };
};

declare global {
	interface Window {
		gapi?: { load(name: string, callback: () => void): void };
		google?: { picker?: GooglePickerNamespace };
	}
}

const GOOGLE_API_SCRIPT = "https://apis.google.com/js/api.js";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

let pickerLoad: Promise<GooglePickerNamespace> | null = null;

const loadPicker = () => {
	pickerLoad ??= new Promise<GooglePickerNamespace>((resolve, reject) => {
		const ready = () =>
			window.gapi?.load("picker", () => {
				const picker = window.google?.picker;
				if (picker) resolve(picker);
				else reject(new Error("Google Picker failed to load"));
			});

		if (window.gapi) {
			ready();
			return;
		}

		const script = document.createElement("script");
		script.src = GOOGLE_API_SCRIPT;
		script.async = true;
		script.onload = ready;
		script.onerror = () => reject(new Error("Could not load Google Picker"));
		document.head.appendChild(script);
	}).catch((error: unknown) => {
		pickerLoad = null;
		throw error;
	});
	return pickerLoad;
};

// OAuth client IDs start with the Cloud project number, which the Picker
// needs as its app ID to grant drive.file access to the picked folder.
export const getGoogleCloudProjectNumber = (clientId: string | null) =>
	clientId?.match(/^(\d+)-/)?.[1] ?? null;

export async function pickGoogleDriveFolder({
	accessToken,
	apiKey,
	clientId,
}: {
	accessToken: string;
	apiKey: string;
	clientId: string | null;
}): Promise<{ id: string; name: string } | null> {
	const picker = await loadPicker();
	const appId = getGoogleCloudProjectNumber(clientId);

	return new Promise((resolve) => {
		const view = new picker.DocsView(picker.ViewId.FOLDERS)
			.setIncludeFolders(true)
			.setSelectFolderEnabled(true)
			.setMimeTypes(FOLDER_MIME_TYPE)
			.setEnableDrives(true);

		let builder = new picker.PickerBuilder()
			.addView(view)
			.enableFeature(picker.Feature.SUPPORT_DRIVES)
			.setOAuthToken(accessToken)
			.setDeveloperKey(apiKey)
			.setTitle("Choose the folder for recordings")
			.setCallback((response) => {
				if (response.action === picker.Action.PICKED) {
					const folder = response.docs?.[0];
					resolve(
						folder?.id
							? { id: folder.id, name: folder.name ?? "Folder" }
							: null,
					);
				} else if (response.action === picker.Action.CANCEL) {
					resolve(null);
				}
			});
		if (appId) builder = builder.setAppId(appId);
		builder.build().setVisible(true);
	});
}
