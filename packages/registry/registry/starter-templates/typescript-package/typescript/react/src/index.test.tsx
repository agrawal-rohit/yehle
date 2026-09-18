import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { Button } from ".";

test("renders the button label", () => {
	render(<Button type="primary" />);
	expect(
		screen.getByRole("button", { name: /button: type primary/i }),
	).toBeInTheDocument();
});
