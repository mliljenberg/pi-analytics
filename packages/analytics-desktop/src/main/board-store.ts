import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PersistedBoard } from "../shared/canvas.ts";
import { isRecord } from "../shared/text.ts";

export class BoardStore {
	private readonly directory: string;

	constructor(userDataPath: string) {
		this.directory = join(userDataPath, "analytics-boards");
	}

	async load(cwd: string): Promise<PersistedBoard | undefined> {
		try {
			const text = await readFile(this.pathForCwd(cwd), "utf8");
			const parsed = JSON.parse(text) as unknown;
			return isPersistedBoard(parsed) ? parsed : undefined;
		} catch (error) {
			if (isRecord(error) && error.code === "ENOENT") return undefined;
			throw error;
		}
	}

	async save(board: PersistedBoard): Promise<void> {
		await mkdir(this.directory, { recursive: true });
		await writeFile(this.pathForCwd(board.cwd), JSON.stringify(board, null, 2), "utf8");
	}

	private pathForCwd(cwd: string): string {
		const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 24);
		return join(this.directory, `${hash}.json`);
	}
}

function isPersistedBoard(value: unknown): value is PersistedBoard {
	return (
		isRecord(value) &&
		value.version === 1 &&
		typeof value.cwd === "string" &&
		typeof value.sessionId === "string" &&
		Array.isArray(value.cards) &&
		typeof value.shareReady === "boolean" &&
		typeof value.updatedAt === "string"
	);
}
