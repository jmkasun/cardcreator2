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
    ctx.save();
    const fontFamily = layer.fontFamily || "sans-serif";
    const matchedFont = fonts.find(f => f.name === fontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(fontFamily));
    const fallbackAlias = matchedFont && matchedFont.name !== fontFamily ? matchedFont.name : undefined;
    const fontStr = buildCanvasFontSpec(layer.fontSize, fontFamily, layer.isBold, layer.isItalic, true, fallbackAlias);
    
    ctx.font = fontStr;
    ctx.textAlign = layer.textAlign || "center";
    ctx.textBaseline = "middle";
    
    const x = (layer.x / 100) * width;
    const y = (layer.y / 100) * height;
    
    let displayText = layer.text || layer.name || "";
    if (layer.type === 'number') {
      const linkedLabel = layers.find(l => l.linkedNumberId === layer.id);
      const effectiveMode = linkedLabel?.numberFontMode || layer.numberFontMode;
      displayText = formatNumberForCanvas(layer.text, layer.numberSuffix, layer.fontFamily, effectiveMode);
    } else if (layer.isListLabel && layer.linkedListId) {
      const parentList = layers.find(l => l.id === layer.linkedListId);
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
      const parentNumber = layers.find(l => l.id === layer.linkedNumberId);
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

    if (layer.shadowBlur > 0) {
      ctx.shadowBlur = layer.shadowBlur * (width / 1000);
      ctx.shadowColor = layer.shadowColor;
    }

    if (isSinhalaDate) {
      const monthFontSize = ((layer.sinhalaMonthFontSize || layer.fontSize) * (width / 1000));
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
        ctx.lineWidth = layer.strokeWidth * (width / 1000);
        
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
        ctx.lineWidth = layer.strokeWidth * (width / 1000);
        ctx.strokeText(displayText, x, y);
      }

      ctx.fillStyle = layer.color;
      ctx.fillText(displayText, x, y);

      if (layer.hasSuffixList && layer.selectedSuffix) {
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

        const gap = (layer.suffixGap !== undefined ? layer.suffixGap : 4);
        const suffixX = lastCharEndX + gap;

        const prevFont = ctx.font;
        const prevAlign = ctx.textAlign;

        const suffixFontSize = layer.suffixFontSize || layer.fontSize;
        const suffixFontFamily = layer.suffixFontFamily || layer.fontFamily;
        const matchedSuffixFont = fonts.find(f => f.name === suffixFontFamily || normalizeFontLookup(f.name) === normalizeFontLookup(suffixFontFamily));
        const suffixFallbackAlias = matchedSuffixFont && matchedSuffixFont.name !== suffixFontFamily ? matchedSuffixFont.name : undefined;
        const suffixFontStr = buildCanvasFontSpec(suffixFontSize, suffixFontFamily, layer.isBold, layer.isItalic, true, suffixFallbackAlias);

        ctx.font = suffixFontStr;
        ctx.textAlign = 'left';

        if (layer.strokeWidth > 0) {
          ctx.strokeStyle = layer.strokeColor;
          ctx.lineWidth = layer.strokeWidth * (width / 1000);
          ctx.strokeText(layer.selectedSuffix, suffixX, y);
        }

        ctx.fillStyle = layer.suffixColor || layer.color;
        ctx.fillText(layer.selectedSuffix, suffixX, y);

        ctx.font = prevFont;
        ctx.textAlign = prevAlign;
      }
    }

    if (layer.isUnderline) {
      const metrics = ctx.measureText(displayText);
      const mWidth = metrics.width;
      const heightVal = layer.fontSize;
      let underlineX = x;
      if (ctx.textAlign === 'center') underlineX = x - mWidth / 2;
      if (ctx.textAlign === 'right') underlineX = x - mWidth;
      
      let totalWidth = mWidth;
      if (layer.hasSuffixList && layer.selectedSuffix) {
        const prevFont = ctx.font;
        const suffixFontSize = layer.suffixFontSize || layer.fontSize;
        const suffixFontFamily = layer.suffixFontFamily || layer.fontFamily;
        ctx.font = buildCanvasFontSpec(suffixFontSize, suffixFontFamily, layer.isBold, layer.isItalic, true);
        const sufMetrics = ctx.measureText(layer.selectedSuffix);
        const gap = (layer.suffixGap !== undefined ? layer.suffixGap : 4);
        totalWidth += gap + sufMetrics.width;
        ctx.font = prevFont;
      }

      ctx.beginPath();
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = Math.max(1, layer.fontSize / 15);
      ctx.moveTo(underlineX, y + heightVal / 2);
      ctx.lineTo(underlineX + totalWidth, y + heightVal / 2);
      ctx.stroke();
    }
    ctx.restore();

    // Draw suffix line if enabled and has selected suffix
    if (layer.hasSuffixList && layer.showSuffixLine && layer.selectedSuffix) {
      const lineCfg = getSuffixLineConfig(layer, layer.selectedSuffix, layer.suffixList?.indexOf(layer.selectedSuffix));
      if (lineCfg) {
        const lx1 = (lineCfg.x1 / 100) * width;
        const ly1 = (lineCfg.y1 / 100) * height;
        const lx2 = (lineCfg.x2 / 100) * width;
        const ly2 = (lineCfg.y2 / 100) * height;

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
