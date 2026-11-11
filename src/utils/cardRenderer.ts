import JSZip from "jszip";
import { convertNumberToSinhala, formatNumberForCanvas } from "./sinhalaConverter";

export interface SuffixLineConfig {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextLayer {
  id: string;
  name: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  strokeColor: string;
  strokeWidth: number;
  shadowBlur: number;
  shadowColor: string;
  textAlign: 'left' | 'center' | 'right';
  type?: 'text' | 'date' | 'label' | 'list' | 'number';
  options?: string[];
  optionLabels?: string[];
  hasOptionLabel?: boolean;
  isListLabel?: boolean;
  linkedListId?: string;
  hasNumberLabel?: boolean;
  isNumberLabel?: boolean;
  linkedNumberId?: string;
  numberFontMode?: 'fm' | 'unicode';
  numberSuffix?: '$-' | '/-' | '$=' | '/=' | 'auto';
  sinhalaMonthFontSize?: number;
  useSinhalaMonth?: boolean;
  sinhalaMonths?: string[];
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  hasSuffixList?: boolean;
  suffixList?: string[];
  selectedSuffix?: string;
  suffixGap?: number;
  suffixFontSize?: number;
  suffixFontFamily?: string;
  suffixColor?: string;
  showSuffixLine?: boolean;
  suffixLineWidth?: number;
  suffixLineColor?: string;
  suffixLines?: Record<string, SuffixLineConfig>;
  visible?: boolean;
  resetAfterCopy?: boolean;
}

export interface Font {
  name: string;
  url: string;
  rawName?: string;
}

export interface BulkCardResult {
  index: number;
  name: string;
  filename: string;
  blob: Blob;
  dataUrl: string;
  layers: TextLayer[];
}

export function formatFontDisplayName(name: string): string {
  return name.replace(/^\d+-/, "") || name;
}

export function normalizeFontLookup(name: string): string {
  return String(name || "")
    .replace(/\.(woff2?|ttf|otf)$/i, "")
    .replace(/^\d+-/, "")
    .replace(/__\d+_?$/i, "")
    .replace(/\s*\(\d+\)$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

const GENERIC_FONT_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui"]);

export function isGenericCssFont(family?: string): boolean {
  return !family || GENERIC_FONT_FAMILIES.has(family.trim().toLowerCase());
}

export function escapeCssFontFamily(family: string): string {
  return family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildCanvasFontSpec(
  fontSize: number,
  fontFamily?: string,
  isBold?: boolean,
  isItalic?: boolean,
  includeFallback = true,
  fallbackAlias?: string
): string {
  const style = isItalic ? "italic " : "";
  const weight = isBold ? "bold " : "";
  const fam = (fontFamily || "sans-serif").trim();
  if (isGenericCssFont(fam)) {
    return `${style}${weight}${fontSize}px ${fam || "sans-serif"}`;
  }
  const quoted = `"${escapeCssFontFamily(fam)}"`;
  const extraAlias = (fallbackAlias && fallbackAlias !== fam && !isGenericCssFont(fallbackAlias))
    ? `, "${escapeCssFontFamily(fallbackAlias)}"`
    : "";
  return includeFallback ? `${style}${weight}${fontSize}px ${quoted}${extraAlias}, sans-serif` : `${style}${weight}${fontSize}px ${quoted}`;
}

export function getSuffixLineConfig(layer: TextLayer, suffix?: string, index?: number): SuffixLineConfig {
  const sufKey = suffix || layer.selectedSuffix || (layer.suffixList?.[0] ?? "");
  if (layer.suffixLines && layer.suffixLines[sufKey]) {
    return layer.suffixLines[sufKey];
  }
  const idx = index !== undefined && index >= 0 ? index : (layer.suffixList?.indexOf(sufKey) ?? 0);
  if (layer.suffixLines && layer.suffixLines[`index_${idx}`]) {
    return layer.suffixLines[`index_${idx}`];
  }
  const yOffset = idx >= 0 ? (idx * 3.5) : 0;
  return {
    x1: Math.round(Math.max(2, Math.min(85, layer.x))),
    y1: Math.round(Math.max(2, Math.min(95, layer.y + 4 + yOffset))),
    x2: Math.round(Math.max(5, Math.min(98, layer.x + 20))),
    y2: Math.round(Math.max(2, Math.min(95, layer.y + 4 + yOffset))),
  };
}

/**
 * Ensures all custom webfonts needed by layers are loaded into document.fonts
 */
export async function ensureCanvasFontsLoaded(layers: TextLayer[], fonts: Font[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await document.fonts.ready;
  } catch (_) {}

  for (const layer of layers) {
    if (layer.visible === false) continue;
    const fontFamily = layer.fontFamily || "sans-serif";
    const matchedFont = fonts.find(f => f.name === fontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(fontFamily));
    const fallbackAlias = matchedFont && matchedFont.name !== fontFamily ? matchedFont.name : undefined;
    
    if (!isGenericCssFont(fontFamily)) {
      const checkFontStr = buildCanvasFontSpec(layer.fontSize, fontFamily, layer.isBold, layer.isItalic, false);
      try {
        if (!document.fonts.check(checkFontStr)) {
          await document.fonts.load(checkFontStr);
        }
        if (fallbackAlias) {
          const aliasCheckStr = buildCanvasFontSpec(layer.fontSize, fallbackAlias, layer.isBold, layer.isItalic, false);
          if (!document.fonts.check(aliasCheckStr)) {
            await document.fonts.load(aliasCheckStr);
          }
        }
      } catch (e) {
        console.warn(`Font load failed: ${checkFontStr}`, e);
      }
    }

    if (layer.hasSuffixList && layer.selectedSuffix && layer.suffixFontFamily && !isGenericCssFont(layer.suffixFontFamily)) {
      const sufCheckStr = buildCanvasFontSpec(layer.suffixFontSize || layer.fontSize, layer.suffixFontFamily, layer.isBold, layer.isItalic, false);
      try {
        if (!document.fonts.check(sufCheckStr)) {
          await document.fonts.load(sufCheckStr);
        }
      } catch (_) {}
    }
  }
}

export interface RenderLayersOptions {
  isPreviewMode?: boolean;
  selectedLayerId?: string | null;
  isLocked?: boolean;
  isExporting?: boolean;
}

export interface ResolvedLayerText {
  displayText: string;
  isSinhalaDate: boolean;
  yearStr: string;
  monthStr: string;
  dayStr: string;
}

/**
 * Resolves the formatted text for a layer, including number formatting,
 * linked Sinhala number words, linked list labels, and Sinhala date months.
 */
export function resolveLayerText(
  layer: TextLayer,
  allLayers: TextLayer[],
  fallbackToName = true
): ResolvedLayerText {
  let displayText = layer.text || (fallbackToName ? layer.name : "") || "";
  if (layer.type === 'number') {
    const linkedLabel = allLayers.find(l => l.linkedNumberId === layer.id);
    const effectiveMode = linkedLabel?.numberFontMode || layer.numberFontMode;
    displayText = formatNumberForCanvas(layer.text, layer.numberSuffix, layer.fontFamily, effectiveMode);
  } else if (layer.isListLabel && layer.linkedListId) {
    const parentList = allLayers.find(l => l.id === layer.linkedListId);
    if (parentList) {
      const optIndex = parentList.options ? parentList.options.indexOf(parentList.text) : -1;
      if (optIndex >= 0 && parentList.optionLabels && parentList.optionLabels[optIndex] !== undefined && parentList.optionLabels[optIndex] !== "") {
        displayText = parentList.optionLabels[optIndex];
      } else if (layer.text) {
        displayText = layer.text;
      } else if (parentList.text === "") {
        displayText = "";
      }
    }
  } else if (layer.isNumberLabel && layer.linkedNumberId) {
    const parentNumber = allLayers.find(l => l.id === layer.linkedNumberId);
    if (parentNumber) {
      const mode = parentNumber.numberFontMode || layer.numberFontMode || 'fm';
      displayText = convertNumberToSinhala(parentNumber.text, mode) || layer.text || "";
    }
  }

  let isSinhalaDate = false;
  let yearStr = "";
  let monthStr = "";
  let dayStr = "";

  if (layer.type === 'date' && layer.useSinhalaMonth && layer.sinhalaMonths) {
    try {
      const d = new Date(layer.text);
      if (!isNaN(d.getTime())) {
        yearStr = d.getFullYear().toString();
        monthStr = layer.sinhalaMonths[d.getMonth()] || "";
        dayStr = d.getDate().toString();
        isSinhalaDate = true;
        displayText = `${yearStr} ${monthStr} ${dayStr}`;
      }
    } catch (e) {
      console.error("Failed to format date with Sinhala month", e);
    }
  }

  return { displayText, isSinhalaDate, yearStr, monthStr, dayStr };
}

interface DrawSingleLayerOverride {
  x?: number; // absolute canvas pixels
  y?: number; // absolute canvas pixels
  refHeight?: number; // original background height for suffix line percentage scaling
  yShiftPx?: number; // vertical pixel shift for layers below expanded gap
  fontScale?: number;
  textAlign?: 'left' | 'center' | 'right';
  fallbackToName?: boolean;
  drawSuffixLine?: boolean;
  selectedLayerId?: string | null;
  isLocked?: boolean;
  isPreviewMode?: boolean;
  isExporting?: boolean;
}

function drawSingleLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layer: TextLayer,
  allLayers: TextLayer[],
  fonts: Font[],
  override: DrawSingleLayerOverride = {}
): void {
  const {
    x: overrideX,
    y: overrideY,
    refHeight,
    yShiftPx = 0,
    fontScale = 1,
    textAlign: overrideAlign,
    fallbackToName = true,
    drawSuffixLine = true,
    selectedLayerId = null,
    isLocked = false,
    isPreviewMode = false,
    isExporting = false,
  } = override;

  ctx.save();
  const fontFamily = layer.fontFamily || "sans-serif";
  const matchedFont = fonts.find(f => f.name === fontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(fontFamily));
  const fallbackAlias = matchedFont && matchedFont.name !== fontFamily ? matchedFont.name : undefined;
  const effectiveFontSize = Math.max(8, layer.fontSize * fontScale);
  const fontStr = buildCanvasFontSpec(effectiveFontSize, fontFamily, layer.isBold, layer.isItalic, true, fallbackAlias);

  ctx.font = fontStr;
  ctx.textAlign = overrideAlign || layer.textAlign || "center";
  ctx.textBaseline = "middle";

  const x = overrideX !== undefined ? overrideX : (layer.x / 100) * width;
  const y = overrideY !== undefined ? overrideY : (layer.y / 100) * height;

  const { displayText, isSinhalaDate, yearStr, monthStr, dayStr } = resolveLayerText(
    layer,
    allLayers,
    fallbackToName
  );

  if (layer.shadowBlur > 0) {
    ctx.shadowBlur = layer.shadowBlur * (width / 1000) * Math.min(1, fontScale);
    ctx.shadowColor = layer.shadowColor;
  }

  if (isSinhalaDate) {
    const monthFontSize = ((layer.sinhalaMonthFontSize || layer.fontSize) * (width / 1000) * fontScale);
    const monthFontStr = buildCanvasFontSpec(monthFontSize, layer.fontFamily, layer.isBold, layer.isItalic, true, fallbackAlias);

    const w1 = ctx.measureText(yearStr + " ").width;
    const originalFont = ctx.font;
    ctx.font = monthFontStr;
    const w2 = ctx.measureText(monthStr + " ").width;
    ctx.font = originalFont;
    const w3 = ctx.measureText(dayStr).width;
    const totalW = w1 + w2 + w3;

    let startX = x;
    if (ctx.textAlign === 'center') startX = x - totalW / 2;
    else if (ctx.textAlign === 'right') startX = x - totalW;

    const originalAlign = ctx.textAlign;
    ctx.textAlign = 'left';

    if (layer.strokeWidth > 0) {
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.strokeWidth * (width / 1000) * Math.min(1, fontScale);

      ctx.strokeText(yearStr + " ", startX, y);
      ctx.font = monthFontStr;
      ctx.strokeText(monthStr + " ", startX + w1, y);
      ctx.font = originalFont;
      ctx.strokeText(dayStr, startX + w1 + w2, y);
    }

    ctx.fillStyle = layer.color;
    ctx.fillText(yearStr + " ", startX, y);
    ctx.font = monthFontStr;
    ctx.fillText(monthStr + " ", startX + w1, y);
    ctx.font = originalFont;
    ctx.fillText(dayStr, startX + w1 + w2, y);

    ctx.textAlign = originalAlign;
  } else {
    if (layer.strokeWidth > 0) {
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.strokeWidth * (width / 1000) * Math.min(1, fontScale);
      ctx.strokeText(displayText, x, y);
    }

    ctx.fillStyle = layer.color;
    ctx.fillText(displayText, x, y);

    if (layer.hasSuffixList && layer.selectedSuffix && displayText.trim() !== "") {
      const mainMetrics = ctx.measureText(displayText);
      const mainWidth = mainMetrics.width;

      let lastCharEndX = x;
      if (ctx.textAlign === 'left') {
        lastCharEndX = x + mainWidth;
      } else if (ctx.textAlign === 'center') {
        lastCharEndX = x + (mainWidth / 2);
      } else if (ctx.textAlign === 'right') {
        lastCharEndX = x;
      }

      const gap = (layer.suffixGap !== undefined ? layer.suffixGap : 4) * fontScale;
      const suffixX = lastCharEndX + gap;

      const prevFont = ctx.font;
      const prevAlign = ctx.textAlign;

      const suffixFontSize = (layer.suffixFontSize || layer.fontSize) * fontScale;
      const suffixFontFamily = layer.suffixFontFamily || layer.fontFamily;
      const matchedSuffixFont = fonts.find(f => f.name === suffixFontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(suffixFontFamily));
      const suffixFallbackAlias = matchedSuffixFont && matchedSuffixFont.name !== suffixFontFamily ? matchedSuffixFont.name : undefined;
      const suffixFontStr = buildCanvasFontSpec(suffixFontSize, suffixFontFamily, layer.isBold, layer.isItalic, true, suffixFallbackAlias);

      ctx.font = suffixFontStr;
      ctx.textAlign = 'left';

      if (layer.strokeWidth > 0) {
        ctx.strokeStyle = layer.strokeColor;
        ctx.lineWidth = layer.strokeWidth * (width / 1000) * Math.min(1, fontScale);
        ctx.strokeText(layer.selectedSuffix, suffixX, y);
      }

      ctx.fillStyle = layer.suffixColor || layer.color;
      ctx.fillText(layer.selectedSuffix, suffixX, y);

      ctx.font = prevFont;
      ctx.textAlign = prevAlign;
    }
  }

  if (layer.isUnderline && displayText.trim() !== "") {
    const metrics = ctx.measureText(displayText);
    const mWidth = metrics.width;
    const heightVal = effectiveFontSize;
    let underlineX = x;
    if (ctx.textAlign === 'center') underlineX = x - mWidth / 2;
    if (ctx.textAlign === 'right') underlineX = x - mWidth;

    let totalWidth = mWidth;
    if (layer.hasSuffixList && layer.selectedSuffix) {
      const prevFont = ctx.font;
      const suffixFontSize = (layer.suffixFontSize || layer.fontSize) * fontScale;
      const suffixFontFamily = layer.suffixFontFamily || layer.fontFamily;
      ctx.font = buildCanvasFontSpec(suffixFontSize, suffixFontFamily, layer.isBold, layer.isItalic, true);
      const sufMetrics = ctx.measureText(layer.selectedSuffix);
      const gap = (layer.suffixGap !== undefined ? layer.suffixGap : 4) * fontScale;
      totalWidth += gap + sufMetrics.width;
      ctx.font = prevFont;
    }

    ctx.beginPath();
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = Math.max(1, effectiveFontSize / 15);
    ctx.moveTo(underlineX, y + heightVal / 2);
    ctx.lineTo(underlineX + totalWidth, y + heightVal / 2);
    ctx.stroke();
  }
  ctx.restore();

  // Draw suffix line if enabled and has selected suffix
  if (drawSuffixLine && layer.hasSuffixList && layer.showSuffixLine && layer.selectedSuffix) {
    const lineCfg = getSuffixLineConfig(layer, layer.selectedSuffix, layer.suffixList?.indexOf(layer.selectedSuffix));
    if (lineCfg) {
      const baseH = refHeight || height;
      const lx1 = (lineCfg.x1 / 100) * width;
      const ly1 = (lineCfg.y1 / 100) * baseH + yShiftPx;
      const lx2 = (lineCfg.x2 / 100) * width;
      const ly2 = (lineCfg.y2 / 100) * baseH + yShiftPx;

      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = layer.suffixLineColor || layer.color;
      const lineThickness = (layer.suffixLineWidth || 3) * (width / 1000);
      ctx.lineWidth = Math.max(1, lineThickness);
      ctx.lineCap = 'round';
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.stroke();

      if (selectedLayerId === layer.id && !isLocked && !isPreviewMode && !isExporting) {
        const handleR = Math.max(5, 7 * (width / 1000));

        // Endpoint 1 Handle
        ctx.beginPath();
        ctx.arc(lx1, ly1, handleR, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, 2 * (width / 1000));
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Endpoint 2 Handle
        ctx.beginPath();
        ctx.arc(lx2, ly2, handleR, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, 2 * (width / 1000));
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/**
 * Renders layers onto a 2D canvas context with full fidelity.
 */
export async function renderLayersOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layers: TextLayer[],
  fonts: Font[],
  options: RenderLayersOptions = {}
): Promise<void> {
  const { isPreviewMode = false, selectedLayerId = null, isLocked = false, isExporting = false } = options;

  await ensureCanvasFontsLoaded(layers, fonts);

  for (const layer of layers) {
    if (layer.visible === false) continue;
    drawSingleLayer(ctx, width, height, layer, layers, fonts, {
      selectedLayerId,
      isLocked,
      isPreviewMode,
      isExporting,
      drawSuffixLine: true,
      fallbackToName: true,
    });
  }
}

export interface GroupedCardOptions {
  groupByLayerId: string;
  groupValue: string;
  items: Array<{
    id?: string;
    rowName?: string;
    values: Record<string, string>;
  }>;
  includedFieldIds: string[];
  layoutStyle: 'inline' | 'columns';
  showItemNumbers: boolean;
  fieldSeparator: string;
  startYPercent: number;
  endYPercent?: number;
  inlineXPercent: number;
  textAlign: 'left' | 'center' | 'right';
  fontScale: number;
  lineGapScale: number;
  showGroupTotal?: boolean;
  totalLabel?: string;
  includeStaticLabels?: boolean;
  autoAdjustSpace?: boolean;
  spacePaddingPercent?: number;
  // Internal overrides computed by renderGroupedCardToCanvas when background gap is spliced
  _layoutOverride?: {
    origHeight: number;
    gapTopY: number;
    deltaHeight: number;
    startYPx: number;
    maxBottomPx: number;
  };
}

export interface DetectedBlankGap {
  topY: number;
  bottomY: number;
  sampleY: number;
  origHeight: number;
}

/**
 * Scans a background template image around `anchorYPercent` to find a horizontal
 * blank band (e.g. uniform cream/white area between top header text and bottom footer text).
 */
export function detectBlankGapInImage(
  bgImage: HTMLImageElement,
  anchorYPercent: number
): DetectedBlankGap | null {
  try {
    const w = bgImage.naturalWidth || bgImage.width;
    const h = bgImage.naturalHeight || bgImage.height;
    if (!w || !h) return null;

    const scanCanvas = document.createElement("canvas");
    scanCanvas.width = w;
    scanCanvas.height = h;
    const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
    if (!scanCtx) return null;

    scanCtx.drawImage(bgImage, 0, 0, w, h);
    const imgData = scanCtx.getImageData(0, 0, w, h).data;

    const minY = Math.max(4, Math.floor(h * 0.08));
    const maxY = Math.min(h - 4, Math.floor(h * 0.94));
    const leftSampleX = Math.max(2, Math.floor(w * 0.08));
    const rightSampleX = Math.min(w - 3, Math.floor(w * 0.92));
    const sampleStep = Math.max(2, Math.floor(w / 180));

    const minGapHeight = Math.max(14, Math.round(h * 0.022));
    const blankRuns: Array<{ topY: number; bottomY: number }> = [];
    let inRun = false;
    let runStart = 0;

    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * w * 4;
      const li = rowOffset + leftSampleX * 4;
      const ri = rowOffset + rightSampleX * 4;

      const lR = imgData[li], lG = imgData[li + 1], lB = imgData[li + 2];
      const rR = imgData[ri], rG = imgData[ri + 1], rB = imgData[ri + 2];

      // Compare margin color continuity against linear edge interpolation
      const edgeDiff = Math.abs(lR - rR) + Math.abs(lG - rG) + Math.abs(lB - rB);
      let isBlankRow = edgeDiff <= 55;

      if (isBlankRow) {
        const span = Math.max(1, rightSampleX - leftSampleX);
        for (let x = leftSampleX; x <= rightSampleX; x += sampleStep) {
          const t = (x - leftSampleX) / span;
          const expR = lR + (rR - lR) * t;
          const expG = lG + (rG - lG) * t;
          const expB = lB + (rB - lB) * t;
          const idx = rowOffset + x * 4;
          const diff =
            Math.abs(imgData[idx] - expR) +
            Math.abs(imgData[idx + 1] - expG) +
            Math.abs(imgData[idx + 2] - expB);
          if (diff > 38) {
            isBlankRow = false;
            break;
          }
        }
      }

      if (isBlankRow && !inRun) {
        inRun = true;
        runStart = y;
      } else if (!isBlankRow && inRun) {
        inRun = false;
        if (y - runStart >= minGapHeight) {
          blankRuns.push({ topY: runStart, bottomY: y - 1 });
        }
      }
    }
    if (inRun && maxY - runStart >= minGapHeight) {
      blankRuns.push({ topY: runStart, bottomY: maxY });
    }

    if (blankRuns.length === 0) return null;

    const anchorYPx = (anchorYPercent / 100) * h;

    // 1. Prefer a blank band that directly contains anchorYPx (with 12px tolerance)
    let chosen = blankRuns.find(r => anchorYPx >= r.topY - 12 && anchorYPx <= r.bottomY + 12);

    // 2. Otherwise pick the closest blank band within 18% of image height
    if (!chosen) {
      let bestDist = Infinity;
      const maxSearchDist = h * 0.18;
      for (const r of blankRuns) {
        const dist = anchorYPx < r.topY
          ? r.topY - anchorYPx
          : anchorYPx > r.bottomY
          ? anchorYPx - r.bottomY
          : 0;
        if (dist < bestDist && dist <= maxSearchDist) {
          bestDist = dist;
          chosen = r;
        }
      }
    }

    if (!chosen) return null;

    // Trim 3px from top & bottom edges to avoid text antialiasing fringes when stretching
    const inset = chosen.bottomY - chosen.topY > 14 ? 3 : 1;
    const safeTop = chosen.topY + inset;
    const safeBottom = Math.max(safeTop + 2, chosen.bottomY - inset);
    const sampleY = Math.round((safeTop + safeBottom) / 2);

    return {
      topY: safeTop,
      bottomY: safeBottom,
      sampleY,
      origHeight: safeBottom - safeTop + 1,
    };
  } catch (err) {
    // Gracefully return null if canvas pixels cannot be read
    console.warn("Blank gap detection skipped:", err);
    return null;
  }
}

interface TextSegment {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  shadowBlur: number;
  shadowColor: string;
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  gapBefore?: number;
}

function parseNumericAmount(val: unknown): number {
  if (val === undefined || val === null) return 0;
  const cleaned = String(val)
    .replace(/(\/[-=]|\$[-=])\s*$/g, "")
    .replace(/,/g, "")
    .replace(/[^0-9.-]/g, "")
    .trim();
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function isNumericPriceField(layer: TextLayer): boolean {
  if (layer.type === 'number') return true;
  if (layer.isNumberLabel || layer.isListLabel || layer.type === 'date' || layer.type === 'list') return false;
  const n = (layer.name || "").toLowerCase();
  return /price|amount|cost|total|fee|money|rs|lkr|rupee|donation|value|මිල|මුදල|ගණන/.test(n);
}

/**
 * Renders a grouped image onto a 2D canvas:
 * - The grouped field is rendered once at its template position.
 * - Any linked labels for the grouped field and static label layers are rendered once.
 * - All items in the group render one after one without overlapping.
 */
export async function renderGroupedLayersOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  baseLayers: TextLayer[],
  fonts: Font[],
  options: GroupedCardOptions
): Promise<void> {
  await ensureCanvasFontsLoaded(baseLayers, fonts);

  const layoutOv = options._layoutOverride;
  const origH = layoutOv ? layoutOv.origHeight : height;
  const gapTopY = layoutOv?.gapTopY;
  const deltaHeight = layoutOv?.deltaHeight ?? 0;

  const getHeaderYOverride = (layer: TextLayer): { y: number; refHeight: number; yShiftPx: number } => {
    const origY = (layer.y / 100) * origH;
    const isBelowGap = gapTopY !== undefined && origY > gapTopY;
    const shift = isBelowGap ? deltaHeight : 0;
    return {
      y: origY + shift,
      refHeight: origH,
      yShiftPx: shift,
    };
  };

  const visibleLayers = baseLayers.filter(l => l.visible !== false);
  const firstItemValues = options.items[0]?.values || {};
  const firstRowPrepared = prepareLayersForRow(visibleLayers, {
    ...firstItemValues,
    [options.groupByLayerId]: options.groupValue,
  });

  // 1. Render static / group header layers once
  const groupLayer = firstRowPrepared.find(l => l.id === options.groupByLayerId);
  if (groupLayer) {
    const hPos = getHeaderYOverride(groupLayer);
    drawSingleLayer(ctx, width, height, groupLayer, firstRowPrepared, fonts, {
      y: hPos.y,
      refHeight: hPos.refHeight,
      yShiftPx: hPos.yShiftPx,
      fallbackToName: false,
      drawSuffixLine: true,
      isPreviewMode: true,
      isExporting: true,
    });
  }

  // Render any label layers linked directly to the grouped field (e.g. list label or number words for group)
  for (const layer of firstRowPrepared) {
    if (layer.id === options.groupByLayerId) continue;
    const isLinkedToGroup =
      (layer.isListLabel && layer.linkedListId === options.groupByLayerId) ||
      (layer.isNumberLabel && layer.linkedNumberId === options.groupByLayerId);
    const isStaticHeading =
      options.includeStaticLabels !== false &&
      layer.type === 'label' &&
      !layer.isListLabel &&
      !layer.isNumberLabel &&
      !options.includedFieldIds.includes(layer.id);

    if (isLinkedToGroup || isStaticHeading) {
      const hPos = getHeaderYOverride(layer);
      drawSingleLayer(ctx, width, height, layer, firstRowPrepared, fonts, {
        y: hPos.y,
        refHeight: hPos.refHeight,
        yShiftPx: hPos.yShiftPx,
        fallbackToName: false,
        drawSuffixLine: true,
        isPreviewMode: true,
        isExporting: true,
      });
    }
  }

  // 2. Collect fields to render sequentially for each item
  const orderedFieldLayers = options.includedFieldIds
    .filter(id => id !== options.groupByLayerId)
    .map(id => visibleLayers.find(l => l.id === id))
    .filter((l): l is TextLayer => Boolean(l));

  if (orderedFieldLayers.length === 0 || options.items.length === 0) {
    return;
  }

  // Calculate vertical auto-fit scaling so entries never clip off the bottom edge
  const maxFieldFontSize = Math.max(...orderedFieldLayers.map(l => l.fontSize || 32));
  const userFontScale = Math.max(0.4, Math.min(2.0, options.fontScale || 1));
  const lineGap = Math.max(1.05, Math.min(3.0, options.lineGapScale || 1.55));

  const priceFieldsForTotal = options.showGroupTotal
    ? orderedFieldLayers.filter(isNumericPriceField)
    : [];
  const hasTotalRow = options.showGroupTotal && priceFieldsForTotal.length > 0;

  const startYPx = layoutOv
    ? layoutOv.startYPx
    : (Math.max(2, Math.min(90, options.startYPercent)) / 100) * height;
  const maxBottomPx = layoutOv
    ? layoutOv.maxBottomPx
    : (Math.max(options.startYPercent + 6, Math.min(96, options.endYPercent ?? 95)) / 100) * height;
  const availableHeight = Math.max(height * 0.06, maxBottomPx - startYPx);

  const desiredLineStep = maxFieldFontSize * userFontScale * lineGap;
  const spanBetweenCenters =
    Math.max(0, options.items.length - 1) * desiredLineStep +
    (hasTotalRow ? desiredLineStep * 1.25 : 0);
  const visualHeightNeed = spanBetweenCenters + maxFieldFontSize * userFontScale * 0.6;
  const verticalFitRatio =
    !layoutOv && visualHeightNeed > availableHeight
      ? Math.max(0.35, availableHeight / visualHeightNeed)
      : 1;

  const effectiveFontScale = userFontScale * verticalFitRatio;
  const effectiveRowStep = desiredLineStep * verticalFitRatio;

  if (options.layoutStyle === 'columns') {
    // Render each entry across a single horizontal row baseline, using each field's X and alignment
    const leftmostFieldX = Math.min(...orderedFieldLayers.map(l => l.x));

    for (let idx = 0; idx < options.items.length; idx++) {
      const item = options.items[idx];
      const rowLayers = prepareLayersForRow(visibleLayers, item.values || {});
      const rowY = startYPx + idx * effectiveRowStep;

      if (options.showItemNumbers) {
        const refLayer = orderedFieldLayers[0];
        const numFontSize = Math.max(10, (refLayer.fontSize || 28) * effectiveFontScale * 0.9);
        const numX = Math.max(width * 0.03, (leftmostFieldX / 100) * width - numFontSize * 2.1);
        ctx.save();
        ctx.font = buildCanvasFontSpec(numFontSize, "sans-serif", true, false, true);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (refLayer.shadowBlur > 0) {
          ctx.shadowBlur = refLayer.shadowBlur * (width / 1000) * Math.min(1, effectiveFontScale);
          ctx.shadowColor = refLayer.shadowColor;
        }
        ctx.fillStyle = refLayer.color || "#000000";
        ctx.fillText(`${idx + 1}.`, numX + numFontSize * 1.4, rowY);
        ctx.restore();
      }

      for (const baseField of orderedFieldLayers) {
        const resolved = rowLayers.find(l => l.id === baseField.id);
        if (!resolved) continue;
        const { displayText } = resolveLayerText(resolved, rowLayers, false);
        if (!displayText.trim()) continue;

        drawSingleLayer(ctx, width, height, resolved, rowLayers, fonts, {
          y: rowY,
          fontScale: effectiveFontScale,
          fallbackToName: false,
          drawSuffixLine: false,
          isPreviewMode: true,
          isExporting: true,
        });
      }
    }

    // Group Total row in Columns mode
    if (hasTotalRow) {
      const totalY = startYPx + options.items.length * effectiveRowStep + effectiveRowStep * 0.25;
      const dividerY = totalY - effectiveRowStep * 0.55;
      const refField = priceFieldsForTotal[0];

      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = refField.color || "#000000";
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1.5, 2 * (width / 1000));
      const minColX = Math.max(width * 0.05, (leftmostFieldX / 100) * width - width * 0.08);
      const maxColX = Math.min(width * 0.95, (Math.max(...orderedFieldLayers.map(l => l.x)) / 100) * width + width * 0.12);
      ctx.moveTo(minColX, dividerY);
      ctx.lineTo(maxColX, dividerY);
      ctx.stroke();
      ctx.restore();

      // Draw total label cleanly without overlapping the price column
      const labelFontSize = Math.max(12, refField.fontSize * effectiveFontScale);
      const priceIsLeftmost = Math.abs(refField.x - leftmostFieldX) < 5;
      ctx.save();
      ctx.font = buildCanvasFontSpec(labelFontSize, "sans-serif", true, false, true);
      ctx.fillStyle = refField.color || "#000000";
      ctx.textBaseline = 'middle';
      if (priceIsLeftmost) {
        ctx.textAlign = 'right';
        ctx.fillText(options.totalLabel || "Total:", Math.max(width * 0.12, (refField.x / 100) * width - width * 0.04), totalY);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(options.totalLabel || "Total:", Math.max(width * 0.04, (leftmostFieldX / 100) * width), totalY);
      }
      ctx.restore();

      for (const pField of priceFieldsForTotal) {
        const sum = options.items.reduce((acc, it) => acc + parseNumericAmount(it.values?.[pField.id]), 0);
        const totalLayer: TextLayer = {
          ...pField,
          text: String(sum),
          isBold: true,
        };
        drawSingleLayer(ctx, width, height, totalLayer, firstRowPrepared, fonts, {
          y: totalY,
          fontScale: effectiveFontScale,
          fallbackToName: false,
          drawSuffixLine: false,
          isPreviewMode: true,
          isExporting: true,
        });
      }
    }
    return;
  }

  // 3. INLINE MODE: render each entry's selected fields sequentially one after one on one line,
  // preserving every field's own fontFamily, fontSize, color, stroke, shadow, and suffix!
  const inlineAnchorX = (Math.max(4, Math.min(96, options.inlineXPercent)) / 100) * width;
  const maxAllowedRowWidth = width * 0.92;
  const separatorStr = options.fieldSeparator ?? "  -  ";

  const drawSegmentList = (segments: TextSegment[], anchorX: number, yPos: number, align: 'left' | 'center' | 'right') => {
    if (segments.length === 0) return;

    const measureSegments = (scale: number) => {
      let total = 0;
      const widths: number[] = [];
      for (const seg of segments) {
        const matched = fonts.find(f => f.name === seg.fontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(seg.fontFamily));
        const alias = matched && matched.name !== seg.fontFamily ? matched.name : undefined;
        ctx.font = buildCanvasFontSpec(seg.fontSize * scale, seg.fontFamily, seg.isBold, seg.isItalic, true, alias);
        const w = ctx.measureText(seg.text).width;
        widths.push(w);
        total += w + (seg.gapBefore || 0) * scale;
      }
      return { total, widths };
    };

    const initialMeasure = measureSegments(1);
    const horizScale = initialMeasure.total > maxAllowedRowWidth
      ? maxAllowedRowWidth / initialMeasure.total
      : 1;

    const { total: finalTotal, widths: finalWidths } =
      horizScale < 1 ? measureSegments(horizScale) : initialMeasure;

    let cursorX = anchorX;
    if (align === 'center') cursorX = anchorX - finalTotal / 2;
    else if (align === 'right') cursorX = anchorX - finalTotal;

    // Clamp so line doesn't bleed outside canvas edges
    if (cursorX < width * 0.03) cursorX = width * 0.03;
    if (cursorX + finalTotal > width * 0.97) cursorX = Math.max(width * 0.03, width * 0.97 - finalTotal);

    segments.forEach((seg, sIdx) => {
      cursorX += (seg.gapBefore || 0) * horizScale;
      const segFontSize = Math.max(8, seg.fontSize * horizScale);
      const matched = fonts.find(f => f.name === seg.fontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(seg.fontFamily));
      const alias = matched && matched.name !== seg.fontFamily ? matched.name : undefined;

      ctx.save();
      ctx.font = buildCanvasFontSpec(segFontSize, seg.fontFamily, seg.isBold, seg.isItalic, true, alias);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      if (seg.shadowBlur > 0) {
        ctx.shadowBlur = seg.shadowBlur * (width / 1000) * Math.min(1, horizScale);
        ctx.shadowColor = seg.shadowColor;
      }

      if (seg.strokeWidth > 0) {
        ctx.strokeStyle = seg.strokeColor;
        ctx.lineWidth = seg.strokeWidth * (width / 1000) * Math.min(1, horizScale);
        ctx.strokeText(seg.text, cursorX, yPos);
      }

      ctx.fillStyle = seg.color;
      ctx.fillText(seg.text, cursorX, yPos);

      if (seg.isUnderline) {
        ctx.beginPath();
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = Math.max(1, segFontSize / 15);
        ctx.moveTo(cursorX, yPos + segFontSize / 2);
        ctx.lineTo(cursorX + finalWidths[sIdx], yPos + segFontSize / 2);
        ctx.stroke();
      }
      ctx.restore();

      cursorX += finalWidths[sIdx];
    });
  };

  for (let idx = 0; idx < options.items.length; idx++) {
    const item = options.items[idx];
    const rowLayers = prepareLayersForRow(visibleLayers, item.values || {});
    const rowY = startYPx + idx * effectiveRowStep;

    const segments: TextSegment[] = [];
    const firstField = orderedFieldLayers[0];

    if (options.showItemNumbers) {
      segments.push({
        text: `${idx + 1}. `,
        fontSize: Math.max(10, firstField.fontSize * effectiveFontScale),
        fontFamily: "sans-serif",
        color: firstField.color,
        strokeColor: firstField.strokeColor,
        strokeWidth: firstField.strokeWidth,
        shadowBlur: firstField.shadowBlur,
        shadowColor: firstField.shadowColor,
        isBold: true,
      });
    }

    let addedAnyField = false;
    for (const baseField of orderedFieldLayers) {
      const resolved = rowLayers.find(l => l.id === baseField.id);
      if (!resolved) continue;

      const { displayText, isSinhalaDate, yearStr, monthStr, dayStr } = resolveLayerText(
        resolved,
        rowLayers,
        false
      );
      if (!displayText.trim()) continue;

      if (addedAnyField && separatorStr) {
        segments.push({
          text: separatorStr,
          fontSize: Math.max(10, resolved.fontSize * effectiveFontScale * 0.85),
          fontFamily: "sans-serif",
          color: resolved.color,
          strokeColor: resolved.strokeColor,
          strokeWidth: resolved.strokeWidth,
          shadowBlur: resolved.shadowBlur,
          shadowColor: resolved.shadowColor,
        });
      }

      if (isSinhalaDate) {
        const baseFS = Math.max(8, resolved.fontSize * effectiveFontScale);
        const monthFS = Math.max(8, (resolved.sinhalaMonthFontSize || resolved.fontSize) * (width / 1000) * effectiveFontScale);
        segments.push({
          text: `${yearStr} `,
          fontSize: baseFS,
          fontFamily: resolved.fontFamily || "sans-serif",
          color: resolved.color,
          strokeColor: resolved.strokeColor,
          strokeWidth: resolved.strokeWidth,
          shadowBlur: resolved.shadowBlur,
          shadowColor: resolved.shadowColor,
          isBold: resolved.isBold,
          isItalic: resolved.isItalic,
          isUnderline: resolved.isUnderline,
        });
        segments.push({
          text: `${monthStr} `,
          fontSize: monthFS,
          fontFamily: resolved.fontFamily || "sans-serif",
          color: resolved.color,
          strokeColor: resolved.strokeColor,
          strokeWidth: resolved.strokeWidth,
          shadowBlur: resolved.shadowBlur,
          shadowColor: resolved.shadowColor,
          isBold: resolved.isBold,
          isItalic: resolved.isItalic,
          isUnderline: resolved.isUnderline,
        });
        segments.push({
          text: dayStr,
          fontSize: baseFS,
          fontFamily: resolved.fontFamily || "sans-serif",
          color: resolved.color,
          strokeColor: resolved.strokeColor,
          strokeWidth: resolved.strokeWidth,
          shadowBlur: resolved.shadowBlur,
          shadowColor: resolved.shadowColor,
          isBold: resolved.isBold,
          isItalic: resolved.isItalic,
          isUnderline: resolved.isUnderline,
        });
      } else {
        segments.push({
          text: displayText,
          fontSize: Math.max(8, resolved.fontSize * effectiveFontScale),
          fontFamily: resolved.fontFamily || "sans-serif",
          color: resolved.color,
          strokeColor: resolved.strokeColor,
          strokeWidth: resolved.strokeWidth,
          shadowBlur: resolved.shadowBlur,
          shadowColor: resolved.shadowColor,
          isBold: resolved.isBold,
          isItalic: resolved.isItalic,
          isUnderline: resolved.isUnderline,
        });

        if (resolved.hasSuffixList && resolved.selectedSuffix) {
          segments.push({
            text: resolved.selectedSuffix,
            fontSize: Math.max(8, (resolved.suffixFontSize || resolved.fontSize) * effectiveFontScale),
            fontFamily: resolved.suffixFontFamily || resolved.fontFamily || "sans-serif",
            color: resolved.suffixColor || resolved.color,
            strokeColor: resolved.strokeColor,
            strokeWidth: resolved.strokeWidth,
            shadowBlur: resolved.shadowBlur,
            shadowColor: resolved.shadowColor,
            isBold: resolved.isBold,
            isItalic: resolved.isItalic,
            isUnderline: resolved.isUnderline,
            gapBefore: (resolved.suffixGap !== undefined ? resolved.suffixGap : 4) * effectiveFontScale,
          });
        }
      }

      addedAnyField = true;
    }

    drawSegmentList(segments, inlineAnchorX, rowY, options.textAlign || 'center');
  }

  // Group Total row in Inline mode
  if (hasTotalRow) {
    const totalY = startYPx + options.items.length * effectiveRowStep + effectiveRowStep * 0.25;
    const refPriceField = priceFieldsForTotal[0];
    const totalSegments: TextSegment[] = [];

    totalSegments.push({
      text: `${options.totalLabel || "Total"}: `,
      fontSize: Math.max(10, refPriceField.fontSize * effectiveFontScale),
      fontFamily: "sans-serif",
      color: refPriceField.color,
      strokeColor: refPriceField.strokeColor,
      strokeWidth: refPriceField.strokeWidth,
      shadowBlur: refPriceField.shadowBlur,
      shadowColor: refPriceField.shadowColor,
      isBold: true,
    });

    priceFieldsForTotal.forEach((pField, pIdx) => {
      if (pIdx > 0) {
        totalSegments.push({
          text: "  |  ",
          fontSize: Math.max(10, pField.fontSize * effectiveFontScale * 0.85),
          fontFamily: "sans-serif",
          color: pField.color,
          strokeColor: pField.strokeColor,
          strokeWidth: pField.strokeWidth,
          shadowBlur: pField.shadowBlur,
          shadowColor: pField.shadowColor,
        });
      }
      const sum = options.items.reduce((acc, it) => acc + parseNumericAmount(it.values?.[pField.id]), 0);
      const linkedLbl = visibleLayers.find(l => l.linkedNumberId === pField.id);
      const effectiveMode = linkedLbl?.numberFontMode || pField.numberFontMode;
      const formattedTotal = formatNumberForCanvas(String(sum), pField.numberSuffix, pField.fontFamily, effectiveMode);

      totalSegments.push({
        text: formattedTotal,
        fontSize: Math.max(10, pField.fontSize * effectiveFontScale),
        fontFamily: pField.fontFamily || "sans-serif",
        color: pField.color,
        strokeColor: pField.strokeColor,
        strokeWidth: pField.strokeWidth,
        shadowBlur: pField.shadowBlur,
        shadowColor: pField.shadowColor,
        isBold: true,
      });
    });

    drawSegmentList(totalSegments, inlineAnchorX, totalY, options.textAlign || 'center');
  }
}

export interface GroupedRenderResult {
  width: number;
  height: number;
  originalHeight: number;
  detectedGap: DetectedBlankGap | null;
  spaceAdjusted: boolean;
  deltaHeight: number;
}

/**
 * Prepares background (auto-expanding/contracting blank gap if enabled & detected),
 * sizes the target canvas, and renders the full grouped card onto it.
 */
export async function renderGroupedCardToCanvas(
  canvas: HTMLCanvasElement,
  bgImage: HTMLImageElement | string,
  baseLayers: TextLayer[],
  fonts: Font[],
  options: GroupedCardOptions
): Promise<GroupedRenderResult> {
  const img = typeof bgImage === 'string' ? await loadImage(bgImage) : bgImage;
  const bgW = img.naturalWidth || img.width;
  const bgH = img.naturalHeight || img.height;

  const visibleLayers = baseLayers.filter(l => l.visible !== false);
  const orderedFieldLayers = options.includedFieldIds
    .filter(id => id !== options.groupByLayerId)
    .map(id => visibleLayers.find(l => l.id === id))
    .filter((l): l is TextLayer => Boolean(l));

  const detectedGap = detectBlankGapInImage(img, options.startYPercent);
  const shouldAutoAdjust =
    options.autoAdjustSpace !== false &&
    detectedGap !== null &&
    orderedFieldLayers.length > 0 &&
    options.items.length > 0;

  let finalH = bgH;
  let deltaHeight = 0;
  let finalOptions: GroupedCardOptions = options;

  if (shouldAutoAdjust && detectedGap) {
    const maxFieldFontSize = Math.max(...orderedFieldLayers.map(l => l.fontSize || 32));
    const userFontScale = Math.max(0.4, Math.min(2.0, options.fontScale || 1));
    const lineGap = Math.max(1.05, Math.min(3.0, options.lineGapScale || 1.55));
    const rowStep = maxFieldFontSize * userFontScale * lineGap;

    const priceFieldsForTotal = options.showGroupTotal
      ? orderedFieldLayers.filter(isNumericPriceField)
      : [];
    const hasTotalRow = options.showGroupTotal && priceFieldsForTotal.length > 0;

    const padPx = Math.round(Math.max(10, ((options.spacePaddingPercent ?? 2.0) / 100) * bgH));
    const singleLineVisualH = 1.15 * maxFieldFontSize * userFontScale;
    const stepCount =
      Math.max(0, options.items.length - 1) + (hasTotalRow ? 1.25 : 0);
    const textBlockHeight = stepCount * rowStep + singleLineVisualH;
    const targetGapHeight = Math.max(
      Math.round(bgH * 0.03),
      Math.round(textBlockHeight + padPx * 2)
    );

    deltaHeight = targetGapHeight - detectedGap.origHeight;
    finalH = Math.max(Math.round(bgH * 0.45), bgH + deltaHeight);

    canvas.width = bgW;
    canvas.height = finalH;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not create 2D canvas context");

    // 1. Top slice (header & lines above blank space)
    if (detectedGap.topY > 0) {
      ctx.drawImage(img, 0, 0, bgW, detectedGap.topY, 0, 0, bgW, detectedGap.topY);
    }
    // 2. Cleanly stretch the 1px middle gap slice to targetGapHeight
    ctx.drawImage(
      img,
      0,
      detectedGap.sampleY,
      bgW,
      1,
      0,
      detectedGap.topY,
      bgW,
      targetGapHeight
    );
    // 3. Bottom slice shifted cleanly by deltaHeight
    const remainingBottomH = bgH - detectedGap.bottomY;
    if (remainingBottomH > 0) {
      ctx.drawImage(
        img,
        0,
        detectedGap.bottomY,
        bgW,
        remainingBottomH,
        0,
        detectedGap.topY + targetGapHeight,
        bgW,
        remainingBottomH
      );
    }

    const row1CenterY = detectedGap.topY + padPx + (0.55 * maxFieldFontSize * userFontScale);
    finalOptions = {
      ...options,
      _layoutOverride: {
        origHeight: bgH,
        gapTopY: detectedGap.topY,
        deltaHeight,
        startYPx: row1CenterY,
        maxBottomPx: detectedGap.topY + targetGapHeight - padPx * 0.5,
      },
    };

    await renderGroupedLayersOnCanvas(ctx, bgW, finalH, baseLayers, fonts, finalOptions);
    return {
      width: bgW,
      height: finalH,
      originalHeight: bgH,
      detectedGap,
      spaceAdjusted: true,
      deltaHeight,
    };
  }

  // Fallback / Fixed-Height mode
  canvas.width = bgW;
  canvas.height = bgH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not create 2D canvas context");

  ctx.drawImage(img, 0, 0);

  // If fixed-height mode and a blank gap was detected, keep rows bounded above gap.bottomY unless user gave endYPercent
  if (
    detectedGap &&
    options.endYPercent === undefined &&
    (options.startYPercent / 100) * bgH < detectedGap.bottomY
  ) {
    finalOptions = {
      ...options,
      endYPercent: Math.max(options.startYPercent + 6, (detectedGap.bottomY / bgH) * 100),
    };
  }

  await renderGroupedLayersOnCanvas(ctx, bgW, bgH, baseLayers, fonts, finalOptions);
  return {
    width: bgW,
    height: bgH,
    originalHeight: bgH,
    detectedGap,
    spaceAdjusted: false,
    deltaHeight: 0,
  };
}

/**
 * Generates a single grouped PNG Blob combining multiple records into one card image.
 */
export async function generateGroupedCardBlob(
  bgImage: HTMLImageElement | string,
  baseLayers: TextLayer[],
  fonts: Font[],
  options: GroupedCardOptions
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await renderGroupedCardToCanvas(canvas, bgImage, baseLayers, fonts, options);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to produce PNG blob from grouped canvas"));
    }, "image/png");
  });
}

