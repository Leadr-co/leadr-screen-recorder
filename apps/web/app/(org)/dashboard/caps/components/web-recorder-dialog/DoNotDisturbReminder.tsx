"use client";

import { BellOff } from "lucide-react";
import { useEffect, useState } from "react";

export const DND_REMINDER_DISMISSED_KEY =
	"cap-web-recorder-dnd-reminder-dismissed";

type Platform = "mac" | "windows" | "chromeos" | "other";

export const detectPlatform = (nav: Navigator): Platform => {
	const hint = (nav as Navigator & { userAgentData?: { platform?: string } })
		.userAgentData?.platform;
	const value =
		`${hint ?? ""} ${nav.platform ?? ""} ${nav.userAgent ?? ""}`.toLowerCase();
	if (value.includes("cros") || value.includes("chrome os")) return "chromeos";
	if (value.includes("mac")) return "mac";
	if (value.includes("win")) return "windows";
	return "other";
};

const INSTRUCTIONS: Record<Platform, string> = {
	mac: "On your Mac, open Control Center in the menu bar, then Focus, then Do Not Disturb.",
	windows: "On Windows, press Windows + N and turn on Do not disturb.",
	chromeos:
		"On your Chromebook, open Quick Settings and turn on Do not disturb.",
	other: "Turn on your computer's Do Not Disturb mode before you start.",
};

interface DoNotDisturbReminderProps {
	visible: boolean;
	onSwitchToWindow: () => void;
}

// Browsers can't switch on the operating system's Do Not Disturb, so the
// recorder can only remind people that pop-ups land in full-screen recordings.
export const DoNotDisturbReminder = ({
	visible,
	onSwitchToWindow,
}: DoNotDisturbReminderProps) => {
	const [dismissed, setDismissed] = useState(true);
	const [platform, setPlatform] = useState<Platform>("other");

	useEffect(() => {
		setPlatform(detectPlatform(window.navigator));
		try {
			setDismissed(
				window.localStorage.getItem(DND_REMINDER_DISMISSED_KEY) === "true",
			);
		} catch {
			setDismissed(false);
		}
	}, []);

	if (!visible || dismissed) return null;

	const dismiss = () => {
		setDismissed(true);
		try {
			window.localStorage.setItem(DND_REMINDER_DISMISSED_KEY, "true");
		} catch {}
	};

	return (
		<div
			role="note"
			className="flex flex-col gap-1.5 rounded-md border border-gray-4 bg-gray-3 px-3 py-2 text-xs leading-snug text-gray-12"
		>
			<div className="flex gap-2 items-start">
				<BellOff
					className="mt-0.5 shrink-0 size-3.5 text-gray-11"
					aria-hidden
				/>
				<p>
					<span className="font-medium">
						Pop-up notifications will show in your recording.
					</span>{" "}
					{INSTRUCTIONS[platform]}
				</p>
			</div>
			<div className="flex gap-3 pl-[22px]">
				<button
					type="button"
					onClick={onSwitchToWindow}
					className="font-medium text-blue-11 hover:underline"
				>
					Record a window instead
				</button>
				<button
					type="button"
					onClick={dismiss}
					className="text-gray-10 hover:text-gray-12"
				>
					Don't show again
				</button>
			</div>
		</div>
	);
};
