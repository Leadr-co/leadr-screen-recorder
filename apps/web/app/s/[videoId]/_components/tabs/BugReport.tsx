"use client";

import type { VideoBugReport } from "@cap/database/types";
import { Button } from "@cap/ui";
import type { Video } from "@cap/web-domain";
import { Bug, ClipboardCopy, LoaderCircle, RotateCw } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { generateBugReport, getBugReport } from "@/actions/videos/bug-report";
import { formatBugReportTimestamp } from "@/lib/bug-report";

interface BugReportPanelProps {
	videoId: Video.VideoId;
	transcriptionStatus?: string | null;
	onSeek?: (time: number) => void;
}

const Section = ({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) => (
	<div className="space-y-1">
		<h4 className="text-xs font-medium tracking-wide uppercase text-gray-10">
			{title}
		</h4>
		{children}
	</div>
);

const List = ({ items }: { items: string[] }) =>
	items.length ? (
		<ul className="pl-4 space-y-1 text-sm list-disc text-gray-12">
			{items.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	) : (
		<p className="text-sm text-gray-10">Not stated in the recording.</p>
	);

export const BugReportPanel = ({
	videoId,
	transcriptionStatus,
	onSeek,
}: BugReportPanelProps) => {
	const [report, setReport] = useState<VideoBugReport | null>(null);
	const [markdown, setMarkdown] = useState<string | null>(null);
	const [canGenerate, setCanGenerate] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isGenerating, startGenerating] = useTransition();

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload once the transcript finishes
	useEffect(() => {
		let cancelled = false;
		getBugReport(videoId)
			.then((state) => {
				if (cancelled) return;
				setReport(state.report);
				setMarkdown(state.markdown);
				setCanGenerate(state.canGenerate);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [videoId, transcriptionStatus]);

	const generate = () =>
		startGenerating(async () => {
			setError(null);
			const result = await generateBugReport(videoId);
			if (!result.success) {
				setError(result.message);
				return;
			}
			setReport(result.report);
			setMarkdown(result.markdown);
		});

	const copy = async () => {
		if (!markdown) return;
		try {
			await navigator.clipboard.writeText(markdown);
			toast.success(
				"Bug report copied. Paste it into Slack, HubSpot or a ticket.",
			);
		} catch {
			toast.error("Couldn't copy. Select the text and copy it instead.");
		}
	};

	if (!report && !canGenerate) return null;

	if (!report) {
		return (
			<div className="p-4 space-y-3 text-left rounded-xl border border-gray-4 bg-gray-2">
				<div className="flex gap-2 items-center">
					<Bug className="size-4 text-gray-11" aria-hidden />
					<h3 className="text-base font-medium text-gray-12">Bug report</h3>
				</div>
				<p className="text-sm text-gray-10">
					Turn this recording into steps to reproduce, expected vs. actual
					behaviour and open questions, ready to paste into a ticket.
				</p>
				<Button
					type="button"
					size="sm"
					variant="dark"
					onClick={generate}
					disabled={isGenerating}
				>
					{isGenerating ? (
						<LoaderCircle className="mr-2 animate-spin size-3.5" aria-hidden />
					) : (
						<Bug className="mr-2 size-3.5" aria-hidden />
					)}
					{isGenerating ? "Writing bug report..." : "Create bug report"}
				</Button>
				{error && <p className="text-sm text-red-500">{error}</p>}
			</div>
		);
	}

	return (
		<div className="p-4 space-y-4 text-left rounded-xl border border-gray-4 bg-gray-2">
			<div className="flex gap-2 justify-between items-start">
				<div className="flex gap-2 items-center min-w-0">
					<Bug className="shrink-0 size-4 text-gray-11" aria-hidden />
					<h3 className="text-base font-medium text-gray-12">{report.title}</h3>
				</div>
				<div className="flex gap-1 shrink-0">
					<Button type="button" size="xs" variant="gray" onClick={copy}>
						<ClipboardCopy className="mr-1 size-3.5" aria-hidden />
						Copy for ticket
					</Button>
					{canGenerate && (
						<Button
							type="button"
							size="xs"
							variant="gray"
							onClick={generate}
							disabled={isGenerating}
							aria-label="Regenerate bug report"
						>
							<RotateCw
								className={`size-3.5 ${isGenerating ? "animate-spin" : ""}`}
								aria-hidden
							/>
						</Button>
					)}
				</div>
			</div>
			<p className="text-sm text-gray-12">{report.summary}</p>
			<Section title="Steps to reproduce">
				{report.steps.length ? (
					<ol className="space-y-1 text-sm list-decimal pl-5 text-gray-12">
						{report.steps.map((step, index) => (
							<li key={`${index}-${step.text}`}>
								{step.atSeconds !== null && (
									<button
										type="button"
										onClick={() => onSeek?.(step.atSeconds ?? 0)}
										className="mr-1.5 text-xs font-medium text-blue-11 hover:underline"
									>
										{formatBugReportTimestamp(step.atSeconds)}
									</button>
								)}
								{step.text}
							</li>
						))}
					</ol>
				) : (
					<p className="text-sm text-gray-10">Not stated in the recording.</p>
				)}
			</Section>
			<Section title="Expected">
				<p className="text-sm text-gray-12">{report.expected}</p>
			</Section>
			<Section title="Actual">
				<p className="text-sm text-gray-12">{report.actual}</p>
			</Section>
			<Section title="Details mentioned">
				<List items={report.details} />
			</Section>
			<Section title="Open questions">
				<List items={report.openQuestions} />
			</Section>
			<p className="text-xs text-gray-9">
				AI draft from the transcript. Check it before filing.
			</p>
			{error && <p className="text-sm text-red-500">{error}</p>}
		</div>
	);
};
