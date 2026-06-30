import { build } from "esbuild";
import { join } from "node:path";

await build({
	entryPoints: ["src/main.ts"],
	bundle: true,
	banner: {
		js: 'import * as __piNodeModule from "node:module"; const require = __piNodeModule.createRequire(import.meta.url);',
	},
	plugins: [
		{
			name: "desktop-tui-stub",
			setup(build) {
				build.onResolve({ filter: /^@earendil-works\/pi-tui$/ }, () => ({
					path: join(process.cwd(), "src/main/pi-tui-stub.ts"),
				}));
			},
		},
	],
	format: "esm",
	platform: "node",
	target: "node22",
	outdir: "dist/electron",
	sourcemap: true,
	ignoreAnnotations: true,
	external: ["electron"],
	tsconfig: "tsconfig.build.json",
});

await build({
	entryPoints: ["src/preload.ts"],
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "node22",
	outfile: "dist/electron/preload.cjs",
	sourcemap: true,
	ignoreAnnotations: true,
	external: ["electron"],
	tsconfig: "tsconfig.build.json",
});
