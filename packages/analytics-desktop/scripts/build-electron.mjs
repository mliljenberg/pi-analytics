import { build } from "esbuild";

await build({
	entryPoints: ["src/main.ts", "src/preload.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	outdir: "dist/electron",
	sourcemap: true,
	ignoreAnnotations: true,
	external: ["electron"],
	tsconfig: "tsconfig.build.json",
});
