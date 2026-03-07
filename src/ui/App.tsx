import { useState, useCallback } from "react";
import type {
  SandboxMessage,
  LibraryGroup,
  ScanScope,
} from "../shared/messages";
import { useFigmaMessages, postToFigma } from "./hooks/useFigmaMessages";
import { Header } from "./components/Header";
import { LibraryGroupCard } from "./components/LibraryGroup";
import { ExportView } from "../export/ExportView";

type ViewState = "idle" | "scanning" | "results";
type ActiveTab = "components" | "export";

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("components");
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [scope, setScope] = useState<ScanScope>("page");
  const [libraries, setLibraries] = useState<LibraryGroup[]>([]);
  const [statusText, setStatusText] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useFigmaMessages(
    useCallback(
      (msg: SandboxMessage) => {
        switch (msg.type) {
          case "scan-progress":
            setStatusText(msg.status);
            break;
          case "scan-result":
            setLibraries(msg.libraries);
            setViewState("results");
            break;
          case "detach-result":
            if (msg.success) {
              showToast(
                `Detached ${msg.detachedCount} instance${msg.detachedCount === 1 ? "" : "s"}. Rescanning…`,
              );
              postToFigma({ type: "scan", scope });
            } else {
              showToast("Failed to detach");
            }
            break;
          case "reset-result":
            if (msg.success) {
              showToast(
                `Reset ${msg.resetCount} instance${msg.resetCount === 1 ? "" : "s"}`,
              );
            } else {
              showToast("Failed to reset");
            }
            break;
        }
      },
      [showToast, scope],
    ),
  );

  const handleScan = useCallback(() => {
    setViewState("scanning");
    setLibraries([]);
    postToFigma({ type: "scan", scope });
  }, [scope]);

  const handleNavigate = useCallback(
    (nodeId: string, pageId: string) => {
      postToFigma({ type: "navigate", nodeId, pageId });
    },
    [],
  );

  const handleDetach = useCallback((nodeId: string) => {
    postToFigma({ type: "detach", nodeId });
  }, []);

  const handleDetachLibrary = useCallback(
    (libraryKey: string, nodeIds: string[]) => {
      postToFigma({ type: "detach-library", libraryKey, nodeIds });
    },
    [],
  );

  const handleReset = useCallback((nodeId: string) => {
    postToFigma({ type: "reset", nodeId });
  }, []);

  const handleResetLibrary = useCallback(
    (libraryKey: string, nodeIds: string[]) => {
      postToFigma({ type: "reset-library", libraryKey, nodeIds });
    },
    [],
  );

  const totalInstances = libraries.reduce(
    (sum, lib) => sum + lib.instances.length,
    0,
  );

  return (
    <div className="flex flex-col h-screen">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2 border-b border-[var(--figma-color-border,#e5e5e5)]">
        <button
          onClick={() => setActiveTab("components")}
          className={`flex-1 py-1 px-2 text-xs rounded-md transition-colors cursor-pointer ${
            activeTab === "components"
              ? "bg-[var(--figma-color-bg-selected,#daebf7)] text-[var(--figma-color-text-brand,#0d99ff)] font-medium"
              : "bg-[var(--figma-color-bg-secondary,#f5f5f5)] text-[var(--figma-color-text-secondary,#999)] hover:bg-[var(--figma-color-bg-hover,#eee)]"
          }`}
        >
          Components
        </button>
        <button
          onClick={() => setActiveTab("export")}
          className={`flex-1 py-1 px-2 text-xs rounded-md transition-colors cursor-pointer ${
            activeTab === "export"
              ? "bg-[var(--figma-color-bg-selected,#daebf7)] text-[var(--figma-color-text-brand,#0d99ff)] font-medium"
              : "bg-[var(--figma-color-bg-secondary,#f5f5f5)] text-[var(--figma-color-text-secondary,#999)] hover:bg-[var(--figma-color-bg-hover,#eee)]"
          }`}
        >
          Export CSS
        </button>
      </div>

      {activeTab === "components" && (
        <>
          <Header
            scope={scope}
            onScopeChange={setScope}
            onScan={handleScan}
            scanning={viewState === "scanning"}
          />

          <div className="flex-1 overflow-y-auto">
            {viewState === "idle" && (
              <div className="flex flex-col items-center justify-center h-full px-6 text-center text-[var(--figma-color-text-secondary,#999)]">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="mb-3 opacity-40"
                >
                  <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-sm">
                  Scan to find component instances from other libraries in your{" "}
                  {scope === "page" ? "current page" : "file"}.
                </p>
              </div>
            )}

            {viewState === "scanning" && (
              <div className="flex flex-col items-center justify-center h-full text-[var(--figma-color-text-secondary,#999)]">
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm">{statusText || "Scanning…"}</p>
              </div>
            )}

            {viewState === "results" && libraries.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full px-6 text-center text-[var(--figma-color-text-secondary,#999)]">
                <p className="text-sm">No component instances found.</p>
              </div>
            )}

            {viewState === "results" && libraries.length > 0 && (
              <div className="pb-3">
                <div className="px-3 py-2 text-xs text-[var(--figma-color-text-secondary,#999)]">
                  {totalInstances} instance{totalInstances === 1 ? "" : "s"}{" "}
                  across {libraries.length}{" "}
                  {libraries.length === 1 ? "component" : "components"}
                </div>
                {libraries.map((lib) => (
                  <LibraryGroupCard
                    key={`${lib.libraryKey}-${lib.componentName}`}
                    group={lib}
                    onNavigate={handleNavigate}
                    onReset={handleReset}
                    onDetach={handleDetach}
                    onDetachLibrary={handleDetachLibrary}
                    onResetLibrary={handleResetLibrary}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "export" && (
        <div className="flex-1 overflow-hidden">
          <ExportView />
        </div>
      )}

      {toast && (
        <div className="fixed bottom-3 left-3 right-3 bg-[var(--figma-color-bg-inverse,#333)] text-[var(--figma-color-text-oninverse,#fff)] text-xs px-3 py-2 rounded-lg shadow-lg text-center animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
