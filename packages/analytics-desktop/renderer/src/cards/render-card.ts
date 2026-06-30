import type { CanvasCard, CanvasCardPosition } from "../../../src/shared/canvas.ts";
import { createElement as createLucideIcon, Download, Maximize2, X } from "lucide";
import { appendMarkdown } from "./markdown.ts";
import { sanitizeCanvasHtml } from "./sanitize-canvas-html.ts";

interface CreateCardElementOptions {
	clone: boolean;
	loading?: boolean;
	selected: boolean;
}

export function createCardElement(card: CanvasCard, options: CreateCardElementOptions): HTMLElement {
	const loading = options.loading ?? false;
	const article = document.createElement("article");
	if (options.clone) {
		article.ariaHidden = "true";
	}
	article.className = [
		"canvas-card",
		card.type === "html" ? "html-card" : "",
		options.selected ? "selected" : "",
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
	actions.appendChild(actionButton("Fullscreen", "open", options.clone));
	if (card.type === "report" || card.type === "html" || card.kept) {
		actions.appendChild(actionButton("Export", "export", options.clone));
	}
	actions.appendChild(actionButton("Close", "close", options.clone));
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

export function setCardPosition(element: HTMLElement, position: CanvasCardPosition): void {
	element.style.setProperty("--x", `${position.x}px`);
	element.style.setProperty("--y", `${position.y}px`);
	element.style.setProperty("--w", `${position.w}px`);
	element.style.setProperty("--h", `${position.h}px`);
}

function actionButton(label: string, action: string, inert: boolean): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = `icon-button card-action ${action}-action`;
	button.type = "button";
	button.dataset.action = action;
	button.ariaLabel = label;
	button.title = label;
	if (action === "open") {
		button.appendChild(createLucideIcon(Maximize2, { class: "lucide-icon", "aria-hidden": "true" }));
	} else if (action === "close") {
		button.appendChild(createLucideIcon(X, { class: "lucide-icon", "aria-hidden": "true" }));
	} else {
		button.appendChild(createLucideIcon(Download, { class: "lucide-icon", "aria-hidden": "true" }));
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