/**
 * Loads an image from a URL or data URL and returns an HTMLImageElement
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error("Failed to load background image: " + e));
    img.src = src;
  });
}

/**
 * Prepares a clone of layers for a specific row entry.
 * Auto-links number labels, list labels, and suffix choices.
 */
export function prepareLayersForRow(baseLayers: TextLayer[], rowData: Record<string, string>): TextLayer[] {
  // First clone layers
  const cloned: TextLayer[] = baseLayers.map(l => ({ ...l }));

  // Apply row values
  for (const layer of cloned) {
    if (rowData[layer.id] !== undefined) {
      layer.text = rowData[layer.id];
    }
    // Check if suffix was provided specifically
    if (rowData[`${layer.id}__suffix`] !== undefined) {
      layer.selectedSuffix = rowData[`${layer.id}__suffix`];
    }
  }

  // Next, auto-update dependent layers if not explicitly provided in rowData
  for (const layer of cloned) {
    // Number word label
    if (layer.isNumberLabel && layer.linkedNumberId) {
      const parent = cloned.find(l => l.id === layer.linkedNumberId);
      if (parent) {
        // If the user didn't specifically type an override for this label in rowData, auto-convert
        if (!rowData[layer.id] || rowData[layer.id].trim() === "") {
          const mode = parent.numberFontMode || layer.numberFontMode || 'fm';
          layer.text = convertNumberToSinhala(parent.text, mode) || "";
        }
      }
    }

    // List label
    if (layer.isListLabel && layer.linkedListId) {
      const parent = cloned.find(l => l.id === layer.linkedListId);
      if (parent) {
        if (!rowData[layer.id] || rowData[layer.id].trim() === "") {
          const optIndex = parent.options ? parent.options.indexOf(parent.text) : -1;
          if (optIndex >= 0 && parent.optionLabels && parent.optionLabels[optIndex] !== undefined) {
            layer.text = parent.optionLabels[optIndex];
          }
        }
      }
    }
  }

  return cloned;
}

