import type {
  VariableCollectionData,
  VariableData,
  VariableValue,
  TextStyleData,
} from "../shared/messages";
import {
  normalizePathForCollection,
  normalizePath,
  rgbaToHex,
  pxToRem,
  formatLetterSpacing,
  normalizeTextStyleName,
} from "./normalizer";

export type ModeRole = "light" | "dark" | "ignore";

// Collections always included in the Arc export
const INCLUDED_COLLECTIONS = new Set(["Config", "Core – Color", "Core – Typography"]);

/** Prefix for typography @utility class names to avoid conflicts with Tailwind built-ins. */
const TYPOGRAPHY_UTILITY_PREFIX = "arc";

/** Header for exported global.css: imports and dark variant. */
const EXPORT_HEADER = `@import './fonts.css';
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));`;

export interface GeneratorInput {
  collections: VariableCollectionData[];
  /** modeId → role */
  modeRoles: Record<string, ModeRole>;
  prefix: string;
  textStyles: TextStyleData[];
}

function isColorValue(v: VariableValue): v is { r: number; g: number; b: number; a: number } {
  return typeof v === "object" && v !== null && "r" in v && "g" in v && "b" in v && "a" in v;
}

function isAlias(v: VariableValue): v is { type: "VARIABLE_ALIAS"; id: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "type" in v &&
    (v as { type: string }).type === "VARIABLE_ALIAS"
  );
}

function formatVariableValue(
  value: VariableValue,
  resolvedType: string,
  idToCssName: Map<string, string>,
  variableName: string,
): string {
  if (isAlias(value)) {
    const ref = idToCssName.get(value.id);
    return ref ? `var(${ref})` : `var(--unknown)`;
  }
  if (isColorValue(value)) {
    return rgbaToHex(value);
  }
  if (resolvedType === "FLOAT" && typeof value === "number") {
    if (variableName.includes("Weight")) return String(Math.round(value));
    if (variableName.includes("Letter Spacing")) return formatLetterSpacing(value);
    return pxToRem(value);
  }
  return String(value);
}

