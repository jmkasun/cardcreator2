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
  keepOriginalHeight?: boolean;
  spacePaddingPercent?: number;
  spaceAbsorptionScale?: number;
  breakLongLines?: boolean; // When true, breaks overly long lines at natural points (සහ, හා, comma, space) instead of heavily shrinking the font
  maxLinesPerRow?: number;  // Max lines a single item can wrap into (strictly 2 lines max)
  // Internal overrides computed by renderGroupedCardToCanvas when background gap is spliced
  _layoutOverride?: {
    origHeight: number;
    gapTopY: number;
    deltaHeight: number;
    startYPx: number;
    maxBottomPx: number;
    getShiftedY?: (origY: number) => number;
  };
}

export interface DetectedBlankGap {
  topY: number;
  bottomY: number;
  sampleY: number;
  origHeight: number;
}

export interface DetectedBlankBand {
  topY: number;
  bottomY: number;
  origHeight: number;
  sampleY: number;
}

export interface MultiGapAnalysis {
  allGaps: DetectedBlankBand[];
  mainGap: DetectedBlankBand;
  lowerGaps: DetectedBlankBand[];
  upperGaps: DetectedBlankBand[];
}

/**
 * Scans a background template image to detect ALL horizontal blank bands:
 * - The primary name/item slot around `anchorYPercent`
 * - Secondary inter-line gaps (spaces between blessing paragraphs/lines above & below)
 */
