export type ScanScope = "page" | "file";

export interface InstanceInfo {
  nodeId: string;
  name: string;
  pageId: string;
  pageName: string;
  parentName: string;
  componentName: string;
  componentKey: string;
  isRemote: boolean;
}

export interface LibraryGroup {
  libraryKey: string;
  libraryName: string;
  isRemote: boolean;
  instances: InstanceInfo[];
}

// --- UI -> Sandbox ---

export interface ScanMessage {
  type: "scan";
  scope: ScanScope;
}

export interface NavigateMessage {
  type: "navigate";
  nodeId: string;
  pageId: string;
}

export interface DetachMessage {
  type: "detach";
  nodeId: string;
}

export interface DetachLibraryMessage {
  type: "detach-library";
  libraryKey: string;
  nodeIds: string[];
}

export interface ResetMessage {
  type: "reset";
  nodeId: string;
}

export interface ResetLibraryMessage {
  type: "reset-library";
  libraryKey: string;
  nodeIds: string[];
}

export type UIMessage =
  | ScanMessage
  | NavigateMessage
  | DetachMessage
  | DetachLibraryMessage
  | ResetMessage
  | ResetLibraryMessage;

// --- Sandbox -> UI ---

export interface ScanResultMessage {
  type: "scan-result";
  libraries: LibraryGroup[];
}

export interface ScanProgressMessage {
  type: "scan-progress";
  status: string;
}

export interface DetachResultMessage {
  type: "detach-result";
  success: boolean;
  detachedCount: number;
}

export interface ResetResultMessage {
  type: "reset-result";
  success: boolean;
  resetCount: number;
}

export type SandboxMessage =
  | ScanResultMessage
  | ScanProgressMessage
  | DetachResultMessage
  | ResetResultMessage;
