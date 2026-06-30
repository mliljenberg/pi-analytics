import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { createDispatchParallelTasksTool, type ParallelTaskRequest } from "../src/main/task-dispatch-tool.ts";
import type { TaskSnapshot } from "../src/shared/ipc.ts";

type DispatchTool = ReturnType<typeof createDispatchParallelTasksTool>;
type DispatchToolParams = Parameters<DispatchTool["execute"]>[1];
type DispatchToolContext = Parameters<DispatchTool["execute"]>[4];

const extensionContext = {} as DispatchToolContext;

describe("dispatch_parallel_tasks", () => {
	it("validates the task list shape", () => {
		const tool = createDispatchParallelTasksTool({
			dispatch: async () => ({ groupId: "task-group-1", tasks: [] }),
		});
		const validTask = {
			title: "Summary",
			instruction: "Summarize file",
			targetPaths: ["a.md"],
			requiresWrites: false,
		};

		expect(Value.Check(tool.parameters, { groupTitle: "Summaries", tasks: [validTask] })).toBe(true);
		expect(Value.Check(tool.parameters, { groupTitle: "Summaries", tasks: [] })).toBe(false);
		expect(
			Value.Check(tool.parameters, {
				groupTitle: "Summaries",
				tasks: Array.from({ length: 25 }, () => validTask),
			}),
		).toBe(false);
	});

	it("normalizes optional fields before dispatching tasks", async () => {
		let dispatchedGroupTitle = "";
		let dispatchedTasks: ParallelTaskRequest[] = [];
		const taskSnapshot: TaskSnapshot = {
			id: "task-1",
			groupId: "task-group-1",
			sessionId: "task-session-1",
			cardId: "task-card-1",
			title: "Summary",
			status: "queued",
			statusText: "Queued",
			targetPaths: [],
			requiresWrites: false,
		};
		const tool = createDispatchParallelTasksTool({
			dispatch: async (groupTitle, tasks) => {
				dispatchedGroupTitle = groupTitle;
				dispatchedTasks = tasks;
				return { groupId: "task-group-1", tasks: [taskSnapshot] };
			},
		});
		const params = {
			groupTitle: "Summaries",
			tasks: [{ title: "Summary", instruction: "Summarize file" }],
		} satisfies DispatchToolParams;

		const result = await tool.execute("tool-1", params, undefined, undefined, extensionContext);

		expect(dispatchedGroupTitle).toBe("Summaries");
		expect(dispatchedTasks).toEqual([
			{
				title: "Summary",
				instruction: "Summarize file",
				targetPaths: [],
				requiresWrites: false,
			},
		]);
		expect(result.details).toEqual({ groupId: "task-group-1", tasks: [taskSnapshot] });
		expect(result.terminate).toBe(true);
	});
});
