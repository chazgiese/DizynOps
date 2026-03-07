import { useState, useCallback, useEffect } from "react";
import type {
  SandboxMessage,
  RemoteLibraryGroup,
  ScanScope,
} from "../shared/messages";
import { useFigmaMessages, postToFigma } from "./hooks/useFigmaMessages";
import { Header } from "./components/Header";
import { LibraryGroupCard } from "./components/LibraryGroup";
import { ExportView } from "../export/ExportView";

type ViewState = "idle" | "connect" | "scanning" | "results";
type ActiveTab = "components" | "export";

type ResolveResult = {
  libraries: RemoteLibraryGroup[];
  /** Human-readable error string if anything went wrong, or null on success. */
  error: string | null;
};

function statusToHint(status: number): string {
  if (status === 401)
    return "Token is invalid or expired — please disconnect and reconnect with a fresh token.";
  if (status === 403)
    return "Token lacks access to the library file. Make sure the token has the 'File content: Read' scope and that you have at least viewer access to the library file.";
  if (status === 404)
    return "Component not found in the published catalog (HTTP 404). The library may not be published as a Figma team library, or it may be a Community file that requires a different approach.";
  return `Unexpected API error (HTTP ${status}).`;
}

async function resolveLibraryNames(
  raw: RemoteLibraryGroup[],
  token: string,
): Promise<ResolveResult> {
  const headers = { "X-Figma-Token": token };

  // Step 0: validate the token with a lightweight /v1/me call before doing
  // dozens of component lookups that would all fail with the same error.
  try {
    const meRes = await fetch("https://api.figma.com/v1/me", { headers });
    if (!meRes.ok) {
      const noopLibraries = buildPassthrough(raw);
      return {
        libraries: noopLibraries,
        error: statusToHint(meRes.status),
      };
    }
  } catch {
    const noopLibraries = buildPassthrough(raw);
    return {
      libraries: noopLibraries,
      error:
        "Could not reach the Figma API. Check your network connection.",
    };
  }

  // Phase 1: look up ONE component per library group to get the file_key.
  // All components in a RemoteLibraryGroup are from the same library file, so
  // a single lookup is enough. This avoids rate-limiting (HTTP 429) from
  // firing dozens of parallel requests when there are many components.
  const fileKeyByLibraryKey = new Map<string, string>();
  let firstFailStatus = 0;

  await Promise.all(
    raw.map(async (lib) => {
      // Pick the first component that has a componentKey
      const representative = lib.components.find(
        (c) => c.instances[0]?.componentKey,
      );
      if (!representative) return;
      const componentKey = representative.instances[0].componentKey;
      try {
        const res = await fetch(
          `https://api.figma.com/v1/components/${componentKey}`,
          { headers },
        );
        const body = await res.json();
        if (!res.ok) {
          if (!firstFailStatus) firstFailStatus = res.status;
          return;
        }
        // The Figma REST API returns file_key directly on meta, not nested
        // inside meta.component: { "meta": { "file_key": "...", ... } }
        const data = body as { meta?: { file_key?: string } };
        const fileKey = data.meta?.file_key;
        if (fileKey) fileKeyByLibraryKey.set(lib.libraryKey, fileKey);
      } catch {
        if (!firstFailStatus) firstFailStatus = -1; // network / CORS error
      }
    }),
  );

  // Phase 2: fetch the file name for each unique file_key (one call per library)
  const fileNameByKey = new Map<string, string>();
  await Promise.all(
    Array.from(new Set(fileKeyByLibraryKey.values())).map(async (fileKey) => {
      try {
        const res = await fetch(
          `https://api.figma.com/v1/files/${fileKey}?depth=1`,
          { headers },
        );
        const body = await res.json() as { name?: string };
        if (!res.ok) {
          if (!firstFailStatus) firstFailStatus = res.status;
          return;
        }
        if (body.name) fileNameByKey.set(fileKey, body.name);
      } catch {
        // keep heuristic name if file fetch fails
      }
    }),
  );

  // Phase 3: re-group components by their resolved library name
  const resolvedMap = new Map<string, RemoteLibraryGroup>();
  for (const lib of raw) {
    const fileKey = fileKeyByLibraryKey.get(lib.libraryKey);
    const resolvedName = (fileKey && fileNameByKey.get(fileKey)) ?? lib.libraryName;
    const resolvedKey = `resolved:${resolvedName}`;
    if (!resolvedMap.has(resolvedKey)) {
      resolvedMap.set(resolvedKey, {
        libraryKey: resolvedKey,
        libraryName: resolvedName,
        isRemote: true,
        components: [],
      });
    }
    for (const comp of lib.components) {
      resolvedMap.get(resolvedKey)!.components.push({
        ...comp,
        libraryName: resolvedName,
        libraryKey: resolvedKey,
      });
    }
  }

  const libraries = Array.from(resolvedMap.values())
    .sort((a, b) => a.libraryName.localeCompare(b.libraryName))
    .map((lib) => ({
      ...lib,
      components: lib.components.sort((a, b) =>
        a.componentName.localeCompare(b.componentName),
      ),
    }));

  // Produce a specific error if every library lookup failed
  const allResolved = fileKeyByLibraryKey.size > 0;
  let error: string | null = null;
  if (!allResolved && firstFailStatus !== 0) {
    error =
      firstFailStatus === -1
        ? "Network error reaching the Figma API. Check your connection."
        : statusToHint(firstFailStatus);
  }

  return { libraries, error };
}

