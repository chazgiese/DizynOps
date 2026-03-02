/**
 * Checks whether a collection name starts with "Primitives" (case-insensitive).
 */
export function isPrimitiveCollection(collectionName: string): boolean {
  return collectionName.toLowerCase().startsWith("primitives");
}

/**
 * Normalizes a Figma variable path into a CSS custom property name.
 *
 * Rules:
 * - Split on `/`
 * - For Primitives: drop the first segment (category label like "Color")
 * - For Base collections: keep all segments as-is
 * - Drop any segment that is exactly `-`
 * - Replace spaces with hyphens, lowercase everything
 * - Join with `-`, prepend `--` (with optional prefix)
 */
export function normalizePath(
  name: string,
  collectionName: string,
  prefix?: string,
): string {
  let segments = name.split("/");

  if (isPrimitiveCollection(collectionName)) {
    segments = segments.slice(1);
  }

  segments = segments
    .filter((s) => s !== "-")
    .map((s) => s.replace(/\s+/g, "-").toLowerCase());

  const body = segments.join("-");
  if (prefix) {
    return `--${prefix}-${body}`;
  }
  return `--${body}`;
}

/**
 * Extracts the group path from a variable name — everything except the last segment.
 * e.g. "Color/Brand/700" → "Color/Brand"
 */
export function getGroup(name: string): string {
  const segments = name.split("/");
  return segments.slice(0, -1).join("/");
}

/**
 * Converts Figma RGBA floats (0-1) to a hex color string.
 * Returns 6-digit hex when alpha is 1, 8-digit hex otherwise.
 */
export function rgbaToHex(color: {
  r: number;
  g: number;
  b: number;
  a: number;
}): string {
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");

  const hex = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  if (color.a < 1) {
    return `${hex}${toHex(color.a)}`;
  }
  return hex;
}
