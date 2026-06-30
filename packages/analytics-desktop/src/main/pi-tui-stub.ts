export const CURSOR_MARKER = "";

export const Key = {
	Enter: "\r",
	Escape: "\u001b",
};

export class Text {
	private text: string;

	constructor(text = "", _x = 0, _y = 0) {
		this.text = text;
	}

	setText(text: string): void {
		this.text = text;
	}

	render(): string[] {
		return this.text.split("\n");
	}
}

export class Container {
	render(): string[] {
		return [];
	}
}

export class Box extends Container {}
export class CancellableLoader extends Text {}
export class Editor extends Text {}
export class Image extends Text {}
export class Input extends Text {}
export class Loader extends Text {}
export class Markdown extends Text {}
export class ProcessTerminal {}
export class SelectList extends Container {}
export class SettingsList extends Container {}
export class Spacer extends Container {}
export class TruncatedText extends Text {}
export class TUI extends Container {}

export class KeybindingsManager {
	matches(_binding: string, _keyData: string): boolean {
		return false;
	}

	get(_binding: string): string[] {
		return [];
	}
}

const keybindings = new KeybindingsManager();

export const TUI_KEYBINDINGS = {};

export function setKeybindings(_manager: KeybindingsManager): void {}

export function getKeybindings(): KeybindingsManager {
	return keybindings;
}

export function matchesKey(_data: string, _keyId: string): boolean {
	return false;
}

export function parseKey(data: string): string | undefined {
	return data || undefined;
}

export function decodeKittyPrintable(data: string): string | undefined {
	return data || undefined;
}

export function isKeyRelease(_data: string): boolean {
	return false;
}

export function isKeyRepeat(_data: string): boolean {
	return false;
}

export function isKittyProtocolActive(): boolean {
	return false;
}

export function setKittyProtocolActive(_active: boolean): void {}

export function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | undefined {
	return text.includes(query) ? { score: query.length, indices: [] } : undefined;
}

export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
	return items.filter((item) => getText(item).includes(query));
}

export class CombinedAutocompleteProvider {}
export class StdinBuffer {}

export function visibleWidth(value: string): number {
	return value.length;
}

export function truncateToWidth(value: string, width: number): string {
	return value.length > width ? value.slice(0, width) : value;
}

export function sliceByColumn(value: string, startCol: number, length: number): string {
	return value.slice(startCol, startCol + length);
}

export function wrapTextWithAnsi(value: string): string[] {
	return value.split("\n");
}

export function allocateImageId(): number {
	return 0;
}

export function calculateImageRows(): number {
	return 0;
}

export function deleteAllKittyImages(): string {
	return "";
}

export function deleteKittyImage(_imageId: number): string {
	return "";
}

export function detectCapabilities(): { trueColor: boolean; images: false; links: false } {
	return { trueColor: false, images: false, links: false };
}

export function getCapabilities(): { trueColor: boolean; images: false; links: false } {
	return detectCapabilities();
}

export function resetCapabilitiesCache(): void {}

export function setCapabilities(_capabilities: unknown): void {}

export function getCellDimensions(): { width: number; height: number } {
	return { width: 0, height: 0 };
}

export function setCellDimensions(_dimensions: unknown): void {}

export function getImageDimensions(): undefined {
	return undefined;
}

export function getGifDimensions(): undefined {
	return undefined;
}

export function getJpegDimensions(): undefined {
	return undefined;
}

export function getPngDimensions(): undefined {
	return undefined;
}

export function getWebpDimensions(): undefined {
	return undefined;
}

export function encodeITerm2(): string {
	return "";
}

export function encodeKitty(): string {
	return "";
}

export function hyperlink(text: string): string {
	return text;
}

export function imageFallback(): string {
	return "[image omitted]";
}

export function renderImage(): string {
	return "";
}

export function parseOsc11BackgroundColor(): undefined {
	return undefined;
}

export function parseTerminalColorSchemeReport(): undefined {
	return undefined;
}

export function getCellSize(): { width: number; height: number } {
	return { width: 0, height: 0 };
}

export function isFocusable(value: unknown): boolean {
	return typeof value === "object" && value !== null;
}
