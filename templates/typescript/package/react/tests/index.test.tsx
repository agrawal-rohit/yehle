import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "../src";

test("button", () => {
	render(<Button type="primary" />);

	const buttonElement = screen.getByText(/button: type primary/i);

	expect(buttonElement).toBeInTheDocument();
	expect(buttonElement).toHaveTextContent("button: type primary");
	expect(buttonElement.outerHTML).toMatchInlineSnapshot(
		`"<button class="button">button: type primary</button>"`,
	);

	expect(buttonElement).toHaveClass("button");
});