export function detectAllBlankGapsInImage(
  bgImage: HTMLImageElement,
  anchorYPercent: number
): MultiGapAnalysis | null {
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

    const minY = Math.max(4, Math.floor(h * 0.04));

    // Robustly determine the card's body background color by taking multiple margin samples
    // across y = 38%..86% instead of a single center pixel (which can hit a line of text on new templates).
    const bodySamples: Array<[number, number, number]> = [];
    const sampleMarginXs = [
      Math.max(2, Math.floor(w * 0.035)),
      Math.max(2, Math.floor(w * 0.055)),
      Math.min(w - 3, Math.floor(w * 0.945)),
      Math.min(w - 3, Math.floor(w * 0.965)),
    ];
    for (let step = 0; step < 14; step++) {
      const sy = Math.min(h - 4, Math.max(4, Math.round(h * (0.38 + (step / 13) * 0.48))));
      for (const sx of sampleMarginXs) {
        const off = (sy * w + sx) * 4;
        bodySamples.push([imgData[off], imgData[off + 1], imgData[off + 2]]);
      }
    }

    let bodyR = 255;
    let bodyG = 255;
    let bodyB = 255;
    if (bodySamples.length > 0) {
      let bestClusterIdx = 0;
      let bestClusterCount = -1;
      for (let i = 0; i < bodySamples.length; i++) {
        const [r0, g0, b0] = bodySamples[i];
        let count = 0;
        for (let j = 0; j < bodySamples.length; j++) {
          const [r1, g1, b1] = bodySamples[j];
          if (Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1) <= 28) {
            count++;
          }
        }
        if (count > bestClusterCount) {
          bestClusterCount = count;
          bestClusterIdx = i;
        }
      }
      const [refR, refG, refB] = bodySamples[bestClusterIdx];
      let sumR = 0, sumG = 0, sumB = 0, cnt = 0;
      for (const [r1, g1, b1] of bodySamples) {
        if (Math.abs(refR - r1) + Math.abs(refG - g1) + Math.abs(refB - b1) <= 28) {
          sumR += r1;
          sumG += g1;
          sumB += b1;
          cnt++;
        }
      }
      if (cnt > 0) {
        bodyR = Math.round(sumR / cnt);
        bodyG = Math.round(sumG / cnt);
        bodyB = Math.round(sumB / cnt);
      }
    }

    // Detect bottom footer banner boundary (e.g. maroon/dark address or contact bar at the bottom).
    // The footer bar must NEVER be treated as a blank compressible gap, and its full height must remain 100% intact.
    let footerBannerTopY = h;
    let seenFooterBanner = false;
    const footerCheckXs = [
      Math.max(2, Math.floor(w * 0.05)),
      Math.floor(w * 0.5),
      Math.min(w - 3, Math.floor(w * 0.95)),
    ];
    for (let y = h - 1; y >= Math.floor(h * 0.65); y--) {
      let diffHits = 0;
      for (const fx of footerCheckXs) {
        const idx = (y * w + fx) * 4;
        const diffFromBody =
          Math.abs(imgData[idx] - bodyR) +
          Math.abs(imgData[idx + 1] - bodyG) +
          Math.abs(imgData[idx + 2] - bodyB);
        if (diffFromBody > 55) diffHits++;
      }
      if (diffHits >= 2) {
        footerBannerTopY = y;
        seenFooterBanner = true;
      } else if (seenFooterBanner) {
        break;
      } else if (y < h - 4) {
        // No solid banner found within bottom 4px border margin
        break;
      }
    }

    // Safety margin: do not detect gaps within the footer banner or 2px above its border
    const maxY = Math.min(footerBannerTopY - 2, Math.min(h - 4, Math.floor(h * 0.98)));
    const leftSampleX = Math.max(2, Math.floor(w * 0.05));
    const rightSampleX = Math.min(w - 3, Math.floor(w * 0.95));
    const sampleStep = Math.max(2, Math.floor(w / 180));
    const span = Math.max(1, rightSampleX - leftSampleX);

    // Pick a margin color on a given row that closely matches body background (tolerant to a thin frame at 5%)
    const leftCandidates = [
      Math.max(2, Math.floor(w * 0.04)),
      leftSampleX,
      Math.max(2, Math.floor(w * 0.07)),
    ];
    const rightCandidates = [
      Math.min(w - 3, Math.floor(w * 0.96)),
      rightSampleX,
      Math.min(w - 3, Math.floor(w * 0.93)),
    ];

    const pickClosestToBody = (rowOffset: number, xs: number[]): { r: number; g: number; b: number; diff: number } => {
      let best = { r: bodyR, g: bodyG, b: bodyB, diff: Infinity };
      for (const x of xs) {
        const i = rowOffset + x * 4;
        const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
        const d = Math.abs(r - bodyR) + Math.abs(g - bodyG) + Math.abs(b - bodyB);
        if (d < best.diff) {
          best = { r, g, b, diff: d };
        }
      }
      return best;
    };

    // Minimal gap height to catch inter-line blank spaces between text paragraphs
    const minGapHeight = Math.max(3, Math.round(h * 0.005));
    const rawRuns: Array<{ topY: number; bottomY: number }> = [];
    let inRun = false;
    let runStart = 0;

    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * w * 4;
      const leftPick = pickClosestToBody(rowOffset, leftCandidates);
      const rightPick = pickClosestToBody(rowOffset, rightCandidates);

      // Row must match the body card background on at least both outer margins to avoid colored banners/artwork
      if (leftPick.diff > 65 || rightPick.diff > 65) {
        if (inRun) {
          inRun = false;
          if (y - runStart >= minGapHeight) {
            rawRuns.push({ topY: runStart, bottomY: y - 1 });
          }
        }
        continue;
      }

      const lR = leftPick.r, lG = leftPick.g, lB = leftPick.b;
      const rR = rightPick.r, rG = rightPick.g, rB = rightPick.b;

      let nonBgCount = 0;
      let totalChecked = 0;

      for (let x = leftSampleX; x <= rightSampleX; x += sampleStep) {
        totalChecked++;
        const t = (x - leftSampleX) / span;
        const expR = lR + (rR - lR) * t;
        const expG = lG + (rG - lG) * t;
        const expB = lB + (rB - lB) * t;
        const idx = rowOffset + x * 4;
        const diff =
          Math.abs(imgData[idx] - expR) +
          Math.abs(imgData[idx + 1] - expG) +
          Math.abs(imgData[idx + 2] - expB);
        if (diff > 36) {
          nonBgCount++;
        }
      }

      // If less than 1.5% pixels deviate, this row is considered a blank background slice
      const isBlankRow = totalChecked > 0 && (nonBgCount / totalChecked) < 0.015;

      if (isBlankRow && !inRun) {
        inRun = true;
        runStart = y;
      } else if (!isBlankRow && inRun) {
        inRun = false;
        if (y - runStart >= minGapHeight) {
          rawRuns.push({ topY: runStart, bottomY: y - 1 });
        }
      }
    }

    if (inRun && maxY - runStart >= minGapHeight) {
      rawRuns.push({ topY: runStart, bottomY: maxY });
    }

    if (rawRuns.length === 0) return null;

    // Merge adjacent runs separated by 1 or 2 stray noise pixels
    const mergedRuns: Array<{ topY: number; bottomY: number }> = [];
    for (const r of rawRuns) {
      if (mergedRuns.length === 0) {
        mergedRuns.push({ ...r });
      } else {
        const last = mergedRuns[mergedRuns.length - 1];
        if (r.topY - last.bottomY <= 2) {
          last.bottomY = r.bottomY;
        } else {
          mergedRuns.push({ ...r });
        }
      }
    }

    const allGaps: DetectedBlankBand[] = mergedRuns.map(r => {
      const origHeight = r.bottomY - r.topY + 1;
      const sampleY = Math.round((r.topY + r.bottomY) / 2);
      return {
        topY: r.topY,
        bottomY: r.bottomY,
        origHeight,
        sampleY,
      };
    });

    const anchorYPx = (anchorYPercent / 100) * h;
    const prominentMinH = Math.max(24, Math.round(h * 0.032));
    const searchDist = h * 0.36;

    const gapDistToAnchor = (r: DetectedBlankBand): number =>
      anchorYPx < r.topY
        ? r.topY - anchorYPx
        : anchorYPx > r.bottomY
        ? anchorYPx - r.bottomY
        : 0;

    const nearby = allGaps.filter(r => gapDistToAnchor(r) <= searchDist);
    const nearbyProminent = nearby.filter(r => r.origHeight >= prominentMinH);

    // Determine the main gap (slot for names):
    // 1. Direct hit with tolerance, provided it isn't just a tiny inter-line gap next to the real donor blank slot
    let mainCandidate = allGaps.find(r => anchorYPx >= r.topY - 8 && anchorYPx <= r.bottomY + 8);
    if (mainCandidate && mainCandidate.origHeight < prominentMinH && nearbyProminent.length > 0) {
      mainCandidate = undefined;
    }

    // 2. Otherwise pick the tallest prominent gap (or tallest nearby gap) within searchDist of anchor
    if (!mainCandidate) {
      if (nearbyProminent.length > 0) {
        mainCandidate = nearbyProminent.reduce((prev, curr) => {
          if (Math.abs(curr.origHeight - prev.origHeight) > 8) {
            return curr.origHeight > prev.origHeight ? curr : prev;
          }
          return gapDistToAnchor(curr) < gapDistToAnchor(prev) ? curr : prev;
        });
      } else if (nearby.length > 0) {
        mainCandidate = nearby.reduce((prev, curr) => (curr.origHeight > prev.origHeight ? curr : prev));
      } else {
        const bodyProminent = allGaps.filter(
          r => r.origHeight >= prominentMinH && r.topY >= h * 0.2 && r.bottomY <= h * 0.88
        );
        const pool = bodyProminent.length > 0 ? bodyProminent : allGaps;
        mainCandidate = pool.reduce((best, curr) =>
          gapDistToAnchor(curr) < gapDistToAnchor(best) ? curr : best
        );
      }
    }

    if (!mainCandidate) return null;

    const mainGap = mainCandidate;
    const lowerGaps = allGaps
      .filter(g => g.topY > mainGap.bottomY)
      .sort((a, b) => a.topY - b.topY);
    const upperGaps = allGaps
      .filter(g => g.bottomY < mainGap.topY)
      .sort((a, b) => a.topY - b.topY);

    return {
      allGaps,
      mainGap,
      lowerGaps,
      upperGaps,
    };
  } catch (err) {
    console.warn("Multi-gap detection skipped:", err);
    return null;
  }
}

