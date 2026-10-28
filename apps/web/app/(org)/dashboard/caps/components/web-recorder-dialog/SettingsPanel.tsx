"use client";

import { Switch } from "@cap/ui";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	RECORDING_QUALITY_OPTIONS,
	type RecordingQuality,
} from "./web-recorder-constants";

interface SettingsPanelProps {
	open: boolean;
	rememberDevices: boolean;
	recordingQuality: RecordingQuality;
	qualityLocked?: boolean;
	onClose: () => void;
	onRememberDevicesChange: (value: boolean) => void;
	onRecordingQualityChange: (value: RecordingQuality) => void;
}

const useScreenResolution = (open: boolean) => {
	const [resolution, setResolution] = useState<{
		width: number;
		height: number;
	} | null>(null);

	useEffect(() => {
		if (!open || typeof window === "undefined") return;
		const scale = window.devicePixelRatio || 1;
		setResolution({
			width: Math.round(window.screen.width * scale),
			height: Math.round(window.screen.height * scale),
		});
	}, [open]);

	return resolution;
};

export const SettingsPanel = ({
	open,
	rememberDevices,
	recordingQuality,
	qualityLocked = false,
	onClose,
	onRememberDevicesChange,
	onRecordingQualityChange,
}: SettingsPanelProps) => {
	const screenResolution = useScreenResolution(open);

	return (
		<AnimatePresence mode="wait">
			{open && (
				<motion.div
					key="web-recorder-settings"
					initial={{ opacity: 0, y: -12 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -12 }}
					transition={{ duration: 0.2, ease: "easeOut" }}
					className="absolute inset-0 z-40 flex flex-col gap-4 p-4 border border-gray-3 rounded-lg bg-gray-1 shadow-lg dark:bg-gray-2"
				>
					<div className="flex items-center justify-between">
						<button
							type="button"
							onClick={onClose}
							className="flex items-center gap-1 text-sm font-medium text-gray-11 transition-colors hover:text-gray-12"
						>
							<ArrowLeftIcon className="size-4" />
							Back
						</button>
						<h2 className="text-sm font-semibold text-gray-12">
							Recorder settings
						</h2>
						<span className="w-9 h-9" aria-hidden />
					</div>
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-3 p-4 text-left rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-3">
							<div className="flex flex-col gap-1">
								<p className="text-sm font-medium text-gray-12">
									Recording quality
								</p>
								<p className="text-xs text-gray-10">
									Higher settings keep small text sharp. Auto records at your
									screen's resolution, up to 4K. Recordings never go above your
									screen's resolution.
								</p>
							</div>
							<fieldset
								aria-label="Recording quality"
								className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-gray-3 dark:bg-gray-4"
							>
								{RECORDING_QUALITY_OPTIONS.map((option) => {
									const selected = option.value === recordingQuality;
									return (
										<button
											key={option.value}
											type="button"
											aria-pressed={selected}
											disabled={qualityLocked}
											onClick={() => onRecordingQualityChange(option.value)}
											className={clsx(
												"py-1.5 text-xs font-medium rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-60",
												selected
													? "bg-gray-1 text-gray-12 shadow-sm dark:bg-gray-2"
													: "text-gray-11 hover:text-gray-12",
											)}
										>
											{option.label}
										</button>
									);
								})}
							</fieldset>
							{screenResolution && (
								<p className="text-xs text-gray-10">
									This screen: {screenResolution.width} ×{" "}
									{screenResolution.height}
								</p>
							)}
						</div>
						<div className="flex gap-4 justify-between items-start p-4 text-left rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-3">
							<div className="flex flex-col gap-1 text-left">
								<p className="text-sm font-medium text-gray-12">
									Automatically select your last webcam/microphone
								</p>
								<p className="text-xs text-gray-10">
									If available, the last used camera and mic will be
									automatically selected.
								</p>
							</div>
							<Switch
								checked={rememberDevices}
								onCheckedChange={onRememberDevicesChange}
								aria-label="Remember selected devices"
							/>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
};
