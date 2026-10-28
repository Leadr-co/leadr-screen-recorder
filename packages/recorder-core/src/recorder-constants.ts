export const NO_MICROPHONE = "No Microphone";
export const NO_MICROPHONE_VALUE = "__no_microphone__";
export const NO_CAMERA = "No Camera";
export const NO_CAMERA_VALUE = "__no_camera__";

// Single source for the capture resolution defaults; consumers that need the
// raw numbers (e.g. fallback stream dimensions) read these instead of
// re-hardcoding them next to the constraints object.
export const DISPLAY_MEDIA_IDEAL = {
	width: 1920,
	height: 1080,
	frameRate: 30,
} as const;

export const DISPLAY_MEDIA_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
	frameRate: { ideal: DISPLAY_MEDIA_IDEAL.frameRate },
	width: { ideal: DISPLAY_MEDIA_IDEAL.width },
	height: { ideal: DISPLAY_MEDIA_IDEAL.height },
};

export type RecordingQuality = "auto" | "2160p" | "1440p" | "1080p";

export const DEFAULT_RECORDING_QUALITY: RecordingQuality = "auto";

export const RECORDING_QUALITY_OPTIONS: ReadonlyArray<{
	value: RecordingQuality;
	label: string;
	maxWidth: number;
	maxHeight: number;
}> = [
	{ value: "auto", label: "Auto", maxWidth: 3840, maxHeight: 2160 },
	{ value: "2160p", label: "4K", maxWidth: 3840, maxHeight: 2160 },
	{ value: "1440p", label: "1440p", maxWidth: 2560, maxHeight: 1440 },
	{ value: "1080p", label: "1080p", maxWidth: 1920, maxHeight: 1080 },
];

export const isRecordingQuality = (value: unknown): value is RecordingQuality =>
	RECORDING_QUALITY_OPTIONS.some((option) => option.value === value);

// Only caps, never ideals: Chrome captures the screen at its native size and
// scales down to fit, so a 1440p monitor on "4K" still records 1440p.
export const displayMediaVideoConstraintsForQuality = (
	quality: RecordingQuality,
): MediaTrackConstraints => {
	const option =
		RECORDING_QUALITY_OPTIONS.find((entry) => entry.value === quality) ??
		RECORDING_QUALITY_OPTIONS[0];
	return {
		frameRate: { ideal: DISPLAY_MEDIA_IDEAL.frameRate },
		width: { max: option.maxWidth },
		height: { max: option.maxHeight },
	};
};

export type ExtendedDisplayMediaStreamOptions = DisplayMediaStreamOptions & {
	monitorTypeSurfaces?: "include" | "exclude";
	surfaceSwitching?: "include" | "exclude";
	selfBrowserSurface?: "include" | "exclude";
	preferCurrentTab?: boolean;
	systemAudio?: "include" | "exclude";
};

export type DetectedDisplayRecordingMode = "fullscreen" | "window" | "tab";

export type DisplaySurfacePreference =
	| "monitor"
	| "window"
	| "browser"
	| "application";

export const DISPLAY_MODE_PREFERENCES: Record<
	DetectedDisplayRecordingMode,
	Partial<ExtendedDisplayMediaStreamOptions>
> = {
	fullscreen: {
		monitorTypeSurfaces: "include",
		selfBrowserSurface: "exclude",
		surfaceSwitching: "exclude",
		preferCurrentTab: false,
	},
	window: {
		monitorTypeSurfaces: "exclude",
		selfBrowserSurface: "exclude",
		surfaceSwitching: "exclude",
		preferCurrentTab: false,
	},
	tab: {
		monitorTypeSurfaces: "exclude",
		selfBrowserSurface: "include",
		surfaceSwitching: "exclude",
		preferCurrentTab: true,
	},
};

export const DISPLAY_SURFACE_TO_RECORDING_MODE: Record<
	string,
	DetectedDisplayRecordingMode
> = {
	monitor: "fullscreen",
	screen: "fullscreen",
	window: "window",
	application: "window",
	browser: "tab",
	tab: "tab",
};

export const RECORDING_MODE_TO_DISPLAY_SURFACE: Record<
	DetectedDisplayRecordingMode,
	DisplaySurfacePreference
> = {
	fullscreen: "monitor",
	window: "window",
	tab: "browser",
};

export const MP4_MIME_TYPES = {
	withAudio: [
		'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
		'video/mp4;codecs="avc1.4d401e,mp4a.40.2"',
	],
	videoOnly: [
		'video/mp4;codecs="avc1.42E01E"',
		'video/mp4;codecs="avc1.4d401e"',
		"video/mp4",
	],
} as const;

export const WEBM_MIME_TYPES = {
	withAudio: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"],
	videoOnly: ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
} as const;

export const DETECTION_RETRY_DELAYS = [120, 450, 1000];