/**
 * Scans a background template image around `anchorYPercent` to find the horizontal
 * blank band (delegates to multi-gap detector).
 */
export function detectBlankGapInImage(
  bgImage: HTMLImageElement,
  anchorYPercent: number
): DetectedBlankGap | null {
  const analysis = detectAllBlankGapsInImage(bgImage, anchorYPercent);
  return analysis ? analysis.mainGap : null;
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

/**
 * Splits text segments into multiple lines at natural break points (e.g. 'සහ', 'හා', comma, space)
 * when total measured width exceeds `maxAllowedWidth`, instead of shrinking font size down to tiny illegible text.
 */
export function wrapSegmentsAtNaturalBreaks(
  segments: TextSegment[],
  maxAllowedWidth: number,
  measureSegmentWidth: (seg: TextSegment) => number,
  maxLines = 2
): TextSegment[][] {
  if (segments.length === 0) return [];
  // Cap at 2 lines max per user requirement: never break into 3 small lines
  const enforcedMaxLines = Math.min(2, Math.max(1, maxLines));
  if (enforcedMaxLines <= 1) return [segments];

  // First measure full single-line width
  let totalSingleWidth = 0;
  for (const seg of segments) {
    totalSingleWidth += measureSegmentWidth(seg) + (seg.gapBefore || 0);
  }

  // If it comfortably fits within maxAllowedWidth, keep as 1 single line
  if (totalSingleWidth <= maxAllowedWidth) {
    return [segments];
  }

  // Flatten segments into fine-grained atomic word/separator tokens so we can break cleanly
  interface AtomicToken {
    text: string;
    gapBefore: number;
    baseSegment: TextSegment;
    isPunctuationBreak: boolean; // after comma, period, or separator
    isConjunctionBreak: boolean; // before or after 'සහ', 'හා', '&', 'and'
    isSpaceBreak: boolean;
  }

  const tokens: AtomicToken[] = [];

  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const seg = segments[sIdx];
    const segText = seg.text;
    if (!segText) continue;

    // Split text into words while keeping delimiters (commas, spaces, etc.)
    const rawMatches = segText.match(/([^\s,]+|,\s*|\s+)/g) || [segText];
    let isFirstInSeg = true;

    for (let mIdx = 0; mIdx < rawMatches.length; mIdx++) {
      const piece = rawMatches[mIdx];
      const trimmed = piece.trim();
      const isComma = piece.includes(",");
      const isWhitespace = /^\s+$/.test(piece);

      // Check for natural Sinhala & English conjunctions
      const isConjunction = /^(සහ|හා|සමග|සමඟ|සහිත|හාත්|and|with|&)$/i.test(trimmed);

      tokens.push({
        text: piece,
        gapBefore: isFirstInSeg ? (seg.gapBefore || 0) : 0,
        baseSegment: seg,
        isPunctuationBreak: isComma,
        isConjunctionBreak: isConjunction,
        isSpaceBreak: isWhitespace,
      });

      isFirstInSeg = false;
    }
  }

  if (tokens.length <= 1) {
    return [segments];
  }

  // Helper to measure token width
  const tokenWidth = (tok: AtomicToken): number => {
    const mock: TextSegment = { ...tok.baseSegment, text: tok.text };
    return measureSegmentWidth(mock) + tok.gapBefore;
  };

  const tokenWidths = tokens.map(tokenWidth);
  const totalW = tokenWidths.reduce((a, b) => a + b, 0);

  // EXACTLY 2-LINE SPLIT:
  // Find the single best natural split index `i` (line 1 is tokens[0..i], line 2 is tokens[i+1..end])
  // We score each candidate based on grammatical/punctuation naturalness plus balance between line 1 and line 2.
  let bestBreakIdx = -1;
  let bestBreakScore = -Infinity;

  let currentPrefixW = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    currentPrefixW += tokenWidths[i];
    const remainingW = totalW - currentPrefixW;
    const cur = tokens[i];
    const next = tokens[i + 1];

    let naturalBonus = 0;
    if (cur.isPunctuationBreak) {
      naturalBonus += 150; // After comma
    }
    if (next.isConjunctionBreak) {
      naturalBonus += 140; // Break right before "සහ" / "හා"
    } else if (cur.isConjunctionBreak) {
      naturalBonus += 120; // Or right after "සහ" / "හා"
    } else if (cur.baseSegment !== next.baseSegment) {
      naturalBonus += 80; // Boundary between different fields
    } else if (cur.isSpaceBreak || next.isSpaceBreak) {
      naturalBonus += 50; // Normal space boundary
    } else {
      naturalBonus += 10;
    }

    // Heavy penalty if either line exceeds maxAllowedWidth
    let overflowPenalty = 0;
    if (currentPrefixW > maxAllowedWidth) {
      overflowPenalty += (currentPrefixW - maxAllowedWidth) * 1.5;
    }
    if (remainingW > maxAllowedWidth) {
      overflowPenalty += (remainingW - maxAllowedWidth) * 1.5;
    }

    // Balance penalty: prefer breaking near the middle (~50% width on each line)
    const diffFromMiddle = Math.abs(currentPrefixW - remainingW);
    const balancePenalty = (diffFromMiddle / totalW) * 80;

    const totalScore = naturalBonus - overflowPenalty - balancePenalty;
    if (totalScore > bestBreakScore) {
      bestBreakScore = totalScore;
      bestBreakIdx = i;
    }
  }

  if (bestBreakIdx !== -1) {
    const line1 = reconstructSegmentsFromTokens(tokens.slice(0, bestBreakIdx + 1));
    const line2 = reconstructSegmentsFromTokens(tokens.slice(bestBreakIdx + 1));
    return [line1, line2];
  }

  return [segments];
}

