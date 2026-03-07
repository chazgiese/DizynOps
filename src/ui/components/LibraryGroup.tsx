import React, { useState } from "react";
import type { LibraryGroup } from "../../shared/messages";
import { InstanceRow } from "./InstanceRow";

interface LibraryGroupCardProps {
  group: LibraryGroup;
  onNavigate: (nodeId: string, pageId: string) => void;
  onReset: (nodeId: string) => void;
  onDetach: (nodeId: string) => void;
  onDetachLibrary: (libraryKey: string, nodeIds: string[]) => void;
  onResetLibrary: (libraryKey: string, nodeIds: string[]) => void;
}

export function LibraryGroupCard({
  group,
  onNavigate,
  onReset,
  onDetach,
  onDetachLibrary,
  onResetLibrary,
}: LibraryGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDetachAll, setConfirmDetachAll] = useState(false);

  const handleDetachAll = () => {
    if (!confirmDetachAll) {
      setConfirmDetachAll(true);
      return;
    }
    const nodeIds = group.instances.map((i) => i.nodeId);
    onDetachLibrary(group.libraryKey, nodeIds);
    setConfirmDetachAll(false);
  };

  return (
    <div className="border-b border-[var(--figma-color-border,#e5e5e5)] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--figma-color-bg-hover,#f5f5f5)] transition-colors cursor-pointer"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>

        <div className="flex-1 text-left min-w-0">
          <span className="text-xs font-medium truncate block">
            {group.componentName}
          </span>
        </div>

        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--figma-color-bg-secondary,#f0f0f0)] text-[var(--figma-color-text-secondary,#999)] shrink-0">
          {group.instances.length}
        </span>
      </button>

      {expanded && (
        <div>
          {group.instances.map((instance) => (
            <InstanceRow
              key={instance.nodeId}
              instance={instance}
              onNavigate={onNavigate}
              onReset={onReset}
              onDetach={onDetach}
            />
          ))}

          <div className="px-3 py-2 space-y-2">
            <button
              onClick={() =>
                onResetLibrary(
                  group.libraryKey,
                  group.instances.map((i) => i.nodeId),
                )
              }
              className="w-full py-1.5 px-3 text-xs rounded-md bg-[var(--figma-color-bg-secondary,#f5f5f5)] text-[var(--figma-color-text-secondary,#666)] hover:bg-[var(--figma-color-bg-hover,#eee)] transition-colors cursor-pointer"
            >
              Reset all ({group.instances.length})
            </button>
            <button
              onClick={handleDetachAll}
              onBlur={() => setConfirmDetachAll(false)}
              className={`w-full py-1.5 px-3 text-xs rounded-md transition-colors cursor-pointer ${
                confirmDetachAll
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-[var(--figma-color-bg-secondary,#f5f5f5)] text-[var(--figma-color-text-secondary,#666)] hover:bg-red-50 hover:text-red-600"
              }`}
            >
              {confirmDetachAll
                ? `Confirm: Detach all ${group.instances.length} instances?`
                : `Detach All (${group.instances.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
