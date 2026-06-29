import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { context } from "esbuild";
import { createServer } from "vite";

const require = createRequire(import.meta.url);

function resolveElectronBinary() {
	const electronPackageJson = require.resolve("electron/package.json");
	const electronPackageDir = dirname(electronPackageJson);
	const pathFile = join(electronPackageDir, "path.txt");

	if (existsSync(pathFile)) {
		const executablePath = readFileSync(pathFile, "utf8");
		const binaryPath = join(electronPackageDir, "dist", executablePath);
		if (existsSync(binaryPath)) {
			return binaryPath;
		}
	}

	console.log("Electron binary is missing. Running Electron's installer before launching.");
	const installer = spawn(process.execPath, [join(electronPackageDir, "install.js")], {
		stdio: "inherit",
	});

	return new Promise((resolve, reject) => {
		installer.on("error", reject);
		installer.on("exit", (code) => {
			if (code !== 0) {
				reject(new Error(`Electron installer exited with code ${code ?? "unknown"}.`));
				return;
			}
			const executablePath = readFileSync(pathFile, "utf8");
			resolve(join(electronPackageDir, "dist", executablePath));
		});
	});
}

const electronPath = await resolveElectronBinary();
const viteServer = await createServer({
	configFile: "vite.config.ts",
});
await viteServer.listen();
const urls = viteServer.resolvedUrls?.local;
const rendererUrl = urls?.[0];

if (!rendererUrl) {
	throw new Error("Vite did not expose a local renderer URL.");
}

const electronBuild = await context({
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
await electronBuild.watch();
await electronBuild.rebuild();

const child = spawn(electronPath, ["dist/electron/main.js"], {
	stdio: "inherit",
	env: {
		...process.env,
		PI_ANALYTICS_DESKTOP_RENDERER_URL: rendererUrl,
	},
});

const shutdown = async () => {
	child.kill();
	await electronBuild.dispose();
	await viteServer.close();
};

child.on("exit", async (code) => {
	await shutdown();
	process.exit(code ?? 0);
});

process.on("SIGINT", async () => {
	await shutdown();
	process.exit(130);
});
