import type { ChatMessage, AppState, TaskView } from "./state.ts";
import type { TaskSnapshot } from "../../src/shared/ipc.ts";

export function activeTaskView(state: AppState): TaskView | undefined {
	if (!state.activeTaskId) {
		return undefined;
	}
	return state.tasks.get(state.activeTaskId);
}

export function visibleTaskViews(state: AppState): TaskView[] {
	const visibleTasks = state.taskOrder
		.map((taskId) => state.tasks.get(taskId))
		.filter((task): task is TaskView => task !== undefined && isTaskBusy(task));
	if (state.activeTaskId && !visibleTasks.some((task) => task.id === state.activeTaskId)) {
		state.activeTaskId = undefined;
	}
	return visibleTasks;
}

export function isTaskBusy(task: TaskView): boolean {
	return task.status === "queued" || task.status === "working";
}

export function isTaskSnapshotBusy(task: TaskSnapshot): boolean {
	return task.status === "queued" || task.status === "working";
}

export function applyTaskSnapshot(state: AppState, snapshot: TaskSnapshot, now = Date.now()): void {
	const existing = state.tasks.get(snapshot.id);
	if (!isTaskSnapshotBusy(snapshot)) {
		if (existing) {
			existing.streaming = undefined;
			existing.queuedSteering = [];
			existing.queuedFollowUp = [];
		}
		removeTaskView(state, snapshot.id);
		return;
	}
	if (existing) {
		existing.groupId = snapshot.groupId;
		existing.sessionId = snapshot.sessionId;
		existing.cardId = snapshot.cardId;
		existing.title = snapshot.title;
		existing.status = snapshot.status;
		existing.statusText = snapshot.statusText;
		existing.targetPaths = [...snapshot.targetPaths];
		existing.requiresWrites = snapshot.requiresWrites;
		return;
	}

	state.tasks.set(snapshot.id, {
		...snapshot,
		targetPaths: [...snapshot.targetPaths],
		messages: [taskSystemMessage(snapshot, `Task started: ${snapshot.title}`, now)],
		queuedSteering: [],
		queuedFollowUp: [],
	});
	state.taskOrder.push(snapshot.id);
}

export function removeTaskView(state: AppState, taskId: string): void {
	state.tasks.delete(taskId);
	state.taskOrder = state.taskOrder.filter((id) => id !== taskId);
	if (state.activeTaskId === taskId) {
		state.activeTaskId = undefined;
	}
}

export function taskSystemMessage(task: TaskSnapshot, text: string, now = Date.now()): ChatMessage {
	return {
		id: `task-system-${task.id}-${now}`,
		author: "System",
		text,
		timestamp: new Date().toISOString(),
	};
}
