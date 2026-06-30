export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const item of content) {
		if (!isRecord(item)) continue;
		if (item.type === "text" && typeof item.text === "string") {
			parts.push(item.text);
		}
	}

	return parts.join("\n").trim();
}

export function previewUnknown(value: unknown, maxLength: number): string {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value, null, 2);
		} catch {
			text = String(value);
		}
	}

	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}
