import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";

const __dirname = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(__dirname, "..");

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
	outputFileTracingRoot: monorepoRoot,
	turbopack: {
		root: monorepoRoot,
	},
	serverExternalPackages: ["@takumi-rs/image-response"],
	reactStrictMode: true,
	async rewrites() {
		return [
			{
				source: "/docs/:path*.mdx",
				destination: "/llms.mdx/docs/:path*",
			},
		];
	},
};

export default withMDX(config);
