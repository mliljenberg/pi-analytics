import type { CanvasCard } from "../../src/shared/canvas.ts";
import type {
	ModelSummary,
	ProviderSummary,
	RecentWorkspace,
	TaskSnapshot,
} from "../../src/shared/ipc.ts";
import { DEFAULT_CANVAS_VIEWPORT, type CanvasViewport } from "./canvas/viewport.ts";
import type { ChatDockPosition } from "./preferences.ts";

export interface ChatMessage {
	id: string;
	author: "You" | "Pi" | "System";
	text: string;
	timestamp: string;
}

export interface StreamingMessage {
	id: string;
	text: string;
}

export interface TaskView extends TaskSnapshot {
	messages: ChatMessage[];
	streaming?: StreamingMessage;
	queuedSteering: string[];
	queuedFollowUp: string[];
}

export interface AppState {
	authenticated: boolean;
	authProviders: ProviderSummary[];
	pendingModelValue?: string;
	cwd?: string;
	sessionId?: string;
	model?: ModelSummary;
	models: ModelSummary[];
	recentWorkspaces: RecentWorkspace[];
	cards: CanvasCard[];
	messages: ChatMessage[];
	streaming?: StreamingMessage;
	queuedSteering: string[];
	queuedFollowUp: string[];
	tasks: Map<string, TaskView>;
	taskOrder: string[];
	activeTaskId?: string;
	selectedIds: Set<string>;
	loadingCardIds: Set<string>;
	activeModalId?: string;
	busy: boolean;
	statusText: string;
	shareReady: boolean;
	htmlCanvasActive: boolean;
	htmlCanvasFailed: boolean;
	viewport: CanvasViewport;
	chatDockPosition: ChatDockPosition;
	chatDockMinimized: boolean;
}

export function createInitialState(
	chatDockPosition: ChatDockPosition,
	chatDockMinimized: boolean,
	timestamp = new Date().toISOString(),
): AppState {
	return {
		authenticated: false,
		authProviders: [],
		models: [],
		recentWorkspaces: [],
		cards: [],
		messages: [
			{
				id: "system-start",
				author: "System",
				text: "Open a folder to start an analytics session.",
				timestamp,
			},
		],
		queuedSteering: [],
		queuedFollowUp: [],
		tasks: new Map(),
		taskOrder: [],
		selectedIds: new Set(),
		loadingCardIds: new Set(),
		busy: false,
		statusText: "No workspace",
		shareReady: false,
		htmlCanvasActive: false,
		htmlCanvasFailed: false,
		viewport: { ...DEFAULT_CANVAS_VIEWPORT },
		chatDockPosition,
		chatDockMinimized,
	};
}
