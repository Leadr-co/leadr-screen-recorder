export const LEADR_RED = "#AB2C21";

const WORDMARK_PATHS = [
	"M1.75,1.48h11.65v52.87h32.79v9.86H1.75V1.48Z",
	"M107.43,54.44v9.76h-47.04V1.48h45.79v9.77h-34.14v16.31h30.29v9.59h-30.29v17.3h35.39Z",
	"M166.06,49.69h-31.36l-6.18,14.52h-12.01L144.73,1.48h11.47l28.32,62.72h-12.19l-6.27-14.52ZM162.21,40.55l-11.83-27.42-11.74,27.42h23.57Z",
	"M197.45,1.48h27.42c20.34,0,34.23,12.54,34.23,31.36s-13.89,31.36-34.23,31.36h-27.42V1.48ZM224.33,54.35c13.98,0,23.03-8.51,23.03-21.51s-9.05-21.51-23.03-21.51h-15.23v43.01h15.23Z",
	"M317.45,64.2l-12.81-18.37c-.81.09-1.61.09-2.42.09h-14.16v18.28h-11.65V1.48h25.81c16.49,0,26.7,8.42,26.7,22.31,0,9.5-4.84,16.48-13.35,19.8l14.43,20.61h-12.55ZM301.68,11.34h-13.62v25h13.62c10.22,0,15.5-4.66,15.5-12.54s-5.29-12.46-15.5-12.46Z",
];

const L_PATH = WORDMARK_PATHS[0] as string;

export const LeadrWordmark = ({ white }: { white?: boolean }) => (
	<g
		className={white ? "fill-white" : "fill-[#AB2C21] [.dark_&]:fill-white"}
		transform="translate(0 8.047) scale(0.36199)"
	>
		{WORDMARK_PATHS.map((d) => (
			<path key={d} d={d} />
		))}
	</g>
);

export const LeadrMark = () => (
	<>
		<rect x="0.25" y="0.25" width="39.5" height="39.5" rx="7.75" fill="#fff" />
		<rect
			x="0.25"
			y="0.25"
			width="39.5"
			height="39.5"
			rx="7.75"
			stroke="#EDE7DF"
			strokeWidth="0.5"
		/>
		<path
			d={L_PATH}
			fill={LEADR_RED}
			transform="translate(10.83 7.434) scale(0.38265)"
		/>
	</>
);
