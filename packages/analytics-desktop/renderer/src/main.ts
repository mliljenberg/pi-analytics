import type { CanvasCard, CanvasCardPosition, PersistedBoard, PromptCardContext } from "../../src/shared/canvas.ts";
import type {
	AuthState,
	ChatMessageEvent,
	MainToRendererEvent,
	ModelSummary,
	ProviderSummary,
	SessionSnapshot,
} from "../../src/shared/ipc.ts";
import "./styles.css";

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

interface AppState {
	authenticated: boolean;
	authProviders: ProviderSummary[];
	pendingModelValue?: string;
	cwd?: string;
	sessionId?: string;
	model?: ModelSummary;
	models: ModelSummary[];
	cards: CanvasCard[];
	messages: ChatMessage[];
	streaming?: StreamingMessage;
	selectedIds: Set<string>;
	activeModalId?: string;
	busy: boolean;
	statusText: string;
	shareReady: boolean;
	htmlCanvasActive: boolean;
	htmlCanvasFailed: boolean;
}

const state: AppState = {
	authenticated: false,
	authProviders: [],
	models: [],
	cards: [],
	messages: [
		{
			id: "system-start",
			author: "System",
			text: "Open a folder to start an analytics session.",
			timestamp: new Date().toISOString(),
		},
	],
	selectedIds: new Set(),
	busy: false,
	statusText: "No workspace",
	shareReady: false,
	htmlCanvasActive: false,
	htmlCanvasFailed: false,
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
const openFolderButton = requireElement<HTMLButtonElement>("openFolderButton");
const newBoardButton = requireElement<HTMLButtonElement>("newBoardButton");
const abortButton = requireElement<HTMLButtonElement>("abortButton");
const reportButton = requireElement<HTMLButtonElement>("reportButton");
const canvasShell = requireElement<HTMLDivElement>("canvasShell");
const workspaceCanvas = requireElement<HTMLCanvasElement>("workspaceCanvas");
const cardHost = requireElement<HTMLDivElement>("cardHost");
const emptyHint = requireElement<HTMLDivElement>("emptyHint");
const contextBar = requireElement<HTMLDivElement>("contextBar");
const selectedCount = requireElement<HTMLSpanElement>("selectedCount");
const selectedNote = requireElement<HTMLDivElement>("selectedNote");
const chatLog = requireElement<HTMLDivElement>("chatLog");
const composer = requireElement<HTMLFormElement>("composer");
const chatInput = requireElement<HTMLInputElement>("chatInput");
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

function requireElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing element #${id}`);
	}
	return element as T;
}

function render(): void {
	renderAuth();
	renderStatus();
	renderModels();
	renderChat();
	renderCards();
	renderSelection();
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
	topStatus.textContent = !state.authenticated
		? "Login required"
		: state.busy
			? `${workspace} - ${state.statusText}`
			: `${workspace} - ${canvasStatus}`;
	const locked = !state.authenticated;
	openFolderButton.disabled = locked;
	newBoardButton.disabled = locked;
	abortButton.disabled = locked || !state.busy;
	reportButton.disabled = locked || !state.cwd || state.busy;
	chatInput.disabled = locked || !state.cwd || state.busy;
	modelSelect.disabled = locked || !state.cwd || state.busy || state.models.length === 0;
	for (const button of document.querySelectorAll<HTMLButtonElement>("[data-prompt]")) {
		button.disabled = locked || !state.cwd || state.busy;
	}
	for (const button of [
		askSelectedButton,
		keepSelectedButton,
		openSelectedButton,
		exportSelectedButton,
		deleteSelectedButton,
	]) {
		button.disabled = locked;
	}
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
	chatLog.replaceChildren();
	const messages = state.streaming
		? [
				...state.messages,
				{
					id: `stream-${state.streaming.id}`,
					author: "Pi" as const,
					text: state.streaming.text,
					timestamp: new Date().toISOString(),
				},
			]
		: state.messages;

	for (const message of messages.slice(-10)) {
		const row = document.createElement("div");
		row.className = "message";
		const author = document.createElement("strong");
		author.textContent = message.author;
		row.append(author, document.createTextNode(` ${message.text}`));
		chatLog.appendChild(row);
	}
	chatLog.scrollTop = chatLog.scrollHeight;
}

function renderCards(): void {
	emptyHint.classList.toggle("hidden", state.cards.length > 0);
	cardHost.replaceChildren(...state.cards.map((card) => createCardElement(card, false)));
	workspaceCanvas.replaceChildren(...state.cards.map((card) => createCardElement(card, true)));
}