export function generateCss(input: GeneratorInput): string {
  const { collections, modeRoles, prefix, textStyles } = input;
  const pfx = prefix || undefined;

  // Build global id → CSS variable name map (across all collections, for alias resolution)
  const idToCssName = new Map<string, string>();
  for (const col of collections) {
    for (const v of col.variables) {
      idToCssName.set(v.id, normalizePathForCollection(v.name, col.name, pfx));
    }
  }

  const themeLines: string[] = [];
  const unlayeredRootParts: string[] = []; // single-mode: Config, Core – Typography
  const rootParts: string[] = [];          // multi-mode: Core – Color
  const darkParts: string[] = [];

  for (const col of collections) {
    // Hard-coded scope: only process known Arc collections
    if (!INCLUDED_COLLECTIONS.has(col.name)) continue;

    const isMultiMode = col.modes.length > 1;

    let lightModeId: string | undefined;
    let darkModeId: string | undefined;

    if (isMultiMode) {
      for (const mode of col.modes) {
        const role = modeRoles[mode.modeId];
        if (role === "light") lightModeId = mode.modeId;
        if (role === "dark") darkModeId = mode.modeId;
      }
      // Skip multi-mode collections that have no light mode assigned
      if (!lightModeId) continue;
    }

    const activeModeId = isMultiMode ? lightModeId! : col.modes[0]?.modeId;
    if (!activeModeId) continue;

    // Group variables by their group path, preserving order
    const groupOrder: string[] = [];
    const byGroup = new Map<string, VariableData[]>();

    for (const v of col.variables) {
      // Omit Elevation group from Core – Color
      if (col.name === "Core – Color" && v.name.startsWith("Elevation/")) continue;

      // Skip unsupported types
      if (v.resolvedType !== "COLOR" && v.resolvedType !== "FLOAT" && v.resolvedType !== "STRING") continue;

      const grp = v.name.split("/").slice(0, -1).join("/");
      if (!byGroup.has(grp)) {
        byGroup.set(grp, []);
        groupOrder.push(grp);
      }
      byGroup.get(grp)!.push(v);
    }

    if (byGroup.size === 0) continue;

    // Build :root lines for this collection
    const colRootLines: string[] = [];
    // Build .dark lines for this collection
    const colDarkLines: string[] = [];

    for (const grp of groupOrder) {
      const vars = byGroup.get(grp)!;

      for (const v of vars) {
        const cssName = idToCssName.get(v.id)!;
        const lightVal = v.valuesByMode[activeModeId];
        if (lightVal === undefined) continue;

        colRootLines.push(`    ${cssName}: ${formatVariableValue(lightVal, v.resolvedType, idToCssName, v.name)};`);

        // @theme inline: COLOR variables from multi-mode collections only
        if (isMultiMode && v.resolvedType === "COLOR") {
          const themeProp = pfx
            ? `--color-${pfx}-${normalizePath(v.name).slice(2)}`
            : `--color-${normalizePath(v.name).slice(2)}`;
          themeLines.push(`  ${themeProp}: var(${cssName});`);
        }

        // .dark: only values that differ from light
        if (isMultiMode && darkModeId) {
          const darkVal = v.valuesByMode[darkModeId];
          if (darkVal !== undefined) {
            const lightFormatted = formatVariableValue(lightVal, v.resolvedType, idToCssName, v.name);
            const darkFormatted = formatVariableValue(darkVal, v.resolvedType, idToCssName, v.name);
            if (darkFormatted !== lightFormatted) {
              colDarkLines.push(`    ${cssName}: ${darkFormatted};`);
            }
          }
        }
      }
    }

    if (isMultiMode) {
      rootParts.push(colRootLines.join("\n"));
    } else {
      unlayeredRootParts.push(colRootLines.join("\n"));
    }

    if (colDarkLines.length > 0) {
      darkParts.push(colDarkLines.join("\n"));
    }
  }

  // Build @utility blocks for text styles
  const utilityLines: string[] = [];
  if (textStyles.length > 0) {
    for (const ts of textStyles) {
      const className = normalizeTextStyleName(ts.name);

      const fontFamilyVal = ts.fontFamily.variableId
        ? `var(${idToCssName.get(ts.fontFamily.variableId) ?? "--unknown"})`
        : `'${ts.fontFamily.rawValue}'`;

      const fontSizeVal = ts.fontSize.variableId
        ? `var(${idToCssName.get(ts.fontSize.variableId) ?? "--unknown"})`
        : pxToRem(Number(ts.fontSize.rawValue));

      const lineHeightVal = ts.lineHeight.variableId
        ? `var(${idToCssName.get(ts.lineHeight.variableId) ?? "--unknown"})`
        : pxToRem(Number(ts.lineHeight.rawValue));

      const fontWeightVal = ts.fontWeight.variableId
        ? `var(${idToCssName.get(ts.fontWeight.variableId) ?? "--unknown"})`
        : String(ts.fontWeight.rawValue);

      const letterSpacingVal = ts.letterSpacing.variableId
        ? `var(${idToCssName.get(ts.letterSpacing.variableId) ?? "--unknown"})`
        : formatLetterSpacing(Number(ts.letterSpacing.rawValue));

      utilityLines.push(
        `@utility ${TYPOGRAPHY_UTILITY_PREFIX}-${className} {\n` +
        `  font-family: ${fontFamilyVal};\n` +
        `  font-size: ${fontSizeVal};\n` +
        `  line-height: ${lineHeightVal};\n` +
        `  font-weight: ${fontWeightVal};\n` +
        `  letter-spacing: ${letterSpacingVal};\n` +
        `}`,
      );
    }
  }

  const sections: string[] = [EXPORT_HEADER];

  if (themeLines.length > 0) {
    sections.push(`@theme inline {\n${themeLines.join("\n")}\n}`);
  }

  // Unlayered :root for constant tokens (Config, Core – Typography)
  if (unlayeredRootParts.length > 0) {
    sections.push(`:root {\n${unlayeredRootParts.join("\n\n")}\n}`);
  }

  // @layer base for semantic/themeable tokens (Core – Color)
  const layerBaseParts: string[] = [];

  if (rootParts.length > 0) {
    layerBaseParts.push(`  :root {\n${rootParts.join("\n\n")}\n  }`);
  }

  if (darkParts.length > 0) {
    layerBaseParts.push(`  .dark {\n${darkParts.join("\n\n")}\n  }`);
  }

  if (layerBaseParts.length > 0) {
    sections.push(`@layer base {\n${layerBaseParts.join("\n\n")}\n}`);
  }

  if (utilityLines.length > 0) {
    sections.push(utilityLines.join("\n\n"));
  }

  sections.push(
    `@layer base {\n` +
      `  * {\n    @apply border-border;\n  }\n` +
      `  body {\n    @apply bg-bg-surface text-text antialiased;\n  }\n` +
      `}`,
  );

  return sections.join("\n\n") + "\n";
}
