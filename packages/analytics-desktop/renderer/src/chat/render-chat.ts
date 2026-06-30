import type { ChatMessage, StreamingMessage, TaskView } from "../state.ts";

export function renderChatTabs(
	chatTabs: HTMLElement,
	visibleTasks: readonly TaskView[],
	activeTaskId: string | undefined,
	busy: boolean,
): void {
	chatTabs.replaceChildren();
	chatTabs.classList.toggle("open", visibleTasks.length > 0);
	if (visibleTasks.length === 0) {
		return;
	}

	chatTabs.appendChild(createChatTab("Main", undefined, !activeTaskId, busy ? "working" : "complete"));
	for (const task of visibleTasks) {
		chatTabs.appendChild(createChatTab(task.title, task.id, activeTaskId === task.id, task.status));
	}
}

export function renderChatLog(
	chatLog: HTMLElement,
	baseMessages: readonly ChatMessage[],
	streaming: StreamingMessage | undefined,
): void {
	const stickToBottom = shouldStickChatToBottom(chatLog);
	chatLog.replaceChildren();
	const messages = streaming
		? [
				...baseMessages,
				{
					id: `stream-${streaming.id}`,
					author: "Pi" as const,
					text: streaming.text,
					timestamp: new Date().toISOString(),
				},
			]
		: baseMessages;

	for (const message of messages.slice(-10)) {
		const row = document.createElement("div");
		row.className = "message";
		const author = document.createElement("strong");
		author.textContent = message.author;
		row.append(author, document.createTextNode(` ${message.text}`));
		chatLog.appendChild(row);
	}
	if (stickToBottom) {
		chatLog.scrollTop = chatLog.scrollHeight;
	}
}

export function renderQueueStack(
	queueStack: HTMLElement,
	queuedSteering: readonly string[],
	queuedFollowUp: readonly string[],
): void {
	queueStack.replaceChildren();
	for (const item of queuedSteering) {
		queueStack.appendChild(createQueuedMessage("Steering", item));
	}
	for (const item of queuedFollowUp) {
		queueStack.appendChild(createQueuedMessage("Queued next", item));
	}
	queueStack.classList.toggle("open", queuedSteering.length + queuedFollowUp.length > 0);
}

function createChatTab(label: string, taskId: string | undefined, active: boolean, status: string): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = ["chat-tab", active ? "active" : "", `status-${status}`].filter(Boolean).join(" ");
	button.textContent = label;
	button.title = label;
	if (taskId) {
		button.dataset.taskId = taskId;
	} else {
		button.dataset.mainTab = "true";
	}
	return button;
}

function createQueuedMessage(label: string, text: string): HTMLElement {
	const item = document.createElement("div");
	item.className = "queued-message";
	const strong = document.createElement("strong");
	strong.textContent = label;
	const body = document.createElement("span");
	body.textContent = text;
	item.append(strong, body);
	return item;
}

function shouldStickChatToBottom(element: HTMLElement): boolean {
	return element.scrollHeight - element.scrollTop - element.clientHeight < 36;
}
