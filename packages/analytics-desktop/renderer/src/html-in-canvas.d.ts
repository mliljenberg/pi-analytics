import type { AnalyticsDesktopApi } from "../../src/shared/ipc.ts";

declare global {
	interface Window {
		piAnalytics: AnalyticsDesktopApi;
	}

	interface CanvasDrawElementResult {
		transform?: DOMMatrixReadOnly | string;
	}

	interface CanvasRenderingContext2D {
		drawElementImage?: (element: Element, x?: number, y?: number) => CanvasDrawElementResult | void;
	}
}

export {};
