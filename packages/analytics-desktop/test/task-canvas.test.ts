import { describe, expect, it } from "vitest";
import { createRenderCanvasTool, createTextCanvasCard } from "../src/main/canvas-tool.ts";
import type { PromptCardContext } from "../src/shared/canvas.ts";
import type { MainToRendererEvent } from "../src/shared/ipc.ts";

type RenderCanvasTool = ReturnType<typeof createRenderCanvasTool>;
type RenderCanvasParams = Parameters<RenderCanvasTool["execute"]>[1];
type RenderCanvasContext = Parameters<RenderCanvasTool["execute"]>[4];

const extensionContext = {} as RenderCanvasContext;

describe("task canvas cards", () => {
	it("stores task metadata on text cards", () => {
		const card = createTextCanvasCard({
			id: "task-card-1",
			title: "File summary",
			subtitle: "Working",
			body: "Queued",
			position: { x: 1, y: 2, w: 300, h: 200 },
			sourceMessageIds: [],
			cardMetadata: {
				taskId: "task-1",
				taskGroupId: "task-group-1",
				taskSessionId: "task-session-1",
			},
		});

		expect(card).toMatchObject({
			id: "task-card-1",
			taskId: "task-1",
			taskGroupId: "task-group-1",
			taskSessionId: "task-session-1",
		});
	});

	it("forces task render_canvas calls to update the assigned task card", async () => {
		const events: MainToRendererEvent[] = [];
		const target: PromptCardContext = {
			id: "task-card-1",
			type: "working",
			title: "File summary",
			body: "Working",
			position: { x: 10, y: 20, w: 320, h: 220 },
			kept: false,
		};
		const tool = createRenderCanvasTool({
			emit: (event) => events.push(event),
			nextPosition: () => ({ x: 100, y: 120, w: 400, h: 240 }),
			editTarget: () => target,
			forceUpdateTarget: true,
			cardMetadata: {
				taskId: "task-1",
				taskGroupId: "task-group-1",
				taskSessionId: "task-session-1",
			},
		});
		const params = {
			title: "File summary",
			subtitle: "Complete",
			body: "Completed summary.",
			format: "text",
			mode: "create",
		} satisfies RenderCanvasParams;

		const result = await tool.execute("render-1", params, undefined, undefined, extensionContext);

		expect(result.details).toEqual({ cardId: "task-card-1", mode: "updated" });
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "canvas-card",
			card: {
				id: "task-card-1",
				title: "File summary",
				body: "Completed summary.",
				taskId: "task-1",
				taskGroupId: "task-group-1",
				taskSessionId: "task-session-1",
				position: target.position,
			},
		});
	});
});
