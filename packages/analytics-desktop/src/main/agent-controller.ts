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
import type { CanvasCardPosition, PromptCardContext } from "../shared/canvas.ts";
import { normalizeSessionEvent } from "../shared/card-events.ts";
import type { AppDiagnostic, AuthState, MainToRendererEvent, ModelSummary, SessionSnapshot } from "../shared/ipc.ts";
import { isRecord, textFromContent } from "../shared/text.ts";
import type { BoardStore } from "./board-store.ts";
import { createRenderCanvasTool, createTextCanvasCard } from "./canvas-tool.ts";

type EmitEvent = (event: MainToRendererEvent) => void;
type OpenExternal = (url: string) => Promise<void>;
type LoginAuthType = "api_key" | "oauth";

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

export class AgentController {
	private readonly boardStore: BoardStore;
	private readonly emit: EmitEvent;
	private services: AgentSessionServices | undefined;
	private authStorage: AuthStorage | undefined;
	private modelRegistry: ModelRegistry | undefined;
	private session: AgentSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private nextPositionIndex = 0;
	private currentTurnRenderedCanvas = false;
	private latestFinalAssistantText:
		| {
				id: string;
				text: string;
		  }
		| undefined;

	constructor(boardStore: BoardStore, emit: EmitEvent) {
		this.boardStore = boardStore;
		this.emit = emit;
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

		this.services = await createAgentSessionServices({ cwd });
		const diagnostics: AppDiagnostic[] = this.services.diagnostics.map((diagnostic) => ({
			type: diagnostic.type,
			message: diagnostic.message,
		}));

		const sessionManager = SessionManager.continueRecent(cwd);
		const { session, modelFallbackMessage } = await createAgentSessionFromServices({
			services: this.services,
			sessionManager,
			tools: ["read", "grep", "find", "ls", "render_canvas"],
			customTools: [
				createRenderCanvasTool({
					emit: this.emit,
					nextPosition: () => this.nextPosition(),
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

	async prompt(text: string, selectedCards: PromptCardContext[]): Promise<void> {
		this.requireConfiguredAuth();
		const session = this.requireSession();
		this.currentTurnRenderedCanvas = false;
		this.latestFinalAssistantText = undefined;
		const promptText =
			selectedCards.length > 0 ? `${text}\n\nSelected canvas context:\n${formatSelectedCards(selectedCards)}` : text;
		await session.prompt(promptText);
	}

	async abort(): Promise<void> {
		await this.session?.abort();
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
	}

	private requireSession(): AgentSession {
		if (!this.session) {
			throw new Error("No analytics session is open.");
		}
		return this.session;
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
		this.currentTurnRenderedCanvas = true;
		this.emit({
			type: "canvas-card",
			card: createTextCanvasCard({
				id: `canvas-${this.latestFinalAssistantText.id}`,
				title: "Answer",
				subtitle: "Agent output",
				body: this.latestFinalAssistantText.text,
				position: this.nextPosition(),
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
	return cards.map((card) => `- ${card.title} (${card.type}): ${card.body}`).join("\n");
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
