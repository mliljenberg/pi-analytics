export type ChatDockPosition = "bottom" | "right";

const CHAT_DOCK_POSITION_KEY = "pi-analytics-chat-dock";
const CHAT_DOCK_MINIMIZED_KEY = "pi-analytics-chat-minimized";

export function readChatDockPosition(storage: Storage = localStorage): ChatDockPosition {
	const stored = storage.getItem(CHAT_DOCK_POSITION_KEY);
	return stored === "right" || stored === "bottom" ? stored : "bottom";
}

export function writeChatDockPosition(position: ChatDockPosition, storage: Storage = localStorage): void {
	storage.setItem(CHAT_DOCK_POSITION_KEY, position);
}

export function readChatDockMinimized(storage: Storage = localStorage): boolean {
	return storage.getItem(CHAT_DOCK_MINIMIZED_KEY) === "true";
}

export function writeChatDockMinimized(minimized: boolean, storage: Storage = localStorage): void {
	storage.setItem(CHAT_DOCK_MINIMIZED_KEY, minimized ? "true" : "false");
}
