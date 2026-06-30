import type { CanvasCard, CanvasCardPosition, PersistedBoard, PromptCardContext } from "../../src/shared/canvas.ts";
import type {
	AuthState,
	ChatMessageEvent,
	MainToRendererEvent,
	ModelSummary,
	ProviderSummary,
	RecentWorkspace,
	SessionSnapshot,
	TaskSnapshot,
} from "../../src/shared/ipc.ts";
import "./styles.css";
import "./canvas-artifacts.css";

interface ChatMessage {
	id: string;
	author: "You" | "Pi" | "System";
	text: string;
	timestamp: string;
}

interface StreamingMessage {
	id: string;
	text: string;
}

interface TaskView extends TaskSnapshot {
	messages: ChatMessage[];
	streaming?: StreamingMessage;
	queuedSteering: string[];
	queuedFollowUp: string[];
}

type ChatDockPosition = "bottom" | "right";

interface AppState {
	authenticated: boolean;
	authProviders: ProviderSummary[];
	pendingModelValue?: string;
	cwd?: string;
	sessionId?: string;
	model?: ModelSummary;
	models: ModelSummary[];
	recentWorkspaces: RecentWorkspace[];
	cards: CanvasCard[];
	messages: ChatMessage[];
	streaming?: StreamingMessage;
	queuedSteering: string[];
	queuedFollowUp: string[];
	tasks: Map<string, TaskView>;
	taskOrder: string[];
	activeTaskId?: string;
	selectedIds: Set<string>;
	loadingCardIds: Set<string>;
	activeModalId?: string;
	busy: boolean;
	statusText: string;
	shareReady: boolean;
	htmlCanvasActive: boolean;
	htmlCanvasFailed: boolean;
	viewport: CanvasViewport;
	chatDockPosition: ChatDockPosition;
	chatDockMinimized: boolean;
}

interface CardDragState {
	id: string;
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startX: number;
	startY: number;
	moved: boolean;
}

interface CanvasViewport {
	x: number;
	y: number;
	zoom: number;
}

interface CanvasPanState {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startX: number;
	startY: number;
}

const MIN_CANVAS_ZOOM = 0.25;
const MAX_CANVAS_ZOOM = 2.5;
const CANVAS_ZOOM_SENSITIVITY = 0.0018;
const GRID_SIZE = 48;
const CARD_PLACEMENT_GAP = 32;

const state: AppState = {
	authenticated: false,
	authProviders: [],
	models: [],
	recentWorkspaces: [],
	cards: [],
	messages: [
		{
			id: "system-start",
			author: "System",
			text: "Open a folder to start an analytics session.",
			timestamp: new Date().toISOString(),
		},
	],
	queuedSteering: [],
	queuedFollowUp: [],
	tasks: new Map(),
	taskOrder: [],
	selectedIds: new Set(),
	loadingCardIds: new Set(),
	busy: false,
	statusText: "No workspace",
	shareReady: false,
	htmlCanvasActive: false,
	htmlCanvasFailed: false,
	viewport: {
		x: 0,
		y: 0,
		zoom: 1,
	},
	chatDockPosition: readChatDockPosition(),
	chatDockMinimized: readChatDockMinimized(),
};

const api = window.piAnalytics;
const appRoot = requireElement<HTMLDivElement>("appRoot");
const loginModal = requireElement<HTMLDivElement>("loginModal");
const loginForm = requireElement<HTMLFormElement>("loginForm");
const loginProvider = requireElement<HTMLSelectElement>("loginProvider");
const loginApiKeyLabel = requireElement<HTMLLabelElement>("loginApiKeyLabel");
const loginApiKey = requireElement<HTMLInputElement>("loginApiKey");
const loginModelLabel = requireElement<HTMLLabelElement>("loginModelLabel");
const loginModel = requireElement<HTMLSelectElement>("loginModel");
const loginError = requireElement<HTMLParagraphElement>("loginError");
const loginSubmitButton = requireElement<HTMLButtonElement>("loginSubmitButton");
const topStatus = requireElement<HTMLElement>("topStatus");
const modelSelect = requireElement<HTMLSelectElement>("modelSelect");
const recentWorkspaceSelect = requireElement<HTMLSelectElement>("recentWorkspaceSelect");
const openFolderButton = requireElement<HTMLButtonElement>("openFolderButton");
const newBoardButton = requireElement<HTMLButtonElement>("newBoardButton");
const canvasShell = requireElement<HTMLDivElement>("canvasShell");
const workspaceCanvas = requireElement<HTMLCanvasElement>("workspaceCanvas");
const cardHost = requireElement<HTMLDivElement>("cardHost");
const emptyHint = requireElement<HTMLDivElement>("emptyHint");
const contextBar = requireElement<HTMLDivElement>("contextBar");
const selectedCount = requireElement<HTMLSpanElement>("selectedCount");
const selectedNote = requireElement<HTMLDivElement>("selectedNote");
const chatDock = requireElement<HTMLElement>("chatDock");
const dockToggleButton = requireElement<HTMLButtonElement>("dockToggleButton");
const dockMinimizeButton = requireElement<HTMLButtonElement>("dockMinimizeButton");
const chatTabs = requireElement<HTMLDivElement>("chatTabs");
const chatLog = requireElement<HTMLDivElement>("chatLog");
const agentLoading = requireElement<HTMLDivElement>("agentLoading");
const agentLoadingText = requireElement<HTMLSpanElement>("agentLoadingText");
const queueStack = requireElement<HTMLDivElement>("queueStack");
const composer = requireElement<HTMLFormElement>("composer");
const chatInput = requireElement<HTMLInputElement>("chatInput");
const steerButton = requireElement<HTMLButtonElement>("steerButton");
const queueNextButton = requireElement<HTMLButtonElement>("queueNextButton");
const sendButton = requireElement<HTMLButtonElement>("sendButton");
const askSelectedButton = requireElement<HTMLButtonElement>("askSelectedButton");
const keepSelectedButton = requireElement<HTMLButtonElement>("keepSelectedButton");
const openSelectedButton = requireElement<HTMLButtonElement>("openSelectedButton");
const exportSelectedButton = requireElement<HTMLButtonElement>("exportSelectedButton");
const deleteSelectedButton = requireElement<HTMLButtonElement>("deleteSelectedButton");
const modal = requireElement<HTMLDivElement>("modal");
const modalTitle = requireElement<HTMLHeadingElement>("modalTitle");
const modalSubtitle = requireElement<HTMLParagraphElement>("modalSubtitle");
const modalBody = requireElement<HTMLDivElement>("modalBody");
const modalKeepButton = requireElement<HTMLButtonElement>("modalKeepButton");
const modalExportButton = requireElement<HTMLButtonElement>("modalExportButton");
const modalCloseButton = requireElement<HTMLButtonElement>("modalCloseButton");
const toast = requireElement<HTMLDivElement>("toast");

let saveTimer: number | undefined;
let canvasFrame: number | undefined;
let toastTimer: number | undefined;
let cardDrag: CardDragState | undefined;
let canvasPan: CanvasPanState | undefined;
let suppressNextCardClick = false;

function requireElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing element #${id}`);
	}
	return element as T;
}

function readChatDockPosition(): ChatDockPosition {
	const stored = localStorage.getItem("pi-analytics-chat-dock");
	return stored === "right" || stored === "bottom" ? stored : "bottom";
}

function readChatDockMinimized(): boolean {
	return localStorage.getItem("pi-analytics-chat-minimized") === "true";
}

function setChatDockPosition(position: ChatDockPosition): void {
	state.chatDockPosition = position;
	localStorage.setItem("pi-analytics-chat-dock", position);
	renderChatDock();
}

function setChatDockMinimized(minimized: boolean): void {
	state.chatDockMinimized = minimized;
	localStorage.setItem("pi-analytics-chat-minimized", minimized ? "true" : "false");
	renderChatDock();
}

function render(): void {
	renderAuth();
	renderStatus();
	renderModels();
	renderRecentWorkspaces();
	renderChatDock();
	renderChatTabs();
	renderChat();
	renderQueue();
	renderCards();
	renderSelection();
	renderCanvasViewport();
	scheduleCanvasPaint();
}

function renderAuth(): void {
	loginModal.classList.toggle("open", !state.authenticated);
	if (state.authenticated) {
		appRoot.removeAttribute("inert");
	} else {
		appRoot.setAttribute("inert", "");
	}

	const selectedProvider = loginProvider.value;
	loginProvider.replaceChildren();
	for (const provider of state.authProviders) {
		const option = document.createElement("option");
		option.value = provider.id;
		const method = provider.authType === "oauth" ? "subscription" : "API key";
		option.textContent = `${provider.name} - ${method}${provider.configured ? " (configured)" : ""}`;
		loginProvider.appendChild(option);
	}
	if (selectedProvider) {
		loginProvider.value = selectedProvider;
	}
	const provider = state.authProviders.find((candidate) => candidate.id === loginProvider.value);
	const apiKeyVisible = provider?.authType !== "oauth";
	loginApiKeyLabel.classList.toggle("hidden", !apiKeyVisible);
	loginApiKey.classList.toggle("hidden", !apiKeyVisible);
	loginApiKey.required = apiKeyVisible;
	loginSubmitButton.textContent = provider?.authType === "oauth" ? "Continue login" : "Login";

	const selectedModel = loginModel.value || state.pendingModelValue || "";
	const configuredModels = state.models.filter((model) => model.configured);
	loginModel.replaceChildren();
	for (const model of configuredModels) {
		const option = document.createElement("option");
		option.value = modelValue(model);
		option.textContent = `${model.providerName}: ${model.name}`;
		loginModel.appendChild(option);
	}
	if (selectedModel) {
		loginModel.value = selectedModel;
	}
	const modelVisible = configuredModels.length > 0;
	loginModelLabel.classList.toggle("hidden", !modelVisible);
	loginModel.classList.toggle("hidden", !modelVisible);
	loginSubmitButton.disabled = state.authProviders.length === 0;
}

function renderStatus(): void {
	const cardCount = state.cards.length;
	const keptCount = state.cards.filter((card) => card.kept).length;
	const workspace = state.cwd ? compactPath(state.cwd) : "No workspace";
	const canvasStatus = cardCount === 0 ? "empty canvas" : keptCount > 0 ? `${cardCount} items, ${keptCount} kept` : `${cardCount} items`;
	const activeTask = activeTaskView();
	const activeBusy = activeTask ? isTaskBusy(activeTask) : state.busy;
	topStatus.textContent = !state.authenticated
		? "Login required"
		: activeTask && isTaskBusy(activeTask)
			? `${workspace} - ${activeTask.title}: ${activeTask.statusText}`
			: state.busy
			? `${workspace} - ${state.statusText}`
			: `${workspace} - ${canvasStatus}`;
	const locked = !state.authenticated;
	openFolderButton.disabled = locked;
	newBoardButton.disabled = locked;
	chatInput.disabled = locked || !state.cwd;
	modelSelect.disabled = locked || !state.cwd || state.busy || state.models.length === 0;
	recentWorkspaceSelect.disabled = locked || state.busy || state.recentWorkspaces.length === 0;
	for (const button of [
		askSelectedButton,
		keepSelectedButton,
		openSelectedButton,
		exportSelectedButton,
		deleteSelectedButton,
	]) {
		button.disabled = locked;
	}
	sendButton.disabled = locked || !state.cwd || activeBusy;
	steerButton.disabled = locked || !state.cwd || !activeBusy;
	queueNextButton.disabled = locked || !state.cwd || !activeBusy;
	composer.classList.toggle("busy", activeBusy);
}

function renderChatDock(): void {
	chatDock.classList.toggle("right", state.chatDockPosition === "right");
	chatDock.classList.toggle("minimized", state.chatDockMinimized);
	const nextPosition = state.chatDockPosition === "right" ? "bottom" : "right";
	dockToggleButton.textContent = nextPosition === "right" ? "▐" : "▁";
	dockToggleButton.ariaLabel = `Dock ${nextPosition}`;
	dockToggleButton.title = `Dock ${nextPosition}`;
	dockMinimizeButton.textContent = state.chatDockMinimized ? "▣" : "−";
	dockMinimizeButton.ariaLabel = state.chatDockMinimized ? "Expand chat" : "Minimize chat";
	dockMinimizeButton.title = state.chatDockMinimized ? "Expand chat" : "Minimize chat";
}

