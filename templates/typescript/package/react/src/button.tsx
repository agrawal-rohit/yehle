import type React from "react";

interface ButtonProps {
	type?: "primary";
}

export const Button: React.FC<ButtonProps> = ({ type }) => {
	return (
		<button
			type="button"
			className="px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-200"
		>
			button: type {type}
		</button>
	);
};
