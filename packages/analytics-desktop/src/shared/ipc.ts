import type { CanvasCard, PersistedBoard, PromptCardContext } from "./canvas.ts";

export const IPC = {
	getAuthState: "analytics:get-auth-state",
	loginProvider: "analytics:login-provider",
	listRecentWorkspaces: "analytics:list-recent-workspaces",
	selectWorkspaceFolder: "analytics:select-workspace-folder",
	startSession: "analytics:start-session",
	sendPrompt: "analytics:send-prompt",
	abortPrompt: "analytics:abort-prompt",
	listModels: "analytics:list-models",
	setModel: "analytics:set-model",
	saveBoard: "analytics:save-board",
	exportReport: "analytics:export-report",
	rendererEvent: "analytics:renderer-event",
} as const;

export interface AppDiagnostic {
	type: "info" | "warning" | "error";
	message: string;
}

export interface ModelSummary {
	provider: string;
	id: string;
	name: string;
	providerName: string;
	configured: boolean;
	contextWindow: number;
	reasoning: boolean;
}

export interface ProviderSummary {
	id: string;
	name: string;
	authType: "api_key" | "oauth";
	configured: boolean;
	modelCount: number;
}

export interface AuthState {
	loggedIn: boolean;
	providers: ProviderSummary[];
	models: ModelSummary[];
}

export interface LoginProviderRequest {
	provider: string;
	apiKey?: string;
}

export interface WorkspaceFolder {
	path: string;
}

export interface RecentWorkspace {
	path: string;
	name: string;
	openedAt: string;
}

export interface SessionSnapshot {
	cwd: string;
	sessionId: string;
	model?: ModelSummary;
	models: ModelSummary[];
	diagnostics: AppDiagnostic[];
	board?: PersistedBoard;
}

export interface SendPromptRequest {
	text: string;
	selectedCards: PromptCardContext[];
	streamingBehavior?: "steer" | "followUp";
}

export type TaskStatus = "queued" | "working" | "complete" | "error";

export interface TaskSnapshot {
	id: string;
	groupId: string;
	sessionId: string;
	cardId: string;
	title: string;
	status: TaskStatus;
	statusText: string;
	targetPaths: string[];
	requiresWrites: boolean;
}

export interface TaskPromptRequest {
	taskId: string;
	text: string;
	streamingBehavior?: "steer" | "followUp";
}

export interface SetModelRequest {
	provider: string;
	id: string;
}

export interface SaveBoardRequest {
	board: PersistedBoard;
}

export interface ExportReportRequest {
	cards: CanvasCard[];
}

export interface ChatMessageEvent {
	type: "chat-message";
	id: string;
	author: "You" | "Pi" | "System";
	text: string;
	timestamp: string;
	taskId?: string;
}

export type MainToRendererEvent =
	| { type: "status"; text: string; busy: boolean }
	| { type: "login-status"; message: string }
	| { type: "diagnostic"; diagnostic: AppDiagnostic }
	| { type: "assistant-stream"; id: string; text: string; taskId?: string }
	| { type: "canvas-card"; card: CanvasCard }
	| { type: "model-selected"; model: ModelSummary }
	| { type: "queue-update"; steering: readonly string[]; followUp: readonly string[]; taskId?: string }
	| { type: "task-update"; task: TaskSnapshot }
	| { type: "exported-report"; filePath: string }
	| ChatMessageEvent;

export interface AnalyticsDesktopApi {
	getAuthState(): Promise<AuthState>;
	loginProvider(request: LoginProviderRequest): Promise<AuthState>;
	listRecentWorkspaces(): Promise<RecentWorkspace[]>;
	selectWorkspaceFolder(): Promise<WorkspaceFolder | undefined>;
	startSession(cwd: string): Promise<SessionSnapshot>;
	sendPrompt(request: SendPromptRequest): Promise<void>;
	abortPrompt(): Promise<void>;
	listModels(): Promise<ModelSummary[]>;
	setModel(request: SetModelRequest): Promise<void>;
	saveBoard(request: SaveBoardRequest): Promise<void>;
	exportReport(request: ExportReportRequest): Promise<string | undefined>;
	onEvent(listener: (event: MainToRendererEvent) => void): () => void;
}