function renderChatTabs(): void {
	chatTabs.replaceChildren();
	chatTabs.classList.toggle("open", state.taskOrder.length > 0);
	if (state.taskOrder.length === 0) {
		return;
	}

	chatTabs.appendChild(createChatTab("Main", undefined, !state.activeTaskId, state.busy ? "working" : "complete"));
	for (const taskId of state.taskOrder) {
		const task = state.tasks.get(taskId);
		if (!task) {
			continue;
		}
		chatTabs.appendChild(createChatTab(task.title, task.id, state.activeTaskId === task.id, task.status));
	}
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

function renderRecentWorkspaces(): void {
	const selectedValue = recentWorkspaceSelect.value;
	recentWorkspaceSelect.replaceChildren();
	const placeholder = document.createElement("option");
	placeholder.value = "";
	placeholder.textContent = state.recentWorkspaces.length === 0 ? "No recent" : "Open recent";
	recentWorkspaceSelect.appendChild(placeholder);
	for (const workspace of state.recentWorkspaces) {
		const option = document.createElement("option");
		option.value = workspace.path;
		option.textContent = workspaceLabel(workspace);
		recentWorkspaceSelect.appendChild(option);
	}
	recentWorkspaceSelect.value = state.recentWorkspaces.some((workspace) => workspace.path === selectedValue) ? selectedValue : "";
}

function renderModels(): void {
	const selectedValue = state.model ? modelValue(state.model) : "";
	modelSelect.replaceChildren();
	if (state.models.length === 0) {
		const option = document.createElement("option");
		option.value = "";
		option.textContent = "No configured models";
		modelSelect.appendChild(option);
		return;
	}

	for (const model of state.models) {
		const option = document.createElement("option");
		option.value = modelValue(model);
		option.textContent = `${model.providerName}: ${model.name}${model.configured ? "" : " (not configured)"}`;
		option.disabled = !model.configured;
		modelSelect.appendChild(option);
	}
	modelSelect.value = selectedValue;
}

function renderChat(): void {
	const stickToBottom = shouldStickChatToBottom(chatLog);
	chatLog.replaceChildren();
	const activeTask = activeTaskView();
	const baseMessages = activeTask?.messages ?? state.messages;
	const streaming = activeTask?.streaming ?? state.streaming;
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
	renderAgentLoading();
	if (stickToBottom) {
		chatLog.scrollTop = chatLog.scrollHeight;
	}
}

function renderAgentLoading(): void {
	const activeTask = activeTaskView();
	const activeBusy = activeTask ? isTaskBusy(activeTask) : state.busy;
	chatDock.classList.toggle("loading", activeBusy);
	agentLoading.classList.toggle("open", activeBusy);
	agentLoadingText.textContent = activeTask ? activeTask.statusText : state.statusText;
}

function renderQueue(): void {
	queueStack.replaceChildren();
	const activeTask = activeTaskView();
	const queuedSteering = activeTask?.queuedSteering ?? state.queuedSteering;
	const queuedFollowUp = activeTask?.queuedFollowUp ?? state.queuedFollowUp;
	for (const item of queuedSteering) {
		queueStack.appendChild(createQueuedMessage("Steering", item));
	}
	for (const item of queuedFollowUp) {
		queueStack.appendChild(createQueuedMessage("Queued next", item));
	}
	queueStack.classList.toggle("open", queuedSteering.length + queuedFollowUp.length > 0);
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

function renderCards(): void {
	emptyHint.classList.toggle("hidden", state.cards.length > 0);
	cardHost.replaceChildren(...state.cards.map((card) => createCardElement(card, false, state.loadingCardIds.has(card.id))));
	workspaceCanvas.replaceChildren(...state.cards.map((card) => createCardElement(card, true, state.loadingCardIds.has(card.id))));
}

function renderSelection(): void {
	const selected = selectedCards();
	contextBar.classList.toggle("open", selected.length > 0);
	selectedCount.textContent = `${selected.length} selected`;
	selectedNote.classList.toggle("open", selected.length > 0);
	selectedNote.textContent = selected.length > 0 ? `Using: ${selected.map((card) => card.title).join(", ")}` : "";
}

function createCardElement(card: CanvasCard, clone: boolean, loading = false): HTMLElement {
	const article = document.createElement("article");
	if (clone) {
		article.ariaHidden = "true";
	}
	article.className = [
		"canvas-card",
		card.type === "html" ? "html-card" : "",
		state.selectedIds.has(card.id) ? "selected" : "",
		loading || card.status === "working" ? "loading" : "",
		card.kept ? "kept" : "",
		card.status === "error" ? "error" : "",
	]
		.filter(Boolean)
		.join(" ");
	article.dataset.id = card.id;
	setCardPosition(article, card.position);

	const head = document.createElement("div");
	head.className = "card-head";
	const title = document.createElement("div");
	title.className = "card-title";
	const h2 = document.createElement("h2");
	h2.textContent = card.title;
	const subtitle = document.createElement("p");
	subtitle.textContent = card.subtitle;
	title.append(h2, subtitle);
	const actions = document.createElement("div");
	actions.className = "card-actions";
	const status = document.createElement("span");
	status.className = `status-pill ${card.kept ? "kept" : card.status}`;
	status.textContent = loading ? "Updating" : card.kept ? "Kept" : card.statusLabel;
	actions.appendChild(status);
	actions.appendChild(actionButton("Fullscreen", "open", clone));
	if (card.type === "report" || card.type === "html" || card.kept) {
		actions.appendChild(actionButton("Export", "export", clone));
	}
	actions.appendChild(actionButton("Close", "close", clone));
	head.append(title, actions);

	const body = document.createElement("div");
	body.className = "card-body";
	appendCardBody(body, card);

	article.append(head);
	if (loading || card.status === "working") {
		article.appendChild(createCardLoading(loading ? "Updating" : card.statusLabel, card.progress));
	}
	article.appendChild(body);
	return article;
}

function actionButton(label: string, action: string, inert: boolean): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = `icon-button card-action ${action}-action`;
	button.type = "button";
	button.dataset.action = action;
	button.ariaLabel = label;
	button.title = label;
	if (action === "open") {
		const glyph = document.createElement("span");
		glyph.className = "expand-glyph";
		glyph.ariaHidden = "true";
		button.appendChild(glyph);
	} else if (action === "close") {
		button.textContent = "x";
	} else {
		button.textContent = label;
	}
	if (inert) {
		button.tabIndex = -1;
	}
	return button;
}

function createCardLoading(label: string, progress: number | undefined): HTMLElement {
	const loading = document.createElement("div");
	loading.className = "card-loading";
	const text = document.createElement("span");
	text.textContent = label;
	const track = document.createElement("div");
	track.className = "card-loading-track";
	const fill = document.createElement("span");
	fill.className = progress === undefined ? "card-loading-fill indeterminate" : "card-loading-fill";
	if (progress !== undefined) {
		fill.style.setProperty("--progress", `${progress}%`);
	}
	track.appendChild(fill);
	loading.append(text, track);
	return loading;
}

function setCardPosition(element: HTMLElement, position: CanvasCardPosition): void {
	element.style.setProperty("--x", `${position.x}px`);
	element.style.setProperty("--y", `${position.y}px`);
	element.style.setProperty("--w", `${position.w}px`);
	element.style.setProperty("--h", `${position.h}px`);
}

function renderCanvasViewport(): void {
	cardHost.style.transform = `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.zoom})`;
}

function appendCardBody(body: HTMLElement, card: CanvasCard): void {
	if (card.status === "working") {
		const text = document.createElement("div");
		text.className = "markdown-body";
		appendMarkdown(text, card.body);
		const lines = document.createElement("div");
		lines.className = "analysis-lines";
		lines.ariaHidden = "true";
		lines.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
		for (const child of lines.children) child.className = "writing-line";
		body.append(text, lines);
		return;
	}

	if (card.type === "html" && card.html) {
		const artifact = document.createElement("div");
		artifact.className = "html-artifact";
		artifact.innerHTML = sanitizeCanvasHtml(card.html);
		body.appendChild(artifact);
		if (card.body) {
			const caption = document.createElement("p");
			caption.className = "artifact-caption";
			caption.textContent = card.body;
			body.appendChild(caption);
		}
		return;
	}

	if (card.type === "chart" && card.metrics) {
		for (const metric of card.metrics) {
			const row = document.createElement("div");
			row.className = "metric-row";
			const label = document.createElement("span");
			label.textContent = metric.label;
			const track = document.createElement("div");
			track.className = "bar-track";
			const fill = document.createElement("span");
			fill.className = "bar-fill";
			fill.style.setProperty("--bar", `${metric.value}%`);
			const value = document.createElement("b");
			value.textContent = String(metric.value);
			track.appendChild(fill);
			row.append(label, track, value);
			body.appendChild(row);
		}
		return;
	}

	if (card.type === "table" && card.rows) {
		body.appendChild(createTable(card.rows));
		return;
	}

	if (card.type === "diagram") {
		body.appendChild(createDiagram(card.nodes ?? ["Inputs", "Tables", "Signals", "Report"]));
		return;
	}

	const markdown = document.createElement("div");
	markdown.className = "markdown-body";
	appendMarkdown(markdown, card.body);
	body.appendChild(markdown);

	if (card.type === "report" && card.sections) {
		const sections = document.createElement("div");
		sections.className = "report-sections";
		for (const section of card.sections) {
			const item = document.createElement("div");
			item.className = "report-section";
			const title = document.createElement("b");
			title.textContent = section.title;
			const sectionBody = document.createElement("div");
			sectionBody.className = "report-section-body";
			appendMarkdown(sectionBody, section.body);
			item.append(title, sectionBody);
			sections.appendChild(item);
		}
		body.appendChild(sections);
		return;
	}

	if (card.type !== "summary" && card.points && card.points.length > 0) {
		const list = document.createElement("ul");
		list.className = "summary-list";
		for (const point of card.points) {
			const item = document.createElement("li");
			item.textContent = point;
			list.appendChild(item);
		}
		body.appendChild(list);
	}
}

function sanitizeCanvasHtml(value: string): string {
	const template = document.createElement("template");
	template.innerHTML = value;
	for (const element of Array.from(template.content.querySelectorAll("*"))) {
		if (isForbiddenCanvasElement(element)) {
			element.remove();
			continue;
		}
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			const text = attribute.value.trim().toLowerCase();
			if (name.startsWith("on") || name === "srcdoc") {
				element.removeAttribute(attribute.name);
				continue;
			}
			if ((name === "href" || name === "src" || name === "xlink:href" || name === "action") && text.startsWith("javascript:")) {
				element.removeAttribute(attribute.name);
				continue;
			}
			if (name === "style") {
				element.setAttribute(attribute.name, sanitizeCss(attribute.value));
			}
		}
		if (element.tagName.toLowerCase() === "style") {
			element.textContent = sanitizeCss(element.textContent ?? "");
		}
	}
	return template.innerHTML;
}

