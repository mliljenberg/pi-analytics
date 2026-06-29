import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent/core/agent-session";
import { describe, expect, it } from "vitest";
import type { CanvasCardPosition } from "../src/shared/canvas.ts";
import { normalizeSessionEvent } from "../src/shared/card-events.ts";

const position: CanvasCardPosition = {
	x: 10,
	y: 20,
	w: 300,
	h: 220,
};

describe("normalizeSessionEvent", () => {
	it("creates an analysis card from an assistant message", () => {
		const events = normalizeSessionEvent(
			{
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
			} as AgentSessionEvent,
			() => position,
		);

		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			type: "analysis-card",
			card: {
				title: "Assistant analysis",
				body: "Revenue increased.\nCosts need review.",
				position,
			},
		});
	});

	it("creates and completes tool cards", () => {
		const start = normalizeSessionEvent(
			{
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "read",
				args: { path: "data.csv" },
			},
			() => position,
		);
		const end = normalizeSessionEvent(
			{
				type: "tool_execution_end",
				toolCallId: "tool-1",
				toolName: "read",
				result: { content: [{ type: "text", text: "ok" }] },
				isError: false,
			},
			() => position,
		);

		expect(start[0]).toMatchObject({
			type: "tool-card-start",
			card: {
				toolCallId: "tool-1",
				status: "working",
			},
		});
		expect(end[0]).toMatchObject({
			type: "tool-card-end",
			toolCallId: "tool-1",
			isError: false,
		});
	});
});
