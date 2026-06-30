export interface CanvasViewport {
	x: number;
	y: number;
	zoom: number;
}

export interface CanvasZoomInput {
	screenX: number;
	screenY: number;
	deltaY: number;
}

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = {
	x: 0,
	y: 0,
	zoom: 1,
};

const MIN_CANVAS_ZOOM = 0.25;
const MAX_CANVAS_ZOOM = 2.5;
const CANVAS_ZOOM_SENSITIVITY = 0.0018;

export function panCanvasViewport(
	viewport: CanvasViewport,
	startViewport: Pick<CanvasViewport, "x" | "y">,
	startClientX: number,
	startClientY: number,
	clientX: number,
	clientY: number,
): CanvasViewport {
	return {
		...viewport,
		x: Math.round(startViewport.x + clientX - startClientX),
		y: Math.round(startViewport.y + clientY - startClientY),
	};
}

export function zoomCanvasViewport(viewport: CanvasViewport, input: CanvasZoomInput): CanvasViewport {
	const worldX = (input.screenX - viewport.x) / viewport.zoom;
	const worldY = (input.screenY - viewport.y) / viewport.zoom;
	const unclampedZoom = viewport.zoom * Math.exp(-input.deltaY * CANVAS_ZOOM_SENSITIVITY);
	const zoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, unclampedZoom));
	return {
		x: Math.round(input.screenX - worldX * zoom),
		y: Math.round(input.screenY - worldY * zoom),
		zoom,
	};
}

export function positiveModulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}