function isForbiddenCanvasElement(element: Element): boolean {
	return ["script", "iframe", "object", "embed", "link", "meta", "base"].includes(element.tagName.toLowerCase());
}

function sanitizeCss(value: string): string {
	return value
		.replace(/@import[^;]+;?/gi, "")
		.replace(/url\s*\([^)]*\)/gi, "")
		.replace(/expression\s*\([^)]*\)/gi, "")
		.replace(/javascript:/gi, "");
}

function appendMarkdown(parent: HTMLElement, markdown: string): void {
	const lines = markdown.split(/\r?\n/);
	let paragraph: string[] = [];
	let list: HTMLUListElement | HTMLOListElement | undefined;
	let codeLines: string[] | undefined;

	const flushParagraph = () => {
		if (paragraph.length === 0) return;
		const element = document.createElement("p");
		appendInlineMarkdown(element, paragraph.join(" "));
		parent.appendChild(element);
		paragraph = [];
	};
	const flushList = () => {
		if (!list) return;
		parent.appendChild(list);
		list = undefined;
	};
	const flushCode = () => {
		if (!codeLines) return;
		const pre = document.createElement("pre");
		const code = document.createElement("code");
		code.textContent = codeLines.join("\n");
		pre.appendChild(code);
		parent.appendChild(pre);
		codeLines = undefined;
	};

	for (const line of lines) {
		if (line.trim().startsWith("```")) {
			if (codeLines) {
				flushCode();
			} else {
				flushParagraph();
				flushList();
				codeLines = [];
			}
			continue;
		}
		if (codeLines) {
			codeLines.push(line);
			continue;
		}

		const trimmed = line.trim();
		if (!trimmed) {
			flushParagraph();
			flushList();
			continue;
		}

		const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
		if (heading) {
			flushParagraph();
			flushList();
			const level = String(Math.min(3, heading[1].length + 2));
			const element = document.createElement(`h${level}`);
			appendInlineMarkdown(element, heading[2]);
			parent.appendChild(element);
			continue;
		}

		const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
		const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
		if (unordered || ordered) {
			flushParagraph();
			const orderedList = Boolean(ordered);
			if (!list || (orderedList && list.tagName !== "OL") || (!orderedList && list.tagName !== "UL")) {
				flushList();
				list = orderedList ? document.createElement("ol") : document.createElement("ul");
			}
			const item = document.createElement("li");
			appendInlineMarkdown(item, (ordered ?? unordered)?.[1] ?? "");
			list.appendChild(item);
			continue;
		}

		paragraph.push(trimmed);
	}

	flushParagraph();
	flushList();
	flushCode();
}

function appendInlineMarkdown(parent: HTMLElement, text: string): void {
	const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
	let cursor = 0;
	for (const match of text.matchAll(tokenPattern)) {
		const token = match[0];
		if (match.index > cursor) {
			parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
		}
		parent.appendChild(inlineMarkdownNode(token));
		cursor = match.index + token.length;
	}
	if (cursor < text.length) {
		parent.appendChild(document.createTextNode(text.slice(cursor)));
	}
}

function inlineMarkdownNode(token: string): Node {
	if (token.startsWith("`") && token.endsWith("`")) {
		const code = document.createElement("code");
		code.textContent = token.slice(1, -1);
		return code;
	}
	if (token.startsWith("**") && token.endsWith("**")) {
		const strong = document.createElement("strong");
		strong.textContent = token.slice(2, -2);
		return strong;
	}
	if (token.startsWith("*") && token.endsWith("*")) {
		const em = document.createElement("em");
		em.textContent = token.slice(1, -1);
		return em;
	}
	const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
	if (link) {
		const anchor = document.createElement("a");
		anchor.textContent = link[1];
		anchor.href = link[2];
		anchor.target = "_blank";
		anchor.rel = "noreferrer";
		return anchor;
	}
	return document.createTextNode(token);
}

function createTable(rows: string[][]): HTMLTableElement {
	const table = document.createElement("table");
	table.className = "mini-table";
	const head = document.createElement("thead");
	const headRow = document.createElement("tr");
	for (const label of ["Item", "Signal", "Next"]) {
		const cell = document.createElement("th");
		cell.textContent = label;
		headRow.appendChild(cell);
	}
	head.appendChild(headRow);
	const body = document.createElement("tbody");
	for (const row of rows) {
		const tableRow = document.createElement("tr");
		for (const value of row.slice(0, 3)) {
			const cell = document.createElement("td");
			cell.textContent = value;
			tableRow.appendChild(cell);
		}
		body.appendChild(tableRow);
	}
	table.append(head, body);
	return table;
}

