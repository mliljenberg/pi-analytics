import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { AuthStorage } from "@earendil-works/pi-coding-agent/core/auth-storage";
import { ModelRegistry, type ProviderConfigInput } from "@earendil-works/pi-coding-agent/core/model-registry";
import { afterEach, describe, expect, it } from "vitest";
import { AgentController } from "../src/main/agent-controller.ts";
import { BoardStore } from "../src/main/board-store.ts";
import type { MainToRendererEvent } from "../src/shared/ipc.ts";

const tempDirs: string[] = [];
const fauxProviders: FauxProviderRegistration[] = [];

afterEach(async () => {
	while (fauxProviders.length > 0) {
		fauxProviders.pop()?.unregister();
	}
	while (tempDirs.length > 0) {
		const tempDir = tempDirs.pop();
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
		}
	}
});

describe("parallel task agent controller", () => {
	it("runs two editable task agents against separate files", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-analytics-tasks-"));
		tempDirs.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		await writeFile(join(workspace, "one.txt"), "one", "utf8");
		await writeFile(join(workspace, "two.txt"), "two", "utf8");
		const events: MainToRendererEvent[] = [];
		const { authStorage, modelRegistry, fauxProvider } = createFauxAuth();
		fauxProviders.push(fauxProvider);
		fauxProvider.setResponses([
			fauxAssistantMessage(
				fauxToolCall("dispatch_parallel_tasks", {
					groupTitle: "File summaries",
					tasks: [
						{
							title: "Summarize one.txt",
							instruction: "Write the summary for one.txt to one.summary.txt.",
							targetPaths: ["one.txt", "one.summary.txt"],
							requiresWrites: true,
						},
						{
							title: "Summarize two.txt",
							instruction: "Write the summary for two.txt to two.summary.txt.",
							targetPaths: ["two.txt", "two.summary.txt"],
							requiresWrites: true,
						},
					],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(fauxToolCall("write", { path: "one.summary.txt", content: "summary one\n" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxToolCall("write", { path: "two.summary.txt", content: "summary two\n" }), {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("Summary one complete."),
			fauxAssistantMessage("Summary two complete."),
		]);
		const controller = new AgentController(new BoardStore(join(root, "user-data")), (event) => events.push(event), {
			authStorage,
			modelRegistry,
		});

		await controller.start(workspace);
		await controller.prompt("create summary for each file", []);
		await waitFor(() => completedTaskIds(events).size === 2);

		await expect(readFile(join(workspace, "one.summary.txt"), "utf8")).resolves.toBe("summary one\n");
		await expect(readFile(join(workspace, "two.summary.txt"), "utf8")).resolves.toBe("summary two\n");
		expect(completedTaskIds(events).size).toBe(2);
		expect(events.filter((event) => event.type === "canvas-card" && event.card.taskId)).not.toHaveLength(0);
	});

	it("serializes same-file task edits through the existing mutation queue", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-analytics-tasks-"));
		tempDirs.push(root);
		const workspace = join(root, "workspace");
		await mkdir(workspace);
		await writeFile(join(workspace, "shared.txt"), "a: todo\nb: todo\n", "utf8");
		const events: MainToRendererEvent[] = [];
		const { authStorage, modelRegistry, fauxProvider } = createFauxAuth();
		fauxProviders.push(fauxProvider);
		fauxProvider.setResponses([
			fauxAssistantMessage(
				fauxToolCall("dispatch_parallel_tasks", {
					groupTitle: "Shared file edits",
					tasks: [
						{
							title: "Edit a",
							instruction: "Change the a line in shared.txt.",
							targetPaths: ["shared.txt"],
							requiresWrites: true,
						},
						{
							title: "Edit b",
							instruction: "Change the b line in shared.txt.",
							targetPaths: ["shared.txt"],
							requiresWrites: true,
						},
					],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: "shared.txt",
					edits: [{ oldText: "a: todo", newText: "a: done" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall("edit", {
					path: "shared.txt",
					edits: [{ oldText: "b: todo", newText: "b: done" }],
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("A edit complete."),
			fauxAssistantMessage("B edit complete."),
		]);
		const controller = new AgentController(new BoardStore(join(root, "user-data")), (event) => events.push(event), {
			authStorage,
			modelRegistry,
		});

		await controller.start(workspace);
		await controller.prompt("edit each line in shared.txt", []);
		await waitFor(() => completedTaskIds(events).size === 2);

		await expect(readFile(join(workspace, "shared.txt"), "utf8")).resolves.toBe("a: done\nb: done\n");
	});
});

function createFauxAuth(): {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	fauxProvider: FauxProviderRegistration;
} {
	const fauxProvider = registerFauxProvider({
		models: [{ id: "faux-1", reasoning: false }],
	});
	const model = fauxProvider.getModel();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, "faux-key");
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	modelRegistry.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey: "faux-key",
		api: fauxProvider.api,
		models: providerModels(fauxProvider.models),
	});
	return { authStorage, modelRegistry, fauxProvider };
}

function providerModels(models: FauxProviderRegistration["models"]): NonNullable<ProviderConfigInput["models"]> {
	return models.map((model) => ({
		id: model.id,
		name: model.name,
		api: model.api,
		reasoning: model.reasoning,
		input: [...model.input],
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens ?? 4096,
		baseUrl: model.baseUrl,
	}));
}

function completedTaskIds(events: MainToRendererEvent[]): Set<string> {
	return new Set(events.filter(isCompleteTaskUpdate).map((event) => event.task.id));
}

function isCompleteTaskUpdate(
	event: MainToRendererEvent,
): event is Extract<MainToRendererEvent, { type: "task-update" }> {
	return event.type === "task-update" && event.task.status === "complete";
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error("Timed out waiting for condition.");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
