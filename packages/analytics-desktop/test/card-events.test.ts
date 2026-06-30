import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent/core/agent-session";
import { describe, expect, it } from "vitest";
import { normalizeSessionEvent } from "../src/shared/card-events.ts";

describe("normalizeSessionEvent", () => {
	it("keeps assistant messages in chat without creating canvas cards", () => {
		const events = normalizeSessionEvent({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Revenue increased.\nCosts need review." }],
				api: "openai-responses",
				provider: "openai",
				model: "test-model",
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 123,
			},
		} as AgentSessionEvent);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "chat-message",
			author: "Pi",
			text: "Revenue increased.\nCosts need review.",
		});
	});

	it("does not expose tool calls as canvas cards", () => {
		const start = normalizeSessionEvent({
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "read",
			args: { path: "data.csv" },
		});
		const end = normalizeSessionEvent({
			type: "tool_execution_end",
			toolCallId: "tool-1",
			toolName: "read",
			result: { content: [{ type: "text", text: "ok" }] },
			isError: false,
		});

		expect(start).toEqual([]);
		expect(end).toEqual([]);
	});

	it("shows provider error details when a retry starts", () => {
		const events = normalizeSessionEvent({
			type: "auto_retry_start",
			attempt: 2,
			maxAttempts: 3,
			delayMs: 1000,
			errorMessage: "Provider returned error: overloaded_error",
		});

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			type: "chat-message",
			author: "System",
			text: "Provider error (2/3): Provider returned error: overloaded_error",
		});
		expect(events[1]).toMatchObject({
			type: "status",
			text: "Retrying after provider error (2/3): Provider returned error: overloaded_error",
			busy: true,
		});
	});

	it("shows provider error details when retries fail", () => {
		const events = normalizeSessionEvent({
			type: "auto_retry_end",
			success: false,
			attempt: 3,
			finalError: "Rate limit exceeded",
		});

		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			type: "chat-message",
			author: "System",
			text: "Retry failed: Rate limit exceeded",
		});
		expect(events[1]).toMatchObject({
			type: "status",
			text: "Retry failed: Rate limit exceeded",
			busy: false,
		});
	});
});
