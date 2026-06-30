import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: "@earendil-works/pi-coding-agent/core/extensions",
				replacement: fileURLToPath(new URL("../coding-agent/src/core/extensions/index.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-coding-agent/core/agent-session",
				replacement: fileURLToPath(new URL("../coding-agent/src/core/agent-session.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-coding-agent/core/agent-session-services",
				replacement: fileURLToPath(
					new URL("../coding-agent/src/core/agent-session-services.ts", import.meta.url),
				),
			},
			{
				find: "@earendil-works/pi-coding-agent/core/auth-storage",
				replacement: fileURLToPath(new URL("../coding-agent/src/core/auth-storage.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-coding-agent/core/model-registry",
				replacement: fileURLToPath(new URL("../coding-agent/src/core/model-registry.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-coding-agent/core/provider-display-names",
				replacement: fileURLToPath(
					new URL("../coding-agent/src/core/provider-display-names.ts", import.meta.url),
				),
			},
			{
				find: "@earendil-works/pi-coding-agent/core/session-manager",
				replacement: fileURLToPath(new URL("../coding-agent/src/core/session-manager.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-agent-core",
				replacement: fileURLToPath(new URL("../agent/src/index.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-ai/compat",
				replacement: fileURLToPath(new URL("../ai/src/compat.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-ai/oauth",
				replacement: fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-ai",
				replacement: fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
			},
			{
				find: "@earendil-works/pi-tui",
				replacement: fileURLToPath(new URL("../tui/src/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		environment: "node",
		globals: true,
	},
});
