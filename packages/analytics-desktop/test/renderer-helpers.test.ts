import { describe, expect, it } from "vitest";
import { positionsOverlap, resolveNewCardPosition } from "../renderer/src/canvas/placement.ts";
import { panCanvasViewport, positiveModulo, zoomCanvasViewport } from "../renderer/src/canvas/viewport.ts";
import { compactPath, errorMessage, modelValue, workspaceLabel } from "../renderer/src/labels.ts";
import {
	readChatDockMinimized,
	readChatDockPosition,
	writeChatDockMinimized,
	writeChatDockPosition,
} from "../renderer/src/preferences.ts";
import { deleteCardById, keepSelectedCards, selectedCards, toggleCardSelection } from "../renderer/src/selection.ts";
import { createInitialState } from "../renderer/src/state.ts";
import { activeTaskView, applyTaskSnapshot, visibleTaskViews } from "../renderer/src/tasks.ts";
import type { CanvasCard, CanvasCardPosition } from "../src/shared/canvas.ts";
import type { ModelSummary, RecentWorkspace, TaskSnapshot } from "../src/shared/ipc.ts";

describe("renderer canvas placement helpers", () => {
	it("normalizes a free card position without moving it", () => {
		const position = resolveNewCardPosition({ x: 10.4, y: 20.6, w: 300.2, h: 200.8 }, []);

		expect(position).toEqual({ x: 10, y: 21, w: 300, h: 201 });
	});

	it("places overlapping cards to the right of the current row", () => {
		const cards = [card("a", { x: 72, y: 70, w: 300, h: 220 }), card("b", { x: 404, y: 80, w: 300, h: 220 })];

		const position = resolveNewCardPosition({ x: 80, y: 90, w: 280, h: 180 }, cards);

		expect(position).toEqual({ x: 736, y: 70, w: 280, h: 180 });
	});

	it("treats the configured gap as part of the overlap boundary", () => {
		const first = { x: 0, y: 0, w: 100, h: 100 };
		const touchingGap = { x: 131, y: 0, w: 100, h: 100 };
		const outsideGap = { x: 132, y: 0, w: 100, h: 100 };

		expect(positionsOverlap(first, touchingGap)).toBe(true);
		expect(positionsOverlap(first, outsideGap)).toBe(false);
	});
});

describe("renderer canvas viewport helpers", () => {
	it("calculates panning from the original pointer position", () => {
		const viewport = panCanvasViewport({ x: 20, y: 30, zoom: 1.25 }, { x: 20, y: 30 }, 100, 80, 130, 70);

		expect(viewport).toEqual({ x: 50, y: 20, zoom: 1.25 });
	});

	it("keeps the zoom focus point stable", () => {
		const viewport = { x: 120, y: 80, zoom: 1 };
		const screenX = 360;
		const screenY = 260;
		const beforeWorldX = (screenX - viewport.x) / viewport.zoom;
		const beforeWorldY = (screenY - viewport.y) / viewport.zoom;

		const next = zoomCanvasViewport(viewport, { screenX, screenY, deltaY: -120 });

		expect((screenX - next.x) / next.zoom).toBeCloseTo(beforeWorldX, 0);
		expect((screenY - next.y) / next.zoom).toBeCloseTo(beforeWorldY, 0);
		expect(next.zoom).toBeGreaterThan(viewport.zoom);
	});

	it("returns positive modulo values for negative viewport offsets", () => {
		expect(positiveModulo(-5, 48)).toBe(43);
		expect(positiveModulo(53, 48)).toBe(5);
	});
});

