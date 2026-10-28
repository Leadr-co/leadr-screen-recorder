import { z } from "zod";

// The desktop app supplies `port` from tauri-plugin-oauth's local callback
// server, which is always a numeric loopback port. Constraining it to an integer
// port is what keeps the redirect target locked to 127.0.0.1: an unconstrained
// string such as `x@evil.example` would be parsed as a URL authority and would
// redirect the browser — with the session token / API key in the query string —
// to an attacker-controlled host.
export const desktopSessionRequestQuerySchema = z.object({
	port: z.coerce.number().int().min(1).max(65535).optional(),
	platform: z.union([z.literal("web"), z.literal("desktop")]).default("web"),
	type: z
		.union([z.literal("session"), z.literal("api_key")])
		.default("session"),
});

// Builds the desktop callback URL. The host is a fixed literal and only the
// `port`/`search` setters are used, so the target is provably loopback: a
// malformed port can only ever be dropped or truncated to digits, never promoted
// to a different host. This is the second line of defence behind the schema, so
// a future loosening of `port` validation cannot silently re-open the redirect.
export function buildLoopbackCallbackUrl(
	port: number,
	params: URLSearchParams,
) {
	const url = new URL("http://127.0.0.1");
	url.port = String(port);
	url.search = params.toString();
	return url.toString();
}

