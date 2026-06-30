import type { CanvasCard, CanvasCardPosition } from "../../../src/shared/canvas.ts";

export const CARD_PLACEMENT_GAP = 32;

export function resolveNewCardPosition(position: CanvasCardPosition, cards: CanvasCard[]): CanvasCardPosition {
	const initial = normalizePosition(position);
	if (!overlapsAny(initial, cards)) {
		return initial;
	}

	const rowCards = cards
		.map((card) => card.position)
		.filter((candidate) => rangesOverlap(candidate.y, candidate.y + candidate.h, initial.y, initial.y + initial.h));
	if (rowCards.length > 0) {
		const rowX = Math.max(...rowCards.map((candidate) => candidate.x + candidate.w)) + CARD_PLACEMENT_GAP;
		const rowY = Math.min(...rowCards.map((candidate) => candidate.y));
		const rowPosition = normalizePosition({ ...initial, x: rowX, y: rowY });
		if (!overlapsAny(rowPosition, cards)) {
			return rowPosition;
		}
	}

	for (const candidate of placementCandidates(initial, cards)) {
		if (!overlapsAny(candidate, cards)) {
			return candidate;
		}
	}

	const rightEdge = Math.max(...cards.map((card) => card.position.x + card.position.w), initial.x);
	return normalizePosition({ ...initial, x: rightEdge + CARD_PLACEMENT_GAP });
}

export function normalizePosition(position: CanvasCardPosition): CanvasCardPosition {
	return {
		x: Math.round(position.x),
		y: Math.round(position.y),
		w: Math.round(position.w),
		h: Math.round(position.h),
	};
}

export function positionsOverlap(a: CanvasCardPosition, b: CanvasCardPosition, gap = CARD_PLACEMENT_GAP): boolean {
	return (
		a.x < b.x + b.w + gap &&
		a.x + a.w + gap > b.x &&
		a.y < b.y + b.h + gap &&
		a.y + a.h + gap > b.y
	);
}

function overlapsAny(position: CanvasCardPosition, cards: CanvasCard[]): boolean {
	return cards.some((card) => positionsOverlap(position, card.position));
}

function placementCandidates(position: CanvasCardPosition, cards: CanvasCard[]): CanvasCardPosition[] {
	const minX = Math.min(position.x, ...cards.map((card) => card.position.x), 72);
	const minY = Math.min(position.y, ...cards.map((card) => card.position.y), 70);
	const maxRight = Math.max(position.x + position.w, ...cards.map((card) => card.position.x + card.position.w));
	const maxBottom = Math.max(position.y + position.h, ...cards.map((card) => card.position.y + card.position.h));
	const columnStep = position.w + CARD_PLACEMENT_GAP;
	const rowStep = position.h + CARD_PLACEMENT_GAP;
	const columnCount = Math.max(4, Math.ceil((maxRight - minX) / columnStep) + 3);
	const rowCount = Math.max(4, Math.ceil((maxBottom - minY) / rowStep) + 3);
	const candidates: CanvasCardPosition[] = [];

	for (const card of cards) {
		candidates.push(
			normalizePosition({ ...position, x: card.position.x + card.position.w + CARD_PLACEMENT_GAP, y: card.position.y }),
		);
		candidates.push(
			normalizePosition({ ...position, x: card.position.x, y: card.position.y + card.position.h + CARD_PLACEMENT_GAP }),
		);
	}

	for (let row = 0; row < rowCount; row += 1) {
		for (let column = 0; column < columnCount; column += 1) {
			candidates.push(
				normalizePosition({
					...position,
					x: minX + column * columnStep,
					y: minY + row * rowStep,
				}),
			);
		}
	}

	return candidates;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && aEnd > bStart;
}
