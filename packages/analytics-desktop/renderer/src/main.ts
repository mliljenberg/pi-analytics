import type { CanvasCard, CanvasCardPosition, PersistedBoard } from "../../src/shared/canvas.ts";
import type {
	AuthState,
	ChatMessageEvent,
	MainToRendererEvent,
	ModelSummary,
	SessionSnapshot,
	TaskSnapshot,
} from "../../src/shared/ipc.ts";
import { createElement as createLucideIcon, Minimize2, PanelBottom, PanelRight, Square } from "lucide";
import { paintCanvas as paintCanvasFrame } from "./canvas/paint.ts";
import { resolveNewCardPosition } from "./canvas/placement.ts";
import {
	DEFAULT_CANVAS_VIEWPORT,
	panCanvasViewport,
	zoomCanvasViewport,
} from "./canvas/viewport.ts";
import { createCardElement, setCardPosition } from "./cards/render-card.ts";
import {
	renderChatLog,
	renderChatTabs as renderChatTabsView,
	renderQueueStack,
} from "./chat/render-chat.ts";
import { compactPath, errorMessage, modelValue, workspaceLabel } from "./labels.ts";
import {
	readChatDockMinimized,
	readChatDockPosition,
	writeChatDockMinimized,
	writeChatDockPosition,
} from "./preferences.ts";
import {
	cardContext,
	deleteCardById,
	deleteSelectedCards,
	keepSelectedCards,
	selectedCards,
	toggleCardSelection,
} from "./selection.ts";
import { createInitialState, type AppState } from "./state.ts";
import { activeTaskView, applyTaskSnapshot, isTaskBusy, visibleTaskViews } from "./tasks.ts";
import "./styles.css";
import "./canvas-artifacts.css";

type LucideIconNode = typeof Square;

interface CardDragState {
	id: string;
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startX: number;
	startY: number;
	moved: boolean;
}

interface CanvasPanState {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startX: number;
	startY: number;
}

const state: AppState = createInitialState(readChatDockPosition(), readChatDockMinimized());

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

function setChatDockPosition(position: AppState["chatDockPosition"]): void {
	state.chatDockPosition = position;
	writeChatDockPosition(position);
	renderChatDock();
}

function setChatDockMinimized(minimized: boolean): void {
	state.chatDockMinimized = minimized;
	writeChatDockMinimized(minimized);
	renderChatDock();
}

function setIconButton(button: HTMLButtonElement, icon: LucideIconNode, label: string): void {
	button.replaceChildren(createLucideIcon(icon, { class: "lucide-icon", "aria-hidden": "true" }));
	button.ariaLabel = label;
	button.title = label;
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
	const activeTask = activeTaskView(state);
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
	setIconButton(dockToggleButton, nextPosition === "right" ? PanelRight : PanelBottom, `Dock ${nextPosition}`);
	setIconButton(dockMinimizeButton, state.chatDockMinimized ? Square : Minimize2, state.chatDockMinimized ? "Expand chat" : "Minimize chat");
}

function renderChatTabs(): void {
	const visibleTasks = visibleTaskViews(state);
	renderChatTabsView(chatTabs, visibleTasks, state.activeTaskId, state.busy);
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
	const activeTask = activeTaskView(state);
	const baseMessages = activeTask?.messages ?? state.messages;
	const streaming = activeTask?.streaming ?? state.streaming;
	renderChatLog(chatLog, baseMessages, streaming);
	renderAgentLoading();
}

function renderAgentLoading(): void {
	const activeTask = activeTaskView(state);
	const activeBusy = activeTask ? isTaskBusy(activeTask) : state.busy;
	chatDock.classList.toggle("loading", activeBusy);
	agentLoading.classList.toggle("open", activeBusy);
	agentLoadingText.textContent = activeTask ? activeTask.statusText : state.statusText;
}

function renderQueue(): void {
	const activeTask = activeTaskView(state);
	const queuedSteering = activeTask?.queuedSteering ?? state.queuedSteering;
	const queuedFollowUp = activeTask?.queuedFollowUp ?? state.queuedFollowUp;
	renderQueueStack(queueStack, queuedSteering, queuedFollowUp);
}