function createDiagram(labels: string[]): HTMLElement {
	const diagram = document.createElement("div");
	diagram.className = "diagram";
	for (const [index, className] of ["a", "b", "c", "d"].entries()) {
		const node = document.createElement("div");
		node.className = `node ${className}`;
		const title = document.createElement("b");
		title.textContent = labels[index] ?? "Node";
		const subtitle = document.createElement("span");
		subtitle.textContent = index === 0 ? "Source" : index === 3 ? "Output" : "Relationship";
		node.append(title, subtitle);
		diagram.appendChild(node);
	}
	return diagram;
}

function scheduleCanvasPaint(): void {
	if (canvasFrame !== undefined) {
		window.cancelAnimationFrame(canvasFrame);
	}
	canvasFrame = window.requestAnimationFrame(() => {
		canvasFrame = undefined;
		paintCanvas();
	});
}

function paintCanvas(): void {
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
	drawGrid(ctx, rect.width, rect.height, state.viewport);

	const drawElementImage = ctx.drawElementImage;
	const supportsHtmlCanvas = typeof drawElementImage === "function" && !state.htmlCanvasFailed && window.innerWidth > 860;
	state.htmlCanvasActive = supportsHtmlCanvas;
	canvasShell.classList.toggle("html-canvas-active", supportsHtmlCanvas);

	if (!supportsHtmlCanvas) return;

	try {
		const clones = Array.from(workspaceCanvas.querySelectorAll<HTMLElement>(":scope > .canvas-card"));
		ctx.save();
		try {
			ctx.translate(state.viewport.x, state.viewport.y);
			ctx.scale(state.viewport.zoom, state.viewport.zoom);
			for (const clone of clones) {
				const card = state.cards.find((item) => item.id === clone.dataset.id);
				if (!card) continue;
				drawElementImage.call(ctx, clone, card.position.x, card.position.y);
			}
		} finally {
			ctx.restore();
		}
	} catch (error) {
		state.htmlCanvasFailed = true;
		state.htmlCanvasActive = false;
		canvasShell.classList.remove("html-canvas-active");
		showToast(error instanceof Error ? error.message : "HTML-in-Canvas paint failed.");
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

function positiveModulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}

async function openWorkspace(): Promise<void> {
	if (!state.authenticated) return;
	const folder = await api.selectWorkspaceFolder();
	if (!folder) return;
	await startSession(folder.path);
}

async function startSession(cwd: string): Promise<void> {
	if (!state.authenticated) return;
	setBusy("Starting session", true);
	try {
		const snapshot = await api.startSession(cwd);
		applySessionSnapshot(snapshot);
		await refreshRecentWorkspaces();
		await applyPendingModelSelection();
		showToast("Workspace opened.");
	} catch (error) {
		addSystemMessage(errorMessage(error));
		showToast(errorMessage(error));
	} finally {
		setBusy("Ready", false);
	}
}

function applySessionSnapshot(snapshot: SessionSnapshot): void {
	state.authenticated = true;
	state.cwd = snapshot.cwd;
	state.sessionId = snapshot.sessionId;
	state.model = snapshot.model;
	state.models = snapshot.models;
	state.cards = snapshot.board?.cards ?? [];
	state.tasks.clear();
	state.taskOrder = [];
	state.activeTaskId = undefined;
	for (const card of state.cards) {
		ensureTaskFromCard(card);
	}
	state.shareReady = snapshot.board?.shareReady ?? false;
	state.queuedSteering = [];
	state.queuedFollowUp = [];
	resetCanvasViewport();
	state.selectedIds.clear();
	state.loadingCardIds.clear();
	for (const diagnostic of snapshot.diagnostics) {
		addSystemMessage(diagnostic.message);
	}
	render();
}

function applyAuthState(authState: AuthState): void {
	state.authenticated = authState.loggedIn;
	state.authProviders = authState.providers;
	state.models = authState.models;
	if (!authState.loggedIn) {
		state.cwd = undefined;
		state.sessionId = undefined;
		state.model = undefined;
		state.cards = [];
		state.queuedSteering = [];
		state.queuedFollowUp = [];
		state.tasks.clear();
		state.taskOrder = [];
		state.activeTaskId = undefined;
		resetCanvasViewport();
		state.selectedIds.clear();
		state.loadingCardIds.clear();
	}
	render();
}

async function refreshAuthState(): Promise<void> {
	try {
		applyAuthState(await api.getAuthState());
		await refreshRecentWorkspaces();
	} catch (error) {
		loginError.textContent = errorMessage(error);
		render();
	}
}

async function refreshRecentWorkspaces(): Promise<void> {
	try {
		state.recentWorkspaces = await api.listRecentWorkspaces();
		renderRecentWorkspaces();
		renderStatus();
	} catch (error) {
		state.recentWorkspaces = [];
		renderRecentWorkspaces();
		renderStatus();
	}
}

async function saveLogin(): Promise<void> {
	loginError.textContent = "";
	loginSubmitButton.disabled = true;
	try {
		const authState = await api.loginProvider({
			provider: loginProvider.value,
			apiKey: loginApiKey.value,
		});
		state.pendingModelValue = loginModel.value || undefined;
		loginApiKey.value = "";
		applyAuthState(authState);
		showToast("Logged in.");
	} catch (error) {
		loginError.textContent = errorMessage(error);
	} finally {
		loginSubmitButton.disabled = state.authProviders.length === 0;
	}
}

async function applyPendingModelSelection(): Promise<void> {
	if (!state.pendingModelValue || !state.cwd) return;
	const [provider, ...idParts] = state.pendingModelValue.split("/");
	const id = idParts.join("/");
	if (!provider || !id) return;
	try {
		await api.setModel({ provider, id });
	} catch (error) {
		addSystemMessage(errorMessage(error));
	}
}

async function submitPrompt(text: string, streamingBehavior?: "steer" | "followUp"): Promise<void> {
	const trimmed = text.trim();
	if (!trimmed || !state.cwd || !state.authenticated) return;
	const activeTask = activeTaskView();
	if (activeTask) {
		const behavior = isTaskBusy(activeTask) ? streamingBehavior ?? "followUp" : streamingBehavior;
		try {
			await api.sendTaskPrompt({
				taskId: activeTask.id,
				text: trimmed,
				streamingBehavior: behavior,
			});
			chatInput.value = "";
		} catch (error) {
			addTaskSystemMessage(activeTask.id, errorMessage(error));
			showToast(errorMessage(error));
		}
		return;
	}
	const selected = selectedCards();
	const queueing = state.busy;
	if (!queueing) {
		state.loadingCardIds = new Set(selected.map((card) => card.id));
		setBusy("Sending prompt", true);
		renderCards();
	}
	try {
		await api.sendPrompt({
			text: trimmed,
			selectedCards: selected.map(cardContext),
			streamingBehavior,
		});
		chatInput.value = "";
	} catch (error) {
		addSystemMessage(errorMessage(error));
		showToast(errorMessage(error));
	} finally {
		if (!queueing) {
			state.loadingCardIds.clear();
			setBusy("Ready", false);
			renderCards();
		}
	}
}

function handleRendererEvent(event: MainToRendererEvent): void {
	if (event.type === "status") {
		setBusy(event.text, event.busy);
		return;
	}
	if (event.type === "login-status") {
		loginError.textContent = event.message;
		return;
	}
	if (event.type === "chat-message") {
		if (event.taskId) {
			addTaskChatEvent(event.taskId, event);
		} else {
			addChatEvent(event);
		}
		return;
	}
	if (event.type === "assistant-stream") {
		if (event.taskId) {
			const task = state.tasks.get(event.taskId);
			if (task) {
				task.streaming = { id: event.id, text: event.text };
			}
		} else {
			state.streaming = { id: event.id, text: event.text };
		}
		renderChat();
		return;
	}
	if (event.type === "queue-update") {
		if (event.taskId) {
			const task = state.tasks.get(event.taskId);
			if (task) {
				task.queuedSteering = [...event.steering];
				task.queuedFollowUp = [...event.followUp];
			}
		} else {
			state.queuedSteering = [...event.steering];
			state.queuedFollowUp = [...event.followUp];
		}
		renderQueue();
		return;
	}
	if (event.type === "task-update") {
		upsertTask(event.task);
		return;
	}
	if (event.type === "canvas-card") {
		upsertCard(event.card);
		return;
	}
	if (event.type === "model-selected") {
		state.model = event.model;
		render();
		return;
	}
	if (event.type === "diagnostic") {
		addSystemMessage(event.diagnostic.message);
		return;
	}
	if (event.type === "exported-report") {
		showToast(`Exported ${event.filePath}`);
	}
}

function addChatEvent(event: ChatMessageEvent): void {
	if (event.author === "Pi") {
		state.streaming = undefined;
	}
	state.messages.push({
		id: event.id,
		author: event.author,
		text: event.text,
		timestamp: event.timestamp,
	});
	renderChat();
}

function addTaskChatEvent(taskId: string, event: ChatMessageEvent): void {
	const task = state.tasks.get(taskId);
	if (!task) {
		return;
	}
	if (event.author === "Pi") {
		task.streaming = undefined;
	}
	task.messages.push({
		id: event.id,
		author: event.author,
		text: event.text,
		timestamp: event.timestamp,
	});
	renderChat();
}

function addSystemMessage(text: string): void {
	state.messages.push({
		id: `system-${Date.now()}`,
		author: "System",
		text,
		timestamp: new Date().toISOString(),
	});
	renderChat();
}

function addTaskSystemMessage(taskId: string, text: string): void {
	const task = state.tasks.get(taskId);
	if (!task) {
		addSystemMessage(text);
		return;
	}
	task.messages.push({
		id: `task-system-${taskId}-${Date.now()}`,
		author: "System",
		text,
		timestamp: new Date().toISOString(),
	});
	renderChat();
}

function upsertTask(snapshot: TaskSnapshot): void {
	const existing = state.tasks.get(snapshot.id);
	if (existing) {
		existing.groupId = snapshot.groupId;
		existing.sessionId = snapshot.sessionId;
		existing.cardId = snapshot.cardId;
		existing.title = snapshot.title;
		existing.status = snapshot.status;
		existing.statusText = snapshot.statusText;
		existing.targetPaths = [...snapshot.targetPaths];
		existing.requiresWrites = snapshot.requiresWrites;
		if (snapshot.status === "complete" || snapshot.status === "error") {
			existing.streaming = undefined;
			existing.queuedSteering = [];
			existing.queuedFollowUp = [];
		}
	} else {
		state.tasks.set(snapshot.id, {
			...snapshot,
			targetPaths: [...snapshot.targetPaths],
			messages: [taskSystemMessage(snapshot, `Task started: ${snapshot.title}`)],
			queuedSteering: [],
			queuedFollowUp: [],
		});
		state.taskOrder.push(snapshot.id);
	}
	renderChatTabs();
	renderStatus();
	renderChat();
	renderQueue();
}

function ensureTaskFromCard(card: CanvasCard): void {
	if (!card.taskId || state.tasks.has(card.taskId)) {
		return;
	}
	const snapshot: TaskSnapshot = {
		id: card.taskId,
		groupId: card.taskGroupId ?? "restored-task-group",
		sessionId: card.taskSessionId ?? "restored-task-session",
		cardId: card.id,
		title: card.title,
		status: card.status === "working" ? "working" : card.status === "error" ? "error" : "complete",
		statusText: card.statusLabel,
		targetPaths: [],
		requiresWrites: false,
	};
	state.tasks.set(snapshot.id, {
		...snapshot,
		messages: [taskSystemMessage(snapshot, `Task card: ${snapshot.title}`)],
		queuedSteering: [],
		queuedFollowUp: [],
	});
	state.taskOrder.push(snapshot.id);
}

function taskSystemMessage(task: TaskSnapshot, text: string): ChatMessage {
	return {
		id: `task-system-${task.id}-${Date.now()}`,
		author: "System",
		text,
		timestamp: new Date().toISOString(),
	};
}

function upsertCard(card: CanvasCard): void {
	const index = state.cards.findIndex((candidate) => candidate.id === card.id);
	if (index === -1) {
		state.cards.push({
			...card,
			position: resolveNewCardPosition(card.position, state.cards),
		});
	} else {
		const existing = state.cards[index];
		state.cards[index] = {
			...card,
			position: {
				...card.position,
				x: existing.position.x,
				y: existing.position.y,
			},
		};
	}
	ensureTaskFromCard(card);
	state.loadingCardIds.delete(card.id);
	render();
	scheduleSaveBoard();
}

function resolveNewCardPosition(position: CanvasCardPosition, cards: CanvasCard[]): CanvasCardPosition {
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

function normalizePosition(position: CanvasCardPosition): CanvasCardPosition {
	return {
		x: Math.round(position.x),
		y: Math.round(position.y),
		w: Math.round(position.w),
		h: Math.round(position.h),
	};
}

function overlapsAny(position: CanvasCardPosition, cards: CanvasCard[]): boolean {
	return cards.some((card) => positionsOverlap(position, card.position, CARD_PLACEMENT_GAP));
}

function positionsOverlap(a: CanvasCardPosition, b: CanvasCardPosition, gap: number): boolean {
	return (
		a.x < b.x + b.w + gap &&
		a.x + a.w + gap > b.x &&
		a.y < b.y + b.h + gap &&
		a.y + a.h + gap > b.y
	);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && aEnd > bStart;
}

function activeTaskView(): TaskView | undefined {
	if (!state.activeTaskId) {
		return undefined;
	}
	return state.tasks.get(state.activeTaskId);
}

function isTaskBusy(task: TaskView): boolean {
	return task.status === "queued" || task.status === "working";
}

function selectedCards(): CanvasCard[] {
	return state.cards.filter((card) => state.selectedIds.has(card.id));
}

function cardContext(card: CanvasCard): PromptCardContext {
	return {
		id: card.id,
		type: card.type,
		title: card.title,
		body: card.body,
		position: card.position,
		kept: card.kept,
	};
}

function toggleSelection(id: string, additive: boolean): void {
	if (!additive) state.selectedIds.clear();
	if (state.selectedIds.has(id) && additive) {
		state.selectedIds.delete(id);
	} else {
		state.selectedIds.add(id);
	}
	render();
}

function beginCardDrag(event: PointerEvent): void {
	if (!state.authenticated || event.button !== 0) return;
	const target = event.target;
	if (!(target instanceof Element)) return;
	if (target.closest("[data-action]")) return;
	const cardElement = target.closest<HTMLElement>(".canvas-card");
	if (!cardElement?.dataset.id) return;
	const card = state.cards.find((candidate) => candidate.id === cardElement.dataset.id);
	if (!card) return;
	event.preventDefault();
	cardDrag = {
		id: card.id,
		pointerId: event.pointerId,
		startClientX: event.clientX,
		startClientY: event.clientY,
		startX: card.position.x,
		startY: card.position.y,
		moved: false,
	};
	cardElement.setPointerCapture(event.pointerId);
	cardElement.classList.add("dragging");
}

function moveCardDrag(event: PointerEvent): void {
	if (!cardDrag || event.pointerId !== cardDrag.pointerId) return;
	const card = state.cards.find((candidate) => candidate.id === cardDrag?.id);
	if (!card) return;
	const deltaX = (event.clientX - cardDrag.startClientX) / state.viewport.zoom;
	const deltaY = (event.clientY - cardDrag.startClientY) / state.viewport.zoom;
	cardDrag.moved ||= Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
	if (!cardDrag.moved) return;
	card.position = {
		x: Math.round(cardDrag.startX + deltaX),
		y: Math.round(cardDrag.startY + deltaY),
		w: card.position.w,
		h: card.position.h,
	};
	updateCardPositionElements(card.id, card.position);
	scheduleCanvasPaint();
}

function endCardDrag(event: PointerEvent): void {
	if (!cardDrag || event.pointerId !== cardDrag.pointerId) return;
	const moved = cardDrag.moved;
	const id = cardDrag.id;
	cardDrag = undefined;
	for (const element of cardElements(id)) {
		element.classList.remove("dragging");
	}
	if (!moved) return;
	suppressNextCardClick = true;
	scheduleSaveBoard();
	window.setTimeout(() => {
		suppressNextCardClick = false;
	}, 0);
}

function updateCardPositionElements(id: string, position: CanvasCardPosition): void {
	for (const element of cardElements(id)) {
		setCardPosition(element, position);
	}
}

function cardElements(id: string): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>(".canvas-card")).filter((element) => element.dataset.id === id);
}

