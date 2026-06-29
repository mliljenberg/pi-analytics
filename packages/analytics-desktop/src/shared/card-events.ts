import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent/core/agent-session";
import type { CanvasCard, CanvasCardPosition } from "./canvas.ts";
import type { MainToRendererEvent } from "./ipc.ts";
import { previewUnknown, textFromContent } from "./text.ts";

const DEFAULT_POSITION: CanvasCardPosition = {
	x: 72,
	y: 70,
	w: 340,
	h: 256,
};

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

export function createAnalysisCard(message: AgentMessage, position: CanvasCardPosition = DEFAULT_POSITION): CanvasCard {
	const text = messageText(message);
	const title = text.toLowerCase().includes("report") ? "Analysis report" : "Assistant analysis";
	const type = title === "Analysis report" ? "report" : "summary";
	const body = text || "The assistant completed the turn without text output.";

	return {
		id: `card-${messageId(message)}`,
		type,
		title,
		subtitle: "Agent output",
		body,
		status: "complete",
		statusLabel: "Complete",
		position,
		kept: false,
		points: type === "summary" ? splitSummaryPoints(body) : undefined,
		sections: type === "report" ? reportSections(body) : undefined,
		sourceMessageIds: [messageId(message)],
	};
}

export function createToolCard(
	toolCallId: string,
	toolName: string,
	args: unknown,
	position: CanvasCardPosition,
): CanvasCard {
	return {
		id: `tool-${toolCallId}`,
		type: "tool",
		title: toolName,
		subtitle: "Tool running",
		body: previewUnknown(args, 700),
		status: "working",
		statusLabel: "Working",
		position,
		progress: 35,
		kept: false,
		sourceMessageIds: [],
		toolCallId,
	};
}

export function completeToolCardBody(result: unknown): string {
	return previewUnknown(result, 1400);
}

export function normalizeSessionEvent(
	event: AgentSessionEvent,
	nextPosition: () => CanvasCardPosition,
): MainToRendererEvent[] {
	if (event.type === "agent_start") {
		return [{ type: "status", text: "Agent working", busy: true }];
	}
	if (event.type === "agent_end") {
		return [{ type: "status", text: event.willRetry ? "Retrying" : "Ready", busy: event.willRetry }];
	}
	if (event.type === "message_start" && messageRole(event.message) === "user") {
		return [
			{
				type: "chat-message",
				id: messageId(event.message),
				author: "You",
				text: messageText(event.message),
				timestamp: new Date().toISOString(),
			},
		];
	}
	if (event.type === "message_update" && messageRole(event.message) === "assistant") {
		return [
			{
				type: "assistant-stream",
				id: messageId(event.message),
				text: messageText(event.message),
			},
		];
	}
	if (event.type === "message_end" && messageRole(event.message) === "assistant") {
		const text = messageText(event.message);
		return [
			{
				type: "chat-message",
				id: messageId(event.message),
				author: "Pi",
				text,
				timestamp: new Date().toISOString(),
			},
			{ type: "analysis-card", card: createAnalysisCard(event.message, nextPosition()) },
		];
	}
	if (event.type === "tool_execution_start") {
		return [
			{
				type: "tool-card-start",
				card: createToolCard(event.toolCallId, event.toolName, event.args, nextPosition()),
			},
		];
	}
	if (event.type === "tool_execution_end") {
		return [
			{
				type: "tool-card-end",
				toolCallId: event.toolCallId,
				body: completeToolCardBody(event.result),
				isError: event.isError,
			},
		];
	}
	if (event.type === "compaction_start") {
		return [{ type: "status", text: "Compacting context", busy: true }];
	}
	if (event.type === "compaction_end") {
		return [{ type: "status", text: event.aborted ? "Compaction aborted" : "Ready", busy: false }];
	}
	if (event.type === "auto_retry_start") {
		return [
			{ type: "status", text: `Retrying after provider error (${event.attempt}/${event.maxAttempts})`, busy: true },
		];
	}
	if (event.type === "auto_retry_end") {
		return [{ type: "status", text: event.success ? "Ready" : "Retry failed", busy: false }];
	}

	return [];
}

function splitSummaryPoints(body: string): string[] {
	return body
		.split(/\n+/)
		.map((line) => line.replace(/^[-*]\s+/, "").trim())
		.filter(Boolean)
		.slice(0, 4);
}

function reportSections(body: string) {
	const paragraphs = body
		.split(/\n{2,}/)
		.map((line) => line.trim())
		.filter(Boolean);
	return [
		{ title: "Summary", body: paragraphs[0] ?? body },
		{ title: "Evidence", body: paragraphs[1] ?? "Evidence is available in the session transcript and tool cards." },
		{ title: "Next step", body: paragraphs[2] ?? "Ask a follow-up or export this report." },
	];
}
