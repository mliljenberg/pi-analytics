import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { defineTool } from "@earendil-works/pi-coding-agent/core/extensions";
import { type Static, Type } from "typebox";
import type { TaskSnapshot } from "../shared/ipc.ts";

const taskSchema = Type.Object(
	{
		title: Type.String({
			description: "Short task title shown on the canvas card and chat tab.",
		}),
		instruction: Type.String({
			description: "Complete task-specific instruction for the task agent.",
		}),
		targetPaths: Type.Optional(
			Type.Array(Type.String(), {
				description: "Files or directories this task is expected to inspect or edit.",
			}),
		),
		requiresWrites: Type.Optional(
			Type.Boolean({
				description: "True when this task is expected to edit or create files.",
			}),
		),
	},
	{ additionalProperties: false },
);

const dispatchParallelTasksSchema = Type.Object(
	{
		groupTitle: Type.String({
			description: "Short title for this batch of parallel work.",
		}),
		tasks: Type.Array(taskSchema, {
			minItems: 1,
			maxItems: 24,
			description: "Independent tasks that can run as separate Pi agents.",
		}),
	},
	{ additionalProperties: false },
);

type DispatchParallelTasksInput = Static<typeof dispatchParallelTasksSchema>;

export interface ParallelTaskRequest {
	title: string;
	instruction: string;
	targetPaths: string[];
	requiresWrites: boolean;
}

export interface DispatchParallelTasksResult {
	groupId: string;
	tasks: TaskSnapshot[];
}

interface CreateDispatchParallelTasksToolOptions {
	dispatch: (groupTitle: string, tasks: ParallelTaskRequest[]) => Promise<DispatchParallelTasksResult>;
}

export function createDispatchParallelTasksTool({ dispatch }: CreateDispatchParallelTasksToolOptions) {
	return defineTool({
		name: "dispatch_parallel_tasks",
		label: "dispatch parallel tasks",
		description:
			"Start independent Pi task agents in parallel. Use this for requests that naturally split into separate per-file, per-day, per-table, or per-item work. Each task gets its own canvas card, chat tab, and editable agent session.",
		promptSnippet: "Dispatch independent subtasks to parallel editable Pi agents",
		promptGuidelines: [
			"Use dispatch_parallel_tasks when the user asks for the same operation across multiple independent files, dates, records, tables, or similarly separable targets.",
			"Task agents can read, run shell commands, edit, and write files. Only dispatch write tasks when target paths are independent enough that tasks should not need to coordinate.",
			"If tasks overlap heavily, require shared sequencing, or need a single cross-task design decision before edits, ask a clarifying question or handle the work yourself instead of dispatching.",
			"Give each task a complete instruction. Do not rely on hidden context beyond the workspace and the user request.",
			"Include targetPaths whenever the task is tied to specific files or directories.",
			"Keep groups to 24 tasks or fewer. If there are more items, ask the user to narrow the scope.",
		],
		parameters: dispatchParallelTasksSchema,
		executionMode: "sequential",
		async execute(
			_toolCallId,
			params: DispatchParallelTasksInput,
		): Promise<AgentToolResult<DispatchParallelTasksResult>> {
			const tasks = params.tasks.map((task) => ({
				title: task.title,
				instruction: task.instruction,
				targetPaths: task.targetPaths ?? [],
				requiresWrites: task.requiresWrites ?? false,
			}));
			const result = await dispatch(params.groupTitle, tasks);
			return {
				content: [
					{
						type: "text",
						text: `Started ${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"} for "${params.groupTitle}".`,
					},
				],
				details: result,
				terminate: true,
			};
		},
	});
}
