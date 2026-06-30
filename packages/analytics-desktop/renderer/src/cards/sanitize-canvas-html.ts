export function sanitizeCanvasHtml(value: string): string {
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
