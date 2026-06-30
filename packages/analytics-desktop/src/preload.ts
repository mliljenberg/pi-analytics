import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	type AnalyticsDesktopApi,
	type AuthState,
	type ExportReportRequest,
	IPC,
	type LoginProviderRequest,
	type MainToRendererEvent,
	type ModelSummary,
	type RecentWorkspace,
	type SaveBoardRequest,
	type SendPromptRequest,
	type SessionSnapshot,
	type SetModelRequest,
	type WorkspaceFolder,
} from "./shared/ipc.ts";

const api: AnalyticsDesktopApi = {
	getAuthState: async () => ipcRenderer.invoke(IPC.getAuthState) as Promise<AuthState>,
	loginProvider: async (request: LoginProviderRequest) =>
		ipcRenderer.invoke(IPC.loginProvider, request) as Promise<AuthState>,
	listRecentWorkspaces: async () => ipcRenderer.invoke(IPC.listRecentWorkspaces) as Promise<RecentWorkspace[]>,
	selectWorkspaceFolder: async () =>
		ipcRenderer.invoke(IPC.selectWorkspaceFolder) as Promise<WorkspaceFolder | undefined>,
	startSession: async (cwd: string) => ipcRenderer.invoke(IPC.startSession, cwd) as Promise<SessionSnapshot>,
	sendPrompt: async (request: SendPromptRequest) => {
		await ipcRenderer.invoke(IPC.sendPrompt, request);
	},
	abortPrompt: async () => {
		await ipcRenderer.invoke(IPC.abortPrompt);
	},
	listModels: async () => ipcRenderer.invoke(IPC.listModels) as Promise<ModelSummary[]>,
	setModel: async (request: SetModelRequest) => {
		await ipcRenderer.invoke(IPC.setModel, request);
	},
	saveBoard: async (request: SaveBoardRequest) => {
		await ipcRenderer.invoke(IPC.saveBoard, request);
	},
	exportReport: async (request: ExportReportRequest) =>
		ipcRenderer.invoke(IPC.exportReport, request) as Promise<string | undefined>,
	onEvent: (listener: (event: MainToRendererEvent) => void) => {
		const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload as MainToRendererEvent);
		ipcRenderer.on(IPC.rendererEvent, handler);
		return () => ipcRenderer.off(IPC.rendererEvent, handler);
	},
};

contextBridge.exposeInMainWorld("piAnalytics", api);
