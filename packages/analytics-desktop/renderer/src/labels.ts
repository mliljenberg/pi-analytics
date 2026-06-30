import type { ModelSummary, RecentWorkspace } from "../../src/shared/ipc.ts";

export function compactPath(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	if (parts.length <= 2) return path;
	return `${parts.at(-2)}/${parts.at(-1)}`;
}

export function workspaceLabel(workspace: RecentWorkspace): string {
	const path = compactPath(workspace.path);
	return workspace.name === path ? path : `${workspace.name} - ${path}`;
}

export function modelValue(model: ModelSummary): string {
	return `${model.provider}/${model.id}`;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