function beginCanvasPan(event: PointerEvent): void {
	if (event.button !== 0 || cardDrag) return;
	const target = event.target;
	if (!(target instanceof Element)) return;
	if (target.closest(".canvas-card")) return;
	canvasPan = {
		pointerId: event.pointerId,
		startClientX: event.clientX,
		startClientY: event.clientY,
		startX: state.viewport.x,
		startY: state.viewport.y,
	};
	canvasShell.setPointerCapture(event.pointerId);
	canvasShell.classList.add("panning");
	event.preventDefault();
}

function moveCanvasPan(event: PointerEvent): void {
	if (!canvasPan || event.pointerId !== canvasPan.pointerId) return;
	state.viewport.x = Math.round(canvasPan.startX + event.clientX - canvasPan.startClientX);
	state.viewport.y = Math.round(canvasPan.startY + event.clientY - canvasPan.startClientY);
	renderCanvasViewport();
	scheduleCanvasPaint();
	event.preventDefault();
}

function endCanvasPan(event: PointerEvent): void {
	if (!canvasPan || event.pointerId !== canvasPan.pointerId) return;
	canvasPan = undefined;
	canvasShell.classList.remove("panning");
}

function zoomCanvas(event: WheelEvent): void {
	const rect = canvasShell.getBoundingClientRect();
	const screenX = event.clientX - rect.left;
	const screenY = event.clientY - rect.top;
	const worldX = (screenX - state.viewport.x) / state.viewport.zoom;
	const worldY = (screenY - state.viewport.y) / state.viewport.zoom;
	const unclampedZoom = state.viewport.zoom * Math.exp(-event.deltaY * CANVAS_ZOOM_SENSITIVITY);
	const nextZoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, unclampedZoom));
	state.viewport.x = Math.round(screenX - worldX * nextZoom);
	state.viewport.y = Math.round(screenY - worldY * nextZoom);
	state.viewport.zoom = nextZoom;
	renderCanvasViewport();
	scheduleCanvasPaint();
	event.preventDefault();
}

