export function appendMarkdown(parent: HTMLElement, markdown: string): void {
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