function renderSelection(): void {
	const selected = selectedCards();
	contextBar.classList.toggle("open", selected.length > 0);
	selectedCount.textContent = `${selected.length} selected`;
	selectedNote.classList.toggle("open", selected.length > 0);
	selectedNote.textContent = selected.length > 0 ? `Using: ${selected.map((card) => card.title).join(", ")}` : "";
}

function createCardElement(card: CanvasCard, clone: boolean): HTMLElement {
	const article = document.createElement("article");
	if (clone) {
		article.ariaHidden = "true";
	}
	article.className = [
		"canvas-card",
		state.selectedIds.has(card.id) ? "selected" : "",
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
	status.textContent = card.kept ? "Kept" : card.statusLabel;
	actions.appendChild(status);
	actions.appendChild(actionButton("Open", "open", clone));
	if (card.type === "report" || card.kept) {
		actions.appendChild(actionButton("Export", "export", clone));
	}
	head.append(title, actions);

	const body = document.createElement("div");
	body.className = "card-body";
	appendCardBody(body, card);

	article.append(head, body);
	return article;
}

function actionButton(label: string, action: string, inert: boolean): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = "icon-button";
	button.type = "button";
	button.dataset.action = action;
	button.textContent = label;
	button.ariaLabel = label;
	if (inert) {
		button.tabIndex = -1;
	}
	return button;
}

function setCardPosition(element: HTMLElement, position: CanvasCardPosition): void {
	element.style.setProperty("--x", `${position.x}px`);
	element.style.setProperty("--y", `${position.y}px`);
	element.style.setProperty("--w", `${position.w}px`);
	element.style.setProperty("--h", `${position.h}px`);
}

function appendCardBody(body: HTMLElement, card: CanvasCard): void {
	if (card.status === "working") {
		const text = document.createElement("p");
		text.textContent = card.body;
		const lines = document.createElement("div");
		lines.className = "analysis-lines";
		lines.ariaHidden = "true";
		lines.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
		for (const child of lines.children) child.className = "writing-line";
		const progress = document.createElement("div");
		progress.className = "progress-track";
		const fill = document.createElement("span");
		fill.className = "progress-fill";
		fill.style.setProperty("--progress", `${card.progress ?? 35}%`);
		progress.appendChild(fill);
		body.append(text, lines, progress);
		return;
	}

	if (card.type === "tool") {
		const pre = document.createElement("pre");
		pre.textContent = card.body;
		body.appendChild(pre);
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

	const paragraph = document.createElement("p");
	paragraph.textContent = card.body;
	body.appendChild(paragraph);

	if (card.type === "report" && card.sections) {
		const sections = document.createElement("div");
		sections.className = "report-sections";
		for (const section of card.sections) {
			const item = document.createElement("div");
			item.className = "report-section";
			const title = document.createElement("b");
			title.textContent = section.title;
			const sectionBody = document.createElement("span");
			sectionBody.textContent = section.body;
			item.append(title, sectionBody);
			sections.appendChild(item);
		}
		body.appendChild(sections);
		return;
	}

	if (card.points && card.points.length > 0) {
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
	drawGrid(ctx, rect.width, rect.height);

	const drawElementImage = ctx.drawElementImage;
	const supportsHtmlCanvas = typeof drawElementImage === "function" && !state.htmlCanvasFailed && window.innerWidth > 860;
	state.htmlCanvasActive = supportsHtmlCanvas;
	canvasShell.classList.toggle("html-canvas-active", supportsHtmlCanvas);

	if (!supportsHtmlCanvas) return;

	try {
		const clones = Array.from(workspaceCanvas.querySelectorAll<HTMLElement>(":scope > .canvas-card"));
		for (const clone of clones) {
			const card = state.cards.find((item) => item.id === clone.dataset.id);
			if (!card) continue;
			drawElementImage.call(ctx, clone, card.position.x, card.position.y);
		}
	} catch (error) {
		state.htmlCanvasFailed = true;
		state.htmlCanvasActive = false;
		canvasShell.classList.remove("html-canvas-active");
		showToast(error instanceof Error ? error.message : "HTML-in-Canvas paint failed.");
	}
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
	ctx.save();
	ctx.strokeStyle = "rgba(16, 17, 20, 0.035)";
	ctx.lineWidth = 1;
	for (let x = 0; x <= width; x += 48) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.stroke();
	}
	for (let y = 0; y <= height; y += 48) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
		ctx.stroke();
	}
	ctx.restore();
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
	state.shareReady = snapshot.board?.shareReady ?? false;
	state.selectedIds.clear();
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
		state.selectedIds.clear();
	}
	render();
}

