import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { TooltipProvider } from "./components/ui/tooltip";
import "@fontsource-variable/geist/wght.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
	<StrictMode>
		<ThemeProvider defaultTheme="system" storageKey="theme">
			<TooltipProvider>
				<App />
			</TooltipProvider>
		</ThemeProvider>
	</StrictMode>,
);
