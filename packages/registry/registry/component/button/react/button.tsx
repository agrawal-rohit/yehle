import type React from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "default" | "outline";
};

/**
 * Minimal candyshop button component for React projects.
 */
export function Button({
	variant = "default",
	className = "",
	children,
	...props
}: ButtonProps) {
	const base =
		"inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors";
	const styles =
		variant === "outline"
			? "border border-zinc-300 bg-transparent hover:bg-zinc-100"
			: "bg-zinc-900 text-white hover:bg-zinc-700";

	return (
		<button type="button" className={`${base} ${styles} ${className}`} {...props}>
			{children}
		</button>
	);
}