function resetCanvasViewport(): void {
	state.viewport = {
		x: 0,
		y: 0,
		zoom: 1,
	};
	renderCanvasViewport();
}

function keepSelected(): void {
	if (!state.authenticated) return;
	for (const card of selectedCards()) {
		card.kept = true;
		card.status = "kept";
		card.statusLabel = "Kept";
	}
	render();
	scheduleSaveBoard();
	if (state.selectedIds.size > 0) showToast("Selected item kept.");
}

function deleteSelected(): void {
	if (!state.authenticated) return;
	if (state.selectedIds.size === 0) return;
	state.cards = state.cards.filter((card) => !state.selectedIds.has(card.id));
	for (const id of state.selectedIds) {
		state.loadingCardIds.delete(id);
	}
	state.selectedIds.clear();
	render();
	scheduleSaveBoard();
	showToast("Selected item deleted.");
}

function deleteCard(id: string): void {
	if (!state.authenticated) return;
	const deleted = state.cards.find((card) => card.id === id);
	state.cards = state.cards.filter((card) => card.id !== id);
	state.selectedIds.delete(id);
	state.loadingCardIds.delete(id);
	if (deleted?.taskId === state.activeTaskId) {
		state.activeTaskId = undefined;
	}
	render();
	scheduleSaveBoard();
	showToast("Canvas item closed.");
}

async function openCard(id: string): Promise<void> {
	if (!state.authenticated) return;
	const card = state.cards.find((candidate) => candidate.id === id);
	if (!card) return;
	state.activeModalId = id;
	modalTitle.textContent = card.title;
	modalSubtitle.textContent = card.subtitle;
	modalBody.replaceChildren(createCardElement(card, false));
	modal.classList.add("open");
	try {
		await modal.requestFullscreen();
	} catch (error) {
		showToast(errorMessage(error));
	}
}

async function closeCardFullscreen(): Promise<void> {
	if (document.fullscreenElement === modal) {
		await document.exitFullscreen();
	}
	modal.classList.remove("open");
	state.activeModalId = undefined;
}

async function exportCards(cards: CanvasCard[]): Promise<void> {
	if (!state.authenticated) return;
	if (cards.length === 0) return;
	try {
		const filePath = await api.exportReport({ cards });
		if (filePath) showToast(`Exported ${filePath}`);
	} catch (error) {
		showToast(errorMessage(error));
	}
}

function scheduleSaveBoard(): void {
	if (!state.cwd || !state.sessionId) return;
	if (saveTimer !== undefined) {
		window.clearTimeout(saveTimer);
	}
	saveTimer = window.setTimeout(() => {
		saveTimer = undefined;
		void saveBoard();
	}, 350);
}

