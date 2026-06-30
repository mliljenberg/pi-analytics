import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type SaveDialogOptions, shell } from "electron";
import { AgentController } from "./main/agent-controller.ts";
import { BoardStore } from "./main/board-store.ts";
import type { CanvasCard } from "./shared/canvas.ts";
import {
	type AuthState,
	type ExportReportRequest,
	IPC,
	type LoginProviderRequest,
	type MainToRendererEvent,
	type SaveBoardRequest,
	type SendPromptRequest,
	type SessionSnapshot,
	type SetModelRequest,
	type WorkspaceFolder,
} from "./shared/ipc.ts";
import { isRecord } from "./shared/text.ts";

app.commandLine.appendSwitch("enable-experimental-web-platform-features");
app.commandLine.appendSwitch("enable-features", "CanvasDrawElement");
app.commandLine.appendSwitch("enable-blink-features", "CanvasDrawElement");

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | undefined;
let agentController: AgentController | undefined;
let boardStore: BoardStore | undefined;

function sendToRenderer(event: MainToRendererEvent): void {
	mainWindow?.webContents.send(IPC.rendererEvent, event);
}

function getBoardStore(): BoardStore {
	if (!boardStore) {
		boardStore = new BoardStore(app.getPath("userData"));
	}
	return boardStore;
}

function getAgentController(): AgentController {
	if (!agentController) {
		agentController = new AgentController(getBoardStore(), sendToRenderer);
	}
	return agentController;
}

async function createWindow(): Promise<void> {
	mainWindow = new BrowserWindow({
		width: 1440,
		height: 980,
		minWidth: 1100,
		minHeight: 720,
		backgroundColor: "#f7f8fb",
		title: "Pi Analytics",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: join(currentDirectory, "preload.cjs"),
		},
	});

	const devServerUrl = process.env.PI_ANALYTICS_DESKTOP_RENDERER_URL;
	if (devServerUrl) {
		await mainWindow.loadURL(devServerUrl);
	} else {
		await mainWindow.loadFile(join(currentDirectory, "../renderer/index.html"));
	}

	mainWindow.on("closed", () => {
		mainWindow = undefined;
	});
}

ipcMain.handle(IPC.selectWorkspaceFolder, async (): Promise<WorkspaceFolder | undefined> => {
	const options: OpenDialogOptions = {
		properties: ["openDirectory"],
		title: "Open analytics workspace",
	};
	const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
	if (result.canceled || result.filePaths.length === 0) return undefined;
	return { path: result.filePaths[0] };
});

ipcMain.handle(IPC.getAuthState, async (): Promise<AuthState> => {
	return getAgentController().getAuthState();
});

ipcMain.handle(IPC.loginProvider, async (_event, request: unknown): Promise<AuthState> => {
	if (!isLoginProviderRequest(request)) {
		throw new Error("Invalid login request.");
	}
	return getAgentController().loginProvider(request.provider, request.apiKey, (url) => shell.openExternal(url));
});

ipcMain.handle(IPC.startSession, async (_event, cwd: unknown): Promise<SessionSnapshot> => {
	if (typeof cwd !== "string" || cwd.length === 0) {
		throw new Error("A workspace folder path is required.");
	}
	return getAgentController().start(cwd);
});

ipcMain.handle(IPC.sendPrompt, async (_event, request: unknown): Promise<void> => {
	if (!isSendPromptRequest(request)) {
		throw new Error("Invalid prompt request.");
	}
	await getAgentController().prompt(request.text, request.selectedCards);
});

ipcMain.handle(IPC.abortPrompt, async (): Promise<void> => {
	await getAgentController().abort();
});

ipcMain.handle(IPC.listModels, async () => {
	return getAgentController().listModels();
});

ipcMain.handle(IPC.setModel, async (_event, request: unknown): Promise<void> => {
	if (!isSetModelRequest(request)) {
		throw new Error("Invalid model request.");
	}
	await getAgentController().setModel(request.provider, request.id);
});

ipcMain.handle(IPC.saveBoard, async (_event, request: unknown): Promise<void> => {
	if (!isSaveBoardRequest(request)) {
		throw new Error("Invalid board payload.");
	}
	await getBoardStore().save(request.board);
});

ipcMain.handle(IPC.exportReport, async (_event, request: unknown): Promise<string | undefined> => {
	if (!isExportReportRequest(request)) {
		throw new Error("Invalid report export payload.");
	}
	const options: SaveDialogOptions = {
		title: "Export report",
		defaultPath: "pi-analytics-report.html",
		filters: [{ name: "HTML", extensions: ["html"] }],
	};
	const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
	if (result.canceled || !result.filePath) return undefined;
	await writeFile(result.filePath, buildReportHtml(request.cards), "utf8");
	sendToRenderer({ type: "exported-report", filePath: result.filePath });
	return result.filePath;
});

app.whenReady().then(async () => {
	await createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			void createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

function isSendPromptRequest(value: unknown): value is SendPromptRequest {
	return isRecord(value) && typeof value.text === "string" && Array.isArray(value.selectedCards);
}

function isSetModelRequest(value: unknown): value is SetModelRequest {
	return isRecord(value) && typeof value.provider === "string" && typeof value.id === "string";
}

function isLoginProviderRequest(value: unknown): value is LoginProviderRequest {
	return (
		isRecord(value) &&
		typeof value.provider === "string" &&
		(value.apiKey === undefined || typeof value.apiKey === "string")
	);
}

function isSaveBoardRequest(value: unknown): value is SaveBoardRequest {
	return isRecord(value) && isRecord(value.board) && value.board.version === 1;
}

function isExportReportRequest(value: unknown): value is ExportReportRequest {
	return isRecord(value) && Array.isArray(value.cards);
}

function buildReportHtml(cards: CanvasCard[]): string {
	const body = cards
		.map(
			(card) => `<section>
<h2>${escapeHtml(card.title)}</h2>
<p class="subtitle">${escapeHtml(card.subtitle)}</p>
<p>${escapeHtml(card.body)}</p>
</section>`,
		)
		.join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pi Analytics Report</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8fb;color:#101114;}
main{max-width:860px;margin:0 auto;padding:48px 24px 72px;}
h1{font-size:30px;line-height:1.15;margin:0 0 24px;}
section{background:#fff;border:1px solid rgba(16,17,20,.1);border-radius:8px;padding:20px;margin:14px 0;}
h2{font-size:18px;margin:0 0 4px;}
p{line-height:1.5;white-space:pre-wrap;}
.subtitle{color:#6f7480;font-size:13px;margin-top:0;}
</style>
</head>
<body><main><h1>Pi Analytics Report</h1>${body}</main></body>
</html>`;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
