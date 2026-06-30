import type { CanvasCard } from "../../../src/shared/canvas.ts";
import type { CanvasViewport } from "./viewport.ts";
import { positiveModulo } from "./viewport.ts";

interface PaintCanvasOptions {
	workspaceCanvas: HTMLCanvasElement;
	canvasShell: HTMLElement;
	viewport: CanvasViewport;
	cards: readonly CanvasCard[];
	htmlCanvasFailed: boolean;
	onHtmlCanvasActiveChange: (active: boolean) => void;
	onHtmlCanvasFailure: (message: string) => void;
}

const GRID_SIZE = 48;

export function paintCanvas({
	workspaceCanvas,
	canvasShell,
	viewport,
	cards,
	htmlCanvasFailed,
	onHtmlCanvasActiveChange,
	onHtmlCanvasFailure,
}: PaintCanvasOptions): void {
	const ctx = workspaceCanvas.getContext("2d");
	if (!ctx) return;
	const rect = workspaceCanvas.getBoundingClientRect();
	const scale = window.devicePixelRatio || 1;
	const width = Math.max(1, Math.floor(rect.width * scale));
	const height = Math.max(1, Math.floor(rect.height * scale));
	if (workspaceCanvas.width !== width || workspaceCanvas.height !== height) {
		workspaceCanvas.width = width;
		workspaceCanvas.height = height;
	}

	ctx.setTransform(scale, 0, 0, scale, 0, 0);
	ctx.clearRect(0, 0, rect.width, rect.height);
	drawGrid(ctx, rect.width, rect.height, viewport);

	const drawElementImage = ctx.drawElementImage;
	const supportsHtmlCanvas = typeof drawElementImage === "function" && !htmlCanvasFailed && window.innerWidth > 860;
	onHtmlCanvasActiveChange(supportsHtmlCanvas);
	canvasShell.classList.toggle("html-canvas-active", supportsHtmlCanvas);

	if (!supportsHtmlCanvas) return;

	try {
		const clones = Array.from(workspaceCanvas.querySelectorAll<HTMLElement>(":scope > .canvas-card"));
		ctx.save();
		try {
			ctx.translate(viewport.x, viewport.y);
			ctx.scale(viewport.zoom, viewport.zoom);
			for (const clone of clones) {
				const card = cards.find((item) => item.id === clone.dataset.id);
				if (!card) continue;
				drawElementImage.call(ctx, clone, card.position.x, card.position.y);
			}
		} finally {
			ctx.restore();
		}
	} catch (error) {
		onHtmlCanvasActiveChange(false);
		canvasShell.classList.remove("html-canvas-active");
		onHtmlCanvasFailure(error instanceof Error ? error.message : "HTML-in-Canvas paint failed.");
	}
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, viewport: CanvasViewport): void {
	const step = GRID_SIZE * viewport.zoom;
	const startX = positiveModulo(viewport.x, step);
	const startY = positiveModulo(viewport.y, step);
	ctx.save();
	ctx.strokeStyle = "rgba(16, 17, 20, 0.035)";
	ctx.lineWidth = 1;
	for (let x = startX; x <= width; x += step) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.stroke();
	}
	for (let y = startY; y <= height; y += step) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
		ctx.stroke();
	}
	ctx.restore();
}
