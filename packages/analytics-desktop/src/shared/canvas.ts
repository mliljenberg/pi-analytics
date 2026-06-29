export type CanvasCardType = "summary" | "chart" | "diagram" | "table" | "report" | "tool" | "working" | "error";

export type CanvasCardStatus = "working" | "complete" | "kept" | "error";

export interface CanvasCardPosition {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface MetricRow {
	label: string;
	value: number;
}

export interface ReportSection {
	title: string;
	body: string;
}

export interface CanvasCard {
	id: string;
	type: CanvasCardType;
	title: string;
	subtitle: string;
	body: string;
	status: CanvasCardStatus;
	statusLabel: string;
	position: CanvasCardPosition;
	progress?: number;
	kept: boolean;
	points?: string[];
	metrics?: MetricRow[];
	rows?: string[][];
	nodes?: string[];
	sections?: ReportSection[];
	sourceMessageIds: string[];
	toolCallId?: string;
}

export interface PromptCardContext {
	id: string;
	type: CanvasCardType;
	title: string;
	body: string;
}

export interface PersistedBoard {
	version: 1;
	cwd: string;
	sessionId: string;
	cards: CanvasCard[];
	shareReady: boolean;
	updatedAt: string;
}