async function saveBoard(): Promise<void> {
	if (!state.authenticated) return;
	if (!state.cwd || !state.sessionId) return;
	const board: PersistedBoard = {
		version: 1,
		cwd: state.cwd,
		sessionId: state.sessionId,
		cards: state.cards,
		shareReady: state.shareReady,
		updatedAt: new Date().toISOString(),
	};
	await api.saveBoard({ board });
}

function setBusy(text: string, busy: boolean): void {
	state.statusText = text;
	state.busy = busy;
	renderChatTabs();
	renderStatus();
	renderChat();
}

function showToast(text: string): void {
	toast.textContent = text;
	toast.classList.add("open");
	if (toastTimer !== undefined) {
		window.clearTimeout(toastTimer);
	}
	toastTimer = window.setTimeout(() => toast.classList.remove("open"), 2600);
}

function compactPath(path: string): string {
	const parts = path.split(/[\\/]/).filter(Boolean);
	if (parts.length <= 2) return path;
	return `${parts.at(-2)}/${parts.at(-1)}`;
}

function workspaceLabel(workspace: RecentWorkspace): string {
	const path = compactPath(workspace.path);
	return workspace.name === path ? path : `${workspace.name} - ${path}`;
}

function modelValue(model: ModelSummary): string {
	return `${model.provider}/${model.id}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

cardHost.addEventListener("click", (event) => {
	if (suppressNextCardClick) {
		suppressNextCardClick = false;
		event.preventDefault();
		return;
	}
	const target = event.target;
	if (!(target instanceof Element)) return;
	const action = target.closest<HTMLElement>("[data-action]");
	const cardElement = target.closest<HTMLElement>(".canvas-card");
	if (!cardElement?.dataset.id) return;
	if (action?.dataset.action === "open") {
		void openCard(cardElement.dataset.id);
		return;
	}
	if (action?.dataset.action === "export") {
		const card = state.cards.find((candidate) => candidate.id === cardElement.dataset.id);
		if (card) void exportCards([card]);
		return;
	}
	if (action?.dataset.action === "close") {
		deleteCard(cardElement.dataset.id);
		return;
	}
	const card = state.cards.find((candidate) => candidate.id === cardElement.dataset.id);
	if (card?.taskId) {
		ensureTaskFromCard(card);
		state.activeTaskId = card.taskId;
	}
	toggleSelection(cardElement.dataset.id, event.shiftKey || event.metaKey || event.ctrlKey);
});
cardHost.addEventListener("pointerdown", beginCardDrag);
cardHost.addEventListener("pointermove", moveCardDrag);
cardHost.addEventListener("pointerup", endCardDrag);
cardHost.addEventListener("pointercancel", endCardDrag);
canvasShell.addEventListener("pointerdown", beginCanvasPan);
canvasShell.addEventListener("pointermove", moveCanvasPan);
canvasShell.addEventListener("pointerup", endCanvasPan);
canvasShell.addEventListener("pointercancel", endCanvasPan);
canvasShell.addEventListener("wheel", zoomCanvas, { passive: false });

composer.addEventListener("submit", (event) => {
	event.preventDefault();
	const activeTask = activeTaskView();
	const activeBusy = activeTask ? isTaskBusy(activeTask) : state.busy;
	void submitPrompt(chatInput.value, activeBusy ? "followUp" : undefined);
});

steerButton.addEventListener("click", () => {
	void submitPrompt(chatInput.value, "steer");
});

queueNextButton.addEventListener("click", () => {
	void submitPrompt(chatInput.value, "followUp");
});

dockToggleButton.addEventListener("click", () => {
	setChatDockPosition(state.chatDockPosition === "right" ? "bottom" : "right");
});

dockMinimizeButton.addEventListener("click", () => {
	setChatDockMinimized(!state.chatDockMinimized);
});

chatTabs.addEventListener("click", (event) => {
	const target = event.target;
	if (!(target instanceof HTMLElement)) return;
	const tab = target.closest<HTMLButtonElement>(".chat-tab");
	if (!tab) return;
	state.activeTaskId = tab.dataset.taskId;
	renderStatus();
	renderChatTabs();
	renderChat();
	renderQueue();
	chatInput.focus();
});

openFolderButton.addEventListener("click", () => {
	void openWorkspace();
});

recentWorkspaceSelect.addEventListener("change", () => {
	const path = recentWorkspaceSelect.value;
	recentWorkspaceSelect.value = "";
	if (!path) return;
	void startSession(path);
});

loginForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void saveLogin();
});

loginProvider.addEventListener("change", () => {
	loginError.textContent = "";
	renderAuth();
});

loginModel.addEventListener("change", () => {
	state.pendingModelValue = loginModel.value || undefined;
});

newBoardButton.addEventListener("click", () => {
	state.cards = [];
	state.selectedIds.clear();
	state.loadingCardIds.clear();
	state.activeTaskId = undefined;
	state.shareReady = false;
	resetCanvasViewport();
	render();
	scheduleSaveBoard();
	addSystemMessage("New blank canvas ready.");
});

modelSelect.addEventListener("change", () => {
	const [provider, ...idParts] = modelSelect.value.split("/");
	const id = idParts.join("/");
	if (!provider || !id) return;
	void api.setModel({ provider, id });
});

askSelectedButton.addEventListener("click", () => {
	const selected = selectedCards();
	if (selected.length === 0) return;
	chatInput.value = `Use ${selected.map((card) => card.title).join(", ")} and show the next useful analysis step`;
	chatInput.focus();
});

keepSelectedButton.addEventListener("click", keepSelected);
deleteSelectedButton.addEventListener("click", deleteSelected);
openSelectedButton.addEventListener("click", () => {
	const first = selectedCards()[0];
	if (first) void openCard(first.id);
});
exportSelectedButton.addEventListener("click", () => {
	void exportCards(selectedCards());
});

modalKeepButton.addEventListener("click", () => {
	const card = state.cards.find((candidate) => candidate.id === state.activeModalId);
	if (!card) return;
	card.kept = true;
	card.status = "kept";
	card.statusLabel = "Kept";
	render();
	scheduleSaveBoard();
	showToast("Focused item kept.");
});

modalExportButton.addEventListener("click", () => {
	const card = state.cards.find((candidate) => candidate.id === state.activeModalId);
	if (card) void exportCards([card]);
});

modalCloseButton.addEventListener("click", () => {
	void closeCardFullscreen();
});
modal.addEventListener("click", (event) => {
	if (event.target === modal) void closeCardFullscreen();
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		void closeCardFullscreen();
		state.selectedIds.clear();
		render();
	}
	if ((event.key === "Delete" || event.key === "Backspace") && state.selectedIds.size > 0 && document.activeElement !== chatInput) {
		deleteSelected();
	}
});

document.addEventListener("fullscreenchange", () => {
	if (!document.fullscreenElement && modal.classList.contains("open")) {
		modal.classList.remove("open");
		state.activeModalId = undefined;
	}
});

const resizeObserver = new ResizeObserver(() => scheduleCanvasPaint());
resizeObserver.observe(canvasShell);
workspaceCanvas.addEventListener("paint", () => scheduleCanvasPaint());
api.onEvent(handleRendererEvent);
await refreshAuthState();
