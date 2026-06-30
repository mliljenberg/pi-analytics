import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent/core/agent-session";
import type { MainToRendererEvent } from "./ipc.ts";
import { textFromContent } from "./text.ts";

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

export function normalizeSessionEvent(event: AgentSessionEvent): MainToRendererEvent[] {
	if (event.type === "agent_start") {
		return [{ type: "status", text: "Agent working", busy: true }];
	}
	if (event.type === "agent_end") {
		return [{ type: "status", text: event.willRetry ? "Retrying" : "Ready", busy: event.willRetry }];
	}
	if (event.type === "queue_update") {
		return [{ type: "queue-update", steering: event.steering, followUp: event.followUp }];
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
		const text = messageText(event.message);
		if (!text) {
			return [];
		}
		return [
			{
				type: "assistant-stream",
				id: messageId(event.message),
				text,
			},
		];
	}
	if (event.type === "message_end" && messageRole(event.message) === "assistant") {
		const text = messageText(event.message);
		if (!text) {
			return [];
		}
		return [
			{
				type: "chat-message",
				id: messageId(event.message),
				author: "Pi",
				text,
				timestamp: new Date().toISOString(),
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