function reconstructSegmentsFromTokens(tokens: Array<{ text: string; gapBefore: number; baseSegment: TextSegment }>): TextSegment[] {
  if (tokens.length === 0) return [];
  const result: TextSegment[] = [];
  let currentSeg: TextSegment | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // Trim leading whitespace on fresh line start
    let tokText = tok.text;
    if (i === 0 && !result.length) {
      tokText = tokText.replace(/^\s+/, "");
      if (!tokText) continue;
    }

    if (
      currentSeg &&
      currentSeg.fontFamily === tok.baseSegment.fontFamily &&
      currentSeg.fontSize === tok.baseSegment.fontSize &&
      currentSeg.color === tok.baseSegment.color &&
      currentSeg.isBold === tok.baseSegment.isBold &&
      currentSeg.isItalic === tok.baseSegment.isItalic &&
      currentSeg.isUnderline === tok.baseSegment.isUnderline &&
      currentSeg.strokeWidth === tok.baseSegment.strokeWidth &&
      currentSeg.strokeColor === tok.baseSegment.strokeColor &&
      tok.gapBefore === 0
    ) {
      currentSeg.text += tokText;
    } else {
      currentSeg = {
        ...tok.baseSegment,
        text: tokText,
        gapBefore: result.length === 0 ? 0 : tok.gapBefore,
      };
      result.push(currentSeg);
    }
  }

  // Trim trailing whitespace from the last segment of the line
  if (result.length > 0) {
    const last = result[result.length - 1];
    last.text = last.text.replace(/\s+$/, "");
    if (!last.text && result.length > 1) {
      result.pop();
    }
  }

  return result;
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

