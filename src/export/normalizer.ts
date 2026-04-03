/**
 * Normalizes a Figma variable path into a CSS custom property name.
 *
 * Rules:
 * - Split on `/`
 * - Drop any segment that is exactly `-` (signals the default variant in Figma)
 * - Replace spaces with hyphens, lowercase everything
 * - Join with `-`, prepend `--` (with optional prefix)
 *
 * The collection name is never part of the CSS variable name.
 */
export function normalizePath(name: string, prefix?: string): string {
  const segments = name
    .split("/")
    .filter((s) => s !== "-")
    .map((s) => s.replace(/\s+/g, "-").toLowerCase());

  const body = segments.join("-");
  return prefix ? `--${prefix}-${body}` : `--${body}`;
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

/**
 * Converts a pixel value to rem, assuming a 16px root font size.
 * Strips trailing zeros from the decimal.
 */
export function pxToRem(px: number, base = 16): string {
  return `${parseFloat((px / base).toFixed(4))}rem`;
}

/**
 * Formats a letter spacing float value: rounds to 2 decimal places and
 * appends px. No rem conversion — letter spacing is always output in px.
 */
export function formatLetterSpacing(value: number): string {
  return `${parseFloat(value.toFixed(2))}px`;
}

/**
 * Normalizes a variable path to a CSS custom property name, applying
 * per-collection rules.
 *
 * Config collection: drops the first path segment (e.g. "Color", "Typography"),
 * which is a redundant category label in that collection's naming scheme.
 * All other collections: uses the full path as-is.
 */
export function normalizePathForCollection(
  name: string,
  collectionName: string,
  prefix?: string,
): string {
  if (collectionName === "Config") {
    const stripped = name.split("/").slice(1).join("/");
    return normalizePath(stripped, prefix);
  }
  return normalizePath(name, prefix);
}

/**
 * Normalizes a text style name into a CSS utility class name.
 * Same path rules as normalizePath.
 * e.g. "Body/MD-Strong" → "body-md-strong"
 */
export function normalizeTextStyleName(name: string): string {
  const segments = name
    .split("/")
    .filter((s) => s !== "-")
    .map((s) => s.replace(/\s+/g, "-").toLowerCase());

  return `${segments.join("-")}`;
}
