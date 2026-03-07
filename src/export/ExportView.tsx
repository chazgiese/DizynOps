import { useState, useCallback, useMemo, useEffect } from "react";
import type {
  SandboxMessage,
  VariableCollectionData,
  TextStyleData,
} from "../shared/messages";
import {
  useFigmaMessages,
  postToFigma,
} from "../ui/hooks/useFigmaMessages";
import { generateCss, type ModeRole } from "./generator";

const INCLUDED_COLLECTIONS = new Set(["Config", "Core – Color", "Core – Typography"]);

function autoDetectRole(modeName: string): ModeRole | undefined {
  const lower = modeName.toLowerCase();
  if (lower.includes("light")) return "light";
  if (lower.includes("dark")) return "dark";
  return undefined;
}

export function ExportView() {
  const [collections, setCollections] = useState<VariableCollectionData[] | null>(null);
  const [textStyles, setTextStyles] = useState<TextStyleData[]>([]);
  const [modeRoles, setModeRoles] = useState<Record<string, ModeRole | undefined>>({});
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    postToFigma({ type: "fetch-variables" });
  }, []);

  useFigmaMessages(
    useCallback((msg: SandboxMessage) => {
      if (msg.type !== "variables-result") return;

      setCollections(msg.collections);
      setTextStyles(msg.textStyles ?? []);

      const roles: Record<string, ModeRole | undefined> = {};

      for (const col of msg.collections) {
        if (!INCLUDED_COLLECTIONS.has(col.name)) continue;
        if (col.modes.length > 1) {
          for (const mode of col.modes) {
            if (!(mode.modeId in roles)) {
              roles[mode.modeId] = autoDetectRole(mode.name);
            }
          }
        }
      }

      setModeRoles(roles);
    }, []),
  );

  const setRole = useCallback(
    (modeId: string, role: ModeRole | undefined) => {
      setModeRoles((prev) => ({ ...prev, [modeId]: role }));
    },
    [],
  );

  const cssOutput = useMemo(() => {
    if (!collections) return "";
    return generateCss({
      collections,
      modeRoles: modeRoles as Record<string, ModeRole>,
      prefix: prefix.trim(),
      textStyles,
    });
  }, [collections, modeRoles, prefix, textStyles]);

  // Collect unique modes from all multi-mode included collections
  const pendingModes = useMemo(() => {
    if (!collections) return [];
    const seen = new Map<string, string>();
    for (const col of collections) {
      if (!INCLUDED_COLLECTIONS.has(col.name)) continue;
      if (col.modes.length <= 1) continue;
      for (const mode of col.modes) {
        if (!seen.has(mode.modeId)) {
          seen.set(mode.modeId, mode.name);
        }
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [collections]);

  const allModesAssigned = useMemo(
    () => pendingModes.every((m) => modeRoles[m.id] !== undefined),
    [pendingModes, modeRoles],
  );

  const canExport = allModesAssigned;

  const handleExport = useCallback(() => {
    const blob = new Blob([cssOutput], { type: "text/css" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "global.css";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [cssOutput]);

  if (!collections) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--figma-color-text-secondary,#999)]">
        <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm">Loading variables…</p>
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center text-[var(--figma-color-text-secondary,#999)]">
        <p className="text-sm">No variable collections found in this file.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2 space-y-3">
        {/* Mode role assignments */}
        {pendingModes.length > 0 && (
          <div>
            <p className="text-[10px] text-[var(--figma-color-text-secondary,#999)] font-medium uppercase tracking-wide mb-1.5">
              Modes
            </p>
            <div className="space-y-1.5">
              {pendingModes.map((mode) => (
                <div key={mode.id} className="flex items-center gap-2">
                  <span className="text-xs flex-1 truncate">{mode.name}</span>
                  <select
                    value={modeRoles[mode.id] ?? ""}
                    onChange={(e) =>
                      setRole(
                        mode.id,
                        (e.target.value || undefined) as ModeRole | undefined,
                      )
                    }
                    className="text-xs rounded border border-[var(--figma-color-border,#e5e5e5)] bg-[var(--figma-color-bg,#fff)] text-[var(--figma-color-text,#333)] px-1.5 py-1"
                  >
                    <option value="">— assign —</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="ignore">Ignore</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prefix input */}
        <div className={pendingModes.length > 0 ? "border-t border-[var(--figma-color-border,#e5e5e5)] pt-3" : ""}>
          <label className="text-xs font-semibold block mb-1">
            Variable prefix
          </label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="e.g. arc"
            className="w-full text-xs rounded border border-[var(--figma-color-border,#e5e5e5)] bg-[var(--figma-color-bg,#fff)] text-[var(--figma-color-text,#333)] px-2 py-1.5"
          />
        </div>

        {/* Preview panel */}
        {cssOutput.trim().length > 1 && (
          <div className="border-t border-[var(--figma-color-border,#e5e5e5)] pt-3">
            <h3 className="text-xs font-semibold mb-2">Preview</h3>
            <pre className="text-[10px] leading-relaxed bg-[var(--figma-color-bg-secondary,#f5f5f5)] rounded-md p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre font-mono">
              {cssOutput}
            </pre>
          </div>
        )}
      </div>

      {/* Export button */}
      <div className="px-3 py-2 border-t border-[var(--figma-color-border,#e5e5e5)]">
        <button
          onClick={handleExport}
          disabled={!canExport}
          className="w-full py-1.5 px-3 text-xs font-medium rounded-md
            bg-[var(--figma-color-bg-brand,#0d99ff)]
            text-[var(--figma-color-text-onbrand,#fff)]
            hover:opacity-90 active:opacity-80
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-opacity cursor-pointer"
        >
          Export global.css
        </button>
      </div>
    </div>
  );
}
