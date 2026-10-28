import "@/app/globals.css";
import { buildEnv } from "@cap/env";
import { OpenPanelComponent } from "@openpanel/nextjs";
import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import Script from "next/script";
import type { PropsWithChildren } from "react";

const defaultFont = Montserrat({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
	style: ["normal", "italic"],
	display: "swap",
});

const title = "LEADR Screen Recorder";
const description =
	"Record your screen and share it with the LEADR team in seconds.";

export const metadata: Metadata = {
	metadataBase: new URL(buildEnv.NEXT_PUBLIC_WEB_URL),
	title,
	description,
	applicationName: title,
	openGraph: {
		title,
		description,
		type: "website",
		siteName: title,
		images: [{ url: "/api/og", width: 1200, height: 630, alt: title }],
	},
	twitter: {
		card: "summary_large_image",
		title,
		description,
		images: ["/api/og"],
	},
};

export default function RootLayout({ children }: PropsWithChildren) {
	return (
		// suppressHydrationWarning: the Cap Chrome extension stamps
		// data-cap-chrome-extension-installed on <html> at document_idle,
		// which can land before hydration finishes.
		<html className={defaultFont.className} lang="en" suppressHydrationWarning>
			<head>
				<link
					rel="apple-touch-icon"
					sizes="180x180"
					href="/apple-touch-icon.png"
				/>
				<link
					rel="icon"
					type="image/png"
					sizes="32x32"
					href="/favicon-32x32.png"
				/>
				<link
					rel="icon"
					type="image/png"
					sizes="16x16"
					href="/favicon-16x16.png"
				/>
				<link rel="manifest" href="/site.webmanifest" />
				<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#AB2C21" />
				<link rel="shortcut icon" href="/favicon.ico" />
				<meta name="msapplication-TileColor" content="#AB2C21" />
				<meta name="theme-color" content="#ffffff" />
			</head>
			<body suppressHydrationWarning>
				<Script src="/theme-script.js" strategy="beforeInteractive" />
				{buildEnv.NEXT_PUBLIC_OPENPANEL_CLIENT_ID ? (
					<OpenPanelComponent
						apiUrl="/api/op"
						clientId={buildEnv.NEXT_PUBLIC_OPENPANEL_CLIENT_ID}
						scriptUrl="/api/op/op1.js"
						trackOutgoingLinks
						trackScreenViews
					/>
				) : null}
				<main className="w-full">{children}</main>
			</body>
		</html>
	);
}
