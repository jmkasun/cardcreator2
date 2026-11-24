import type { TextLayer } from "./cardRenderer";

/**
 * Checks if a layer represents a numeric Price tag column
 */
export function isPriceLayer(layer?: Partial<TextLayer> | null): boolean {
  if (!layer) return false;
  if (layer.type === "number") return true;
  // Ignore linked words labels, list labels, or dates
  if (layer.isNumberLabel || layer.isListLabel || layer.type === "date" || layer.type === "list") return false;
  const nameLower = (layer.name || "").toLowerCase().trim();
  return (
    nameLower.includes("price") ||
    nameLower.includes("මුදල") ||
    nameLower.includes("ගාස්තුව") ||
    nameLower.includes("මිල") ||
    nameLower.includes("ගණන") ||
    nameLower.includes("amount") ||
    nameLower.includes("cost") ||
    nameLower.includes("fee") ||
    nameLower.includes("rate") ||
    nameLower.includes("tag") ||
    nameLower.includes("total") ||
    nameLower.includes("lkr") ||
    nameLower.includes("rupee") ||
    nameLower.includes("donation") ||
    /\brs\b/.test(nameLower)
  );
}

/**
 * Safely parses any number, currency string, or formatted price into a float
 */
export function parsePriceValue(val: unknown): number {
  if (val === undefined || val === null) return 0;
  const str = String(val)
    .replace(/(\/[-=]|\$[-=])\s*$/g, "")
    .replace(/,/g, "")
    .trim();
  if (!str) return 0;
  const match = str.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const num = parseFloat(match[0]);
  return isNaN(num) ? 0 : num;
}

/**
 * Formats a number with comma separators
 */
export function formatPriceNumber(num: number): string {
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
