import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getProviders } from "@earendil-works/pi-ai/compat";
import type { OAuthProviderId } from "@earendil-works/pi-ai/oauth";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent/core/agent-session";
import {
	type AgentSessionServices,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "@earendil-works/pi-coding-agent/core/agent-session-services";
import { AuthStorage } from "@earendil-works/pi-coding-agent/core/auth-storage";
import { ModelRegistry } from "@earendil-works/pi-coding-agent/core/model-registry";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "@earendil-works/pi-coding-agent/core/provider-display-names";
import { SessionManager } from "@earendil-works/pi-coding-agent/core/session-manager";
import type { CanvasCard, CanvasCardPosition, PromptCardContext } from "../shared/canvas.ts";
import { normalizeSessionEvent } from "../shared/card-events.ts";
import type {
	AppDiagnostic,
	AuthState,
	MainToRendererEvent,
	ModelSummary,
	SessionSnapshot,
	TaskSnapshot,
	TaskStatus,
} from "../shared/ipc.ts";
import { isRecord, textFromContent } from "../shared/text.ts";
import type { BoardStore } from "./board-store.ts";
import { createRenderCanvasTool, createTextCanvasCard } from "./canvas-tool.ts";
import { createDispatchParallelTasksTool, type ParallelTaskRequest } from "./task-dispatch-tool.ts";

type EmitEvent = (event: MainToRendererEvent) => void;
type OpenExternal = (url: string) => Promise<void>;
type LoginAuthType = "api_key" | "oauth";

interface AgentControllerOptions {
	authStorage?: AuthStorage;
	modelRegistry?: ModelRegistry;
}

const BUILT_IN_MODEL_PROVIDERS = new Set<string>(getProviders());

const POSITION_PRESETS: CanvasCardPosition[] = [
	{ x: 72, y: 70, w: 340, h: 256 },
	{ x: 448, y: 70, w: 360, h: 286 },
	{ x: 844, y: 70, w: 360, h: 286 },
	{ x: 72, y: 390, w: 378, h: 300 },
	{ x: 486, y: 400, w: 382, h: 330 },
	{ x: 904, y: 390, w: 360, h: 292 },
	{ x: 170, y: 730, w: 360, h: 286 },
	{ x: 566, y: 738, w: 382, h: 330 },
	{ x: 986, y: 730, w: 340, h: 256 },
];

const TASK_AGENT_TOOLS = ["read", "bash", "grep", "find", "ls", "edit", "write", "render_canvas"];
const MAX_PARALLEL_TASKS = 24;

interface TaskRun {
	id: string;
	groupId: string;
	groupTitle: string;
	sessionId: string;
	cardId: string;
	title: string;
	instruction: string;
	targetPaths: string[];
	requiresWrites: boolean;
	status: TaskStatus;
	statusText: string;
	position: CanvasCardPosition;
	session?: AgentSession;
	unsubscribe?: () => void;
	currentTurnRenderedCanvas: boolean;
	latestFinalAssistantText?: {
		id: string;
		text: string;
	};
}

export class AgentController {
	private readonly boardStore: BoardStore;
	private readonly emit: EmitEvent;
	private services: AgentSessionServices | undefined;
	private authStorage: AuthStorage | undefined;
	private modelRegistry: ModelRegistry | undefined;
	private session: AgentSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private readonly tasks = new Map<string, TaskRun>();
	private nextPositionIndex = 0;
	private promptEditTarget: PromptCardContext | undefined;
	private currentTurnRenderedCanvas = false;
	private latestFinalAssistantText:
		| {
				id: string;
				text: string;
		  }
		| undefined;

	constructor(boardStore: BoardStore, emit: EmitEvent, options: AgentControllerOptions = {}) {
		this.boardStore = boardStore;
		this.emit = emit;
		this.authStorage = options.authStorage;
		this.modelRegistry = options.modelRegistry;
	}

	getAuthState(): AuthState {
		const registry = this.getModelRegistry();
		const models = registry.getAll().map((model) => this.modelToSummary(model, registry));
		const authStorage = this.getAuthStorage();
		const oauthProviderIds = new Set(authStorage.getOAuthProviders().map((provider) => provider.id));
		const providerMap = new Map<
			string,
			{ id: string; name: string; authType: LoginAuthType; configured: boolean; modelCount: number }
		>();
		for (const provider of authStorage.getOAuthProviders()) {
			providerMap.set(provider.id, {
				id: provider.id,
				name: provider.name,
				authType: "oauth",
				configured: this.getModelRegistry().getProviderAuthStatus(provider.id).configured,
				modelCount: 0,
			});
		}
		for (const model of models) {
			const current = providerMap.get(model.provider);
			if (current) {
				current.modelCount += 1;
				current.configured ||= model.configured;
				continue;
			}
			providerMap.set(model.provider, {
				id: model.provider,
				name: model.providerName,
				authType: isApiKeyLoginProvider(model.provider, oauthProviderIds) ? "api_key" : "oauth",
				configured: model.configured,
				modelCount: 1,
			});
		}
		return {
			loggedIn: models.some((model) => model.configured),
			providers: Array.from(providerMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
			models,
		};
	}

	async loginProvider(provider: string, apiKey: string | undefined, openExternal: OpenExternal): Promise<AuthState> {
		const trimmedProvider = provider.trim();
		if (!trimmedProvider) {
			throw new Error("Select a provider.");
		}
		const authType = this.getProviderAuthType(trimmedProvider);
		if (authType === "oauth") {
			await this.loginOAuthProvider(trimmedProvider, openExternal);
		} else {
			const trimmedApiKey = apiKey?.trim();
			if (!trimmedApiKey) {
				throw new Error("Enter an API key.");
			}
			this.getAuthStorage().set(trimmedProvider, { type: "api_key", key: trimmedApiKey });
		}
		this.modelRegistry = undefined;
		this.services = undefined;
		return this.getAuthState();
	}

	async start(cwd: string): Promise<SessionSnapshot> {
		this.requireConfiguredAuth();
		await this.disposeSession();
		this.nextPositionIndex = 0;

		this.services = await createAgentSessionServices({
			cwd,
			authStorage: this.getAuthStorage(),
			modelRegistry: this.getModelRegistry(),
		});
		const diagnostics: AppDiagnostic[] = this.services.diagnostics.map((diagnostic) => ({
			type: diagnostic.type,
			message: diagnostic.message,
		}));

		const sessionManager = SessionManager.continueRecent(cwd);
		const { session, modelFallbackMessage } = await createAgentSessionFromServices({
			services: this.services,
			sessionManager,
			tools: ["read", "bash", "grep", "find", "ls", "render_canvas", "dispatch_parallel_tasks"],
			customTools: [
				createDispatchParallelTasksTool({
					dispatch: (groupTitle, tasks) => this.dispatchParallelTasks(groupTitle, tasks),
				}),
				createRenderCanvasTool({
					emit: this.emit,
					nextPosition: () => this.nextPosition(),
					editTarget: () => this.promptEditTarget,
					onRender: () => {
						this.currentTurnRenderedCanvas = true;
					},
				}),
			],
			sessionStartEvent: {
				type: "session_start",
				reason: "startup",
			},
		});

		this.session = session;
		this.unsubscribe = session.subscribe((event) => this.handleSessionEvent(event));

		if (modelFallbackMessage) {
			diagnostics.push({ type: "warning", message: modelFallbackMessage });
		}

		const board = await this.boardStore.load(cwd);
		return {
			cwd,
			sessionId: session.sessionManager.getSessionId(),
			model: session.model ? this.modelToSummary(session.model) : undefined,
			models: this.listModels(),
			diagnostics,
			board,
		};
	}

	async prompt(
		text: string,
		selectedCards: PromptCardContext[],
		streamingBehavior?: "steer" | "followUp",
	): Promise<void> {
		this.requireConfiguredAuth();
		const session = this.requireSession();
		this.currentTurnRenderedCanvas = false;
		this.latestFinalAssistantText = undefined;
		this.promptEditTarget = selectedCards.length === 1 ? selectedCards[0] : undefined;
		const promptText =
			selectedCards.length > 0
				? `${text}\n\nSelected canvas context:\n${formatSelectedCards(selectedCards)}\n\n${formatCanvasRenderInstruction(selectedCards)}`
				: text;
		try {
			await session.prompt(promptText, { streamingBehavior });
		} finally {
			this.promptEditTarget = undefined;
		}
	}

	async abort(): Promise<void> {
		await this.session?.abort();
	}

	async promptTask(taskId: string, text: string, streamingBehavior?: "steer" | "followUp"): Promise<void> {
		this.requireConfiguredAuth();
		const task = this.requireTask(taskId);
		if (!task.session) {
			throw new Error(`Task "${task.title}" is still starting.`);
		}
		const behavior = task.session.isStreaming ? (streamingBehavior ?? "followUp") : streamingBehavior;
		if (!task.session.isStreaming) {
			task.status = "working";
			task.statusText = "Working";
			task.currentTurnRenderedCanvas = false;
			task.latestFinalAssistantText = undefined;
			this.emitTaskUpdate(task);
			this.emitTaskStatusCard(task, formatTaskWorkingBody(task));
		}
		await task.session.prompt(text, { streamingBehavior: behavior });
	}

	async abortTask(taskId: string): Promise<void> {
		const task = this.requireTask(taskId);
		await task.session?.abort();
		if (task.status === "queued" || task.status === "working") {
			this.markTaskError(task, "Aborted.");
		}
	}

	listModels(): ModelSummary[] {
		const registry = this.services?.modelRegistry ?? this.getModelRegistry();
		return registry.getAll().map((model) => this.modelToSummary(model, registry));
	}

	async setModel(provider: string, id: string): Promise<void> {
		this.requireConfiguredAuth();
		const session = this.requireSession();
		const model = this.services?.modelRegistry.find(provider, id);
		if (!model) {
			throw new Error(`Unknown model: ${provider}/${id}`);
		}
		await session.setModel(model);
		this.emit({ type: "model-selected", model: this.modelToSummary(model) });
	}

	private async disposeSession(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		await this.session?.dispose();
		this.session = undefined;
		for (const task of this.tasks.values()) {
			task.unsubscribe?.();
			task.session?.dispose();
		}
		this.tasks.clear();
	}

	private requireSession(): AgentSession {
		if (!this.session) {
			throw new Error("No analytics session is open.");
		}
		return this.session;
	}

	private requireTask(taskId: string): TaskRun {
		const task = this.tasks.get(taskId);
		if (!task) {
			throw new Error(`Unknown task: ${taskId}`);
		}
		return task;
	}

	private async dispatchParallelTasks(
		groupTitle: string,
		taskRequests: ParallelTaskRequest[],
	): Promise<{ groupId: string; tasks: TaskSnapshot[] }> {
		this.requireConfiguredAuth();
		if (taskRequests.length === 0) {
			throw new Error("At least one task is required.");
		}
		if (taskRequests.length > MAX_PARALLEL_TASKS) {
			throw new Error(`Parallel dispatch supports at most ${MAX_PARALLEL_TASKS} tasks.`);
		}
		this.requireSession();
		if (!this.services) {
			throw new Error("No analytics session services are available.");
		}

		const groupId = `task-group-${randomUUID()}`;
		const tasks = taskRequests.map((request) => this.createTaskRun(groupId, groupTitle, request));
		for (const task of tasks) {
			this.tasks.set(task.id, task);
			this.emitTaskUpdate(task);
			this.emitTaskStatusCard(task, formatTaskQueuedBody(task));
		}
		for (const task of tasks) {
			void this.startTaskAgent(task);
		}
		return { groupId, tasks: tasks.map((task) => this.taskSnapshot(task)) };
	}

	private createTaskRun(groupId: string, groupTitle: string, request: ParallelTaskRequest): TaskRun {
		const taskId = `task-${randomUUID()}`;
		return {
			id: taskId,
			groupId,
			groupTitle,
			sessionId: `task-session-${randomUUID()}`,
			cardId: `task-card-${taskId}`,
			title: normalizeTaskTitle(request.title),
			instruction: request.instruction.trim(),
			targetPaths: request.targetPaths.map((path) => path.trim()).filter(Boolean),
			requiresWrites: request.requiresWrites,
			status: "queued",
			statusText: "Queued",
			position: this.nextPosition(),
			currentTurnRenderedCanvas: false,
			latestFinalAssistantText: undefined,
		};
	}

	private async startTaskAgent(task: TaskRun): Promise<void> {
		try {
			const services = this.services;
			if (!services) {
				throw new Error("No analytics session services are available.");
			}
			const mainSession = this.requireSession();
			const sessionManager = SessionManager.inMemory(services.cwd);
			const { session } = await createAgentSessionFromServices({
				services,
				sessionManager,
				model: mainSession.model,
				thinkingLevel: mainSession.thinkingLevel,
				tools: TASK_AGENT_TOOLS,
				customTools: [
					createRenderCanvasTool({
						emit: this.emit,
						nextPosition: () => task.position,
						editTarget: () => this.taskCardContext(task),
						onRender: () => {
							task.currentTurnRenderedCanvas = true;
						},
						cardMetadata: taskCardMetadata(task),
						forceUpdateTarget: true,
					}),
				],
				sessionStartEvent: {
					type: "session_start",
					reason: "startup",
				},
			});
			task.session = session;
			task.sessionId = session.sessionManager.getSessionId();
			task.status = "working";
			task.statusText = "Working";
			task.unsubscribe = session.subscribe((event) => this.handleTaskSessionEvent(task, event));
			this.emitTaskUpdate(task);
			this.emitTaskStatusCard(task, formatTaskWorkingBody(task));
			await session.prompt(formatTaskPrompt(task), { expandPromptTemplates: false });
		} catch (error) {
			this.markTaskError(task, errorMessage(error));
		}
	}

	private handleTaskSessionEvent(task: TaskRun, event: AgentSessionEvent): void {
		this.captureTaskFinalAssistantText(task, event);
		for (const normalized of normalizeSessionEvent(event)) {
			if (normalized.type === "status") {
				if (task.status !== "error" && normalized.busy) {
					task.status = "working";
					task.statusText = normalized.text;
					this.emitTaskUpdate(task);
				}
				continue;
			}
			if (normalized.type === "chat-message") {
				this.emit({ ...normalized, taskId: task.id });
				continue;
			}
			if (normalized.type === "assistant-stream") {
				this.emit({ ...normalized, taskId: task.id });
				continue;
			}
			if (normalized.type === "queue-update") {
				this.emit({ ...normalized, taskId: task.id });
				continue;
			}
			if (normalized.type === "canvas-card") {
				this.emit({
					type: "canvas-card",
					card: {
						...normalized.card,
						...taskCardMetadata(task),
					},
				});
			}
		}
		if (event.type === "agent_end" && !event.willRetry) {
			this.renderTaskFallbackCanvasCard(task);
			if (task.status !== "error") {
				task.status = "complete";
				task.statusText = "Complete";
				this.emitTaskUpdate(task);
			}
			task.currentTurnRenderedCanvas = false;
			task.latestFinalAssistantText = undefined;
		}
	}

	private captureTaskFinalAssistantText(task: TaskRun, event: AgentSessionEvent): void {
		if (event.type !== "message_end" || messageRole(event.message) !== "assistant") {
			return;
		}
		if (messageHasToolCall(event.message)) {
			return;
		}
		const text = messageText(event.message);
		if (!text) {
			return;
		}
		task.latestFinalAssistantText = {
			id: messageId(event.message),
			text,
		};
	}

	private renderTaskFallbackCanvasCard(task: TaskRun): void {
		if (task.currentTurnRenderedCanvas || !task.latestFinalAssistantText) {
			return;
		}
		this.emit({
			type: "canvas-card",
			card: createTextCanvasCard({
				id: task.cardId,
				title: task.title,
				subtitle: "Task output",
				body: task.latestFinalAssistantText.text,
				position: task.position,
				sourceMessageIds: [task.latestFinalAssistantText.id],
				cardMetadata: taskCardMetadata(task),
			}),
		});
	}

	private markTaskError(task: TaskRun, message: string): void {
		task.status = "error";
		task.statusText = message || "Task failed";
		this.emitTaskUpdate(task);
		this.emitTaskStatusCard(task, task.statusText);
	}

	private emitTaskUpdate(task: TaskRun): void {
		this.emit({ type: "task-update", task: this.taskSnapshot(task) });
	}

	private emitTaskStatusCard(task: TaskRun, body: string): void {
		const card = createTextCanvasCard({
			id: task.cardId,
			title: task.title,
			subtitle: `${task.groupTitle} - ${task.statusText}`,
			body,
			position: task.position,
			sourceMessageIds: [],
			cardMetadata: taskCardMetadata(task),
		});
		card.type = task.status === "error" ? "error" : task.status === "complete" ? "summary" : "working";
		card.status = task.status === "queued" ? "working" : task.status;
		card.statusLabel = task.statusText;
		card.progress = task.status === "complete" || task.status === "error" ? 100 : undefined;
		this.emit({ type: "canvas-card", card });
	}

	private taskSnapshot(task: TaskRun): TaskSnapshot {
		return {
			id: task.id,
			groupId: task.groupId,
			sessionId: task.sessionId,
			cardId: task.cardId,
			title: task.title,
			status: task.status,
			statusText: task.statusText,
			targetPaths: [...task.targetPaths],
			requiresWrites: task.requiresWrites,
		};
	}

	private taskCardContext(task: TaskRun): PromptCardContext {
		return {
			id: task.cardId,
			type: task.status === "error" ? "error" : task.status === "complete" ? "summary" : "working",
			title: task.title,
			body: formatTaskWorkingBody(task),
			position: task.position,
			kept: false,
		};
	}

	private getAuthStorage(): AuthStorage {
		if (!this.authStorage) {
			this.authStorage = AuthStorage.create();
		}
		return this.authStorage;
	}

	private getModelRegistry(): ModelRegistry {
		if (!this.modelRegistry) {
			this.modelRegistry = ModelRegistry.create(this.getAuthStorage());
		}
		return this.modelRegistry;
	}

	private getProviderAuthType(providerId: string): LoginAuthType {
		const oauthProviderIds = new Set(
			this.getAuthStorage()
				.getOAuthProviders()
				.map((provider) => provider.id),
		);
		return isApiKeyLoginProvider(providerId, oauthProviderIds) ? "api_key" : "oauth";
	}

	private async loginOAuthProvider(providerId: string, openExternal: OpenExternal): Promise<void> {
		const authStorage = this.getAuthStorage();
		const provider = authStorage.getOAuthProviders().find((candidate) => candidate.id === providerId);
		if (!provider) {
			throw new Error(`Provider ${providerId} does not support subscription login.`);
		}
		await authStorage.login(providerId as OAuthProviderId, {
			onAuth: (info) => {
				this.emit({
					type: "login-status",
					message: info.instructions ?? `Browser login opened for ${provider.name}.`,
				});
				void openExternal(info.url);
			},
			onDeviceCode: (info) => {
				this.emit({
					type: "login-status",
					message: `Open ${info.verificationUri} and enter code ${info.userCode}.`,
				});
				void openExternal(info.verificationUri);
			},
			onPrompt: async (prompt) => {
				if (prompt.allowEmpty) return "";
				throw new Error(`${prompt.message} is not supported in the desktop login flow yet.`);
			},
			onProgress: (message) => {
				this.emit({ type: "login-status", message });
			},
			onSelect: async (prompt) => {
				const browserOption = prompt.options.find((option) => option.id === "browser");
				return browserOption?.id ?? prompt.options[0]?.id;
			},
		});
		this.emit({ type: "login-status", message: `Logged in to ${provider.name}.` });
	}

	private requireConfiguredAuth(): void {
		if (!this.getAuthState().loggedIn) {
			throw new Error("Login is required before using Pi Analytics.");
		}
	}

	private handleSessionEvent(event: AgentSessionEvent): void {
		this.captureFinalAssistantText(event);
		for (const normalized of normalizeSessionEvent(event)) {
			this.emit(normalized);
		}
		if (event.type === "agent_end" && !event.willRetry) {
			this.renderFallbackCanvasCard();
			this.currentTurnRenderedCanvas = false;
			this.latestFinalAssistantText = undefined;
		}
	}

	private captureFinalAssistantText(event: AgentSessionEvent): void {
		if (event.type !== "message_end" || messageRole(event.message) !== "assistant") {
			return;
		}
		if (messageHasToolCall(event.message)) {
			return;
		}
		const text = messageText(event.message);
		if (!text) {
			return;
		}
		this.latestFinalAssistantText = {
			id: messageId(event.message),
			text,
		};
	}

	private renderFallbackCanvasCard(): void {
		if (this.currentTurnRenderedCanvas || !this.latestFinalAssistantText) {
			return;
		}
		if (isClarifyingQuestion(this.latestFinalAssistantText.text)) {
			return;
		}
		const target = this.promptEditTarget;
		this.currentTurnRenderedCanvas = true;
		this.emit({
			type: "canvas-card",
			card: createTextCanvasCard({
				id: target?.id ?? `canvas-${this.latestFinalAssistantText.id}`,
				title: "Answer",
				subtitle: "Agent output",
				body: this.latestFinalAssistantText.text,
				position: target?.position ?? this.nextPosition(),
				kept: target?.kept,
				sourceMessageIds: [this.latestFinalAssistantText.id],
			}),
		});
	}

	private nextPosition(): CanvasCardPosition {
		const preset = POSITION_PRESETS[this.nextPositionIndex % POSITION_PRESETS.length];
		const loop = Math.floor(this.nextPositionIndex / POSITION_PRESETS.length);
		this.nextPositionIndex += 1;
		return {
			x: preset.x + loop * 48,
			y: preset.y + loop * 42,
			w: preset.w,
			h: preset.h,
		};
	}

	private modelToSummary(
		model: Model<Api>,
		registry: ModelRegistry | undefined = this.services?.modelRegistry,
	): ModelSummary {
		return {
			provider: model.provider,
			id: model.id,
			name: model.name,
			providerName: registry?.getProviderDisplayName(model.provider) ?? model.provider,
			configured: registry?.hasConfiguredAuth(model) ?? false,
			contextWindow: model.contextWindow,
			reasoning: model.reasoning,
		};
	}
}

function isApiKeyLoginProvider(providerId: string, oauthProviderIds: ReadonlySet<string>): boolean {
	if (BUILT_IN_PROVIDER_DISPLAY_NAMES[providerId]) {
		return true;
	}
	if (BUILT_IN_MODEL_PROVIDERS.has(providerId)) {
		return false;
	}
	return !oauthProviderIds.has(providerId);
}

function formatSelectedCards(cards: PromptCardContext[]): string {
	return cards
		.map(
			(card) => `- ${card.title} (${card.type}, id ${card.id}, ${card.position.w}x${card.position.h}): ${card.body}`,
		)
		.join("\n");
}

function formatCanvasRenderInstruction(cards: PromptCardContext[]): string {
	if (cards.length === 1) {
		return [
			"Canvas render behavior:",
			"- Treat the selected canvas item as the current item.",
			"- If the user asks to revise, edit, change, fix, refine, or update it, call render_canvas and let it update the selected item in place.",
			"- Set render_canvas mode to create only if the user explicitly asks for a new, additional, duplicate, or separate canvas item.",
		].join("\n");
	}
	return [
		"Canvas render behavior:",
		"- Multiple canvas items are selected, so render_canvas creates a new result unless the user clearly asks for one specific selected item to be changed.",
	].join("\n");
}

function taskCardMetadata(task: TaskRun): Pick<CanvasCard, "taskId" | "taskGroupId" | "taskSessionId"> {
	return {
		taskId: task.id,
		taskGroupId: task.groupId,
		taskSessionId: task.sessionId,
	};
}

function formatTaskPrompt(task: TaskRun): string {
	return [
		`Task group: ${task.groupTitle}`,
		`Task: ${task.title}`,
		`Instruction:\n${task.instruction}`,
		formatTaskTargetPaths(task),
		task.requiresWrites
			? "This task may edit or create files. Keep file changes scoped to this task's target paths unless the instruction explicitly requires otherwise."
			: "Prefer read-only work unless the instruction explicitly requires an edit.",
		"Work independently from the main chat and other task agents. Use normal read, shell, edit, and write tools as needed.",
		"Update the assigned canvas task card with render_canvas when the task is complete. Keep the output concise and presentation-ready.",
	]
		.filter(Boolean)
		.join("\n\n");
}

function formatTaskQueuedBody(task: TaskRun): string {
	return [`Queued task agent.`, `Instruction:\n${task.instruction}`, formatTaskTargetPaths(task)]
		.filter(Boolean)
		.join("\n\n");
}

function formatTaskWorkingBody(task: TaskRun): string {
	return [`Task agent is working.`, `Instruction:\n${task.instruction}`, formatTaskTargetPaths(task)]
		.filter(Boolean)
		.join("\n\n");
}

function formatTaskTargetPaths(task: TaskRun): string {
	if (task.targetPaths.length === 0) {
		return "";
	}
	return `Target paths:\n${task.targetPaths.map((path) => `- ${path}`).join("\n")}`;
}

function normalizeTaskTitle(title: string): string {
	const trimmed = title.trim().replace(/\s+/g, " ");
	if (!trimmed) {
		return "Parallel task";
	}
	return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function messageId(message: AgentMessage): string {
	if ("responseId" in message && typeof message.responseId === "string") return message.responseId;
	if ("timestamp" in message && typeof message.timestamp === "number")
		return `${messageRole(message)}-${message.timestamp}`;
	return `message-${messageRole(message)}`;
}

function messageRole(message: AgentMessage): string {
	return "role" in message && typeof message.role === "string" ? message.role : "unknown";
}

function messageText(message: AgentMessage): string {
	return "content" in message ? textFromContent(message.content) : "";
}

function messageHasToolCall(message: AgentMessage): boolean {
	if (!("content" in message) || !Array.isArray(message.content)) {
		return false;
	}
	return message.content.some((item) => isRecord(item) && item.type === "toolCall");
}

function isClarifyingQuestion(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed.includes("?")) {
		return false;
	}
	const words = trimmed.split(/\s+/);
	if (words.length > 160) {
		return false;
	}
	const sentences = trimmed
		.split(/(?<=[.!?])\s+/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);
	const questionCount = sentences.filter((sentence) => sentence.endsWith("?")).length;
	return questionCount > 0 && questionCount >= Math.ceil(sentences.length / 2);
}
