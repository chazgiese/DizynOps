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
  componentName: string;
  componentSetKey: string;
  isRemote: boolean;
  instances: InstanceInfo[];
}

export interface RemoteLibraryGroup {
  libraryKey: string;
  libraryName: string;
  isRemote: boolean;
  components: LibraryGroup[];
}

// --- Variable export types ---

export interface TextStylePropertyData {
  variableId: string | null;
  rawValue: string | number;
}

export interface TextStyleData {
  id: string;
  name: string;
  fontFamily: TextStylePropertyData;
  fontSize: TextStylePropertyData;
  lineHeight: TextStylePropertyData;
  fontWeight: TextStylePropertyData;
  letterSpacing: TextStylePropertyData;
}



export type VariableValue =
  | number
  | string
  | boolean
  | { r: number; g: number; b: number; a: number }
  | { type: "VARIABLE_ALIAS"; id: string };

export interface VariableMode {
  modeId: string;
  name: string;
}

export interface VariableData {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, VariableValue>;
}

export interface VariableCollectionData {
  id: string;
  name: string;
  modes: VariableMode[];
  variables: VariableData[];
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

export interface FetchVariablesMessage {
  type: "fetch-variables";
}

export interface LoadPatMessage {
  type: "load-pat";
}

export interface SavePatMessage {
  type: "save-pat";
  pat: string;
}

export interface ClearPatMessage {
  type: "clear-pat";
}

export interface OpenUrlMessage {
  type: "open-url";
  url: string;
}

export type UIMessage =
  | ScanMessage
  | NavigateMessage
  | DetachMessage
  | DetachLibraryMessage
  | ResetMessage
  | ResetLibraryMessage
  | FetchVariablesMessage
  | LoadPatMessage
  | SavePatMessage
  | ClearPatMessage
  | OpenUrlMessage;

// --- Sandbox -> UI ---

export interface ScanResultMessage {
  type: "scan-result";
  libraries: RemoteLibraryGroup[];
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

export interface VariablesResultMessage {
  type: "variables-result";
  collections: VariableCollectionData[];
  textStyles: TextStyleData[];
}

export interface PatLoadedMessage {
  type: "pat-loaded";
  pat: string;
}

export type SandboxMessage =
  | ScanResultMessage
  | ScanProgressMessage
  | DetachResultMessage
  | ResetResultMessage
  | VariablesResultMessage
  | PatLoadedMessage;