describe("renderer label helpers", () => {
	it("compacts long workspace paths to their last two segments", () => {
		expect(compactPath("/Users/marcus/work/pi-analytics")).toBe("work/pi-analytics");
		expect(compactPath("/tmp")).toBe("/tmp");
	});

	it("labels recent workspaces without duplicating the compact path", () => {
		const workspace = {
			path: "/Users/marcus/work/pi-analytics",
			name: "Pi Analytics",
			openedAt: "2026-06-30T12:00:00.000Z",
		} satisfies RecentWorkspace;

		expect(workspaceLabel(workspace)).toBe("Pi Analytics - work/pi-analytics");
	});

	it("formats model values and unknown errors consistently", () => {
		const model = {
			provider: "openai",
			id: "gpt-5",
			name: "GPT-5",
			providerName: "OpenAI",
			configured: true,
			contextWindow: 1000,
			reasoning: true,
		} satisfies ModelSummary;

		expect(modelValue(model)).toBe("openai/gpt-5");
		expect(errorMessage(new Error("failed"))).toBe("failed");
		expect(errorMessage("plain failure")).toBe("plain failure");
	});
});

describe("renderer preference helpers", () => {
	it("reads defaults and writes dock preferences", () => {
		const storage = new MemoryStorage();

		expect(readChatDockPosition(storage)).toBe("bottom");
		expect(readChatDockMinimized(storage)).toBe(false);

		writeChatDockPosition("right", storage);
		writeChatDockMinimized(true, storage);

		expect(readChatDockPosition(storage)).toBe("right");
		expect(readChatDockMinimized(storage)).toBe(true);
	});
});

describe("renderer task state helpers", () => {
	it("adds, updates, and removes busy task views", () => {
		const state = createInitialState("bottom", false, "2026-06-30T00:00:00.000Z");
		const queued = taskSnapshot({ status: "queued", statusText: "Queued" });

		applyTaskSnapshot(state, queued, 123);

		expect(state.taskOrder).toEqual(["task-1"]);
		expect(activeTaskView(state)).toBeUndefined();
		expect(state.tasks.get("task-1")?.messages[0]).toMatchObject({
			id: "task-system-task-1-123",
			text: "Task started: Summarize",
		});

		state.activeTaskId = "task-1";
		applyTaskSnapshot(state, taskSnapshot({ status: "working", statusText: "Reading" }));

		expect(activeTaskView(state)?.statusText).toBe("Reading");
		expect(visibleTaskViews(state).map((task) => task.id)).toEqual(["task-1"]);

		applyTaskSnapshot(state, taskSnapshot({ status: "complete", statusText: "Complete" }));

		expect(state.tasks.has("task-1")).toBe(false);
		expect(state.taskOrder).toEqual([]);
		expect(state.activeTaskId).toBeUndefined();
	});
});

describe("renderer selection helpers", () => {
	it("toggles, keeps, and deletes selected cards", () => {
		const state = createInitialState("bottom", false, "2026-06-30T00:00:00.000Z");
		state.cards = [card("a", { x: 0, y: 0, w: 100, h: 100 }), card("b", { x: 140, y: 0, w: 100, h: 100 })];
		state.loadingCardIds.add("a");

		toggleCardSelection(state, "a", false);
		toggleCardSelection(state, "b", true);
		keepSelectedCards(state);

		expect(selectedCards(state).map((selected) => selected.id)).toEqual(["a", "b"]);
		expect(state.cards.map((selected) => selected.status)).toEqual(["kept", "kept"]);

		deleteCardById(state, "a");

		expect(state.cards.map((selected) => selected.id)).toEqual(["b"]);
		expect(state.selectedIds.has("a")).toBe(false);
		expect(state.loadingCardIds.has("a")).toBe(false);
	});
});

function card(id: string, position: CanvasCardPosition): CanvasCard {
	return {
		id,
		type: "summary",
		title: id,
		subtitle: "",
		body: "",
		status: "complete",
		statusLabel: "Complete",
		position,
		kept: false,
		sourceMessageIds: [],
	};
}

function taskSnapshot(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
	return {
		id: "task-1",
		groupId: "group-1",
		sessionId: "session-1",
		cardId: "card-1",
		title: "Summarize",
		status: "queued",
		statusText: "Queued",
		targetPaths: ["src/main.ts"],
		requiresWrites: false,
		...overrides,
	};
}

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return Array.from(this.values.keys())[index] ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}