function renderCards(): void {
	emptyHint.classList.toggle("hidden", state.cards.length > 0);
	cardHost.replaceChildren(
		...state.cards.map((card) =>
			createCardElement(card, {
				clone: false,
				loading: state.loadingCardIds.has(card.id),
				selected: state.selectedIds.has(card.id),
			}),
		),
	);
	workspaceCanvas.replaceChildren(
		...state.cards.map((card) =>
			createCardElement(card, {
				clone: true,
				loading: state.loadingCardIds.has(card.id),
				selected: state.selectedIds.has(card.id),
			}),
		),
	);
}

function renderSelection(): void {
	const selected = selectedCards(state);
	contextBar.classList.toggle("open", selected.length > 0);
	selectedCount.textContent = `${selected.length} selected`;
	selectedNote.classList.toggle("open", selected.length > 0);
	selectedNote.textContent = selected.length > 0 ? `Using: ${selected.map((card) => card.title).join(", ")}` : "";
}

function renderCanvasViewport(): void {
	cardHost.style.transform = `translate(${state.viewport.x}px, ${state.viewport.y}px) scale(${state.viewport.zoom})`;
}

function scheduleCanvasPaint(): void {
	if (canvasFrame !== undefined) {
		window.cancelAnimationFrame(canvasFrame);
	}
	canvasFrame = window.requestAnimationFrame(() => {
		canvasFrame = undefined;
		paintCanvasFrame({
			workspaceCanvas,
			canvasShell,
			viewport: state.viewport,
			cards: state.cards,
			htmlCanvasFailed: state.htmlCanvasFailed,
			onHtmlCanvasActiveChange: (active) => {
				state.htmlCanvasActive = active;
			},
			onHtmlCanvasFailure: (message) => {
				state.htmlCanvasFailed = true;
				state.htmlCanvasActive = false;
				showToast(message);
			},
		});
	});
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
	const activeTask = activeTaskView(state);
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
	const selected = selectedCards(state);
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
	applyTaskSnapshot(state, snapshot);
	renderChatTabs();
	renderStatus();
	renderChat();
	renderQueue();
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
	state.loadingCardIds.delete(card.id);
	render();
	scheduleSaveBoard();
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
	state.viewport = panCanvasViewport(
		state.viewport,
		{ x: canvasPan.startX, y: canvasPan.startY },
		canvasPan.startClientX,
		canvasPan.startClientY,
		event.clientX,
		event.clientY,
	);
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
	state.viewport = zoomCanvasViewport(state.viewport, { screenX, screenY, deltaY: event.deltaY });
	renderCanvasViewport();
	scheduleCanvasPaint();
	event.preventDefault();
}

function resetCanvasViewport(): void {
	state.viewport = { ...DEFAULT_CANVAS_VIEWPORT };
	renderCanvasViewport();
}

function keepSelected(): void {
	if (!state.authenticated) return;
	keepSelectedCards(state);
	render();
	scheduleSaveBoard();
	if (state.selectedIds.size > 0) showToast("Selected item kept.");
}

function deleteSelected(): void {
	if (!state.authenticated) return;
	if (state.selectedIds.size === 0) return;
	deleteSelectedCards(state);
	render();
	scheduleSaveBoard();
	showToast("Selected item deleted.");
}

function deleteCard(id: string): void {
	if (!state.authenticated) return;
	deleteCardById(state, id);
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
	modalBody.replaceChildren(
		createCardElement(card, {
			clone: false,
			selected: state.selectedIds.has(card.id),
		}),
	);
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
		state.activeTaskId = state.tasks.has(card.taskId) ? card.taskId : undefined;
	}
	toggleCardSelection(state, cardElement.dataset.id, event.shiftKey || event.metaKey || event.ctrlKey);
	render();
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
	const activeTask = activeTaskView(state);
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
	const selected = selectedCards(state);
	if (selected.length === 0) return;
	chatInput.value = `Use ${selected.map((card) => card.title).join(", ")} and show the next useful analysis step`;
	chatInput.focus();
});

keepSelectedButton.addEventListener("click", keepSelected);
deleteSelectedButton.addEventListener("click", deleteSelected);
openSelectedButton.addEventListener("click", () => {
	const first = selectedCards(state)[0];
	if (first) void openCard(first.id);
});
exportSelectedButton.addEventListener("click", () => {
	void exportCards(selectedCards(state));
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
