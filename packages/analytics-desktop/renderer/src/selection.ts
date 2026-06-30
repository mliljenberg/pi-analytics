import type { CanvasCard, PromptCardContext } from "../../src/shared/canvas.ts";
import type { AppState } from "./state.ts";

export function selectedCards(state: AppState): CanvasCard[] {
	return state.cards.filter((card) => state.selectedIds.has(card.id));
}

export function cardContext(card: CanvasCard): PromptCardContext {
	return {
		id: card.id,
		type: card.type,
		title: card.title,
		body: card.body,
		position: card.position,
		kept: card.kept,
	};
}

export function toggleCardSelection(state: AppState, id: string, additive: boolean): void {
	if (!additive) state.selectedIds.clear();
	if (state.selectedIds.has(id) && additive) {
		state.selectedIds.delete(id);
	} else {
		state.selectedIds.add(id);
	}
}

export function keepSelectedCards(state: AppState): void {
	for (const card of selectedCards(state)) {
		card.kept = true;
		card.status = "kept";
		card.statusLabel = "Kept";
	}
}

export function deleteSelectedCards(state: AppState): void {
	state.cards = state.cards.filter((card) => !state.selectedIds.has(card.id));
	for (const id of state.selectedIds) {
		state.loadingCardIds.delete(id);
	}
	state.selectedIds.clear();
}

export function deleteCardById(state: AppState, id: string): void {
	const deleted = state.cards.find((card) => card.id === id);
	state.cards = state.cards.filter((card) => card.id !== id);
	state.selectedIds.delete(id);
	state.loadingCardIds.delete(id);
	if (deleted?.taskId === state.activeTaskId) {
		state.activeTaskId = undefined;
	}
}
