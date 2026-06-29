import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent/core/agent-session";
import {
	type AgentSessionServices,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "@earendil-works/pi-coding-agent/core/agent-session-services";
import { SessionManager } from "@earendil-works/pi-coding-agent/core/session-manager";
import type { CanvasCardPosition, PromptCardContext } from "../shared/canvas.ts";
import { normalizeSessionEvent } from "../shared/card-events.ts";
import type { AppDiagnostic, MainToRendererEvent, ModelSummary, SessionSnapshot } from "../shared/ipc.ts";
import type { BoardStore } from "./board-store.ts";

type EmitEvent = (event: MainToRendererEvent) => void;

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
	private session: AgentSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private nextPositionIndex = 0;

	constructor(boardStore: BoardStore, emit: EmitEvent) {
		this.boardStore = boardStore;
		this.emit = emit;
	}

	async start(cwd: string): Promise<SessionSnapshot> {
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
			tools: ["read", "grep", "find", "ls"],
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
		const session = this.requireSession();
		const promptText =
			selectedCards.length > 0 ? `${text}\n\nSelected canvas context:\n${formatSelectedCards(selectedCards)}` : text;
		await session.prompt(promptText);
	}

	async abort(): Promise<void> {
		await this.session?.abort();
	}

	listModels(): ModelSummary[] {
		if (!this.services) return [];
		return this.services.modelRegistry.getAll().map((model) => this.modelToSummary(model));
	}

	async setModel(provider: string, id: string): Promise<void> {
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

	private handleSessionEvent(event: AgentSessionEvent): void {
		for (const normalized of normalizeSessionEvent(event, () => this.nextPosition())) {
			this.emit(normalized);
		}
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

	private modelToSummary(model: Model<Api>): ModelSummary {
		const registry = this.services?.modelRegistry;
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

function formatSelectedCards(cards: PromptCardContext[]): string {
	return cards.map((card) => `- ${card.title} (${card.type}): ${card.body}`).join("\n");
}
