import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
	root: "renderer",
	base: "./",
	build: {
		outDir: "../dist/renderer",
		emptyOutDir: true,
		rollupOptions: {
			input: resolve("renderer/index.html"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 5174,
		strictPort: false,
	},
});
