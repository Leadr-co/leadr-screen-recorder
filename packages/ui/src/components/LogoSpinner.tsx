import { LeadrMark } from "./icons/leadr-logo";

export const LogoSpinner = ({ className }: { className: string }) => {
	return (
		<svg
			className={className}
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 40 40"
			role="img"
			aria-label="Loading"
		>
			<LeadrMark />
		</svg>
	);
};