function buildGroupedInlinePlans(
  ctx: CanvasRenderingContext2D,
  width: number,
  visibleLayers: TextLayer[],
  orderedFieldLayers: TextLayer[],
  fonts: Font[],
  options: GroupedCardOptions,
  effectiveFontScale: number
): Array<{ lines: TextSegment[][] }> {
  const maxAllowedRowWidth = width * 0.90;
  const separatorStr = options.fieldSeparator ?? "  -  ";
  const breakLongLines = options.breakLongLines !== false;
  const maxLinesPerRow = Math.min(2, Math.max(1, options.maxLinesPerRow || 2));

  const measureSeg = (seg: TextSegment): number => {
    const matched = fonts.find(
      f => f.name === seg.fontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(seg.fontFamily)
    );
    const alias = matched && matched.name !== seg.fontFamily ? matched.name : undefined;
    ctx.font = buildCanvasFontSpec(seg.fontSize, seg.fontFamily, seg.isBold, seg.isItalic, true, alias);
    return ctx.measureText(seg.text).width;
  };

  const itemPlans: Array<{ lines: TextSegment[][] }> = [];

  for (let idx = 0; idx < options.items.length; idx++) {
    const item = options.items[idx];
    const rowLayers = prepareLayersForRow(visibleLayers, item.values || {});
    const segments: TextSegment[] = [];
    const firstField = orderedFieldLayers[0];

    if (options.showItemNumbers && firstField) {
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

    if (breakLongLines) {
      const wrappedLines = wrapSegmentsAtNaturalBreaks(
        segments,
        maxAllowedRowWidth,
        measureSeg,
        maxLinesPerRow
      );
      itemPlans.push({ lines: wrappedLines });
    } else {
      itemPlans.push({ lines: [segments] });
    }
  }

  return itemPlans;
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
    if (layoutOv?.getShiftedY) {
      const shiftedY = layoutOv.getShiftedY(origY);
      return {
        y: shiftedY,
        refHeight: origH,
        yShiftPx: shiftedY - origY,
      };
    }
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



  // Calculate vertical auto-fit scaling so entries never clip off the bottom edge or overlap lower blessing lines
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
  const baseSublineGap = maxFieldFontSize * userFontScale * 1.15;

  // Measure actual wrapped lines first (in inline mode) so overflow protection accounts for 2-line wrapped items
  let effectiveFontScale = userFontScale;
  let effectiveRowStep = desiredLineStep;
  let effectiveSublineGap = baseSublineGap;

  if (options.layoutStyle === 'columns') {
    const spanBetweenCenters =
      Math.max(0, options.items.length - 1) * desiredLineStep +
      (hasTotalRow ? desiredLineStep * 1.25 : 0);
    const visualHeightNeed = spanBetweenCenters + maxFieldFontSize * userFontScale * 0.6;
    const verticalFitRatio =
      visualHeightNeed > availableHeight
        ? Math.max(0.35, availableHeight / visualHeightNeed)
        : 1;
    effectiveFontScale = userFontScale * verticalFitRatio;
    effectiveRowStep = desiredLineStep * verticalFitRatio;
  } else {
    const initialPlans = buildGroupedInlinePlans(
      ctx,
      width,
      visibleLayers,
      orderedFieldLayers,
      fonts,
      options,
      userFontScale
    );
    const sublineStepsCount = initialPlans.reduce((acc, p) => acc + Math.max(0, p.lines.length - 1), 0);
    const itemStepsCount = Math.max(0, initialPlans.length - 1) + (hasTotalRow ? 1.1 : 0);
    const desiredCenterSpan = sublineStepsCount * baseSublineGap + itemStepsCount * desiredLineStep;
    const allowedCenterSpan = Math.max(8, availableHeight - maxFieldFontSize * userFontScale * 0.55);

    if (desiredCenterSpan > allowedCenterSpan) {
      // First compress inter-row and subline spacing slightly before shrinking font size
      const minRowStep = maxFieldFontSize * userFontScale * Math.min(lineGap, 1.12);
      const minSublineStep = maxFieldFontSize * userFontScale * 1.02;
      const minSpacingSpan = sublineStepsCount * minSublineStep + itemStepsCount * minRowStep;

      if (minSpacingSpan <= allowedCenterSpan && desiredCenterSpan > minSpacingSpan) {
        const t = (allowedCenterSpan - minSpacingSpan) / Math.max(1, desiredCenterSpan - minSpacingSpan);
        effectiveRowStep = minRowStep + t * (desiredLineStep - minRowStep);
        effectiveSublineGap = minSublineStep + t * (baseSublineGap - minSublineStep);
      } else {
        const fitRatio = Math.max(0.45, allowedCenterSpan / Math.max(1, minSpacingSpan));
        effectiveFontScale = userFontScale * fitRatio;
        effectiveRowStep = minRowStep * fitRatio;
        effectiveSublineGap = minSublineStep * fitRatio;
      }
    }
  }

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

  // 3. INLINE MODE: render each entry's selected fields sequentially.
  // When text length is long, break into up to 2 lines at natural break points (සහ, හා, comma, space)
  // instead of reducing font size down to tiny illegible characters!
  const inlineAnchorX = (Math.max(4, Math.min(96, options.inlineXPercent)) / 100) * width;
  const maxAllowedRowWidth = width * 0.90;

  const measureSegment = (seg: TextSegment, scale: number): number => {
    const matched = fonts.find(f => f.name === seg.fontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(seg.fontFamily));
    const alias = matched && matched.name !== seg.fontFamily ? matched.name : undefined;
    ctx.font = buildCanvasFontSpec(seg.fontSize * scale, seg.fontFamily, seg.isBold, seg.isItalic, true, alias);
    return ctx.measureText(seg.text).width;
  };

  const drawSegmentList = (segments: TextSegment[], anchorX: number, yPos: number, align: 'left' | 'center' | 'right', scale = 1) => {
    if (segments.length === 0) return;

    let total = 0;
    const widths: number[] = [];
    for (const seg of segments) {
      const w = measureSegment(seg, scale);
      widths.push(w);
      total += w + (seg.gapBefore || 0) * scale;
    }

    let cursorX = anchorX;
    if (align === 'center') cursorX = anchorX - total / 2;
    else if (align === 'right') cursorX = anchorX - total;

    // Clamp so line doesn't bleed outside canvas edges
    if (cursorX < width * 0.03) cursorX = width * 0.03;
    if (cursorX + total > width * 0.97) cursorX = Math.max(width * 0.03, width * 0.97 - total);

    segments.forEach((seg, sIdx) => {
      cursorX += (seg.gapBefore || 0) * scale;
      const segFontSize = Math.max(8, seg.fontSize * scale);
      const matched = fonts.find(f => f.name === seg.fontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(seg.fontFamily));
      const alias = matched && matched.name !== seg.fontFamily ? matched.name : undefined;

      ctx.save();
      ctx.font = buildCanvasFontSpec(segFontSize, seg.fontFamily, seg.isBold, seg.isItalic, true, alias);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      if (seg.shadowBlur > 0) {
        ctx.shadowBlur = seg.shadowBlur * (width / 1000) * Math.min(1, scale);
        ctx.shadowColor = seg.shadowColor;
      }

      if (seg.strokeWidth > 0) {
        ctx.strokeStyle = seg.strokeColor;
        ctx.lineWidth = seg.strokeWidth * (width / 1000) * Math.min(1, scale);
        ctx.strokeText(seg.text, cursorX, yPos);
      }

      ctx.fillStyle = seg.color;
      ctx.fillText(seg.text, cursorX, yPos);

      if (seg.isUnderline) {
        ctx.beginPath();
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = Math.max(1, segFontSize / 15);
        ctx.moveTo(cursorX, yPos + segFontSize / 2);
        ctx.lineTo(cursorX + widths[sIdx], yPos + segFontSize / 2);
        ctx.stroke();
      }
      ctx.restore();

      cursorX += widths[sIdx];
    });
  };

  // Pre-build segments for each item so we know multiline wrapping and exact Y placement
  const itemPlans = buildGroupedInlinePlans(
    ctx,
    width,
    visibleLayers,
    orderedFieldLayers,
    fonts,
    options,
    effectiveFontScale
  );

  // Calculate vertical positions considering wrapped sublines
  const itemSublineGap = effectiveSublineGap;
  let currentY = startYPx;

  for (let idx = 0; idx < itemPlans.length; idx++) {
    const plan = itemPlans[idx];
    const lines = plan.lines;

    for (let lIdx = 0; lIdx < lines.length; lIdx++) {
      const lineSegs = lines[lIdx];
      // Check if this line still slightly exceeds width; only minor scale down if necessary
      let lineWidth = 0;
      for (const seg of lineSegs) {
        lineWidth += measureSegment(seg, 1) + (seg.gapBefore || 0);
      }
      const lineScale = lineWidth > maxAllowedRowWidth ? maxAllowedRowWidth / lineWidth : 1;

      drawSegmentList(lineSegs, inlineAnchorX, currentY, options.textAlign || 'center', lineScale);

      if (lIdx < lines.length - 1) {
        currentY += itemSublineGap;
      }
    }

    if (idx < itemPlans.length - 1) {
      currentY += effectiveRowStep;
    }
  }

  // Group Total row in Inline mode
  if (hasTotalRow) {
    const totalY = currentY + effectiveRowStep * 1.1;
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
  adjustedGapCount?: number;
  reclaimedSpacePx?: number;
  heightPreserved?: boolean;
}

/**
 * Prepares background (auto-adjusting inter-line spaces or expanding blank gap if enabled & detected),
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

  const multiGap = detectAllBlankGapsInImage(img, options.startYPercent);
  const detectedGap = multiGap ? multiGap.mainGap : null;
  const shouldAutoAdjust =
    options.autoAdjustSpace !== false &&
    detectedGap !== null &&
    orderedFieldLayers.length > 0 &&
    options.items.length > 0;

  const isFixedHeightMode = options.keepOriginalHeight !== false;

  let finalH = bgH;
  let deltaHeight = 0;
  let finalOptions: GroupedCardOptions = options;

  if (shouldAutoAdjust && detectedGap) {
    // Ensure custom fonts are ready BEFORE measuring exact wrapped line counts
    await ensureCanvasFontsLoaded(baseLayers, fonts);

    const maxFieldFontSize = Math.max(...orderedFieldLayers.map(l => l.fontSize || 32));
    const userFontScale = Math.max(0.4, Math.min(2.0, options.fontScale || 1));
    const lineGap = Math.max(1.05, Math.min(3.0, options.lineGapScale || 1.55));
    const rowStep = maxFieldFontSize * userFontScale * lineGap;
    const itemSublineGap = maxFieldFontSize * userFontScale * 1.15;

    const priceFieldsForTotal = options.showGroupTotal
      ? orderedFieldLayers.filter(isNumericPriceField)
      : [];
    const hasTotalRow = options.showGroupTotal && priceFieldsForTotal.length > 0;

    const padPx = Math.round(Math.max(6, ((options.spacePaddingPercent ?? 2.0) / 100) * bgH));
    const topVisualHalf = 0.55 * maxFieldFontSize * userFontScale;
    const bottomVisualHalf = 0.60 * maxFieldFontSize * userFontScale;

    let centerSpan = 0;
    if (options.layoutStyle !== 'columns') {
      canvas.width = bgW;
      canvas.height = bgH;
      const measureCtx = canvas.getContext("2d", { alpha: false });
      if (measureCtx) {
        const plans = buildGroupedInlinePlans(
          measureCtx,
          bgW,
          visibleLayers,
          orderedFieldLayers,
          fonts,
          options,
          userFontScale
        );
        for (let i = 0; i < plans.length; i++) {
          const lc = plans[i].lines.length;
          if (lc > 1) centerSpan += (lc - 1) * itemSublineGap;
          if (i < plans.length - 1) centerSpan += rowStep;
        }
        if (hasTotalRow) centerSpan += rowStep * 1.1;
      } else {
        centerSpan =
          Math.max(0, options.items.length - 1) * rowStep + (hasTotalRow ? rowStep * 1.1 : 0);
      }
    } else {
      centerSpan =
        Math.max(0, options.items.length - 1) * rowStep + (hasTotalRow ? rowStep * 1.25 : 0);
    }

    const textBlockHeight = topVisualHalf + centerSpan + bottomVisualHalf;

    // --- MODE 1: Fixed Image Height Mode (Adjust Inter-line Spaces without changing canvas height) ---
    if (isFixedHeightMode) {
      canvas.width = bgW;
      canvas.height = bgH;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Could not create 2D canvas context");

      const desiredMainHeight = Math.round(textBlockHeight + padPx * 2);
      const neededExtraHeight = Math.max(0, desiredMainHeight - detectedGap.origHeight);

      // Reclaim space from lower inter-line spaces (the exact gaps between blessing paragraphs)
      const lowerGaps = multiGap ? multiGap.lowerGaps : [];
      const minInterLineGap = Math.max(2, Math.round(bgH * 0.003));
      let totalCompressible = 0;
      const gapCapacities = lowerGaps.map(g => {
        const cap = Math.max(0, g.origHeight - minInterLineGap);
        totalCompressible += cap;
        return cap;
      });

      const absorptionScale = Math.max(0.1, Math.min(1.5, options.spaceAbsorptionScale ?? 1.0));
      const deltaReclaimed = totalCompressible > 0
        ? Math.min(neededExtraHeight, Math.round(totalCompressible * absorptionScale))
        : 0;

      const gapDeltas: number[] = lowerGaps.map((_g, idx) => {
        if (totalCompressible <= 0) return 0;
        return Math.round((gapCapacities[idx] / totalCompressible) * deltaReclaimed);
      });
      const sumDeltas = gapDeltas.reduce((a, b) => a + b, 0);
      if (gapDeltas.length > 0 && sumDeltas !== deltaReclaimed) {
        gapDeltas[0] += (deltaReclaimed - sumDeltas);
      }

      // 1. Draw top slice (header & lines above main blank space)
      if (detectedGap.topY > 0) {
        ctx.drawImage(img, 0, 0, bgW, detectedGap.topY, 0, 0, bgW, detectedGap.topY);
      }

      // 2. Draw expanded main gap slice
      const newMainHeight = detectedGap.origHeight + deltaReclaimed;
      ctx.drawImage(
        img,
        0,
        detectedGap.sampleY,
        bgW,
        1,
        0,
        detectedGap.topY,
        bgW,
        newMainHeight
      );

      // 3. Draw lower slices (text lines and adjusted inter-line gaps)
      interface SliceShift {
        origTop: number;
        origBottom: number;
        destTop: number;
        shift: number;
      }
      const sliceShifts: SliceShift[] = [];

      let destCursorY = detectedGap.topY + newMainHeight;
      let srcCursorY = detectedGap.bottomY + 1;

      lowerGaps.forEach((gap, idx) => {
        const textSliceH = gap.topY - srcCursorY;
        if (textSliceH > 0) {
          ctx.drawImage(img, 0, srcCursorY, bgW, textSliceH, 0, destCursorY, bgW, textSliceH);
          sliceShifts.push({
            origTop: srcCursorY,
            origBottom: gap.topY,
            destTop: destCursorY,
            shift: destCursorY - srcCursorY,
          });
          destCursorY += textSliceH;
          srcCursorY += textSliceH;
        }

        const newGapH = Math.max(0, gap.origHeight - gapDeltas[idx]);
        if (newGapH > 0) {
          ctx.drawImage(img, 0, gap.sampleY, bgW, 1, 0, destCursorY, bgW, newGapH);
          destCursorY += newGapH;
        }
        srcCursorY = gap.bottomY + 1;
      });

      const finalSliceH = bgH - srcCursorY;
      if (finalSliceH > 0) {
        ctx.drawImage(img, 0, srcCursorY, bgW, finalSliceH, 0, destCursorY, bgW, finalSliceH);
        sliceShifts.push({
          origTop: srcCursorY,
          origBottom: bgH,
          destTop: destCursorY,
          shift: destCursorY - srcCursorY,
        });
        destCursorY += finalSliceH;
      }

      const getShiftedY = (origY: number): number => {
        if (origY <= detectedGap.topY) return origY;
        if (origY <= detectedGap.bottomY) {
          const t = (origY - detectedGap.topY) / Math.max(1, detectedGap.origHeight);
          return detectedGap.topY + t * newMainHeight;
        }
        for (const s of sliceShifts) {
          if (origY >= s.origTop && origY <= s.origBottom) {
            return origY + s.shift;
          }
        }
        return origY;
      };

      // If reclaimed space is slightly shy of full desiredMainHeight, tighten top/bottom margin gently first
      const minEffectivePad = Math.max(4, Math.round(bgH * 0.006));
      const effectivePadPx =
        textBlockHeight + padPx * 2 > newMainHeight
          ? Math.max(minEffectivePad, Math.floor((newMainHeight - textBlockHeight) / 2))
          : padPx;

      const row1CenterY = detectedGap.topY + effectivePadPx + topVisualHalf;
      finalOptions = {
        ...options,
        _layoutOverride: {
          origHeight: bgH,
          gapTopY: detectedGap.topY,
          deltaHeight: 0,
          startYPx: row1CenterY,
          maxBottomPx: detectedGap.topY + newMainHeight - Math.max(2, effectivePadPx * 0.6),
          getShiftedY,
        },
      };

      await renderGroupedLayersOnCanvas(ctx, bgW, bgH, baseLayers, fonts, finalOptions);
      return {
        width: bgW,
        height: bgH,
        originalHeight: bgH,
        detectedGap,
        spaceAdjusted: true,
        deltaHeight: 0,
        adjustedGapCount: lowerGaps.length,
        reclaimedSpacePx: deltaReclaimed,
        heightPreserved: true,
      };
    }

    // --- MODE 2: Expand Canvas Height Mode (Canvas Slicing) ---
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
      heightPreserved: false,
    };
  }

  // Fallback / Fixed-Height mode when no gap auto-adjust
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
    heightPreserved: true,
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