export function escapeHtmlAttribute(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function serializeStateForScript(value: unknown) {
	// Escape characters that could break out of an inline <script> (or split the
	// script via U+2028/U+2029) into their \uXXXX JSON form. `port` is validated
	// to be numeric, so these values are server-generated today; this keeps the
	// template from ever becoming an XSS sink if an upstream value changes.
	return (JSON.stringify(value) ?? "null").replace(
		/[<>&\u2028\u2029]/g,
		(ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}

export function createDesktopRedirectPage(
	primaryUrl: string,
	fallbackUrl: string,
) {
	const state = serializeStateForScript({ primaryUrl, fallbackUrl });
	const fallbackHref = escapeHtmlAttribute(fallbackUrl);

	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
		<meta http-equiv="Pragma" content="no-cache" />
		<title>Opening LEADR Screen Recorder</title>
		<style>
			@font-face {
				font-family: "Neue Montreal";
				src: url("/fonts/NeueMontreal-Regular.woff2") format("woff2");
				font-weight: 400;
				font-display: swap;
			}

			@font-face {
				font-family: "Neue Montreal";
				src: url("/fonts/NeueMontreal-Medium.woff2") format("woff2");
				font-weight: 500;
				font-display: swap;
			}

			:root {
				--paper: #fbfaf7;
				--ink: #20242c;
				--ink-soft: #6b7079;
				--accent: #4785ff;
				--accent-soft: #adc9ff;
				--track: #dcdcd4;
				color-scheme: light;
			}

			*,
			*::before,
			*::after {
				box-sizing: border-box;
			}

			body {
				margin: 0;
				min-height: 100vh;
				min-height: 100dvh;
				display: flex;
				flex-direction: column;
				background: var(--paper);
				color: var(--ink);
				font-family: "Neue Montreal", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
				-webkit-font-smoothing: antialiased;
			}

			header {
				display: flex;
				justify-content: center;
				padding: 32px 24px 0;
				animation: fade-up 0.5s ease both;
			}

			main {
				flex: 1;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				padding: 40px 24px 56px;
				text-align: center;
			}

			.doodle {
				width: 236px;
				height: auto;
				overflow: visible;
				animation: fade-up 0.5s ease 0.05s both;
			}

			.boil {
				filter: url(#boil);
			}

			.stroke,
			.accent,
			.accent-soft,
			.soft {
				fill: none;
				stroke-linecap: round;
				stroke-linejoin: round;
			}

			.stroke {
				stroke: var(--ink);
				stroke-width: 4.5;
			}

			.accent {
				stroke: var(--accent);
				stroke-width: 4.5;
			}

			.accent-soft {
				stroke: var(--accent-soft);
				stroke-width: 4.5;
			}

			.soft {
				stroke: var(--ink-soft);
				stroke-width: 2.5;
				stroke-dasharray: 2 4.2;
				animation: march 1.2s linear infinite;
			}

			.ink-fill {
				fill: var(--ink);
			}

			.draw {
				stroke-dasharray: 1;
				stroke-dashoffset: 1;
				animation: draw var(--t, 0.6s) ease var(--d, 0s) forwards;
			}

			.appear {
				opacity: 0;
				animation: fade-in 0.4s ease var(--d, 0s) forwards;
			}

			.mark {
				transform-box: fill-box;
				transform-origin: center;
				animation: pulse 1.6s ease-in-out 1.2s infinite;
			}

			h1 {
				margin: 28px 0 0;
				font-size: 28px;
				font-weight: 500;
				line-height: 1.15;
				letter-spacing: -0.015em;
				animation: fade-up 0.5s ease 0.1s both;
			}

			.lede {
				margin: 10px 0 0;
				max-width: 400px;
				font-size: 15.5px;
				line-height: 1.55;
				color: var(--ink-soft);
				animation: fade-up 0.5s ease 0.15s both;
			}

			.actions {
				display: flex;
				flex-wrap: wrap;
				justify-content: center;
				gap: 10px;
				margin-top: 28px;
				animation: fade-up 0.5s ease 0.22s both;
			}

			.cta {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				min-height: 44px;
				padding: 0 24px;
				border: 1.5px solid var(--ink);
				border-radius: 999px;
				background: var(--ink);
				color: var(--paper);
				font: inherit;
				font-size: 14.5px;
				font-weight: 500;
				text-decoration: none;
				cursor: pointer;
				transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
			}

			.cta:hover {
				background: #353a45;
				border-color: #353a45;
			}

			.cta:active {
				transform: translateY(1px);
			}

			.cta:focus-visible {
				outline: 2px solid var(--accent);
				outline-offset: 3px;
			}

			.cta.ghost {
				background: transparent;
				border-color: var(--track);
				color: var(--ink);
			}

			.cta.ghost:hover {
				background: rgba(32, 36, 44, 0.04);
				border-color: var(--ink-soft);
			}

			.status {
				display: flex;
				align-items: center;
				gap: 10px;
				margin: 22px 0 0;
				font-size: 13.5px;
				color: var(--ink-soft);
				animation: fade-up 0.5s ease 0.3s both;
			}

			.status svg {
				width: 44px;
				height: 12px;
				overflow: visible;
			}

			footer {
				padding: 0 24px 32px;
				text-align: center;
				font-size: 13px;
				color: var(--ink-soft);
				animation: fade-up 0.5s ease 0.35s both;
			}

			footer a {
				color: var(--ink);
				text-decoration: underline;
				text-decoration-color: var(--track);
				text-decoration-thickness: 1.5px;
				text-underline-offset: 3px;
			}

			footer a:hover {
				text-decoration-color: var(--ink);
			}

			@keyframes draw {
				to {
					stroke-dashoffset: 0;
				}
			}

			@keyframes fade-in {
				to {
					opacity: 1;
				}
			}

			@keyframes fade-up {
				from {
					opacity: 0;
					transform: translateY(10px);
				}
				to {
					opacity: 1;
					transform: translateY(0);
				}
			}

			@keyframes march {
				to {
					stroke-dashoffset: -6.2;
				}
			}

			@keyframes pulse {
				0%,
				100% {
					transform: scale(1);
				}
				50% {
					transform: scale(1.08);
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.boil {
					filter: none;
				}

				header,
				.doodle,
				h1,
				.lede,
				.actions,
				.status,
				footer,
				.draw,
				.appear {
					animation-duration: 0.01ms;
					animation-delay: 0s;
				}

				.soft,
				.mark {
					animation: none;
				}
			}
		</style>
	</head>
	<body>
		<header>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 331.5 66" height="20" fill="#AB2C21" role="img" aria-label="LEADR Screen Recorder"><path d="M1.75,1.48h11.65v52.87h32.79v9.86H1.75V1.48Z" /><path d="M107.43,54.44v9.76h-47.04V1.48h45.79v9.77h-34.14v16.31h30.29v9.59h-30.29v17.3h35.39Z" /><path d="M166.06,49.69h-31.36l-6.18,14.52h-12.01L144.73,1.48h11.47l28.32,62.72h-12.19l-6.27-14.52ZM162.21,40.55l-11.83-27.42-11.74,27.42h23.57Z" /><path d="M197.45,1.48h27.42c20.34,0,34.23,12.54,34.23,31.36s-13.89,31.36-34.23,31.36h-27.42V1.48ZM224.33,54.35c13.98,0,23.03-8.51,23.03-21.51s-9.05-21.51-23.03-21.51h-15.23v43.01h15.23Z" /><path d="M317.45,64.2l-12.81-18.37c-.81.09-1.61.09-2.42.09h-14.16v18.28h-11.65V1.48h25.81c16.49,0,26.7,8.42,26.7,22.31,0,9.5-4.84,16.48-13.35,19.8l14.43,20.61h-12.55ZM301.68,11.34h-13.62v25h13.62c10.22,0,15.5-4.66,15.5-12.54s-5.29-12.46-15.5-12.46Z" /></svg>
		</header>
		<main>
			<svg class="doodle" viewBox="0 0 200 104" aria-hidden="true">
				<defs>
					<filter id="boil" x="-15%" y="-15%" width="130%" height="130%">
						<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="1" result="noise">
							<animate attributeName="seed" values="1;3;5;7" dur="0.6s" repeatCount="indefinite" calcMode="discrete" />
						</feTurbulence>
						<feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
					</filter>
				</defs>
				<g class="boil">
					<path class="stroke draw" style="--d: 0.1s; --t: 0.7s" pathLength="1" d="M 18 30 L 62 30 Q 70 30 70 38 L 70 80 Q 70 88 62 88 L 18 88 Q 10 88 10 80 L 10 38 Q 10 30 18 30 Z" />
					<path class="stroke draw" style="--d: 0.55s; --t: 0.3s" pathLength="1" d="M 10 43 L 70 43" />
					<circle class="ink-fill appear" style="--d: 0.75s" cx="18" cy="36.5" r="1.8" />
					<circle class="ink-fill appear" style="--d: 0.8s" cx="25" cy="36.5" r="1.8" />
					<path class="accent draw" style="--d: 0.8s; --t: 0.35s" pathLength="1" d="M 28 66 L 36 73 L 52 56" />
					<path class="soft" d="M 82 50 Q 110 18 140 46" />
					<path class="stroke draw" style="--d: 1s; --t: 0.25s" pathLength="1" d="M 129 46 L 141 47 L 139 35" />
					<g class="mark">
						<circle class="accent draw" style="--d: 0.35s; --t: 0.6s" pathLength="1" cx="170" cy="60" r="22" />
						<circle class="accent-soft draw" style="--d: 0.75s; --t: 0.45s" pathLength="1" cx="170" cy="60" r="12" />
					</g>
				</g>
			</svg>
			<h1>Opening LEADR Screen Recorder</h1>
			<p class="lede">You're signed in. LEADR Screen Recorder should open in a moment and pick up right where you left off.</p>
			<div class="actions">
				<button id="open-cap" class="cta" type="button">Open LEADR Screen Recorder</button>
				<a id="browser-fallback" class="cta ghost" href="${fallbackHref}">Finish in browser</a>
			</div>
			<p class="status">
				<svg viewBox="0 0 44 12" aria-hidden="true"><path class="soft" d="M 2 6 q 3 -4 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0" /></svg>
				<span id="status" role="status">Waiting for LEADR Screen Recorder to open</span>
			</p>
		</main>
		<footer>Don't have the app yet? <a href="/download">Download LEADR Screen Recorder</a></footer>
		<script>
			const { primaryUrl, fallbackUrl } = ${state};
			const status = document.getElementById("status");
			const openCapButton = document.getElementById("open-cap");
			const fallbackLink = document.getElementById("browser-fallback");
			let fallbackStarted = false;

			const startFallback = () => {
				if (fallbackStarted) return;
				fallbackStarted = true;
				status.textContent = "Finishing sign-in in your browser";
				window.location.replace(fallbackUrl);
			};

			const openCap = () => {
				status.textContent = "Waiting for LEADR Screen Recorder to open";
				window.location.href = primaryUrl;
			};

			openCapButton.addEventListener("click", openCap);
			fallbackLink.addEventListener("click", () => {
				fallbackStarted = true;
			});

			openCap();
			window.setTimeout(startFallback, 1800);
		</script>
	</body>
</html>`;
}
