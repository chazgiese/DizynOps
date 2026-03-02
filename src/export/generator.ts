import type {
  VariableCollectionData,
  VariableData,
  VariableValue,
} from "../shared/messages";
import {
  normalizePath,
  isPrimitiveCollection,
  getGroup,
  rgbaToHex,
} from "./normalizer";

export type ModeRole = "light" | "dark" | "ignore";

export interface GeneratorInput {
  collections: VariableCollectionData[];
  /** collectionId → Set of selected group paths */
  selectedGroups: Record<string, Set<string>>;
  /** modeId → role */
  modeRoles: Record<string, ModeRole>;
  prefix: string;
}

function isColor(v: VariableValue): v is { r: number; g: number; b: number; a: number } {
  return typeof v === "object" && v !== null && "r" in v && "g" in v && "b" in v && "a" in v;
}

function isAlias(v: VariableValue): v is { type: "VARIABLE_ALIAS"; id: string } {
  return typeof v === "object" && v !== null && "type" in v && (v as any).type === "VARIABLE_ALIAS";
}

function formatValue(
  value: VariableValue,
  idToCssName: Map<string, string>,
): string {
  if (isAlias(value)) {
    const ref = idToCssName.get(value.id);
    return ref ? `var(${ref})` : `var(--unknown)`;
  }
  if (isColor(value)) {
    return rgbaToHex(value);
  }
  return String(value);
}

function isBaseColorCollection(name: string): boolean {
  return /^base\s*[–—-]\s*color$/i.test(name);
}

function isBaseCollection(name: string): boolean {
  return /^base\s*[–—-]/i.test(name);
}

/**
 * Checks whether a variable belongs to any of the selected groups for its collection.
 */
function isSelected(
  variable: VariableData,
  collectionId: string,
  selectedGroups: Record<string, Set<string>>,
): boolean {
  const groups = selectedGroups[collectionId];
  if (!groups) return false;
  return groups.has(getGroup(variable.name));
}

export function generateCss(input: GeneratorInput): string {
  const { collections, selectedGroups, modeRoles, prefix } = input;

  const idToCssName = new Map<string, string>();
  for (const col of collections) {
    for (const v of col.variables) {
      idToCssName.set(v.id, normalizePath(v.name, col.name, prefix || undefined));
    }
  }

  const primitiveCollections = collections.filter((c) =>
    isPrimitiveCollection(c.name),
  );
  const baseCollections = collections.filter((c) => isBaseCollection(c.name));

  const primitiveLines: string[] = [];
  for (const col of primitiveCollections) {
    const firstModeId = col.modes[0]?.modeId;
    if (!firstModeId) continue;
    for (const v of col.variables) {
      if (!isSelected(v, col.id, selectedGroups)) continue;
      const cssName = idToCssName.get(v.id)!;
      const val = v.valuesByMode[firstModeId];
      if (val !== undefined) {
        primitiveLines.push(`    ${cssName}: ${formatValue(val, idToCssName)};`);
      }
    }
  }

  const themeLines: string[] = [];
  const baseLightLines: string[] = [];
  const darkLines: string[] = [];

  for (const col of baseCollections) {
    let lightModeId: string | undefined;
    let darkModeId: string | undefined;
    for (const mode of col.modes) {
      const role = modeRoles[mode.modeId];
      if (role === "light") lightModeId = mode.modeId;
      if (role === "dark") darkModeId = mode.modeId;
    }
    if (!lightModeId) continue;

    const isColor = isBaseColorCollection(col.name);

    for (const v of col.variables) {
      if (!isSelected(v, col.id, selectedGroups)) continue;
      const cssName = idToCssName.get(v.id)!;

      if (isColor) {
        const themeProp = cssName.replace(/^--/, "--color-");
        themeLines.push(`  ${themeProp}: var(${cssName});`);
      }

      const lightVal = v.valuesByMode[lightModeId];
      if (lightVal !== undefined) {
        baseLightLines.push(
          `    ${cssName}: ${formatValue(lightVal, idToCssName)};`,
        );
      }

      if (darkModeId) {
        const darkVal = v.valuesByMode[darkModeId];
        if (darkVal !== undefined) {
          const lightFormatted = lightVal !== undefined ? formatValue(lightVal, idToCssName) : "";
          const darkFormatted = formatValue(darkVal, idToCssName);
          if (darkFormatted !== lightFormatted) {
            darkLines.push(`    ${cssName}: ${darkFormatted};`);
          }
        }
      }
    }
  }

  const sections: string[] = [];

  if (themeLines.length > 0) {
    sections.push(`@theme inline {\n${themeLines.join("\n")}\n}`);
  }

  const layerParts: string[] = [];

  const rootLines: string[] = [];
  if (primitiveLines.length > 0) {
    rootLines.push(...primitiveLines);
  }
  if (baseLightLines.length > 0) {
    if (rootLines.length > 0) rootLines.push("");
    rootLines.push(...baseLightLines);
  }

  if (rootLines.length > 0) {
    layerParts.push(`  :root {\n${rootLines.join("\n")}\n  }`);
  }

  if (darkLines.length > 0) {
    layerParts.push(`  .dark {\n${darkLines.join("\n")}\n  }`);
  }

  if (layerParts.length > 0) {
    sections.push(`@layer base {\n${layerParts.join("\n\n")}\n}`);
  }

  return sections.join("\n\n") + "\n";
}
