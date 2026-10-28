import { Logo } from "@cap/ui";
import type { ReactNode } from "react";
import styles from "./paper-state.module.css";

export const paperStateStyles = styles;

export function PaperState({
	doodle,
	title,
	lede,
	children,
	footnote,
	homeHref = "/",
}: {
	doodle: ReactNode;
	title: ReactNode;
	lede?: ReactNode;
	children?: ReactNode;
	footnote?: ReactNode;
	homeHref?: string;
}) {
	return (
		<div className={styles.page}>
			<header className={styles.brand}>
				<a
					href={homeHref}
					className={styles.brandLink}
					aria-label="LEADR Screen Recorder"
				>
					<CapWordmark />
				</a>
			</header>
			<main className={styles.stage}>
				{doodle}
				<h1 className={styles.title}>{title}</h1>
				{lede && <p className={styles.lede}>{lede}</p>}
				{children}
			</main>
			{footnote && <p className={styles.footnote}>{footnote}</p>}
		</div>
	);
}

export function PaperActions({ children }: { children: ReactNode }) {
	return <div className={styles.actions}>{children}</div>;
}

function CapWordmark() {
	return <Logo className="h-6 w-auto" />;
}