/** Re-pack raw libraries unchanged (used when we short-circuit before lookups). */
function buildPassthrough(raw: RemoteLibraryGroup[]): RemoteLibraryGroup[] {
  return raw
    .slice()
    .sort((a, b) => a.libraryName.localeCompare(b.libraryName))
    .map((lib) => ({
      ...lib,
      components: lib.components
        .slice()
        .sort((a, b) => a.componentName.localeCompare(b.componentName)),
    }));
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("components");
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [scope, setScope] = useState<ScanScope>("page");
  const [libraries, setLibraries] = useState<RemoteLibraryGroup[]>([]);
  const [statusText, setStatusText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [isResolvingLibraries, setIsResolvingLibraries] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);

  // Personal Access Token — persisted via figma.clientStorage (relayed through code.ts)
  const [pat, setPat] = useState("");
  const [patInput, setPatInput] = useState("");
  // False until the initial load-pat round-trip completes, so we don't
  // redirect to the connect screen while clientStorage is still loading.
  const [patLoaded, setPatLoaded] = useState(false);

  useEffect(() => {
    postToFigma({ type: "load-pat" });
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const triggerResolution = useCallback(
    (rawLibraries: RemoteLibraryGroup[], token: string) => {
      setIsResolvingLibraries(true);
      setResolutionError(null);
      resolveLibraryNames(rawLibraries, token).then(({ libraries: resolved, error }) => {
        setLibraries(resolved);
        setIsResolvingLibraries(false);
        setResolutionError(error);
      });
    },
    [],
  );

  useFigmaMessages(
    useCallback(
      (msg: SandboxMessage) => {
        switch (msg.type) {
          case "pat-loaded":
            setPat(msg.pat);
            setPatLoaded(true);
            break;
          case "scan-progress":
            setStatusText(msg.status);
            break;
          case "scan-result": {
            setLibraries(msg.libraries);
            setResolutionError(null);
            setViewState("results");
            if (pat) {
              triggerResolution(msg.libraries, pat);
            }
            break;
          }
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
      [showToast, scope, triggerResolution, pat],
    ),
  );

  const handleScan = useCallback(() => {
    // Don't redirect to connect screen while the stored PAT is still loading
    // from clientStorage — wait for the load-pat round-trip to complete first.
    if (!patLoaded) return;
    if (!pat) {
      setViewState("connect");
      return;
    }
    setViewState("scanning");
    setLibraries([]);
    postToFigma({ type: "scan", scope });
  }, [scope, pat, patLoaded]);

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

  const handleConnectAndScan = useCallback(() => {
    const trimmed = patInput.trim();
    if (!trimmed) return;
    postToFigma({ type: "save-pat", pat: trimmed });
    setPat(trimmed);
    setPatInput("");
    setViewState("scanning");
    setLibraries([]);
    postToFigma({ type: "scan", scope });
  }, [patInput, scope]);

  const handleDisconnectPat = useCallback(() => {
    postToFigma({ type: "clear-pat" });
    setPat("");
    setViewState("idle");
    setLibraries([]);
    showToast("Token removed");
  }, [showToast]);

  const totalInstances = libraries.reduce(
    (sum, lib) =>
      sum + lib.components.reduce((s, c) => s + c.instances.length, 0),
    0,
  );
  const totalComponents = libraries.reduce(
    (sum, lib) => sum + lib.components.length,
    0,
  );
  const libraryCount = libraries.length;

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
                {pat && (
                  <p className="mt-3 text-[11px] flex items-center gap-1.5 text-[var(--figma-color-text-tertiary,#b3b3b3)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    Figma API connected
                  </p>
                )}
              </div>
            )}

            {viewState === "connect" && (
              <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="mb-3 text-[var(--figma-color-text-secondary,#999)] opacity-50"
                >
                  <path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                <p className="text-sm font-medium text-[var(--figma-color-text,#333)]">
                  Connect Figma API
                </p>
                <p className="mt-1.5 text-[11px] text-[var(--figma-color-text-secondary,#666)] max-w-[220px]">
                  A Personal Access Token lets the plugin look up real library
                  names from the Figma API.
                </p>
                <div className="mt-4 w-full space-y-2">
                  <input
                    autoFocus
                    type="password"
                    placeholder="figd_…"
                    value={patInput}
                    onChange={(e) => setPatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConnectAndScan();
                    }}
                    className="w-full text-[11px] px-2.5 py-1.5 rounded border border-[var(--figma-color-border,#e5e5e5)] bg-[var(--figma-color-bg,#fff)] text-[var(--figma-color-text,#333)] outline-none focus:border-[var(--figma-color-border-brand,#0d99ff)]"
                  />
                  <button
                    onClick={handleConnectAndScan}
                    disabled={!patInput.trim()}
                    className="w-full text-xs py-1.5 rounded bg-[var(--figma-color-bg-brand,#0d99ff)] text-white disabled:opacity-40 cursor-pointer hover:opacity-90 transition-opacity font-medium"
                  >
                    Connect &amp; Scan
                  </button>
                  <p className="text-[10px] text-[var(--figma-color-text-tertiary,#b3b3b3)]">
                    Generate a token at{" "}
                    <span
                      className="underline cursor-pointer"
                      onClick={() =>
                        postToFigma({
                          type: "open-url",
                          url: "https://www.figma.com/settings",
                        })
                      }
                    >
                      figma.com → Settings → Personal access tokens
                    </span>
                    . Requires &quot;Read&quot; scope on file content.
                  </p>
                </div>
              </div>
            )}

            {viewState === "scanning" && (
              <div className="flex flex-col items-center justify-center h-full text-[var(--figma-color-text-secondary,#999)]">
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm">{statusText || "Scanning…"}</p>
              </div>
            )}

            {viewState === "results" && libraryCount === 0 && (
              <div className="flex flex-col items-center justify-center h-full px-6 text-center text-[var(--figma-color-text-secondary,#999)]">
                <p className="text-sm">No component instances found.</p>
              </div>
            )}

            {viewState === "results" && libraryCount > 0 && (
              <div className="pb-3">
                <div className="px-3 py-2 text-xs text-[var(--figma-color-text-secondary,#999)] flex items-center gap-1">
                  <span>
                    {totalInstances} instance{totalInstances === 1 ? "" : "s"}{" "}
                    in {totalComponents} component
                    {totalComponents === 1 ? "" : "s"} from {libraryCount}{" "}
                    librar{libraryCount === 1 ? "y" : "ies"}
                  </span>
                  {isResolvingLibraries && (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="opacity-60 flex items-center gap-1">
                        <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin inline-block" />
                        Resolving names…
                      </span>
                    </>
                  )}
                  <span className="ml-auto">
                    <button
                      onClick={handleDisconnectPat}
                      className="text-[10px] text-[var(--figma-color-text-tertiary,#b3b3b3)] hover:text-[var(--figma-color-text-danger,#f24822)] cursor-pointer transition-colors"
                    >
                      Disconnect token
                    </button>
                  </span>
                </div>
                {resolutionError && !isResolvingLibraries && (
                  <div className="mx-3 mb-2 px-2.5 py-2 rounded bg-[var(--figma-color-bg-danger-tertiary,#fff0ee)] border border-[var(--figma-color-border-danger,#f24822)] border-opacity-30 text-[10px] text-[var(--figma-color-text-danger,#f24822)] leading-relaxed">
                    {resolutionError}
                  </div>
                )}
                {libraries.map((remoteLib) => {
                  const libInstanceCount = remoteLib.components.reduce(
                    (s, c) => s + c.instances.length,
                    0,
                  );
                  return (
                    <div
                      key={remoteLib.libraryKey}
                      className="border-b border-[var(--figma-color-border,#e5e5e5)] last:border-b-0"
                    >
                      <div className="px-3 py-1.5 bg-[var(--figma-color-bg-secondary,#f5f5f5)] text-[11px] font-medium text-[var(--figma-color-text-secondary,#666)] sticky top-0 z-10">
                        {remoteLib.libraryName} · {libInstanceCount} instance
                        {libInstanceCount === 1 ? "" : "s"}
                      </div>
                      {remoteLib.components.map((group) => (
                        <LibraryGroupCard
                          key={group.componentSetKey}
                          group={group}
                          onNavigate={handleNavigate}
                          onReset={handleReset}
                          onDetach={handleDetach}
                          onDetachLibrary={handleDetachLibrary}
                          onResetLibrary={handleResetLibrary}
                        />
                      ))}
                    </div>
                  );
                })}
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
