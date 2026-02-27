import type { ScanScope } from "../../shared/messages";

interface HeaderProps {
  scope: ScanScope;
  onScopeChange: (scope: ScanScope) => void;
  onScan: () => void;
  scanning: boolean;
}

export function Header({
  scope,
  onScopeChange,
  onScan,
  scanning,
}: HeaderProps) {
  return (
    <div className="px-3 pt-3 pb-2 border-b border-[var(--figma-color-border,#e5e5e5)]">
      <h1 className="text-sm font-semibold mb-2">Dizyn Ops</h1>

      <div className="flex items-center gap-1 mb-2">
        <ScopeButton
          active={scope === "page"}
          onClick={() => onScopeChange("page")}
          label="Current Page"
        />
        <ScopeButton
          active={scope === "file"}
          onClick={() => onScopeChange("file")}
          label="All Pages"
        />
      </div>

      <button
        onClick={onScan}
        disabled={scanning}
        className="w-full py-1.5 px-3 text-xs font-medium rounded-md
          bg-[var(--figma-color-bg-brand,#0d99ff)]
          text-[var(--figma-color-text-onbrand,#fff)]
          hover:opacity-90 active:opacity-80
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-opacity cursor-pointer"
      >
        {scanning ? "Scanning…" : "Scan Components"}
      </button>
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-1 px-2 text-xs rounded-md transition-colors cursor-pointer ${
        active
          ? "bg-[var(--figma-color-bg-selected,#daebf7)] text-[var(--figma-color-text-brand,#0d99ff)] font-medium"
          : "bg-[var(--figma-color-bg-secondary,#f5f5f5)] text-[var(--figma-color-text-secondary,#999)] hover:bg-[var(--figma-color-bg-hover,#eee)]"
      }`}
    >
      {label}
    </button>
  );
}
