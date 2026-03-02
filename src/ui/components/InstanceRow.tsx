import React from "react";
import type { InstanceInfo } from "../../shared/messages";

interface InstanceRowProps {
  instance: InstanceInfo;
  onNavigate: (nodeId: string, pageId: string) => void;
  onReset: (nodeId: string) => void;
  onDetach: (nodeId: string) => void;
}

export function InstanceRow({
  instance,
  onNavigate,
  onReset,
  onDetach,
}: InstanceRowProps) {
  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--figma-color-bg-hover,#f5f5f5)] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate" title={instance.name}>
          {instance.name}
        </div>
        <div
          className="text-[10px] text-[var(--figma-color-text-tertiary,#b3b3b3)] truncate"
          title={`${instance.componentName} · ${instance.parentName || instance.pageName}`}
        >
          {instance.componentName}
          {instance.parentName && (
            <span> · {instance.parentName}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <IconButton
          title="Go to instance"
          onClick={() => onNavigate(instance.nodeId, instance.pageId)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 3h6v6M14 10l6.1-6.1M10 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5" />
          </svg>
        </IconButton>
        <IconButton
          title="Reset instance"
          onClick={() => onReset(instance.nodeId)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </IconButton>
        <IconButton
          title="Detach instance"
          onClick={() => onDetach(instance.nodeId)}
          destructive
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  destructive = false,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1 rounded transition-colors cursor-pointer ${
        destructive
          ? "hover:bg-red-100 hover:text-red-600"
          : "hover:bg-[var(--figma-color-bg-secondary,#eee)]"
      }`}
    >
      {children}
    </button>
  );
}