/**
 * Renders a single card and returns a PNG Blob
 */
export async function generateCardBlob(
  bgImage: HTMLImageElement | string,
  layers: TextLayer[],
  fonts: Font[]
): Promise<Blob> {
  const img = typeof bgImage === 'string' ? await loadImage(bgImage) : bgImage;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not create 2D canvas context");

  ctx.drawImage(img, 0, 0);
  await renderLayersOnCanvas(ctx, canvas.width, canvas.height, layers, fonts, {
    isPreviewMode: true,
    isExporting: true,
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to produce PNG blob from canvas"));
    }, "image/png");
  });
}

/**
 * Generates cards for all rows and compiles them into a ZIP archive.
 */
export async function generateBulkCardsZip(
  bgImage: HTMLImageElement | string,
  baseLayers: TextLayer[],
  rows: Array<{ id: string; name?: string; values: Record<string, string> }>,
  fonts: Font[],
  onProgress?: (current: number, total: number, status: string) => void
): Promise<{ zipBlob: Blob; cards: BulkCardResult[] }> {
  const img = typeof bgImage === 'string' ? await loadImage(bgImage) : bgImage;
  const zip = new JSZip();
  const cards: BulkCardResult[] = [];
  const total = rows.length;

  for (let i = 0; i < total; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    const cardTitle = row.name?.trim() || `Card_${String(rowNum).padStart(2, "0")}`;
    const safeFilename = `${String(rowNum).padStart(2, "0")}_${cardTitle.replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_")}.png`;

    if (onProgress) {
      onProgress(rowNum, total, `Rendering image ${rowNum} of ${total}: ${cardTitle}...`);
    }

    const rowLayers = prepareLayersForRow(baseLayers, row.values);
    const blob = await generateCardBlob(img, rowLayers, fonts);
    const dataUrl = URL.createObjectURL(blob);

    cards.push({
      index: i,
      name: cardTitle,
      filename: safeFilename,
      blob,
      dataUrl,
      layers: rowLayers,
    });

    zip.file(safeFilename, blob);
  }

  if (onProgress) {
    onProgress(total, total, `Packaging ${total} images into ZIP archive...`);
  }

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { zipBlob, cards };
}