async function refreshAuthState(): Promise<void> {
	try {
		applyAuthState(await api.getAuthState());
	} catch (error) {
		loginError.textContent = errorMessage(error);
		render();
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

async function submitPrompt(text: string): Promise<void> {
	const trimmed = text.trim();
	if (!trimmed || !state.cwd || !state.authenticated) return;
	setBusy("Sending prompt", true);
	try {
		await api.sendPrompt({
			text: trimmed,
			selectedCards: selectedCards().map(cardContext),
		});
		chatInput.value = "";
	} catch (error) {
		addSystemMessage(errorMessage(error));
		showToast(errorMessage(error));
	} finally {
		setBusy("Ready", false);
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
		addChatEvent(event);
		return;
	}
	if (event.type === "assistant-stream") {
		state.streaming = { id: event.id, text: event.text };
		renderChat();
		return;
	}
	if (event.type === "analysis-card" || event.type === "tool-card-start") {
		upsertCard(event.card);
		return;
	}
	if (event.type === "tool-card-end") {
		completeToolCard(event.toolCallId, event.body, event.isError);
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

function addSystemMessage(text: string): void {
	state.messages.push({
		id: `system-${Date.now()}`,
		author: "System",
		text,
		timestamp: new Date().toISOString(),
	});
	renderChat();
}

function upsertCard(card: CanvasCard): void {
	const index = state.cards.findIndex((candidate) => candidate.id === card.id);
	if (index === -1) {
		state.cards.push(card);
	} else {
		state.cards[index] = card;
	}
	render();
	scheduleSaveBoard();
}

function completeToolCard(toolCallId: string, body: string, isError: boolean): void {
	const card = state.cards.find((candidate) => candidate.toolCallId === toolCallId);
	if (!card) return;
	card.body = body;
	card.status = isError ? "error" : "complete";
	card.statusLabel = isError ? "Error" : "Complete";
	card.progress = 100;
	card.subtitle = isError ? "Tool failed" : "Tool result";
	render();
	scheduleSaveBoard();
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
	state.selectedIds.clear();
	render();
	scheduleSaveBoard();
	showToast("Selected item deleted.");
}

function openCard(id: string): void {
	if (!state.authenticated) return;
	const card = state.cards.find((candidate) => candidate.id === id);
	if (!card) return;
	state.activeModalId = id;
	modalTitle.textContent = card.title;
	modalSubtitle.textContent = card.subtitle;
	modalBody.replaceChildren(createCardElement(card, false));
	modal.classList.add("open");
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
	renderStatus();
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

function modelValue(model: ModelSummary): string {
	return `${model.provider}/${model.id}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

cardHost.addEventListener("click", (event) => {
	const target = event.target;
	if (!(target instanceof Element)) return;
	const action = target.closest<HTMLElement>("[data-action]");
	const cardElement = target.closest<HTMLElement>(".canvas-card");
	if (!cardElement?.dataset.id) return;
	if (action?.dataset.action === "open") {
		openCard(cardElement.dataset.id);
		return;
	}
	if (action?.dataset.action === "export") {
		const card = state.cards.find((candidate) => candidate.id === cardElement.dataset.id);
		if (card) void exportCards([card]);
		return;
	}
	toggleSelection(cardElement.dataset.id, event.shiftKey || event.metaKey || event.ctrlKey);
});

composer.addEventListener("submit", (event) => {
	event.preventDefault();
	void submitPrompt(chatInput.value);
});

document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach((button) => {
	button.addEventListener("click", () => {
		const prompt = button.dataset.prompt;
		if (prompt) void submitPrompt(prompt);
	});
});

openFolderButton.addEventListener("click", () => {
	void openWorkspace();
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
	state.shareReady = false;
	render();
	scheduleSaveBoard();
	addSystemMessage("New blank canvas ready.");
});

reportButton.addEventListener("click", () => {
	void submitPrompt("Build a board-ready report from this workspace. Use concise sections and cite the files or tool results you relied on.");
});

abortButton.addEventListener("click", () => {
	void api.abortPrompt();
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
	if (first) openCard(first.id);
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

modalCloseButton.addEventListener("click", () => modal.classList.remove("open"));
modal.addEventListener("click", (event) => {
	if (event.target === modal) modal.classList.remove("open");
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") {
		modal.classList.remove("open");
		state.selectedIds.clear();
		render();
	}
	if ((event.key === "Delete" || event.key === "Backspace") && state.selectedIds.size > 0 && document.activeElement !== chatInput) {
		deleteSelected();
	}
});

const resizeObserver = new ResizeObserver(() => scheduleCanvasPaint());
resizeObserver.observe(canvasShell);
workspaceCanvas.addEventListener("paint", () => scheduleCanvasPaint());
api.onEvent(handleRendererEvent);
await refreshAuthState();
