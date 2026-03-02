import { useState, useCallback, useMemo, useEffect } from "react";
import type {
  SandboxMessage,
  VariableCollectionData,
} from "../shared/messages";
import {
  useFigmaMessages,
  postToFigma,
} from "../ui/hooks/useFigmaMessages";
import { getGroup } from "./normalizer";
import { generateCss, type ModeRole } from "./generator";

function isPrimitiveCollection(name: string): boolean {
  return name.toLowerCase().startsWith("primitives");
}

function isBaseCollection(name: string): boolean {
  return /^base\s*[–—-]/i.test(name);
}

function autoDetectRole(modeName: string): ModeRole | undefined {
  const lower = modeName.toLowerCase();
  if (lower.includes("light")) return "light";
  if (lower.includes("dark")) return "dark";
  return undefined;
}

function collectGroups(col: VariableCollectionData): string[] {
  const seen = new Set<string>();
  for (const v of col.variables) {
    seen.add(getGroup(v.name));
  }
  return Array.from(seen).sort();
}

export function ExportView() {
  const [collections, setCollections] = useState<
    VariableCollectionData[] | null
  >(null);
  const [selectedGroups, setSelectedGroups] = useState<
    Record<string, Set<string>>
  >({});
  const [modeRoles, setModeRoles] = useState<
    Record<string, ModeRole | undefined>
  >({});
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    postToFigma({ type: "fetch-variables" });
  }, []);

  useFigmaMessages(
    useCallback((msg: SandboxMessage) => {
      if (msg.type !== "variables-result") return;

      setCollections(msg.collections);

      const groups: Record<string, Set<string>> = {};
      const roles: Record<string, ModeRole | undefined> = {};

      for (const col of msg.collections) {
        groups[col.id] = new Set(collectGroups(col));

        if (isBaseCollection(col.name)) {
          for (const mode of col.modes) {
            if (!(mode.modeId in roles)) {
              roles[mode.modeId] = autoDetectRole(mode.name);
            }
          }
        }
      }

      setSelectedGroups(groups);
      setModeRoles(roles);
    }, []),
  );

  const toggleGroup = useCallback(
    (collectionId: string, group: string) => {
      setSelectedGroups((prev) => {
        const copy = { ...prev };
        const set = new Set(copy[collectionId] ?? []);
        if (set.has(group)) set.delete(group);
        else set.add(group);
        copy[collectionId] = set;
        return copy;
      });
    },
    [],
  );

  const toggleAllGroups = useCallback(
    (collectionId: string, allGroups: string[], checked: boolean) => {
      setSelectedGroups((prev) => {
        const copy = { ...prev };
        copy[collectionId] = checked ? new Set(allGroups) : new Set();
        return copy;
      });
    },
    [],
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
      selectedGroups,
      modeRoles: modeRoles as Record<string, ModeRole>,
      prefix: prefix.trim(),
    });
  }, [collections, selectedGroups, modeRoles, prefix]);

  const baseModes = useMemo(() => {
    if (!collections) return [];
    const seen = new Map<string, string>();
    for (const col of collections) {
      if (!isBaseCollection(col.name)) continue;
      const hasSelectedGroup = [...(selectedGroups[col.id] ?? [])].length > 0;
      if (!hasSelectedGroup) continue;
      for (const mode of col.modes) {
        if (!seen.has(mode.modeId)) {
          seen.set(mode.modeId, mode.name);
        }
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [collections, selectedGroups]);

  const hasAnyGroup = useMemo(() => {
    return Object.values(selectedGroups).some((s) => s.size > 0);
  }, [selectedGroups]);

  const allModesAssigned = useMemo(() => {
    return baseModes.every((m) => modeRoles[m.id] !== undefined);
  }, [baseModes, modeRoles]);

  const canExport = hasAnyGroup && allModesAssigned;

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
        {/* Collection / group selector */}
        {collections.map((col) => {
          const groups = collectGroups(col);
          const selected = selectedGroups[col.id] ?? new Set();
          const allChecked = groups.length > 0 && groups.every((g) => selected.has(g));
          const someChecked = groups.some((g) => selected.has(g));

          return (
            <details key={col.id} open>
              <summary className="cursor-pointer text-xs font-semibold py-1 select-none flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked && !allChecked;
                  }}
                  onChange={(e) =>
                    toggleAllGroups(col.id, groups, e.target.checked)
                  }
                  className="accent-[var(--figma-color-bg-brand,#0d99ff)]"
                  onClick={(e) => e.stopPropagation()}
                />
                <span>{col.name}</span>
                <span className="font-normal text-[var(--figma-color-text-secondary,#999)]">
                  ({col.variables.length})
                </span>
              </summary>
              <div className="pl-5 py-1 space-y-0.5">
                {groups.map((g) => (
                  <label
                    key={g}
                    className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(g)}
                      onChange={() => toggleGroup(col.id, g)}
                      className="accent-[var(--figma-color-bg-brand,#0d99ff)]"
                    />
                    {g || "(root)"}
                  </label>
                ))}
              </div>
            </details>
          );
        })}

        {/* Mode labeler */}
        {baseModes.length > 0 && (
          <div className="border-t border-[var(--figma-color-border,#e5e5e5)] pt-3">
            <h3 className="text-xs font-semibold mb-2">Mode Roles</h3>
            <div className="space-y-1.5">
              {baseModes.map((mode) => (
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
        <div className="border-t border-[var(--figma-color-border,#e5e5e5)] pt-3">
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
