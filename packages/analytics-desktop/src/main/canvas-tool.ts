import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { defineTool } from "@earendil-works/pi-coding-agent/core/extensions";
import { type Static, Type } from "typebox";
import type { CanvasCard, CanvasCardPosition, CanvasCardType, PromptCardContext } from "../shared/canvas.ts";
import type { MainToRendererEvent } from "../shared/ipc.ts";

const canvasArtifactSchema = Type.Object({
	title: Type.String({
		description: "Short title shown in the canvas card header.",
	}),
	subtitle: Type.Optional(
		Type.String({
			description: "Short supporting label shown below the title.",
		}),
	),
	body: Type.Optional(
		Type.String({
			description: "Plain-text summary or fallback for the canvas card.",
		}),
	),
	format: Type.Optional(
		Type.Union([Type.Literal("html"), Type.Literal("svg"), Type.Literal("text")], {
			description: "Use html or svg for rich visual output; use text for a simple summary card.",
		}),
	),
	html: Type.Optional(
		Type.String({
			description: "Self-contained HTML or SVG fragment to render inside the canvas card. Do not include scripts.",
		}),
	),
	width: Type.Optional(
		Type.Number({
			description: "Canvas card width in pixels.",
			minimum: 240,
			maximum: 960,
		}),
	),
	height: Type.Optional(
		Type.Number({
			description: "Canvas card minimum height in pixels.",
			minimum: 160,
			maximum: 720,
		}),
	),
	mode: Type.Optional(
		Type.Union([Type.Literal("update"), Type.Literal("create")], {
			description:
				"Use update for revisions to the selected canvas item. Use create only when the user explicitly asks for a new, additional, or separate canvas item.",
		}),
	),
});

type CanvasArtifactInput = Static<typeof canvasArtifactSchema>;

interface RenderCanvasDetails {
	cardId: string;
	mode: "created" | "updated";
}

interface CreateRenderCanvasToolOptions {
	emit: (event: MainToRendererEvent) => void;
	nextPosition: () => CanvasCardPosition;
	editTarget: () => PromptCardContext | undefined;
	onRender?: () => void;
}

interface TextCanvasCardOptions {
	id: string;
	title: string;
	subtitle: string;
	body: string;
	position: CanvasCardPosition;
	kept?: boolean;
	sourceMessageIds: string[];
}

const DEFAULT_CARD_WIDTH = 460;
const DEFAULT_CARD_HEIGHT = 320;

export function createRenderCanvasTool({ emit, nextPosition, editTarget, onRender }: CreateRenderCanvasToolOptions) {
	return defineTool({
		name: "render_canvas",
		label: "render canvas",
		description:
			"Render a deliberate final output on the Pi Analytics canvas. Use this when the user's request has been answered enough to decide the best visual presentation. Supports plain text, HTML, and SVG fragments.",
		promptSnippet: "Render a final text, HTML, or SVG artifact on the canvas",
		promptGuidelines: [
			"Use chat for concise progress updates while working so the user can see what is happening.",
			"Use render_canvas for the completed output whenever you can answer the user; the normal exception is when you need to ask a clarifying question.",
			"Use render_canvas only for final or presentation-ready output.",
			"Do not use render_canvas for tool calls, thinking, scratch work, or intermediate results.",
			"When visual output helps, call render_canvas with a self-contained HTML or SVG fragment instead of describing the layout in chat.",
			"When exactly one canvas item is selected, render_canvas updates that item in place by default. Set mode to create only if the user explicitly asked for a new, additional, or separate canvas item.",
			"Use renderer/src/canvas-artifacts.css as the style guide for generated HTML: prefer shared classes such as artifact, artifact-header, artifact-title, artifact-subtitle, artifact-grid, artifact-panel, artifact-label, artifact-value, artifact-text, artifact-list, artifact-table, artifact-bar, artifact-track, artifact-fill, and artifact-status for consistent structure. Inline styles are allowed when needed for artifact-specific layout, emphasis, SVG styling, or values like bar widths, but keep them consistent with the app palette, spacing, typography, and 8px radius.",
			"After render_canvas succeeds, do not repeat the rendered artifact in chat unless the user asks for text output too.",
		],
		parameters: canvasArtifactSchema,
		executionMode: "sequential",
		async execute(toolCallId, params): Promise<AgentToolResult<RenderCanvasDetails>> {
			const target = params.mode === "create" ? undefined : editTarget();
			const card = createCanvasCard(toolCallId, params, target?.position ?? nextPosition(), target);
			const mode = target ? "updated" : "created";
			onRender?.();
			emit({ type: "canvas-card", card });
			return {
				content: [
					{ type: "text", text: `${mode === "updated" ? "Updated" : "Rendered"} "${card.title}" on the canvas.` },
				],
				details: { cardId: card.id, mode },
				terminate: true,
			};
		},
	});
}

export function createTextCanvasCard({
	id,
	title,
	subtitle,
	body,
	position,
	kept = false,
	sourceMessageIds,
}: TextCanvasCardOptions): CanvasCard {
	const normalizedBody = normalizeText(body, "Completed.");
	return {
		id,
		type: "summary",
		title: normalizeText(title, "Answer"),
		subtitle,
		body: normalizedBody,
		status: kept ? "kept" : "complete",
		statusLabel: kept ? "Kept" : "Complete",
		position,
		kept,
		points: splitSummaryPoints(normalizedBody),
		sourceMessageIds,
	};
}

function createCanvasCard(
	toolCallId: string,
	params: CanvasArtifactInput,
	position: CanvasCardPosition,
	editTarget: PromptCardContext | undefined,
): CanvasCard {
	const html = params.html?.trim();
	const type = canvasCardType(params.format, html);
	const title = normalizeText(params.title, "Canvas artifact");
	const subtitle = normalizeText(params.subtitle, type === "html" ? "Rendered artifact" : "Agent output");
	const body = normalizeText(params.body, html ? "Rendered visual artifact." : "");
	const kept = editTarget?.kept ?? false;
	return {
		id: editTarget?.id ?? `canvas-${toolCallId}`,
		type,
		title,
		subtitle,
		body,
		html,
		status: kept ? "kept" : "complete",
		statusLabel: kept ? "Kept" : "Complete",
		position: {
			x: position.x,
			y: position.y,
			w: clampDimension(params.width, position.w || DEFAULT_CARD_WIDTH, 240, 960),
			h: clampDimension(params.height, position.h || DEFAULT_CARD_HEIGHT, 160, 720),
		},
		kept,
		points: type === "summary" ? splitSummaryPoints(body) : undefined,
		sourceMessageIds: [],
		toolCallId,
	};
}

function canvasCardType(format: CanvasArtifactInput["format"], html: string | undefined): CanvasCardType {
	if (format === "html" || format === "svg" || html) {
		return "html";
	}
	return "summary";
}

function normalizeText(value: string | undefined, fallback: string): string {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function clampDimension(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.round(value)));
}

function splitSummaryPoints(body: string): string[] {
	return body
		.split(/\n+/)
		.map((line) => line.replace(/^[-*]\s+/, "").trim())
		.filter(Boolean)
		.slice(0, 4);
}
