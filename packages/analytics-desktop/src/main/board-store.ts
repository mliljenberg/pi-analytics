import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PersistedBoard } from "../shared/canvas.ts";
import type { RecentWorkspace } from "../shared/ipc.ts";
import { isRecord } from "../shared/text.ts";

const MAX_RECENT_WORKSPACES = 12;

export class BoardStore {
	private readonly directory: string;
	private readonly recentPath: string;

	constructor(userDataPath: string) {
		this.directory = join(userDataPath, "analytics-boards");
		this.recentPath = join(this.directory, "recent-workspaces.json");
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

	async listRecentWorkspaces(): Promise<RecentWorkspace[]> {
		try {
			const text = await readFile(this.recentPath, "utf8");
			const parsed = JSON.parse(text) as unknown;
			return Array.isArray(parsed) ? parsed.filter(isRecentWorkspace) : [];
		} catch (error) {
			if (isRecord(error) && error.code === "ENOENT") return [];
			throw error;
		}
	}

	async rememberWorkspace(path: string): Promise<RecentWorkspace[]> {
		const recents = await this.listRecentWorkspaces();
		const next: RecentWorkspace = {
			path,
			name: basename(path) || path,
			openedAt: new Date().toISOString(),
		};
		const deduped = recents.filter((workspace) => workspace.path !== path);
		const updated = [next, ...deduped].slice(0, MAX_RECENT_WORKSPACES);
		await mkdir(this.directory, { recursive: true });
		await writeFile(this.recentPath, JSON.stringify(updated, null, 2), "utf8");
		return updated;
	}

	private pathForCwd(cwd: string): string {
		const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 24);
		return join(this.directory, `${hash}.json`);
	}
}

function isRecentWorkspace(value: unknown): value is RecentWorkspace {
	return (
		isRecord(value) &&
		typeof value.path === "string" &&
		typeof value.name === "string" &&
		typeof value.openedAt === "string"
	);
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
