import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  X, Plus, Trash2, Edit2, Upload, Download, FileSpreadsheet, FileJson,
  Database, Search, ArrowRight, ArrowLeftRight,
  RefreshCw, Layers, Share2, CheckCircle2, Save,
  Wand2, Copy, ChevronRight, LayoutList, SlidersHorizontal,
  Eye, AlignLeft, AlignCenter, AlignRight, ArrowUp, ArrowDown,
  Image as ImageIcon, Check, ChevronDown, ChevronUp, Sparkles, Printer
} from "lucide-react";
import {
  TextLayer, Font, prepareLayersForRow, generateCardBlob, loadImage,
  GroupedCardOptions, renderGroupedCardToCanvas, generateGroupedCardBlob, GroupedRenderResult
} from "../utils/cardRenderer";
import { convertNumberToSinhala } from "../utils/sinhalaConverter";
import { isPriceLayer, parsePriceValue, formatPriceNumber } from "./BulkImageCreatorModal";
import { cn } from "../lib/utils";

export interface ProjectDataItem {
  id: string;
  projectId: string;
  username: string;
  rowName: string;
  rowValues: Record<string, string>;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

interface ImageProject {
  id: string;
  username: string;
  imageUrl: string;
  layers: TextLayer[];
  name: string;
  createdAt: string;
  isLocked?: boolean;
}

interface ProjectDataListModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ImageProject;
  image: string;
  fonts: Font[];
  user: { username: string; role: 'admin' | 'user' } | null;
  onApplyRowToCanvas: (rowValues: Record<string, string>) => void;
  onOpenInBulkCreator: (rows: Array<{ id: string; name: string; values: Record<string, string> }>) => void;
  onRecordCreationEvents: (count: number, type?: 'copy' | 'download' | 'share') => Promise<void>;
  onNotification: (notif: { message: string; type: 'success' | 'error' | 'info' }) => void;
}

/**
 * Normalizes field names for smart auto-matching (lowercase alphanumeric)
 */
function normalizeFieldName(str: string): string {
  return String(str || "")
    .toLowerCase()
    .replace(/[\s_\-\.]+/g, "")
    .trim();
}

/**
 * Flattens a nested object into single-level dot-notation keys for JSON import
 */
function flattenObject(obj: Record<string, any>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val === null || val === undefined) {
      out[fullKey] = "";
    } else if (typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      Object.assign(out, flattenObject(val, fullKey));
    } else if (Array.isArray(val)) {
      out[fullKey] = val.map(v => (typeof v === "object" ? JSON.stringify(v) : String(v ?? ""))).join(", ");
    } else {
      out[fullKey] = String(val);
    }
  }
  return out;
}

/**
 * Parses CSV or TSV text cleanly handling UTF-8 BOM, quoted values, escaped quotes, and newlines inside quotes.
 */
function parseCsvContent(rawText: string): { fields: string[]; records: Array<Record<string, string>> } {
  const text = rawText.replace(/^\uFEFF/, "").trim();
  if (!text) return { fields: [], records: [] };

  // Detect delimiter from first line
  const firstLineEnd = text.search(/\r?\n/);
  const firstLine = firstLineEnd >= 0 ? text.slice(0, firstLineEnd) : text;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;

  let delimiter = ",";
  if (tabCount > commaCount && tabCount >= semiCount) delimiter = "\t";
  else if (semiCount > commaCount && semiCount > tabCount) delimiter = ";";

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const nextCh = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && nextCh === '"') {
        currentVal += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentVal += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentVal.trim());
        currentVal = "";
      } else if (ch === "\r" && nextCh === "\n") {
        currentRow.push(currentVal.trim());
        if (currentRow.some(cell => cell !== "")) rows.push(currentRow);
        currentRow = [];
        currentVal = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        currentRow.push(currentVal.trim());
        if (currentRow.some(cell => cell !== "")) rows.push(currentRow);
        currentRow = [];
        currentVal = "";
      } else {
        currentVal += ch;
      }
    }
  }
  currentRow.push(currentVal.trim());
  if (currentRow.some(cell => cell !== "")) {
    rows.push(currentRow);
  }

  if (rows.length === 0) return { fields: [], records: [] };

  const rawHeaders = rows[0];
  const fields: string[] = [];
  const usedCounts: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    const base = h.trim() || `Column ${idx + 1}`;
    usedCounts[base] = (usedCounts[base] || 0) + 1;
    fields.push(usedCounts[base] > 1 ? `${base} (${usedCounts[base]})` : base);
  });

  const records = rows.slice(1).map(row => {
    const rec: Record<string, string> = {};
    fields.forEach((f, idx) => {
      rec[f] = row[idx] !== undefined ? row[idx] : "";
    });
    return rec;
  });

  return { fields, records };
}

/**
 * Parses JSON text supporting array of objects, wrapped array properties, or 2D arrays.
 */
function parseJsonContent(rawText: string): { fields: string[]; records: Array<Record<string, string>> } {
  const parsed = JSON.parse(rawText.replace(/^\uFEFF/, "").trim());
  let arrayData: any[] | null = null;

  if (Array.isArray(parsed)) {
    arrayData = parsed;
  } else if (parsed && typeof parsed === "object") {
    const preferredKeys = ["data", "rows", "items", "records", "list", "entries", "results"];
    for (const k of preferredKeys) {
      if (Array.isArray(parsed[k])) {
        arrayData = parsed[k];
        break;
      }
    }
    if (!arrayData) {
      for (const k of Object.keys(parsed)) {
        if (Array.isArray(parsed[k])) {
          arrayData = parsed[k];
          break;
        }
      }
    }
    if (!arrayData) {
      arrayData = [parsed];
    }
  }

  if (!arrayData || arrayData.length === 0) {
    return { fields: [], records: [] };
  }

  // Handle array of arrays (first row headers)
  if (Array.isArray(arrayData[0])) {
    const headers = (arrayData[0] as any[]).map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
    const records = arrayData.slice(1).map((row: any[]) => {
      const rec: Record<string, string> = {};
      headers.forEach((h, i) => {
        rec[h] = row[i] !== undefined && row[i] !== null ? String(row[i]) : "";
      });
      return rec;
    });
    return { fields: headers, records };
  }

  // Array of objects
  const fieldSet = new Set<string>();
  const flatRecords: Array<Record<string, string>> = arrayData.map(item => {
    if (item && typeof item === "object") {
      const flat = flattenObject(item);
      Object.keys(flat).forEach(k => fieldSet.add(k));
      return flat;
    }
    fieldSet.add("value");
    return { value: String(item ?? "") };
  });

  return { fields: Array.from(fieldSet), records: flatRecords };
}

export interface ProjectTemplateImage {
  id: string;
  projectId: string;
  name: string;
  url: string;
  createdAt?: string;
}

export interface ImageSelectionRules {
  enabled: boolean;
  nameFieldId: string;
  maleEndings: string;
  femaleEndings: string;
  maleTemplateId: string;
  femaleTemplateId: string;
  multipleTemplateId: string;
  singleFallbackTemplateId: string;
}

export const DEFAULT_IMAGE_RULES: ImageSelectionRules = {
  enabled: true,
  nameFieldId: "",
  maleEndings: "මයා, මහතා, මහත්මයා, හිමි, ස්වාමීන් වහන්සේ, පියතුමා, Mr, Mr.",
  femaleEndings: "මිය, මහත්මිය, මෙනවිය, මෑණියන්, කන්‍යා සොහොයුරිය, Mrs, Mrs., Ms, Ms., Miss",
  maleTemplateId: "",
  femaleTemplateId: "",
  multipleTemplateId: "",
  singleFallbackTemplateId: "",
};

export interface MultiRowPreviewTarget {
  key: string;
  title: string;
  rawValue?: string;
  items: ProjectDataItem[];
  groupByLayerId?: string;
}

type GroupConfigState = {
  layoutStyle: "inline" | "columns";
  includedFieldIds: string[];
  showItemNumbers: boolean;
  fieldSeparator: string;
  startYPercent: number;
  endYPercent?: number;
  inlineXPercent: number;
  textAlign: "left" | "center" | "right";
  fontScale: number;
  lineGapScale: number;
  showGroupTotal: boolean;
  totalLabel: string;
  includeStaticLabels: boolean;
  autoAdjustSpace: boolean;
  spacePaddingPercent: number;
  breakLongLines: boolean;
  imageRules?: ImageSelectionRules;
  groupImageOverrides?: Record<string, string>;
};

const DEFAULT_GROUP_CONFIG: GroupConfigState = {
  layoutStyle: "inline",
  includedFieldIds: [],
  showItemNumbers: false,
  fieldSeparator: " - ",
  startYPercent: 38,
  endYPercent: undefined,
  inlineXPercent: 50,
  textAlign: "center",
  fontScale: 1.0,
  lineGapScale: 1.55,
  showGroupTotal: false,
  totalLabel: "Total",
  includeStaticLabels: true,
  autoAdjustSpace: true,
  spacePaddingPercent: 2.0,
  breakLongLines: true,
  imageRules: { ...DEFAULT_IMAGE_RULES },
  groupImageOverrides: {},
};

function detectDefaultNameLayerId(layers: TextLayer[], excludeLayerId = ""): string {
  const candidates = layers.filter(
    l =>
      l.id !== excludeLayerId &&
      l.type !== "date" &&
      !isPriceLayer(l) &&
      !l.isNumberLabel &&
      !l.isListLabel
  );
  const byName = candidates.find(l => /නම|name|donor|person|member|title/i.test(l.name || ""));
  if (byName) return byName.id;
  if (candidates[0]) return candidates[0].id;
  const fallback = layers.find(l => l.id !== excludeLayerId);
  return fallback?.id || layers[0]?.id || "";
}

function findEndingMatch(
  rawText: string,
  endingsCsv: string
): { token: string; length: number } | null {
  const cleanText = String(rawText || "")
    .replace(/[\s.,;:!?'"’”)\]\}]+$/g, "")
    .trim();
  if (!cleanText) return null;
  const cleanLower = cleanText.toLowerCase();

  const tokens = String(endingsCsv || "")
    .split(/[,\n]+/)
    .map(t => t.replace(/[\s.,;:!?'"’”)\]\}]+$/g, "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const token of tokens) {
    const kwLower = token.toLowerCase();
    if (cleanLower === kwLower) {
      return { token, length: kwLower.length + 100 };
    }
    if (cleanLower.endsWith(kwLower)) {
      const prevIdx = cleanLower.length - kwLower.length - 1;
      const prevChar = cleanLower[prevIdx];
      if (!prevChar || /[\s.,\-()/]/.test(prevChar)) {
        return { token, length: kwLower.length + 50 };
      }
      if (kwLower.length >= 2) {
        return { token, length: kwLower.length };
      }
    }
  }
  return null;
}

export interface ResolvedTemplateSelection {
  templateId: string; // "" = default project image, or tpl.id
  url: string;
  label: string;
  source: "manual" | "rule_male" | "rule_female" | "rule_multi" | "rule_fallback" | "default";
  reason: string;
  isManualOverride: boolean;
  detectedCategory: "multi" | "male" | "female" | "other";
  detectedDetail: string;
}

function resolveGroupOrRowImage(params: {
  items: ProjectDataItem[];
  overrideKey?: string | null;
  groupConfig: GroupConfigState;
  activeLayers: TextLayer[];
  groupByLayerId: string;
  templates: ProjectTemplateImage[];
  defaultImageUrl: string;
}): ResolvedTemplateSelection {
  const {
    items,
    overrideKey,
    groupConfig,
    activeLayers,
    groupByLayerId,
    templates,
    defaultImageUrl,
  } = params;

  const rules: ImageSelectionRules = {
    ...DEFAULT_IMAGE_RULES,
    ...(groupConfig.imageRules || {}),
  };

  const resolveTpl = (tplId?: string) => {
    if (!tplId) return { id: "", url: defaultImageUrl, name: "Default Image" };
    const found = templates.find(t => t.id === tplId);
    if (!found) return { id: "", url: defaultImageUrl, name: "Default Image" };
    return { id: found.id, url: found.url, name: found.name };
  };

  // Smart fallback to discover templates by name if not explicitly selected in rules dropdown
  const getSmartTemplateId = (ruleType: "male" | "female" | "multi" | "fallback"): string => {
    if (ruleType === "male") {
      if (rules.maleTemplateId) return rules.maleTemplateId;
      const match = templates.find(t => /male|පිරිමි|මයා|මහතා/i.test(t.name));
      return match ? match.id : "";
    }
    if (ruleType === "female") {
      if (rules.femaleTemplateId) return rules.femaleTemplateId;
      const match = templates.find(t => /female|කාන්තා|මිය|මහත්මිය/i.test(t.name));
      return match ? match.id : "";
    }
    if (ruleType === "multi") {
      if (rules.multipleTemplateId) return rules.multipleTemplateId;
      const match = templates.find(t => /multi|multiple|rows|group|පේළි|බහු/i.test(t.name));
      return match ? match.id : "";
    }
    if (ruleType === "fallback") {
      if (rules.singleFallbackTemplateId) return rules.singleFallbackTemplateId;
      const match = templates.find(t => /single|fallback|other/i.test(t.name));
      return match ? match.id : "";
    }
    return "";
  };

  // Detect category purely from data
  let detectedCategory: "multi" | "male" | "female" | "other" = "other";
  let detectedDetail = "1 record";

  if (items.length > 1) {
    detectedCategory = "multi";
    detectedDetail = `${items.length} records (Multiple Rows)`;
  } else if (items.length === 1) {
    const item = items[0];
    const targetFieldId =
      rules.nameFieldId && activeLayers.some(l => l.id === rules.nameFieldId)
        ? rules.nameFieldId
        : detectDefaultNameLayerId(activeLayers, groupByLayerId);

    const rawVal = String(item.rowValues?.[targetFieldId] ?? "").trim();
    const rawSuffix = String(item.rowValues?.[`${targetFieldId}__suffix`] ?? "").trim();
    const combined = (rawSuffix ? `${rawVal} ${rawSuffix}` : rawVal).trim() || item.rowName || "";

    let maleMatch = findEndingMatch(combined, rules.maleEndings);
    let femaleMatch = findEndingMatch(combined, rules.femaleEndings);

    // If target field did not match, scan other text fields, suffix dropdowns, and rowName
    if (!maleMatch && !femaleMatch) {
      for (const layer of activeLayers) {
        if (layer.id === targetFieldId) continue;
        if (layer.type === "date" || isPriceLayer(layer) || layer.isNumberLabel || layer.isListLabel) continue;
        const val = String(item.rowValues?.[layer.id] ?? "").trim();
        const suf = String(item.rowValues?.[`${layer.id}__suffix`] ?? "").trim();
        const full = (suf ? `${val} ${suf}` : val).trim();
        if (!full) continue;
        const m = findEndingMatch(full, rules.maleEndings);
        const f = findEndingMatch(full, rules.femaleEndings);
        if (m || f) {
          maleMatch = m;
          femaleMatch = f;
          break;
        }
      }
      if (!maleMatch && !femaleMatch && item.rowName) {
        maleMatch = findEndingMatch(item.rowName, rules.maleEndings);
        femaleMatch = findEndingMatch(item.rowName, rules.femaleEndings);
      }
    }

    if (maleMatch && (!femaleMatch || maleMatch.length >= femaleMatch.length)) {
      detectedCategory = "male";
      detectedDetail = `1 record • Name ends with "${maleMatch.token}" (Male)`;
    } else if (femaleMatch) {
      detectedCategory = "female";
      detectedDetail = `1 record • Name ends with "${femaleMatch.token}" (Female)`;
    } else {
      detectedCategory = "other";
      detectedDetail = "1 record (Other ending / Default)";
    }
  }

  // 1. Check explicit per-group / per-row selection from Preview
  const overrides = groupConfig.groupImageOverrides || {};
  if (overrideKey && Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
    const manualId = overrides[overrideKey];
    if (manualId === "" || templates.some(t => t.id === manualId)) {
      const chosen = resolveTpl(manualId);
      return {
        templateId: chosen.id,
        url: chosen.url,
        label: chosen.name,
        source: "manual",
        reason: `Selected: ${chosen.name}`,
        isManualOverride: true,
        detectedCategory,
        detectedDetail,
      };
    }
  }

  // 2. Apply automatic rules
  if (rules.enabled) {
    if (detectedCategory === "multi") {
      const multiTplId = getSmartTemplateId("multi");
      if (multiTplId) {
        const chosen = resolveTpl(multiTplId);
        if (chosen.id) {
          return {
            templateId: chosen.id,
            url: chosen.url,
            label: chosen.name,
            source: "rule_multi",
            reason: `Auto (Multiple rows): ${chosen.name}`,
            isManualOverride: false,
            detectedCategory,
            detectedDetail,
          };
        }
      }
    } else if (detectedCategory === "male") {
      const maleTplId = getSmartTemplateId("male");
      if (maleTplId) {
        const chosen = resolveTpl(maleTplId);
        if (chosen.id) {
          return {
            templateId: chosen.id,
            url: chosen.url,
            label: chosen.name,
            source: "rule_male",
            reason: `Auto (මයා/මහතා): ${chosen.name}`,
            isManualOverride: false,
            detectedCategory,
            detectedDetail,
          };
        }
      }
    } else if (detectedCategory === "female") {
      const femaleTplId = getSmartTemplateId("female");
      if (femaleTplId) {
        const chosen = resolveTpl(femaleTplId);
        if (chosen.id) {
          return {
            templateId: chosen.id,
            url: chosen.url,
            label: chosen.name,
            source: "rule_female",
            reason: `Auto (මිය/මහත්මිය): ${chosen.name}`,
            isManualOverride: false,
            detectedCategory,
            detectedDetail,
          };
        }
      }
    } else if (detectedCategory === "other") {
      const fallbackTplId = getSmartTemplateId("fallback");
      if (fallbackTplId) {
        const chosen = resolveTpl(fallbackTplId);
        if (chosen.id) {
          return {
            templateId: chosen.id,
            url: chosen.url,
            label: chosen.name,
            source: "rule_fallback",
            reason: `Auto (Single Other): ${chosen.name}`,
            isManualOverride: false,
            detectedCategory,
            detectedDetail,
          };
        }
      }
    }
  }

  // 3. Fallback to project's default background image
  return {
    templateId: "",
    url: defaultImageUrl,
    label: "Default Image",
    source: "default",
    reason: "Project Default Image",
    isManualOverride: false,
    detectedCategory,
    detectedDetail,
  };
}

export function ProjectDataListModal({
  isOpen,
  onClose,
  project,
  image,
  fonts,
  user,
  onApplyRowToCanvas,
  onOpenInBulkCreator,
  onRecordCreationEvents,
  onNotification,
}: ProjectDataListModalProps) {
  const activeLayers = useMemo(() => {
    return (project.layers || []).filter(l => l.visible !== false);
  }, [project.layers]);

  const [items, setItems] = useState<ProjectDataItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Add / Edit modal state
  const [editingItem, setEditingItem] = useState<{
    mode: "add" | "edit";
    id?: string;
    rowName: string;
    rowValues: Record<string, string>;
  } | null>(null);

  // Inline quick-editing state (tracks unsaved inline edits or directly commits on blur)
  const [editingCell, setEditingCell] = useState<{ itemId: string; layerId: string; value: string } | null>(null);

  // Import & Field Mapping wizard state
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importFileInfo, setImportFileInfo] = useState<{
    fileName: string;
    format: "csv" | "json";
    fields: string[];
    records: Array<Record<string, string>>;
  } | null>(null);
  // Maps project field key ('__rowName' or layer.id) -> uploaded field name (or '' if skipped)
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [isImporting, setIsImporting] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  // Row image generation / share state
  const [processingRowId, setProcessingRowId] = useState<string | null>(null);
  const [shareTargetCard, setShareTargetCard] = useState<{
    name: string;
    filename: string;
    blob: Blob;
    dataUrl: string;
  } | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [isConfirmExecuting, setIsConfirmExecuting] = useState(false);

  // Grouping & Grouped Image Generation state (persisted per project)
  const [groupByLayerId, setGroupByLayerIdRaw] = useState<string>("");
  const [processingGroupKey, setProcessingGroupKey] = useState<string | null>(null);
  const [previewGroupKey, setPreviewGroupKey] = useState<string | null>(null);
  const [multiRowPreviewTarget, setMultiRowPreviewTarget] = useState<MultiRowPreviewTarget | null>(null);
  const groupPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRenderingGroupPreview, setIsRenderingGroupPreview] = useState(false);
  const [groupPreviewInfo, setGroupPreviewInfo] = useState<GroupedRenderResult | null>(null);
  const [groupConfig, setGroupConfigRaw] = useState<GroupConfigState>(() => ({ ...DEFAULT_GROUP_CONFIG }));
  const [isPrefsHydrated, setIsPrefsHydrated] = useState(false);
  const hasUserEditedPrefsRef = useRef(false);
  const pendingSaveRef = useRef<{ projectId: string; groupByLayerId: string; groupConfig: GroupConfigState } | null>(null);

  // Alternative template images & conditional print rules
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplateImage[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
  const [showTemplateManagerModal, setShowTemplateManagerModal] = useState(false);
  const [showRulesInPreview, setShowRulesInPreview] = useState(false);
  const [previewSingleItemId, setPreviewSingleItemId] = useState<string | null>(null);
  const singlePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRenderingSinglePreview, setIsRenderingSinglePreview] = useState(false);
  const templateUploadInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadRoleRef = useRef<"male" | "female" | "multiple" | "fallback" | "manualGroup" | "manualSingle" | null>(null);
  const loadedImagesMapRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const setGroupConfig: React.Dispatch<React.SetStateAction<GroupConfigState>> = updater => {
    hasUserEditedPrefsRef.current = true;
    setGroupConfigRaw(updater);
  };

  // Helper to load and cache any template or default background URL
  const getLoadedImageForUrl = async (targetUrl: string): Promise<HTMLImageElement> => {
    const effectiveUrl = targetUrl || image;
    const cached = loadedImagesMapRef.current.get(effectiveUrl);
    if (cached) return cached;
    try {
      const img = await loadImage(effectiveUrl);
      loadedImagesMapRef.current.set(effectiveUrl, img);
      return img;
    } catch (err) {
      if (effectiveUrl !== image && image) {
        const defImg = loadedImagesMapRef.current.get(image) || (await loadImage(image));
        loadedImagesMapRef.current.set(image, defImg);
        return defImg;
      }
      throw err;
    }
  };

  const fetchProjectTemplates = async () => {
    if (!project.id || project.id === "temp") {
      setProjectTemplates([]);
      return;
    }
    setIsLoadingTemplates(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/templates`);
      if (res.ok) {
        const data = await res.json();
        setProjectTemplates(Array.isArray(data.templates) ? data.templates : []);
      }
    } catch (err) {
      console.error("Failed to fetch project templates:", err);
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  // Mobile keyboard responsive height
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(() => {
    if (typeof window !== "undefined" && window.visualViewport && window.innerWidth < 1024) {
      return window.visualViewport.height;
    }
    return null;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateHeight = () => {
      if (window.visualViewport && window.innerWidth < 1024) {
        setMobileViewportHeight(window.visualViewport.height);
      } else {
        setMobileViewportHeight(null);
      }
    };
    window.visualViewport?.addEventListener("resize", updateHeight);
    window.addEventListener("resize", updateHeight);
    return () => {
      window.visualViewport?.removeEventListener("resize", updateHeight);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  // Load default background image for quick reuse
  useEffect(() => {
    if (!isOpen || !image) return;
    let active = true;
    loadImage(image)
      .then(img => {
        if (active) {
          bgImageRef.current = img;
          loadedImagesMapRef.current.set(image, img);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen, image]);

  // Fetch saved project data list from DB
  const fetchProjectDataList = async () => {
    if (!project.id || project.id === "temp") return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/data-list`);
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data.items) ? data.items : []);
      } else {
        onNotification({ message: "Failed to load project saved data list", type: "error" });
      }
    } catch (err) {
      console.error("Failed to fetch project data list:", err);
      onNotification({ message: "Error loading saved data list", type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  const getSmartGroupFieldDefaults = (targetGroupLayerId: string, layers: TextLayer[]) => {
    const candidateFields = layers.filter(l => {
      if (l.id === targetGroupLayerId) return false;
      if (l.isNumberLabel && l.linkedNumberId === targetGroupLayerId) return false;
      if (l.isListLabel && l.linkedListId === targetGroupLayerId) return false;
      if (l.type === "label" && !l.isNumberLabel && !l.isListLabel) return false;
      return true;
    });
    const fallbackFields = candidateFields.length > 0
      ? candidateFields
      : layers.filter(l => l.id !== targetGroupLayerId);

    const minY = fallbackFields.length > 0
      ? Math.max(15, Math.min(72, Math.round(Math.min(...fallbackFields.map(l => l.y || 38)))))
      : 38;
    const firstField = fallbackFields[0];

    return {
      includedFieldIds: fallbackFields.map(l => l.id),
      startYPercent: minY,
      inlineXPercent: firstField ? Math.round(firstField.x) : 50,
      textAlign: (firstField?.textAlign || "center") as "left" | "center" | "right",
    };
  };

  const applyRestoredSettings = (rawSettings: { groupByLayerId?: string; groupConfig?: Partial<GroupConfigState> } | null | undefined) => {
    if (!rawSettings || typeof rawSettings !== "object") return false;
    const layerIds = new Set(activeLayers.map(l => l.id));
    const rawGroupId = typeof rawSettings.groupByLayerId === "string" ? rawSettings.groupByLayerId : "";
    const validGroupBy = rawGroupId && layerIds.has(rawGroupId) ? rawGroupId : "";
    const rawCfg = rawSettings.groupConfig && typeof rawSettings.groupConfig === "object" ? rawSettings.groupConfig : {};

    const merged: GroupConfigState = {
      ...DEFAULT_GROUP_CONFIG,
      ...rawCfg,
      showItemNumbers: typeof rawCfg.showItemNumbers === "boolean" ? rawCfg.showItemNumbers : DEFAULT_GROUP_CONFIG.showItemNumbers,
      showGroupTotal: typeof rawCfg.showGroupTotal === "boolean" ? rawCfg.showGroupTotal : DEFAULT_GROUP_CONFIG.showGroupTotal,
      autoAdjustSpace: typeof rawCfg.autoAdjustSpace === "boolean" ? rawCfg.autoAdjustSpace : DEFAULT_GROUP_CONFIG.autoAdjustSpace,
      includeStaticLabels: typeof rawCfg.includeStaticLabels === "boolean" ? rawCfg.includeStaticLabels : DEFAULT_GROUP_CONFIG.includeStaticLabels,
      breakLongLines: typeof rawCfg.breakLongLines === "boolean" ? rawCfg.breakLongLines : DEFAULT_GROUP_CONFIG.breakLongLines,
      imageRules: {
        ...DEFAULT_IMAGE_RULES,
        ...(rawCfg.imageRules && typeof rawCfg.imageRules === "object" ? rawCfg.imageRules : {}),
      },
      groupImageOverrides:
        rawCfg.groupImageOverrides && typeof rawCfg.groupImageOverrides === "object"
          ? { ...rawCfg.groupImageOverrides }
          : {},
    };

    if (Array.isArray(rawCfg.includedFieldIds)) {
      const validIncluded = rawCfg.includedFieldIds.filter(id => layerIds.has(id) && id !== validGroupBy);
      if (validIncluded.length > 0) {
        merged.includedFieldIds = validIncluded;
      } else if (rawCfg.includedFieldIds.length === 0) {
        merged.includedFieldIds = [];
      } else if (validGroupBy) {
        merged.includedFieldIds = getSmartGroupFieldDefaults(validGroupBy, activeLayers).includedFieldIds;
      }
    } else if (validGroupBy) {
      merged.includedFieldIds = getSmartGroupFieldDefaults(validGroupBy, activeLayers).includedFieldIds;
    }

    setGroupByLayerIdRaw(validGroupBy);
    setGroupConfigRaw(merged);
    return true;
  };

  const handleGroupByChange = (nextLayerId: string) => {
    hasUserEditedPrefsRef.current = true;
    setGroupByLayerIdRaw(nextLayerId);
    if (!nextLayerId) {
      setPreviewGroupKey(null);
      return;
    }
    const smart = getSmartGroupFieldDefaults(nextLayerId, activeLayers);
    setGroupConfigRaw(prev => ({
      ...prev,
      ...smart,
    }));
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchProjectDataList();
    fetchProjectTemplates();
    setSelectedIds(new Set());
    setShowImportWizard(false);
    setEditingItem(null);
    setPreviewGroupKey(null);
    setMultiRowPreviewTarget(null);
    setPreviewSingleItemId(null);
    setShowTemplateManagerModal(false);

    let cancelled = false;
    hasUserEditedPrefsRef.current = false;
    setIsPrefsHydrated(false);

    const storageKey = `project_data_list_settings_${project.id}`;
    let restoredFromLocal = false;
    try {
      const localRaw = localStorage.getItem(storageKey);
      if (localRaw) {
        restoredFromLocal = applyRestoredSettings(JSON.parse(localRaw));
      }
    } catch {
      // ignore invalid localStorage cache
    }

    if (!restoredFromLocal) {
      setGroupByLayerIdRaw("");
      setGroupConfigRaw({ ...DEFAULT_GROUP_CONFIG });
    }

    if (project.id && project.id !== "temp") {
      fetch(`/api/projects/${encodeURIComponent(project.id)}/data-list/settings`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (cancelled || hasUserEditedPrefsRef.current) return;
          if (data?.settings) {
            applyRestoredSettings(data.settings);
            try {
              localStorage.setItem(storageKey, JSON.stringify({
                groupByLayerId: data.settings.groupByLayerId || "",
                groupConfig: { ...DEFAULT_GROUP_CONFIG, ...(data.settings.groupConfig || {}) },
              }));
            } catch {
              // ignore storage quota errors
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsPrefsHydrated(true);
        });
    } else {
      setIsPrefsHydrated(true);
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, project.id]);

  // Persist Group By and group layout settings automatically to localStorage + DB
  useEffect(() => {
    if (!isOpen || !isPrefsHydrated || !project.id || !hasUserEditedPrefsRef.current) return;

    const storageKey = `project_data_list_settings_${project.id}`;
    const payload = { groupByLayerId, groupConfig };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // ignore storage quota errors
    }

    if (project.id === "temp") return;
    pendingSaveRef.current = { projectId: project.id, groupByLayerId, groupConfig };

    const timer = window.setTimeout(() => {
      const pending = pendingSaveRef.current;
      if (!pending) return;
      pendingSaveRef.current = null;
      fetch(`/api/projects/${encodeURIComponent(pending.projectId)}/data-list/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupByLayerId: pending.groupByLayerId,
          groupConfig: pending.groupConfig,
        }),
      }).catch(() => {});
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, isPrefsHydrated, project.id, groupByLayerId, groupConfig]);

  // Flush any pending DB settings save immediately when closing the modal
  useEffect(() => {
    if (isOpen || !pendingSaveRef.current) return;
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    fetch(`/api/projects/${encodeURIComponent(pending.projectId)}/data-list/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        groupByLayerId: pending.groupByLayerId,
        groupConfig: pending.groupConfig,
      }),
    }).catch(() => {});
  }, [isOpen]);

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item => {
      if (item.rowName?.toLowerCase().includes(q)) return true;
      return Object.values(item.rowValues || {}).some(v => String(v).toLowerCase().includes(q));
    });
  }, [items, searchQuery]);

  // Price column totals
  const priceTotals = useMemo(() => {
    const map: Record<string, { label: string; total: number }> = {};
    activeLayers.forEach(layer => {
      if (isPriceLayer(layer)) {
        let sum = 0;
        filteredItems.forEach(item => {
          sum += parsePriceValue(item.rowValues?.[layer.id]);
        });
        map[layer.id] = { label: layer.name || "Price", total: sum };
      }
    });
    return map;
  }, [activeLayers, filteredItems]);

  // Grouped entries when groupByLayerId is active
  const groupedEntries = useMemo(() => {
    if (!groupByLayerId) return [];
    const groupLayer = activeLayers.find(l => l.id === groupByLayerId);
    const groupsMap = new Map<string, {
      key: string;
      rawValue: string;
      displayValue: string;
      items: ProjectDataItem[];
      priceTotals: Array<{ layerId: string; label: string; total: number }>;
    }>();

    filteredItems.forEach(item => {
      const rawVal = String(item.rowValues?.[groupByLayerId] ?? "").trim();
      const key = rawVal || "__empty__";
      const displayValue = rawVal || "(Empty)";
      let bucket = groupsMap.get(key);
      if (!bucket) {
        bucket = {
          key,
          rawValue: rawVal,
          displayValue,
          items: [],
          priceTotals: [],
        };
        groupsMap.set(key, bucket);
      }
      bucket.items.push(item);
    });

    const priceLayers = activeLayers.filter(l => l.id !== groupByLayerId && isPriceLayer(l));
    const list = Array.from(groupsMap.values()).map(g => {
      g.priceTotals = priceLayers.map(pl => ({
        layerId: pl.id,
        label: pl.name || "Total",
        total: g.items.reduce((sum, it) => sum + parsePriceValue(it.rowValues?.[pl.id]), 0),
      }));
      return g;
    });

    if (groupLayer?.type === "date") {
      list.sort((a, b) => {
        if (a.key === "__empty__") return 1;
        if (b.key === "__empty__") return -1;
        return b.displayValue.localeCompare(a.displayValue);
      });
    }

    return list;
  }, [filteredItems, groupByLayerId, activeLayers]);

  const activePreviewGroup = useMemo(() => {
    if (multiRowPreviewTarget) {
      return {
        key: multiRowPreviewTarget.key,
        rawValue: multiRowPreviewTarget.rawValue ?? "",
        displayValue: multiRowPreviewTarget.title,
        items: multiRowPreviewTarget.items,
        groupByLayerId: multiRowPreviewTarget.groupByLayerId ?? groupByLayerId ?? "",
      };
    }
    if (!previewGroupKey) return null;
    const found = groupedEntries.find(g => g.key === previewGroupKey);
    if (!found) return null;
    return {
      key: found.key,
      rawValue: found.rawValue,
      displayValue: found.displayValue,
      items: found.items,
      groupByLayerId,
    };
  }, [groupedEntries, previewGroupKey, multiRowPreviewTarget, groupByLayerId]);

  const otherDisplayLayers = useMemo(() => {
    if (!groupByLayerId) return activeLayers;
    const orderedIds = groupConfig.includedFieldIds.filter(id => id !== groupByLayerId);
    const orderedSet = new Set(orderedIds);
    const remaining = activeLayers.filter(l => l.id !== groupByLayerId && !orderedSet.has(l.id));
    const ordered = orderedIds
      .map(id => activeLayers.find(l => l.id === id))
      .filter((l): l is TextLayer => Boolean(l));
    return [...ordered, ...remaining];
  }, [activeLayers, groupByLayerId, groupConfig.includedFieldIds]);

  const activeSinglePreviewItem = useMemo(() => {
    if (!previewSingleItemId) return null;
    return items.find(i => i.id === previewSingleItemId) || null;
  }, [items, previewSingleItemId]);

  const activePreviewGroupSelection = useMemo(() => {
    if (!activePreviewGroup) return null;
    return resolveGroupOrRowImage({
      items: activePreviewGroup.items,
      overrideKey: activePreviewGroup.key,
      groupConfig,
      activeLayers,
      groupByLayerId: activePreviewGroup.groupByLayerId || groupByLayerId || "",
      templates: projectTemplates,
      defaultImageUrl: image,
    });
  }, [activePreviewGroup, groupConfig, activeLayers, groupByLayerId, projectTemplates, image]);

  const activeSinglePreviewSelection = useMemo(() => {
    if (!activeSinglePreviewItem) return null;
    return resolveGroupOrRowImage({
      items: [activeSinglePreviewItem],
      overrideKey: `row_${activeSinglePreviewItem.id}`,
      groupConfig,
      activeLayers,
      groupByLayerId: "",
      templates: projectTemplates,
      defaultImageUrl: image,
    });
  }, [activeSinglePreviewItem, groupConfig, activeLayers, projectTemplates, image]);

  // Live render canvas for Group Image Preview Modal (using resolved or manually selected image)
  useEffect(() => {
    if (!isOpen || !activePreviewGroup || !activePreviewGroupSelection) return;
    let cancelled = false;

    const renderPreview = async () => {
      const canvas = groupPreviewCanvasRef.current;
      if (!canvas) return;
      setIsRenderingGroupPreview(true);
      try {
        const img = await getLoadedImageForUrl(activePreviewGroupSelection.url);
        if (cancelled) return;

        const effectiveGroupBy = activePreviewGroup.groupByLayerId || groupByLayerId || "";
        const options: GroupedCardOptions = {
          groupByLayerId: effectiveGroupBy,
          groupValue: activePreviewGroup.rawValue,
          items: activePreviewGroup.items.map(it => ({
            id: it.id,
            rowName: it.rowName,
            values: it.rowValues || {},
          })),
          includedFieldIds: groupConfig.includedFieldIds.length > 0
            ? groupConfig.includedFieldIds
            : activeLayers.filter(l => l.id !== effectiveGroupBy).map(l => l.id),
          layoutStyle: groupConfig.layoutStyle,
          showItemNumbers: groupConfig.showItemNumbers,
          fieldSeparator: groupConfig.fieldSeparator,
          startYPercent: groupConfig.startYPercent,
          endYPercent: groupConfig.endYPercent,
          inlineXPercent: groupConfig.inlineXPercent,
          textAlign: groupConfig.textAlign,
          fontScale: groupConfig.fontScale,
          lineGapScale: groupConfig.lineGapScale,
          showGroupTotal: groupConfig.showGroupTotal,
          totalLabel: groupConfig.totalLabel,
          includeStaticLabels: groupConfig.includeStaticLabels,
          autoAdjustSpace: groupConfig.autoAdjustSpace,
          spacePaddingPercent: groupConfig.spacePaddingPercent,
          breakLongLines: groupConfig.breakLongLines,
        };
        const result = await renderGroupedCardToCanvas(canvas, img, activeLayers, fonts, options);
        if (!cancelled) {
          setGroupPreviewInfo(result);
        }
      } catch (err) {
        console.error("Failed to render grouped preview:", err);
      } finally {
        if (!cancelled) setIsRenderingGroupPreview(false);
      }
    };

    renderPreview();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activePreviewGroup, activePreviewGroupSelection, groupByLayerId, groupConfig, activeLayers, fonts, image]);

  // Live render canvas for Single-Row Preview Modal
  useEffect(() => {
    if (!isOpen || !activeSinglePreviewItem || !activeSinglePreviewSelection) return;
    let cancelled = false;

    const renderSingle = async () => {
      const canvas = singlePreviewCanvasRef.current;
      if (!canvas) return;
      setIsRenderingSinglePreview(true);
      try {
        const img = await getLoadedImageForUrl(activeSinglePreviewSelection.url);
        if (cancelled) return;
        const rowLayers = prepareLayersForRow(activeLayers, activeSinglePreviewItem.rowValues || {});
        const blob = await generateCardBlob(img, rowLayers, fonts);
        const objUrl = URL.createObjectURL(blob);
        try {
          const rendered = await loadImage(objUrl);
          if (cancelled) return;
          canvas.width = rendered.naturalWidth || rendered.width;
          canvas.height = rendered.naturalHeight || rendered.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(rendered, 0, 0);
          }
        } finally {
          URL.revokeObjectURL(objUrl);
        }
      } catch (err) {
        console.error("Failed to render single row preview:", err);
      } finally {
        if (!cancelled) setIsRenderingSinglePreview(false);
      }
    };

    renderSingle();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeSinglePreviewItem, activeSinglePreviewSelection, activeLayers, fonts, image]);

  if (!isOpen) return null;

  // Helper to update values cleanly including linked Sinhala number words
  const updateValueWithLinks = (prevValues: Record<string, string>, layerId: string, newVal: string): Record<string, string> => {
    const next = { ...prevValues, [layerId]: newVal };
    const layer = activeLayers.find(l => l.id === layerId);
    if (layer && (layer.type === "number" || isPriceLayer(layer))) {
      activeLayers
        .filter(l => l.isNumberLabel && l.linkedNumberId === layerId)
        .forEach(lbl => {
          const mode = lbl.numberFontMode || layer.numberFontMode || "fm";
          next[lbl.id] = convertNumberToSinhala(newVal, mode) || "";
        });
    }
    return next;
  };

  // Open Add Entry dialog
  const openAddDialog = () => {
    const initialValues: Record<string, string> = {};
    activeLayers.forEach(l => {
      initialValues[l.id] = l.type === "date" ? new Date().toISOString().split("T")[0] : "";
      if (l.hasSuffixList && l.suffixList && l.suffixList.length > 0) {
        initialValues[`${l.id}__suffix`] = l.selectedSuffix || l.suffixList[0];
      }
    });
    setEditingItem({
      mode: "add",
      rowName: `${project.name} ${items.length + 1}`,
      rowValues: initialValues,
    });
  };

  // Open Edit Entry dialog
  const openEditDialog = (item: ProjectDataItem) => {
    setEditingItem({
      mode: "edit",
      id: item.id,
      rowName: item.rowName || "",
      rowValues: { ...(item.rowValues || {}) },
    });
  };

  // Save Add / Edit entry to database
  const handleSaveEntry = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingItem) return;

    setIsSaving(true);
    try {
      if (editingItem.mode === "add") {
        const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/data-list`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: user?.username || "user",
            mode: "append",
            item: {
              rowName: editingItem.rowName,
              rowValues: editingItem.rowValues,
            },
          }),
        });
        if (!res.ok) throw new Error("Failed to add entry");
        const data = await res.json();
        if (Array.isArray(data.items) && data.items.length > 0) {
          setItems(prev => [...prev, ...data.items]);
        } else {
          await fetchProjectDataList();
        }
        onNotification({ message: "Record added and saved to database!", type: "success" });
      } else if (editingItem.mode === "edit" && editingItem.id) {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(project.id)}/data-list/${encodeURIComponent(editingItem.id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rowName: editingItem.rowName,
              rowValues: editingItem.rowValues,
            }),
          }
        );
        if (!res.ok) throw new Error("Failed to update entry");
        const data = await res.json();
        if (data.item) {
          setItems(prev => prev.map(it => (it.id === data.item.id ? data.item : it)));
        }
        onNotification({ message: "Record updated in database!", type: "success" });
      }
      setEditingItem(null);
    } catch (err) {
      console.error("Error saving entry:", err);
      onNotification({ message: "Failed to save record to database", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  // Commit inline cell edit directly to DB
  const commitInlineCellEdit = async (item: ProjectDataItem, layerId: string, newValue: string) => {
    setEditingCell(null);
    const oldVal = item.rowValues?.[layerId] ?? "";
    if (oldVal === newValue) return;

    const updatedValues = updateValueWithLinks(item.rowValues || {}, layerId, newValue);
    // Optimistic update
    setItems(prev => prev.map(it => (it.id === item.id ? { ...it, rowValues: updatedValues } : it)));

    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/data-list/${encodeURIComponent(item.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowValues: updatedValues }),
        }
      );
      if (!res.ok) throw new Error("Save failed");
    } catch (err) {
      console.error("Inline save failed:", err);
      onNotification({ message: "Failed to save inline change to database", type: "error" });
      fetchProjectDataList();
    }
  };

  // Update suffix inline
  const handleInlineSuffixChange = async (item: ProjectDataItem, layerId: string, suffix: string) => {
    const updatedValues = { ...(item.rowValues || {}), [`${layerId}__suffix`]: suffix };
    setItems(prev => prev.map(it => (it.id === item.id ? { ...it, rowValues: updatedValues } : it)));
    try {
      await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/data-list/${encodeURIComponent(item.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowValues: updatedValues }),
        }
      );
    } catch {
      fetchProjectDataList();
    }
  };

  // Execute delete single row
  const executeDeleteItem = async (id: string) => {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}/data-list/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete");
      setItems(prev => prev.filter(it => it.id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      onNotification({ message: "Record deleted from database", type: "info" });
    } catch (err) {
      console.error("Delete failed:", err);
      onNotification({ message: "Failed to delete record", type: "error" });
    }
  };

  // Prompt delete single row
  const handleDeleteItem = (id: string) => {
    setConfirmDialog({
      title: "Delete Record",
      message: "Are you sure you want to delete this record from the saved list?",
      confirmLabel: "Delete",
      onConfirm: () => executeDeleteItem(id),
    });
  };

  // Execute bulk delete or clear all
  const executeBulkDelete = async (deleteAll: boolean, idsToDelete: string[]) => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/data-list/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deleteAll ? {} : { ids: idsToDelete }),
      });
      if (!res.ok) throw new Error("Bulk delete failed");

      if (deleteAll) {
        setItems([]);
        setSelectedIds(new Set());
        setEditingCell(null);
        setPreviewGroupKey(null);
        onNotification({ message: `Cleared all ${idsToDelete.length} saved record(s)`, type: "info" });
      } else {
        const removeSet = new Set(idsToDelete);
        setItems(prev => prev.filter(it => !removeSet.has(it.id)));
        setSelectedIds(new Set());
        onNotification({ message: `Deleted ${idsToDelete.length} record(s)`, type: "info" });
      }
    } catch (err) {
      console.error("Bulk delete error:", err);
      onNotification({ message: "Failed to delete records from database", type: "error" });
    }
  };

  // Delete selected rows or clear all
  const handleBulkDelete = (deleteAll = false) => {
    const idsToDelete = deleteAll ? items.map(i => i.id) : Array.from(selectedIds);
    if (idsToDelete.length === 0) return;

    setConfirmDialog({
      title: deleteAll ? "Clear All Saved Records" : "Delete Selected Records",
      message: deleteAll
        ? `Delete ALL ${items.length} saved records for "${project.name}" from the database? This cannot be undone.`
        : `Delete ${idsToDelete.length} selected record(s) from the database?`,
      confirmLabel: deleteAll ? "Clear All" : `Delete (${idsToDelete.length})`,
      onConfirm: () => executeBulkDelete(deleteAll, idsToDelete),
    });
  };

  // Auto-match uploaded fields with project fields
  const computeAutoMapping = (uploadedFields: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {};
    const normalizedUploaded = uploadedFields.map(f => ({ raw: f, norm: normalizeFieldName(f) }));

    // Match rowName
    const nameMatch = normalizedUploaded.find(u =>
      ["cardname", "rowname", "title", "label", "recordname", "id"].includes(u.norm)
    );
    mapping.__rowName = nameMatch ? nameMatch.raw : "";

    // Match each project layer
    activeLayers.forEach((layer, idx) => {
      const targetNorm = normalizeFieldName(layer.name || "");
      const idNorm = normalizeFieldName(layer.id || "");

      // 1. Exact case-insensitive / separator-insensitive match on layer name or id
      let match = normalizedUploaded.find(
        u => u.norm && (u.norm === targetNorm || u.norm === idNorm)
      );

      // 2. Partial containment match (e.g. uploaded "Donor Name" <-> project "Name")
      if (!match && targetNorm.length >= 2) {
        match = normalizedUploaded.find(
          u => u.norm && (u.norm.includes(targetNorm) || targetNorm.includes(u.norm))
        );
      }

      // 3. Fallback positional if same number of columns & no match yet? Keep empty unless confident
      if (match) {
        mapping[layer.id] = match.raw;
      } else if (uploadedFields[idx] && normalizedUploaded.length === activeLayers.length) {
        // Don't force wrong matches silently; leave empty unless exact/partial, or user can click "Match by Position"
        mapping[layer.id] = "";
      } else {
        mapping[layer.id] = "";
      }
    });

    return mapping;
  };

  // Handle file upload for JSON / CSV import
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isJson = ext === "json" || file.type.includes("json");

    const reader = new FileReader();
    reader.onload = ev => {
      const content = String(ev.target?.result || "");
      if (!content.trim()) {
        onNotification({ message: "Uploaded file is empty", type: "error" });
        return;
      }

      try {
        const parsed = isJson ? parseJsonContent(content) : parseCsvContent(content);
        if (parsed.fields.length === 0 || parsed.records.length === 0) {
          onNotification({ message: "No fields or data rows found in the uploaded file", type: "error" });
          return;
        }

        setImportFileInfo({
          fileName: file.name,
          format: isJson ? "json" : "csv",
          fields: parsed.fields,
          records: parsed.records,
        });
        setFieldMapping(computeAutoMapping(parsed.fields));
        setShowImportWizard(true);
      } catch (err) {
        console.error("File parse error:", err);
        onNotification({
          message: `Could not parse ${isJson ? "JSON" : "CSV"} file: ${err instanceof Error ? err.message : "Invalid format"}`,
          type: "error",
        });
      }
    };
    reader.readAsText(file, "UTF-8");
    if (importFileInputRef.current) importFileInputRef.current.value = "";
  };

  // Build mapped items from uploaded file + current fieldMapping
  const mappedImportPreviewRows = useMemo(() => {
    if (!importFileInfo) return [];
    return importFileInfo.records.map((rec, idx) => {
      const rowValues: Record<string, string> = {};
      activeLayers.forEach(layer => {
        const mappedSourceField = fieldMapping[layer.id];
        if (mappedSourceField && rec[mappedSourceField] !== undefined) {
          rowValues[layer.id] = String(rec[mappedSourceField]);
        } else {
          rowValues[layer.id] = "";
        }
        if (layer.hasSuffixList && layer.suffixList && layer.suffixList.length > 0) {
          rowValues[`${layer.id}__suffix`] = layer.selectedSuffix || layer.suffixList[0];
        }
      });

      // Auto-populate linked Sinhala number words if the number label itself wasn't mapped
      activeLayers.forEach(layer => {
        if (layer.isNumberLabel && layer.linkedNumberId && !fieldMapping[layer.id]) {
          const parent = activeLayers.find(l => l.id === layer.linkedNumberId);
          if (parent && rowValues[parent.id]) {
            const mode = parent.numberFontMode || layer.numberFontMode || "fm";
            rowValues[layer.id] = convertNumberToSinhala(rowValues[parent.id], mode) || "";
          }
        }
      });

      const mappedNameCol = fieldMapping.__rowName;
      const rowName =
        mappedNameCol && rec[mappedNameCol]
          ? String(rec[mappedNameCol])
          : rowValues[activeLayers[0]?.id] || `${project.name} ${idx + 1}`;

      return { rowName, rowValues };
    });
  }, [importFileInfo, fieldMapping, activeLayers, project.name]);

  // Execute confirmed import to DB
  const handleConfirmImport = async () => {
    if (!importFileInfo || mappedImportPreviewRows.length === 0) return;

    const hasAnyMappedField = activeLayers.some(l => Boolean(fieldMapping[l.id]));
    if (!hasAnyMappedField) {
      onNotification({ message: "Please match at least one uploaded field to a project field", type: "error" });
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/data-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: user?.username || "user",
          mode: importMode,
          items: mappedImportPreviewRows,
        }),
      });
      if (!res.ok) throw new Error("Failed to save imported records");

      await fetchProjectDataList();
      onNotification({
        message: `Imported and saved ${mappedImportPreviewRows.length} records to the database!`,
        type: "success",
      });
      setShowImportWizard(false);
      setImportFileInfo(null);
    } catch (err) {
      console.error("Import save failed:", err);
      onNotification({ message: "Failed to import records to database", type: "error" });
    } finally {
      setIsImporting(false);
    }
  };

  // Export saved list to CSV or JSON
  const handleExportList = (format: "csv" | "json") => {
    const targetList = selectedIds.size > 0 ? items.filter(i => selectedIds.has(i.id)) : items;
    if (targetList.length === 0) {
      onNotification({ message: "No records to export", type: "info" });
      return;
    }

    const safeName = project.name.replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_") || "Project";

    if (format === "json") {
      const payload = targetList.map(item => {
        const obj: Record<string, string> = { "Record Name": item.rowName || "" };
        activeLayers.forEach(l => {
          obj[l.name || l.id] = item.rowValues?.[l.id] || "";
        });
        return obj;
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}_Data_List.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } else {
      const headers = ["Record Name", ...activeLayers.map(l => l.name || l.id)];
      const csvRows = [
        headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(","),
        ...targetList.map(item =>
          [item.rowName || "", ...activeLayers.map(l => item.rowValues?.[l.id] || "")]
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        ),
      ];
      const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}_Data_List.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    }

    onNotification({ message: `Exported ${targetList.length} records as ${format.toUpperCase()}`, type: "success" });
  };

  // Generate & download or share a single row image directly
  const handleRowCardAction = async (item: ProjectDataItem, idx: number, action: "download" | "share") => {
    try {
      setProcessingRowId(item.id);
      const selection = resolveGroupOrRowImage({
        items: [item],
        overrideKey: `row_${item.id}`,
        groupConfig,
        activeLayers,
        groupByLayerId: "",
        templates: projectTemplates,
        defaultImageUrl: image,
      });
      const img = await getLoadedImageForUrl(selection.url);
      const cardTitle = item.rowName?.trim() || `${project.name}_${idx + 1}`;
      const safeFilename = `${String(idx + 1).padStart(2, "0")}_${cardTitle.replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_")}.png`;
      const rowLayers = prepareLayersForRow(activeLayers, item.rowValues || {});
      const blob = await generateCardBlob(img, rowLayers, fonts);
      const dataUrl = URL.createObjectURL(blob);

      if (action === "download") {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = safeFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);
        onRecordCreationEvents(1, "download").catch(() => {});
        onNotification({ message: `Downloaded "${safeFilename}" (${selection.label})`, type: "success" });
      } else {
        const file = new File([blob], safeFilename, { type: "image/png" });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: cardTitle });
            onRecordCreationEvents(1, "share").catch(() => {});
            onNotification({ message: "Card shared successfully!", type: "success" });
            setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);
            return;
          } catch (e) {
            if ((e as Error).name === "AbortError") {
              setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);
              return;
            }
          }
        }
        setShareTargetCard({ name: cardTitle, filename: safeFilename, blob, dataUrl });
      }
    } catch (err) {
      console.error("Card generation failed:", err);
      onNotification({ message: "Failed to generate card image", type: "error" });
    } finally {
      setProcessingRowId(null);
    }
  };

  // Print canvas helper using sandboxed iframe
  const handlePrintCard = (canvas: HTMLCanvasElement | null, title: string) => {
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>${title}</title>
              <style>
                @page { size: auto; margin: 0mm; }
                body { margin: 0; display: flex; align-items: center; justify-content: center; height: 100vh; background: #fff; }
                img { max-width: 100%; max-height: 100%; object-fit: contain; }
              </style>
            </head>
            <body>
              <img src="${dataUrl}" onload="window.print();" />
            </body>
          </html>
        `);
        doc.close();
        setTimeout(() => iframe.remove(), 60000);
        onRecordCreationEvents(1, "download").catch(() => {});
        onNotification({ message: `Sent "${title}" to printer`, type: "success" });
      }
    } catch (err) {
      console.error("Print failed:", err);
      onNotification({ message: "Unable to open print preview", type: "error" });
    }
  };

  // Open Preview & Print from toolbar (auto-routes to Single Record Preview or Multi-Row Preview)
  const handleOpenPreviewAndPrint = () => {
    const targetItems = selectedIds.size > 0
      ? filteredItems.filter(i => selectedIds.has(i.id))
      : filteredItems;
    if (targetItems.length === 0) {
      onNotification({ message: "No records to preview and print", type: "info" });
      return;
    }
    if (targetItems.length === 1) {
      setPreviewSingleItemId(targetItems[0].id);
      return;
    }
    const key = selectedIds.size > 0 ? "__selected_rows__" : "__all_rows__";
    const title = selectedIds.size > 0
      ? `Selected Records (${targetItems.length})`
      : `${project.name} (${targetItems.length} Records)`;
    setMultiRowPreviewTarget({
      key,
      title,
      rawValue: "",
      items: targetItems,
      groupByLayerId: groupByLayerId || "",
    });
  };

  // Generate & download or share a combined image for a group or multiple rows
  const handleGroupCardAction = async (
    group: { key: string; rawValue: string; displayValue: string; items: ProjectDataItem[]; groupByLayerId?: string },
    action: "download" | "share"
  ) => {
    try {
      setProcessingGroupKey(group.key);
      const effectiveGroupBy = group.groupByLayerId ?? groupByLayerId ?? "";
      const selection = resolveGroupOrRowImage({
        items: group.items,
        overrideKey: group.key,
        groupConfig,
        activeLayers,
        groupByLayerId: effectiveGroupBy,
        templates: projectTemplates,
        defaultImageUrl: image,
      });
      const img = await getLoadedImageForUrl(selection.url);

      const groupLayer = activeLayers.find(l => l.id === effectiveGroupBy);
      const groupTitle = effectiveGroupBy
        ? `${groupLayer?.name || "Group"}_${group.displayValue}`
        : `${project.name}_${group.displayValue}`;
      const safeFilename = `${project.name.replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_")}_${(group.displayValue || "List").replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_")}_Card.png`;

      const options: GroupedCardOptions = {
        groupByLayerId: effectiveGroupBy,
        groupValue: group.rawValue,
        items: group.items.map(it => ({
          id: it.id,
          rowName: it.rowName,
          values: it.rowValues || {},
        })),
        includedFieldIds: groupConfig.includedFieldIds.length > 0
          ? groupConfig.includedFieldIds
          : activeLayers.filter(l => l.id !== effectiveGroupBy).map(l => l.id),
        layoutStyle: groupConfig.layoutStyle,
        showItemNumbers: groupConfig.showItemNumbers,
        fieldSeparator: groupConfig.fieldSeparator,
        startYPercent: groupConfig.startYPercent,
        endYPercent: groupConfig.endYPercent,
        inlineXPercent: groupConfig.inlineXPercent,
        textAlign: groupConfig.textAlign,
        fontScale: groupConfig.fontScale,
        lineGapScale: groupConfig.lineGapScale,
        showGroupTotal: groupConfig.showGroupTotal,
        totalLabel: groupConfig.totalLabel,
        includeStaticLabels: groupConfig.includeStaticLabels,
        autoAdjustSpace: groupConfig.autoAdjustSpace,
        spacePaddingPercent: groupConfig.spacePaddingPercent,
        breakLongLines: groupConfig.breakLongLines,
      };

      const blob = await generateGroupedCardBlob(img, activeLayers, fonts, options);
      const dataUrl = URL.createObjectURL(blob);

      if (action === "download") {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = safeFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);
        onRecordCreationEvents(1, "download").catch(() => {});
        onNotification({ message: `Downloaded grouped image "${safeFilename}" (${selection.label})`, type: "success" });
      } else {
        const file = new File([blob], safeFilename, { type: "image/png" });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: groupTitle });
            onRecordCreationEvents(1, "share").catch(() => {});
            onNotification({ message: "Group card image shared successfully!", type: "success" });
            setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);
            return;
          } catch (e) {
            if ((e as Error).name === "AbortError") {
              setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);
              return;
            }
          }
        }
        setShareTargetCard({ name: groupTitle, filename: safeFilename, blob, dataUrl });
      }
    } catch (err) {
      console.error("Group card generation failed:", err);
      onNotification({ message: "Failed to generate group image", type: "error" });
    } finally {
      setProcessingGroupKey(null);
    }
  };

  // Update conditional image rules
  const updateImageRules = (patch: Partial<ImageSelectionRules>) => {
    setGroupConfig(prev => ({
      ...prev,
      imageRules: {
        ...DEFAULT_IMAGE_RULES,
        ...(prev.imageRules || {}),
        ...patch,
      },
    }));
  };

  // Set or clear manual image override for a group or single row (`null` clears override -> back to Auto rule)
  const setOverrideImageForKey = (overrideKey: string, templateId: string | null) => {
    setGroupConfig(prev => {
      const nextOverrides = { ...(prev.groupImageOverrides || {}) };
      if (templateId === null) {
        delete nextOverrides[overrideKey];
      } else {
        nextOverrides[overrideKey] = templateId;
      }
      return {
        ...prev,
        groupImageOverrides: nextOverrides,
      };
    });
  };

  const triggerTemplateUpload = (
    role: "male" | "female" | "multiple" | "fallback" | "manualGroup" | "manualSingle" | null = null
  ) => {
    if (!project.id || project.id === "temp") {
      onNotification({ message: "Save this project first before uploading extra template images", type: "info" });
      return;
    }
    pendingUploadRoleRef.current = role;
    if (templateUploadInputRef.current) {
      templateUploadInputRef.current.value = "";
      templateUploadInputRef.current.click();
    }
  };

  const handleTemplateFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onNotification({ message: "Please select an image file (PNG, JPG, WEBP)", type: "error" });
      return;
    }

    const role = pendingUploadRoleRef.current;
    pendingUploadRoleRef.current = null;
    const roleLabelMap: Record<string, string> = {
      male: "Male Template",
      female: "Female Template",
      multiple: "Multiple Rows Template",
      fallback: "Single Fallback Template",
    };
    const baseFileName = file.name.replace(/\.[^.]+$/, "").trim();
    const suggestedName =
      (role && roleLabelMap[role] && (!baseFileName || /^image$/i.test(baseFileName)))
        ? roleLabelMap[role]
        : (baseFileName || (role && roleLabelMap[role]) || `Template ${projectTemplates.length + 1}`);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl.startsWith("data:image/")) {
        onNotification({ message: "Invalid image data", type: "error" });
        return;
      }
      setIsUploadingTemplate(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: suggestedName, imageData: dataUrl }),
        });
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        const created: ProjectTemplateImage | undefined = data.template;
        if (created) {
          setProjectTemplates(prev => [...prev, created]);
          if (role === "male") {
            updateImageRules({ enabled: true, maleTemplateId: created.id });
          } else if (role === "female") {
            updateImageRules({ enabled: true, femaleTemplateId: created.id });
          } else if (role === "multiple") {
            updateImageRules({ enabled: true, multipleTemplateId: created.id });
          } else if (role === "fallback") {
            updateImageRules({ enabled: true, singleFallbackTemplateId: created.id });
          } else if (role === "manualGroup" && previewGroupKey) {
            setOverrideImageForKey(previewGroupKey, created.id);
          } else if (role === "manualSingle" && previewSingleItemId) {
            setOverrideImageForKey(`row_${previewSingleItemId}`, created.id);
          }
          onNotification({ message: `Saved template image "${created.name}"`, type: "success" });
        }
      } catch (err) {
        console.error("Failed to upload project template:", err);
        onNotification({ message: "Failed to upload template image", type: "error" });
      } finally {
        setIsUploadingTemplate(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRenameTemplate = async (tplId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setProjectTemplates(prev => prev.map(t => (t.id === tplId ? { ...t, name: trimmed } : t)));
    try {
      await fetch(`/api/projects/${encodeURIComponent(project.id)}/templates/${encodeURIComponent(tplId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
    } catch {
      // ignore rename error
    }
  };

  const handleDeleteTemplate = (tpl: ProjectTemplateImage) => {
    setConfirmDialog({
      title: "Delete Template Image",
      message: `Remove "${tpl.name}" from this project? Any rules using it will fall back to the Default Image.`,
      confirmLabel: "Delete Image",
      onConfirm: async () => {
        try {
          const res = await fetch(
            `/api/projects/${encodeURIComponent(project.id)}/templates/${encodeURIComponent(tpl.id)}`,
            { method: "DELETE" }
          );
          if (!res.ok) throw new Error("Failed");
          setProjectTemplates(prev => prev.filter(t => t.id !== tpl.id));
          setGroupConfig(prev => {
            const rules = { ...DEFAULT_IMAGE_RULES, ...(prev.imageRules || {}) };
            if (rules.maleTemplateId === tpl.id) rules.maleTemplateId = "";
            if (rules.femaleTemplateId === tpl.id) rules.femaleTemplateId = "";
            if (rules.multipleTemplateId === tpl.id) rules.multipleTemplateId = "";
            if (rules.singleFallbackTemplateId === tpl.id) rules.singleFallbackTemplateId = "";
            const nextOverrides: Record<string, string> = {};
            Object.entries(prev.groupImageOverrides || {}).forEach(([k, v]) => {
              if (v !== tpl.id) nextOverrides[k] = String(v);
            });
            return {
              ...prev,
              imageRules: rules,
              groupImageOverrides: nextOverrides,
            };
          });
          onNotification({ message: `Deleted template "${tpl.name}"`, type: "success" });
        } catch {
          onNotification({ message: "Failed to delete template image", type: "error" });
        }
      },
    });
  };

  const toggleIncludedField = (layerId: string) => {
    setGroupConfig(prev => {
      const exists = prev.includedFieldIds.includes(layerId);
      return {
        ...prev,
        includedFieldIds: exists
          ? prev.includedFieldIds.filter(id => id !== layerId)
          : [...prev.includedFieldIds, layerId],
      };
    });
  };

  const moveIncludedField = (layerId: string, dir: -1 | 1) => {
    setGroupConfig(prev => {
      const list = [...prev.includedFieldIds];
      const idx = list.indexOf(layerId);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= list.length) return prev;
      const tmp = list[idx];
      list[idx] = list[target];
      list[target] = tmp;
      return { ...prev, includedFieldIds: list };
    });
  };

  // Send selected or all rows to BulkImageCreatorModal
  const handleSendToBulkCreator = () => {
    const targetList = selectedIds.size > 0 ? items.filter(i => selectedIds.has(i.id)) : items;
    if (targetList.length === 0) {
      onNotification({ message: "No saved records to send to Bulk Creator", type: "info" });
      return;
    }
    const bulkRows = targetList.map((item, idx) => ({
      id: `row_${Date.now()}_${idx}`,
      name: item.rowName || `${project.name} ${idx + 1}`,
      values: { ...(item.rowValues || {}) },
    }));
    onOpenInBulkCreator(bulkRows);
  };

  const toggleSelectAll = () => {
    if (filteredItems.length === 0) return;
    const allSelected = filteredItems.every(i => selectedIds.has(i.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(i => i.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const matchedCount = activeLayers.filter(l => Boolean(fieldMapping[l.id])).length;
  const activeRules = { ...DEFAULT_IMAGE_RULES, ...(groupConfig.imageRules || {}) };
  const effectiveRuleFieldId =
    activeRules.nameFieldId && activeLayers.some(l => l.id === activeRules.nameFieldId)
      ? activeRules.nameFieldId
      : detectDefaultNameLayerId(activeLayers, groupByLayerId);

  // Shared helper UI for picking the print background image in Preview Modals
  const renderPreviewImageSelector = (
    overrideKey: string,
    selection: ResolvedTemplateSelection,
    uploadRole: "manualGroup" | "manualSingle"
  ) => (
    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ImageIcon size={13} className="text-sky-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
            Image to Print
          </span>
        </div>
        <span
          className={cn(
            "text-[10px] px-2 py-0.5 rounded-full font-semibold border truncate max-w-[175px]",
            selection.isManualOverride
              ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
              : selection.source === "rule_male"
              ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
              : selection.source === "rule_female"
              ? "bg-pink-500/15 text-pink-300 border-pink-500/30"
              : selection.source === "rule_multi"
              ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
              : "bg-slate-800 text-slate-300 border-slate-700"
          )}
          title={selection.reason}
        >
          {selection.isManualOverride ? `Manual: ${selection.label}` : selection.reason}
        </span>
      </div>

      <div className="text-[10px] text-slate-400 flex items-center justify-between gap-2 bg-slate-900/70 px-2 py-1 rounded-lg border border-slate-800/80">
        <span>Detected: <strong className="text-slate-200">{selection.detectedDetail}</strong></span>
        {selection.isManualOverride && (
          <button
            type="button"
            onClick={() => setOverrideImageForKey(overrideKey, null)}
            className="text-sky-400 hover:text-sky-300 font-semibold shrink-0"
          >
            Reset to Auto
          </button>
        )}
      </div>

      {/* Clickable Thumbnail Strip */}
      <div className="grid grid-cols-3 gap-1.5">
        {/* Default Project Image */}
        <button
          type="button"
          onClick={() => setOverrideImageForKey(overrideKey, "")}
          className={cn(
            "group relative rounded-lg overflow-hidden border text-left transition-all bg-slate-900",
            selection.templateId === ""
              ? "border-emerald-400 ring-1 ring-emerald-400/50"
              : "border-slate-800 hover:border-slate-600"
          )}
          title="Use Project Default Image"
        >
          <div className="aspect-[4/3] w-full bg-slate-950 overflow-hidden">
            <img src={image} alt="Default Image" className="w-full h-full object-cover" />
          </div>
          <div className="px-1.5 py-1 text-[10px] font-medium text-slate-200 truncate">
            Default
          </div>
          {selection.templateId === "" && (
            <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
              <Check size={10} />
            </div>
          )}
        </button>

        {/* Saved Alternative Project Templates */}
        {projectTemplates.map(tpl => {
          const isSelected = selection.templateId === tpl.id;
          const isMaleRule = activeRules.maleTemplateId === tpl.id;
          const isFemaleRule = activeRules.femaleTemplateId === tpl.id;
          const isMultiRule = activeRules.multipleTemplateId === tpl.id;

          return (
            <div
              key={tpl.id}
              className={cn(
                "group relative rounded-lg overflow-hidden border transition-all bg-slate-900 flex flex-col justify-between",
                isSelected
                  ? "border-emerald-400 ring-2 ring-emerald-400/50"
                  : "border-slate-800 hover:border-slate-600"
              )}
            >
              <button
                type="button"
                onClick={() => setOverrideImageForKey(overrideKey, tpl.id)}
                className="w-full text-left block"
                title={`Click to select "${tpl.name}" for this print`}
              >
                <div className="aspect-[4/3] w-full bg-slate-950 overflow-hidden relative">
                  <img src={tpl.url} alt={tpl.name} className="w-full h-full object-cover" />
                  {/* Role badges on thumbnail */}
                  <div className="absolute top-1 left-1 flex flex-col gap-0.5">
                    {isMaleRule && (
                      <span className="px-1 py-0.2 rounded bg-sky-600/90 text-white text-[8px] font-bold shadow">
                        Male (මයා)
                      </span>
                    )}
                    {isFemaleRule && (
                      <span className="px-1 py-0.2 rounded bg-pink-600/90 text-white text-[8px] font-bold shadow">
                        Female (මිය)
                      </span>
                    )}
                    {isMultiRule && (
                      <span className="px-1 py-0.2 rounded bg-violet-600/90 text-white text-[8px] font-bold shadow">
                        Multi-Row
                      </span>
                    )}
                  </div>
                </div>
                <div className="px-1.5 py-1 text-[10px] font-medium text-slate-200 truncate">
                  {tpl.name}
                </div>
              </button>

              {/* Quick Assign Buttons */}
              <div className="px-1 pb-1 pt-0.5 border-t border-slate-800/80 flex items-center justify-between gap-1 bg-slate-950/60">
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    updateImageRules({ enabled: true, maleTemplateId: tpl.id });
                    onNotification({ message: `Assigned "${tpl.name}" to Male records rule`, type: "success" });
                  }}
                  className={cn(
                    "px-1 py-0.5 rounded text-[8px] font-bold transition-colors",
                    isMaleRule ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:text-sky-300"
                  )}
                  title="Auto-select this image for 1 record ending with male suffix (මයා, මහතා...)"
                >
                  Male
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    updateImageRules({ enabled: true, femaleTemplateId: tpl.id });
                    onNotification({ message: `Assigned "${tpl.name}" to Female records rule`, type: "success" });
                  }}
                  className={cn(
                    "px-1 py-0.5 rounded text-[8px] font-bold transition-colors",
                    isFemaleRule ? "bg-pink-500/20 text-pink-300" : "text-slate-400 hover:text-pink-300"
                  )}
                  title="Auto-select this image for 1 record ending with female suffix (මිය, මහත්මිය...)"
                >
                  Female
                </button>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    updateImageRules({ enabled: true, multipleTemplateId: tpl.id });
                    onNotification({ message: `Assigned "${tpl.name}" to Multiple rows rule`, type: "success" });
                  }}
                  className={cn(
                    "px-1 py-0.5 rounded text-[8px] font-bold transition-colors",
                    isMultiRule ? "bg-violet-500/20 text-violet-300" : "text-slate-400 hover:text-violet-300"
                  )}
                  title="Auto-select this image when printing multiple rows"
                >
                  Multi
                </button>
              </div>

              {isSelected && (
                <div className="pointer-events-none absolute top-1 right-1 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
                  <Check size={10} />
                </div>
              )}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  handleDeleteTemplate(tpl);
                }}
                className="opacity-0 group-hover:opacity-100 absolute top-1 right-6 p-1 rounded bg-black/75 hover:bg-rose-600 text-slate-300 hover:text-white transition-opacity"
                title={`Delete "${tpl.name}"`}
              >
                <Trash2 size={10} />
              </button>
            </div>
          );
        })}

        {/* Upload New Image Option */}
        <button
          type="button"
          disabled={isUploadingTemplate}
          onClick={() => triggerTemplateUpload(uploadRole)}
          className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-700 hover:border-sky-400 bg-slate-900/50 hover:bg-sky-500/10 text-slate-400 hover:text-sky-300 transition-colors min-h-[70px] p-1.5"
          title="Upload another background image for this project"
        >
          {isUploadingTemplate ? (
            <RefreshCw size={14} className="animate-spin text-sky-400" />
          ) : (
            <Plus size={15} />
          )}
          <span className="text-[10px] font-semibold text-center leading-tight">
            {isUploadingTemplate ? "Saving..." : "+ Upload Image"}
          </span>
        </button>
      </div>

      {/* Collapsible Auto-Selection Rules right inside Preview */}
      <div className="pt-1 border-t border-slate-800/80">
        <button
          type="button"
          onClick={() => setShowRulesInPreview(v => !v)}
          className="w-full flex items-center justify-between text-[11px] font-semibold text-sky-300 hover:text-sky-200 py-1"
        >
          <span className="flex items-center gap-1.5">
            <Sparkles size={12} />
            <span>Auto-Select Rules (මයා / මිය / Multiple)</span>
          </span>
          {showRulesInPreview ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {showRulesInPreview && (
          <div className="mt-2 space-y-2.5 pt-2 border-t border-slate-800/60 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-200 font-medium">
                <input
                  type="checkbox"
                  checked={activeRules.enabled}
                  onChange={e => updateImageRules({ enabled: e.target.checked })}
                  className="rounded bg-slate-900 border-slate-700 text-sky-500 focus:ring-0"
                />
                <span>Enable Auto Image Rules</span>
              </label>
              <button
                type="button"
                onClick={() => setShowTemplateManagerModal(true)}
                className="text-[10px] text-slate-400 hover:text-white underline"
              >
                Manage All
              </button>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] text-slate-400">Name Field to Check (for 1 row):</span>
              <select
                value={effectiveRuleFieldId}
                onChange={e => updateImageRules({ nameFieldId: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
              >
                {activeLayers.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name || "Untitled Field"}
                  </option>
                ))}
              </select>
            </div>

            {[
              {
                key: "male",
                title: "1 Row • Ending with Male (මයා, මහතා...)",
                tplId: activeRules.maleTemplateId,
                onTplChange: (v: string) => updateImageRules({ maleTemplateId: v }),
                suffixVal: activeRules.maleEndings,
                onSuffixChange: (v: string) => updateImageRules({ maleEndings: v }),
                role: "male" as const,
                badgeColor: "text-sky-300",
              },
              {
                key: "female",
                title: "1 Row • Ending with Female (මිය, මහත්මිය...)",
                tplId: activeRules.femaleTemplateId,
                onTplChange: (v: string) => updateImageRules({ femaleTemplateId: v }),
                suffixVal: activeRules.femaleEndings,
                onSuffixChange: (v: string) => updateImageRules({ femaleEndings: v }),
                role: "female" as const,
                badgeColor: "text-pink-300",
              },
            ].map(rule => (
              <div key={rule.key} className="p-2 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
                <div className={cn("font-semibold text-[10px]", rule.badgeColor)}>{rule.title}</div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={rule.tplId}
                    onChange={e => rule.onTplChange(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none min-w-0"
                  >
                    <option value="">Default Project Image</option>
                    {projectTemplates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => triggerTemplateUpload(rule.role)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] shrink-0"
                    title="Upload image for this rule"
                  >
                    + Upload
                  </button>
                </div>
                <input
                  type="text"
                  value={rule.suffixVal}
                  onChange={e => rule.onSuffixChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-sky-500"
                  placeholder="Comma-separated endings..."
                />
              </div>
            ))}

            {/* Multiple Rows Rule */}
            <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
              <div className="font-semibold text-[10px] text-violet-300">Multiple Rows (2+ records)</div>
              <div className="flex items-center gap-1.5">
                <select
                  value={activeRules.multipleTemplateId}
                  onChange={e => updateImageRules({ multipleTemplateId: e.target.value })}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none min-w-0"
                >
                  <option value="">Default Project Image</option>
                  {projectTemplates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => triggerTemplateUpload("multiple")}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] shrink-0"
                >
                  + Upload
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[155] flex items-start sm:items-center justify-center bg-black/85 backdrop-blur-md p-0 sm:p-4 overflow-hidden animate-in fade-in duration-200"
      style={{
        height: mobileViewportHeight ? `${mobileViewportHeight}px` : undefined,
        maxHeight: mobileViewportHeight ? `${mobileViewportHeight}px` : undefined,
      }}
    >
      <input
        ref={templateUploadInputRef}
        type="file"
        accept="image/*"
        onChange={handleTemplateFileChange}
        className="hidden"
      />
      <div
        style={{
          height: mobileViewportHeight ? `${mobileViewportHeight}px` : undefined,
          maxHeight: mobileViewportHeight ? `${mobileViewportHeight}px` : undefined,
        }}
        className="bg-slate-900 border-0 sm:border border-slate-800 rounded-none sm:rounded-2xl shadow-2xl flex flex-col w-full sm:max-w-[95vw] h-full sm:h-[90vh] max-h-full sm:max-h-[94vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-800 bg-slate-900/95 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Database size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-white truncate">
                  Saved Project Data List
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-emerald-300 border border-slate-700 font-medium truncate max-w-[180px]">
                  {project.name}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  ({items.length} {items.length === 1 ? "record" : "records"})
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Persistent database list for this project • Add, edit, delete, or import JSON/CSV with field matching
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-2.5 bg-slate-950/60 border-b border-slate-800/80 shrink-0 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Add Record */}
            <button
              onClick={openAddDialog}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-sm transition-colors"
            >
              <Plus size={14} />
              <span>Add Data</span>
            </button>

            {/* Import JSON / CSV */}
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-semibold cursor-pointer transition-colors">
              <Upload size={14} className="text-emerald-400" />
              <span>Import JSON / CSV</span>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".json,.csv,.tsv,.txt"
                onChange={handleImportFileChange}
                className="hidden"
              />
            </label>

            {/* Export Dropdown Buttons */}
            <div className="flex items-center rounded-lg bg-slate-800 border border-slate-700 p-0.5">
              <button
                onClick={() => handleExportList("csv")}
                disabled={items.length === 0}
                className="flex items-center gap-1 px-2 py-1 text-slate-300 hover:text-white hover:bg-slate-700/60 rounded disabled:opacity-40"
                title="Export saved data as CSV"
              >
                <FileSpreadsheet size={13} className="text-emerald-400" />
                <span>CSV</span>
              </button>
              <span className="text-slate-700">|</span>
              <button
                onClick={() => handleExportList("json")}
                disabled={items.length === 0}
                className="flex items-center gap-1 px-2 py-1 text-slate-300 hover:text-white hover:bg-slate-700/60 rounded disabled:opacity-40"
                title="Export saved data as JSON"
              >
                <FileJson size={13} className="text-amber-400" />
                <span>JSON</span>
              </button>
            </div>

            {/* Delete Selected / Clear All */}
            {selectedIds.size > 0 && (
              <button
                onClick={() => handleBulkDelete(false)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-medium transition-colors"
              >
                <Trash2 size={13} />
                <span>Delete Selected ({selectedIds.size})</span>
              </button>
            )}

            {items.length > 0 && selectedIds.size === 0 && (
              <button
                type="button"
                onClick={() => handleBulkDelete(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-medium transition-colors"
                title="Clear all saved records for this project"
              >
                <Trash2 size={13} />
                <span>Clear All</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Project Template Images & Rules */}
            <button
              type="button"
              onClick={() => setShowTemplateManagerModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-600/15 hover:bg-sky-600/25 text-sky-300 border border-sky-500/30 font-semibold transition-colors"
              title="Upload extra background images & set automatic rules (1 row Male / 1 row Female / Multiple rows)"
            >
              <ImageIcon size={13} className="text-sky-400" />
              <span>Template Images</span>
              <span className="px-1.5 py-0.2 rounded-full bg-sky-500/25 text-sky-200 text-[10px] font-mono">
                {projectTemplates.length + 1}
              </span>
            </button>

            {/* Group By Selector */}
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5">
              <LayoutList size={13} className="text-violet-400 shrink-0" />
              <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">Group By:</span>
              <select
                value={groupByLayerId}
                onChange={e => handleGroupByChange(e.target.value)}
                className="bg-transparent text-xs font-semibold text-violet-300 outline-none cursor-pointer max-w-[140px]"
                title="Optionally group entries by any field and generate one combined image per group"
              >
                <option value="" className="bg-slate-900 text-slate-300">
                  None (All Rows)
                </option>
                {activeLayers.map(l => (
                  <option key={l.id} value={l.id} className="bg-slate-900 text-white">
                    {l.name || "Untitled Field"}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Box */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search saved list..."
                className="bg-slate-900 border border-slate-700/80 focus:border-blue-500 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none w-40 sm:w-48"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Preview & Print Button (Auto-picks Male / Female for 1 record, Multiple Rows for 2+ records, allows choosing print image in preview) */}
            <button
              type="button"
              onClick={handleOpenPreviewAndPrint}
              disabled={filteredItems.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold shadow-md disabled:opacity-40 transition-all cursor-pointer"
              title="Preview rendered card and select which image to print on"
            >
              <Eye size={14} className="text-white shrink-0" />
              <span>
                Preview & Print{" "}
                {selectedIds.size > 0
                  ? `(${selectedIds.size} Selected)`
                  : filteredItems.length === 1
                  ? "(1 Record)"
                  : `(${filteredItems.length} Records)`}
              </span>
            </button>

            {/* Send to Bulk Creator */}
            <button
              onClick={handleSendToBulkCreator}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold shadow-sm disabled:opacity-40 transition-all"
              title={
                selectedIds.size > 0
                  ? `Load ${selectedIds.size} selected records into Bulk Image Creator`
                  : "Load all saved records into Bulk Image Creator"
              }
            >
              <Layers size={14} />
              <span className="hidden sm:inline">
                {selectedIds.size > 0 ? `Bulk Cards (${selectedIds.size})` : "Bulk Creator"}
              </span>
            </button>
          </div>
        </div>

        {/* Main Table / Grouped Cards Area */}
        <div className="flex-1 overflow-auto bg-slate-900 relative">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <RefreshCw size={26} className="animate-spin text-emerald-400" />
              <p className="text-sm font-medium">Loading saved database records...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center max-w-md mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400 mb-4">
                <Database size={30} className="text-emerald-400" />
              </div>
              <h3 className="text-base font-bold text-white mb-1.5">
                No Saved Data Yet
              </h3>
              <p className="text-xs text-slate-400 mb-5 leading-relaxed">
                Keep a reusable list of entries saved in the database for <strong className="text-slate-200">{project.name}</strong>. Add rows manually or import from a JSON / CSV file and match columns to your project fields.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  onClick={openAddDialog}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow"
                >
                  <Plus size={15} />
                  <span>Add First Record</span>
                </button>
                <button
                  onClick={() => importFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold"
                >
                  <Upload size={15} />
                  <span>Import JSON / CSV</span>
                </button>
              </div>
            </div>
          ) : groupByLayerId ? (
            /* GROUPED DATA LIST VIEW */
            <div className="p-4 sm:p-5 space-y-4">
              {/* Group Summary Banner */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-xl bg-violet-600/10 border border-violet-500/25 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-slate-300">
                  <LayoutList size={15} className="text-violet-400" />
                  <span>
                    Grouped by{" "}
                    <strong className="text-violet-300">
                      {activeLayers.find(l => l.id === groupByLayerId)?.name || "Field"}
                    </strong>
                    {" • "}
                    <strong className="text-white">{groupedEntries.length}</strong>{" "}
                    {groupedEntries.length === 1 ? "group" : "groups"} ({filteredItems.length} total entries)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {groupedEntries[0] && (
                    <button
                      onClick={() => setPreviewGroupKey(groupedEntries[0].key)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-200 border border-violet-500/30 font-medium transition-colors"
                    >
                      <SlidersHorizontal size={12} />
                      <span>Layout Settings</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleGroupByChange("")}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
                  >
                    Clear Grouping
                  </button>
                </div>
              </div>

              {groupedEntries.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs">
                  No records match your search.
                </div>
              ) : (
                groupedEntries.map(group => {
                  const groupFieldLayer = activeLayers.find(l => l.id === groupByLayerId);
                  const isGenerating = processingGroupKey === group.key;
                  const visibleNonGroupLayers = otherDisplayLayers.filter(l =>
                    groupConfig.includedFieldIds.includes(l.id)
                  );
                  const displayFields =
                    visibleNonGroupLayers.length > 0
                      ? visibleNonGroupLayers
                      : activeLayers.filter(l => l.id !== groupByLayerId);
                  const groupImgSelection = resolveGroupOrRowImage({
                    items: group.items,
                    overrideKey: group.key,
                    groupConfig,
                    activeLayers,
                    groupByLayerId,
                    templates: projectTemplates,
                    defaultImageUrl: image,
                  });

                  return (
                    <div
                      key={group.key}
                      className="rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-lg"
                    >
                      {/* Group Card Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-950 border-b border-slate-800/90">
                        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                          <span className="text-[11px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                            {groupFieldLayer?.name || "Group"}
                          </span>
                          <h3 className="text-sm sm:text-base font-bold text-white truncate max-w-[300px]">
                            {group.displayValue}
                          </h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                            {group.items.length} {group.items.length === 1 ? "entry" : "entries"}
                          </span>
                          {(projectTemplates.length > 0 || groupImgSelection.isManualOverride) && (
                            <button
                              type="button"
                              onClick={() => setPreviewGroupKey(group.key)}
                              className={cn(
                                "text-[11px] px-2.5 py-0.5 rounded-full border font-medium flex items-center gap-1 transition-colors",
                                groupImgSelection.isManualOverride
                                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25"
                                  : groupImgSelection.source === "rule_male"
                                  ? "bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25"
                                  : groupImgSelection.source === "rule_female"
                                  ? "bg-pink-500/15 text-pink-300 border-pink-500/30 hover:bg-pink-500/25"
                                  : groupImgSelection.source === "rule_multi"
                                  ? "bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/25"
                                  : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                              )}
                              title={`${groupImgSelection.reason} — Click to preview or switch print image`}
                            >
                              <ImageIcon size={11} />
                              <span className="truncate max-w-[160px]">{groupImgSelection.label}</span>
                            </button>
                          )}
                          {group.priceTotals.map(pt => (
                            <span
                              key={pt.layerId}
                              className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25 font-mono font-semibold"
                            >
                              {pt.label}: {formatPriceNumber(pt.total)}
                            </span>
                          ))}
                        </div>

                        {/* Group Image Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setPreviewGroupKey(group.key)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors"
                            title="Preview grouped image and select or customize print image"
                          >
                            <Eye size={13} className="text-violet-400" />
                            <span>Preview & Customize</span>
                          </button>

                          <button
                            onClick={() => handleGroupCardAction(group, "download")}
                            disabled={isGenerating}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md disabled:opacity-50 transition-all"
                            title="Generate one combined PNG image for all entries in this group"
                          >
                            {isGenerating ? (
                              <RefreshCw size={13} className="animate-spin" />
                            ) : (
                              <ImageIcon size={13} />
                            )}
                            <span>{isGenerating ? "Creating..." : "Create Group Image"}</span>
                          </button>

                          <button
                            onClick={() => handleGroupCardAction(group, "share")}
                            disabled={isGenerating}
                            className="p-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/30 transition-colors disabled:opacity-50"
                            title="Share combined group image"
                          >
                            <Share2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Group Entries Shown One After One */}
                      <div className="divide-y divide-slate-800/60">
                        {group.items.map((item, rIdx) => (
                          <div
                            key={item.id}
                            className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-800/35 transition-colors text-xs"
                          >
                            <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                              <span className="w-6 h-6 rounded-md bg-slate-800 border border-slate-700/70 flex items-center justify-center text-[11px] font-mono font-bold text-slate-300 shrink-0">
                                {rIdx + 1}
                              </span>

                              {/* Sequential Other Fields */}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0 flex-1">
                                {displayFields.map((field, fIdx) => {
                                  const raw = item.rowValues?.[field.id] ?? "";
                                  const suffix =
                                    field.hasSuffixList && item.rowValues?.[`${field.id}__suffix`]
                                      ? ` ${item.rowValues[`${field.id}__suffix`]}`
                                      : "";
                                  const isPrice = isPriceLayer(field);
                                  return (
                                    <React.Fragment key={field.id}>
                                      {fIdx > 0 && (
                                        <span className="text-slate-600 hidden sm:inline">•</span>
                                      )}
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold shrink-0">
                                          {field.name}:
                                        </span>
                                        <span
                                          className={cn(
                                            "truncate max-w-[240px]",
                                            raw ? "text-slate-100 font-medium" : "text-slate-600 italic",
                                            isPrice && "font-mono text-amber-300"
                                          )}
                                        >
                                          {raw ? `${raw}${suffix}` : "empty"}
                                        </span>
                                      </div>
                                    </React.Fragment>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Individual Entry Actions */}
                            <div className="flex items-center gap-1 shrink-0 ml-auto">
                              <button
                                onClick={() => setPreviewSingleItemId(item.id)}
                                className="p-1.5 rounded-lg bg-violet-600/15 hover:bg-violet-600/30 text-violet-400 transition-colors"
                                title="Preview & choose image to print for this record"
                              >
                                <Eye size={13} />
                              </button>
                              <button
                                onClick={() => {
                                  onApplyRowToCanvas(item.rowValues || {});
                                  onClose();
                                }}
                                className="p-1.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-400 transition-colors"
                                title="Load this entry onto Canvas"
                              >
                                <CheckCircle2 size={13} />
                              </button>
                              <button
                                onClick={() => openEditDialog(item)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                                title="Edit entry"
                              >
                                <Edit2 size={12} />
                              </button>
                              <button
                                onClick={() => handleDeleteItem(item.id)}
                                className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                                title="Delete entry"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800 text-slate-400 select-none shadow-sm">
                <tr>
                  <th className="w-10 px-2.5 py-3 text-center border-r border-slate-800/60">
                    <input
                      type="checkbox"
                      checked={filteredItems.length > 0 && filteredItems.every(i => selectedIds.has(i.id))}
                      onChange={toggleSelectAll}
                      className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
                      title="Select all visible rows"
                    />
                  </th>
                  <th className="w-12 px-2 py-3 text-center font-semibold text-slate-500 border-r border-slate-800/60">
                    #
                  </th>
                  <th className="min-w-[140px] max-w-[200px] px-3 py-2.5 font-semibold text-slate-300 border-r border-slate-800/60">
                    Record Name
                  </th>
                  {activeLayers.map(layer => {
                    const isPrice = isPriceLayer(layer);
                    const stat = priceTotals[layer.id];
                    return (
                      <th
                        key={layer.id}
                        className={cn(
                          "min-w-[160px] max-w-[260px] px-3 py-2.5 font-semibold border-r border-slate-800/60",
                          isPrice && "bg-amber-500/[0.03]"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-slate-200 truncate font-bold" title={layer.name}>
                            {layer.name || "Untitled Field"}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] px-1.5 py-0.2 rounded font-mono uppercase font-bold shrink-0",
                              isPrice
                                ? "bg-amber-500/20 text-amber-300"
                                : layer.type === "date"
                                ? "bg-purple-500/20 text-purple-300"
                                : layer.type === "list"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-slate-800 text-slate-400"
                            )}
                          >
                            {isPrice ? "Price" : layer.type || "text"}
                          </span>
                        </div>
                        {stat && (
                          <div className="text-[10px] text-amber-300 font-mono mt-0.5">
                            Total: {formatPriceNumber(stat.total)}
                          </div>
                        )}
                      </th>
                    );
                  })}
                  <th className="w-44 min-w-[170px] px-3 py-3 text-center font-semibold text-slate-300">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/60">
                {filteredItems.map((item, idx) => {
                  const isSelected = selectedIds.has(item.id);
                  const isProcessing = processingRowId === item.id;
                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "transition-colors group",
                        isSelected ? "bg-blue-600/10" : "hover:bg-slate-800/40"
                      )}
                    >
                      <td className="px-2.5 py-2 text-center border-r border-slate-800/60">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(item.id)}
                          className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="px-2 py-2 text-center text-slate-500 font-mono text-[11px] border-r border-slate-800/60">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 border-r border-slate-800/60 font-medium text-slate-200 truncate max-w-[200px]">
                        {item.rowName || <span className="text-slate-600 italic">—</span>}
                      </td>
                      {activeLayers.map(layer => {
                        const val = item.rowValues?.[layer.id] ?? "";
                        const isCurrentlyEditing =
                          editingCell?.itemId === item.id && editingCell?.layerId === layer.id;
                        const isPrice = isPriceLayer(layer);

                        return (
                          <td
                            key={layer.id}
                            className="px-2 py-1.5 border-r border-slate-800/60 align-top"
                          >
                            {isCurrentlyEditing ? (
                              <input
                                type={layer.type === "date" ? "date" : "text"}
                                autoFocus
                                value={editingCell.value}
                                onChange={e =>
                                  setEditingCell({ ...editingCell, value: e.target.value })
                                }
                                onBlur={() =>
                                  commitInlineCellEdit(item, layer.id, editingCell.value)
                                }
                                onKeyDown={e => {
                                  if (e.key === "Enter") {
                                    commitInlineCellEdit(item, layer.id, editingCell.value);
                                  } else if (e.key === "Escape") {
                                    setEditingCell(null);
                                  }
                                }}
                                className="w-full bg-slate-950 border border-blue-500 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : (
                              <div
                                onClick={() =>
                                  setEditingCell({ itemId: item.id, layerId: layer.id, value: val })
                                }
                                title="Click to quick-edit"
                                className={cn(
                                  "min-h-[26px] px-2 py-1 rounded cursor-text hover:bg-slate-800/80 transition-colors break-words",
                                  val ? "text-slate-200" : "text-slate-600 italic",
                                  isPrice && "font-mono"
                                )}
                              >
                                {val || "empty"}
                              </div>
                            )}

                            {layer.hasSuffixList && layer.suffixList && layer.suffixList.length > 0 && (
                              <div className="mt-1 flex items-center gap-1 text-[10px]">
                                <span className="text-slate-500">Suffix:</span>
                                <select
                                  value={
                                    item.rowValues?.[`${layer.id}__suffix`] ||
                                    layer.selectedSuffix ||
                                    layer.suffixList[0]
                                  }
                                  onChange={e =>
                                    handleInlineSuffixChange(item, layer.id, e.target.value)
                                  }
                                  className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-slate-300 text-[10px] outline-none"
                                >
                                  {layer.suffixList.map((s, si) => (
                                    <option key={si} value={s}>
                                      {s}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* Row Actions */}
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setPreviewSingleItemId(item.id)}
                            className="p-1.5 rounded-lg bg-violet-600/15 hover:bg-violet-600/30 text-violet-400 transition-colors"
                            title="Preview & choose image to print"
                          >
                            <Eye size={14} />
                          </button>

                          <button
                            onClick={() => {
                              onApplyRowToCanvas(item.rowValues || {});
                              onClose();
                            }}
                            className="p-1.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-400 transition-colors"
                            title="Load this record into Card Editor"
                          >
                            <CheckCircle2 size={14} />
                          </button>

                          <button
                            onClick={() => handleRowCardAction(item, idx, "download")}
                            disabled={isProcessing}
                            className="p-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600/30 text-blue-400 transition-colors disabled:opacity-40"
                            title="Download PNG card for this record"
                          >
                            {isProcessing ? (
                              <RefreshCw size={14} className="animate-spin" />
                            ) : (
                              <Download size={14} />
                            )}
                          </button>

                          <button
                            onClick={() => handleRowCardAction(item, idx, "share")}
                            disabled={isProcessing}
                            className="p-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/30 text-indigo-400 transition-colors disabled:opacity-40"
                            title="Share card image"
                          >
                            <Share2 size={14} />
                          </button>

                          <button
                            onClick={() => openEditDialog(item)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                            title="Edit full record"
                          >
                            <Edit2 size={13} />
                          </button>

                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                            title="Delete record"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Info */}
        <div className="px-4 sm:px-6 py-2.5 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-3">
            <span>
              Showing <strong className="text-slate-200">{filteredItems.length}</strong> of{" "}
              <strong className="text-slate-200">{items.length}</strong> database records
            </span>
            <span className="hidden sm:inline text-slate-600">•</span>
            <span className="hidden sm:inline text-slate-500">
              Tip: Click any cell to quick-edit, or click the green check icon to load a row directly onto the canvas.
            </span>
          </div>
          <button
            onClick={fetchProjectDataList}
            className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
            title="Refresh from database"
          >
            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
            <span>Sync</span>
          </button>
        </div>

        {/* SUB-MODAL 1: ADD / EDIT RECORD MODAL */}
        {editingItem && (
          <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
            <form
              onSubmit={handleSaveEntry}
              className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full max-h-[88vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/60">
                <div className="flex items-center gap-2 text-white font-bold text-sm sm:text-base">
                  {editingItem.mode === "add" ? (
                    <Plus size={18} className="text-blue-400" />
                  ) : (
                    <Edit2 size={16} className="text-amber-400" />
                  )}
                  <span>{editingItem.mode === "add" ? "Add New Record" : "Edit Record"}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="p-1 text-slate-400 hover:text-white rounded"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Record Name / Label
                  </label>
                  <input
                    type="text"
                    value={editingItem.rowName}
                    onChange={e => setEditingItem({ ...editingItem, rowName: e.target.value })}
                    placeholder="e.g. Donor #1 or File name..."
                    className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-xs sm:text-sm text-white outline-none"
                  />
                </div>

                <div className="border-t border-slate-800 pt-3 space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Project Fields
                  </p>
                  {activeLayers.map(layer => {
                    const val = editingItem.rowValues[layer.id] ?? "";
                    const isPrice = isPriceLayer(layer);
                    const isAutoNumberLabel = layer.isNumberLabel && layer.linkedNumberId;
                    return (
                      <div key={layer.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-slate-300">
                            {layer.name || "Untitled Field"}
                          </label>
                          <span className="text-[10px] font-mono text-slate-500 uppercase">
                            {isPrice ? "Price / Number" : isAutoNumberLabel ? "Auto Words" : layer.type || "text"}
                          </span>
                        </div>

                        {layer.type === "date" ? (
                          <input
                            type="date"
                            value={val}
                            onChange={e =>
                              setEditingItem({
                                ...editingItem,
                                rowValues: updateValueWithLinks(editingItem.rowValues, layer.id, e.target.value),
                              })
                            }
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white font-mono outline-none"
                          />
                        ) : layer.type === "list" && layer.options && layer.options.length > 0 ? (
                          <select
                            value={val}
                            onChange={e =>
                              setEditingItem({
                                ...editingItem,
                                rowValues: updateValueWithLinks(editingItem.rowValues, layer.id, e.target.value),
                              })
                            }
                            className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-white outline-none"
                          >
                            <option value="">(Select Option)</option>
                            {layer.options.map((opt, oi) => (
                              <option key={oi} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            inputMode={isPrice ? "decimal" : undefined}
                            value={val}
                            onChange={e =>
                              setEditingItem({
                                ...editingItem,
                                rowValues: updateValueWithLinks(editingItem.rowValues, layer.id, e.target.value),
                              })
                            }
                            placeholder={
                              isAutoNumberLabel
                                ? "Auto-calculated when number changes (or type override)"
                                : `Enter ${layer.name}...`
                            }
                            className={cn(
                              "w-full bg-slate-950 border border-slate-800 focus:border-blue-500 rounded-xl px-3 py-2 text-xs sm:text-sm text-white outline-none",
                              isPrice && "font-mono"
                            )}
                          />
                        )}

                        {layer.hasSuffixList && layer.suffixList && layer.suffixList.length > 0 && (
                          <div className="flex items-center gap-2 pt-0.5">
                            <span className="text-[11px] text-slate-500">Suffix:</span>
                            <select
                              value={
                                editingItem.rowValues[`${layer.id}__suffix`] ||
                                layer.selectedSuffix ||
                                layer.suffixList[0]
                              }
                              onChange={e =>
                                setEditingItem({
                                  ...editingItem,
                                  rowValues: {
                                    ...editingItem.rowValues,
                                    [`${layer.id}__suffix`]: e.target.value,
                                  },
                                })
                              }
                              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 outline-none"
                            >
                              {layer.suffixList.map((s, si) => (
                                <option key={si} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-950">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow disabled:opacity-50"
                >
                  {isSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>{editingItem.mode === "add" ? "Save Record" : "Update Record"}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SUB-MODAL 2: IMPORT JSON / CSV WITH FIELD MATCHING WIZARD */}
        {showImportWizard && importFileInfo && (
          <div className="fixed inset-0 z-[175] flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4">
            <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Wizard Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <ArrowLeftRight size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm sm:text-base font-bold text-white">
                        Match Uploaded Fields with Project Fields
                      </h3>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {importFileInfo.format}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      File: <span className="text-slate-200">{importFileInfo.fileName}</span> •{" "}
                      <strong className="text-emerald-300">{importFileInfo.records.length}</strong> records •{" "}
                      <strong className="text-blue-300">{importFileInfo.fields.length}</strong> uploaded fields found
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowImportWizard(false);
                    setImportFileInfo(null);
                  }}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Wizard Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
                {/* Controls bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300 font-medium">
                      Matched Fields:{" "}
                      <strong className="text-emerald-400">
                        {matchedCount} / {activeLayers.length}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setFieldMapping(computeAutoMapping(importFileInfo.fields))}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-medium transition-colors"
                    >
                      <Wand2 size={12} />
                      <span>Auto-Match</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const posMap: Record<string, string> = {};
                        activeLayers.forEach((l, i) => {
                          posMap[l.id] = importFileInfo.fields[i] || "";
                        });
                        setFieldMapping(posMap);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-medium transition-colors"
                    >
                      Match by Order
                    </button>
                  </div>

                  {/* Import Mode */}
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 font-medium">Save Mode:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-slate-200">
                      <input
                        type="radio"
                        name="importMode"
                        checked={importMode === "append"}
                        onChange={() => setImportMode("append")}
                        className="text-blue-600 focus:ring-0"
                      />
                      <span>Append to List</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-amber-300">
                      <input
                        type="radio"
                        name="importMode"
                        checked={importMode === "replace"}
                        onChange={() => setImportMode("replace")}
                        className="text-amber-500 focus:ring-0"
                      />
                      <span>Replace Existing List</span>
                    </label>
                  </div>
                </div>

                {/* Field Mapping Table */}
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                  <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-slate-950 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <div className="col-span-4">Project Field</div>
                    <div className="col-span-4">Uploaded File Field</div>
                    <div className="col-span-4">Sample Uploaded Values</div>
                  </div>

                  <div className="divide-y divide-slate-800/70">
                    {/* Optional Record Name Mapping */}
                    <div className="grid grid-cols-12 gap-2 items-center px-4 py-2.5 bg-slate-900/40">
                      <div className="col-span-4 flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-slate-300 truncate">
                          Record Name (Optional)
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                          label
                        </span>
                      </div>
                      <div className="col-span-4">
                        <select
                          value={fieldMapping.__rowName || ""}
                          onChange={e =>
                            setFieldMapping(prev => ({ ...prev, __rowName: e.target.value }))
                          }
                          className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
                        >
                          <option value="">-- Auto-generate from first field --</option>
                          {importFileInfo.fields.map(f => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-4 text-[11px] text-slate-400 truncate font-mono">
                        {fieldMapping.__rowName
                          ? importFileInfo.records
                              .slice(0, 2)
                              .map(r => r[fieldMapping.__rowName])
                              .filter(Boolean)
                              .join(" | ") || "(empty)"
                          : "(Auto)"}
                      </div>
                    </div>

                    {/* Project Layer Fields */}
                    {activeLayers.map(layer => {
                      const selectedUploaded = fieldMapping[layer.id] || "";
                      const isPrice = isPriceLayer(layer);
                      const sampleValues = selectedUploaded
                        ? importFileInfo.records
                            .slice(0, 2)
                            .map(r => r[selectedUploaded])
                            .filter(v => v !== undefined && v !== "")
                            .join(" | ")
                        : "";

                      return (
                        <div
                          key={layer.id}
                          className={cn(
                            "grid grid-cols-12 gap-2 items-center px-4 py-2.5 transition-colors",
                            selectedUploaded ? "bg-emerald-500/[0.03]" : ""
                          )}
                        >
                          <div className="col-span-4 flex items-center justify-between gap-2 min-w-0 pr-2">
                            <span className="text-xs font-bold text-white truncate" title={layer.name}>
                              {layer.name || "Untitled Field"}
                            </span>
                            <span
                              className={cn(
                                "text-[10px] px-1.5 py-0.2 rounded font-mono uppercase shrink-0",
                                isPrice
                                  ? "bg-amber-500/20 text-amber-300"
                                  : layer.type === "date"
                                  ? "bg-purple-500/20 text-purple-300"
                                  : "bg-slate-800 text-slate-400"
                              )}
                            >
                              {isPrice ? "number" : layer.type || "text"}
                            </span>
                          </div>

                          <div className="col-span-4 flex items-center gap-2">
                            <ArrowRight size={13} className="text-slate-600 shrink-0" />
                            <select
                              value={selectedUploaded}
                              onChange={e =>
                                setFieldMapping(prev => ({ ...prev, [layer.id]: e.target.value }))
                              }
                              className={cn(
                                "w-full bg-slate-950 border rounded-lg px-2.5 py-1.5 text-xs outline-none transition-colors",
                                selectedUploaded
                                  ? "border-emerald-500/60 text-emerald-200"
                                  : "border-slate-700 text-slate-400 focus:border-blue-500"
                              )}
                            >
                              <option value="">-- Skip / Do Not Import --</option>
                              {importFileInfo.fields.map(f => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="col-span-4 text-[11px] text-slate-300 truncate font-mono">
                            {selectedUploaded ? (
                              sampleValues || <span className="text-slate-600 italic">(empty values)</span>
                            ) : layer.isNumberLabel ? (
                              <span className="text-sky-400/80 italic">Auto-converted from number</span>
                            ) : (
                              <span className="text-slate-600 italic">Not mapped</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Live Preview of Mapped Records */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Mapped Data Preview (First {Math.min(5, mappedImportPreviewRows.length)} of{" "}
                      {mappedImportPreviewRows.length} rows)
                    </h4>
                  </div>
                  <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950/60">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="px-3 py-2 border-r border-slate-800/60">#</th>
                          <th className="px-3 py-2 border-r border-slate-800/60">Record Name</th>
                          {activeLayers.map(l => (
                            <th key={l.id} className="px-3 py-2 border-r border-slate-800/60 whitespace-nowrap">
                              {l.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {mappedImportPreviewRows.slice(0, 5).map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/30">
                            <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-800/60">
                              {idx + 1}
                            </td>
                            <td className="px-3 py-1.5 text-slate-200 font-medium border-r border-slate-800/60 truncate max-w-[140px]">
                              {row.rowName}
                            </td>
                            {activeLayers.map(l => (
                              <td
                                key={l.id}
                                className="px-3 py-1.5 text-slate-300 border-r border-slate-800/60 truncate max-w-[180px]"
                              >
                                {row.rowValues[l.id] || <span className="text-slate-600">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Wizard Footer */}
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800 bg-slate-950">
                <button
                  type="button"
                  onClick={() => {
                    setShowImportWizard(false);
                    setImportFileInfo(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={isImporting || matchedCount === 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg disabled:opacity-40 transition-all"
                >
                  {isImporting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Saving {mappedImportPreviewRows.length} Records...</span>
                    </>
                  ) : (
                    <>
                      <Database size={14} />
                      <span>
                        Import & Save {mappedImportPreviewRows.length} Records
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MODAL 3: FALLBACK SHARE DIALOG */}
        {shareTargetCard && (
          <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-white font-bold text-base">
                  <Share2 className="text-indigo-400" size={18} />
                  <span>Share Card</span>
                </div>
                <button
                  onClick={() => setShareTargetCard(null)}
                  className="p-1 text-slate-400 hover:text-white rounded"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex items-center gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <img
                  src={shareTargetCard.dataUrl}
                  alt={shareTargetCard.name}
                  className="w-16 h-16 object-cover rounded-lg border border-slate-800"
                />
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-white truncate">{shareTargetCard.name}</h4>
                  <p className="text-[10px] text-slate-400 font-mono truncate">{shareTargetCard.filename}</p>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  onClick={async () => {
                    try {
                      if (navigator.clipboard && (window as any).ClipboardItem) {
                        await navigator.clipboard.write([
                          new (window as any).ClipboardItem({ "image/png": shareTargetCard.blob }),
                        ]);
                        onNotification({ message: "Card image copied to clipboard!", type: "success" });
                      } else {
                        throw new Error("Unsupported");
                      }
                    } catch {
                      onNotification({ message: "Clipboard copy unsupported in this browser", type: "error" });
                    }
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-white text-xs font-medium border border-slate-700/80"
                >
                  <div className="flex items-center gap-2.5">
                    <Copy size={16} className="text-blue-400" />
                    <span>Copy Image to Clipboard</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">PNG</span>
                </button>

                <button
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = shareTargetCard.dataUrl;
                    a.download = shareTargetCard.filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    onRecordCreationEvents(1, "download").catch(() => {});
                    setShareTargetCard(null);
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-xs font-medium border border-blue-500/30"
                >
                  <div className="flex items-center gap-2.5">
                    <Download size={16} className="text-blue-400" />
                    <span>Download Image PNG</span>
                  </div>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
        {/* SUB-MODAL 4: MULTI-ROW / GROUP IMAGE PREVIEW & CUSTOMIZE MODAL */}
        {activePreviewGroup && (
          <div className="fixed inset-0 z-[178] flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4">
            <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-6xl w-full max-h-[94vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 shrink-0">
                    <SlidersHorizontal size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-white truncate">
                        Preview & Print: {activePreviewGroup.displayValue}
                      </h3>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono">
                        {activePreviewGroup.items.length} {activePreviewGroup.items.length === 1 ? "entry" : "entries"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 hidden sm:block">
                      Review multi-row card, choose template image to print on, or adjust layout spacing
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setPreviewGroupKey(null);
                    setMultiRowPreviewTarget(null);
                  }}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Body: Canvas Preview Left + Controls Right */}
              <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                {/* Live Canvas Preview */}
                <div className="flex-1 bg-slate-950 p-4 flex items-center justify-center overflow-auto relative min-h-[260px]">
                  <canvas
                    ref={groupPreviewCanvasRef}
                    className="max-w-full max-h-[65vh] lg:max-h-[74vh] object-contain rounded-lg shadow-2xl border border-slate-800 bg-black"
                  />
                  {isRenderingGroupPreview && (
                    <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-700 text-[11px] text-slate-300">
                      <RefreshCw size={12} className="animate-spin text-violet-400" />
                      <span>Rendering...</span>
                    </div>
                  )}
                </div>

                {/* Controls Panel */}
                <div className="w-full lg:w-[375px] border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/95 overflow-y-auto p-4 space-y-4 text-xs shrink-0">
                  {/* Print Image Picker & Auto-Rules */}
                  {activePreviewGroupSelection &&
                    renderPreviewImageSelector(
                      activePreviewGroup.key,
                      activePreviewGroupSelection,
                      "manualGroup"
                    )}

                  {/* Layout Mode */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Entry Layout Mode
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setGroupConfig(p => ({ ...p, layoutStyle: "inline" }))}
                        className={cn(
                          "px-3 py-2 rounded-xl border text-left transition-all",
                          groupConfig.layoutStyle === "inline"
                            ? "bg-violet-600/20 border-violet-500 text-white"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                        )}
                      >
                        <div className="font-bold text-xs">One After One</div>
                        <div className="text-[10px] opacity-75">Sequential inline lines</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupConfig(p => ({ ...p, layoutStyle: "columns" }))}
                        className={cn(
                          "px-3 py-2 rounded-xl border text-left transition-all",
                          groupConfig.layoutStyle === "columns"
                            ? "bg-violet-600/20 border-violet-500 text-white"
                            : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                        )}
                      >
                        <div className="font-bold text-xs">Aligned Columns</div>
                        <div className="text-[10px] opacity-75">Keep template X positions</div>
                      </button>
                    </div>
                  </div>

                  {/* Fields to Include & Order */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Included Fields & Order
                    </label>
                    <div className="bg-slate-950 border border-slate-800 rounded-xl divide-y divide-slate-800/70 max-h-48 overflow-y-auto">
                      {otherDisplayLayers.map(layer => {
                        const isChecked = groupConfig.includedFieldIds.includes(layer.id);
                        const orderIdx = groupConfig.includedFieldIds.indexOf(layer.id);
                        return (
                          <div
                            key={layer.id}
                            className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-900/60"
                          >
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleIncludedField(layer.id)}
                                className="rounded bg-slate-900 border-slate-700 text-violet-500 focus:ring-0"
                              />
                              <span className="truncate text-slate-200 font-medium">
                                {layer.name || "Untitled"}
                              </span>
                            </label>
                            {isChecked && (
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={orderIdx <= 0}
                                  onClick={() => moveIncludedField(layer.id, -1)}
                                  className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                                  title="Move earlier"
                                >
                                  <ArrowUp size={12} />
                                </button>
                                <button
                                  type="button"
                                  disabled={orderIdx >= groupConfig.includedFieldIds.length - 1}
                                  onClick={() => moveIncludedField(layer.id, 1)}
                                  className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                                  title="Move later"
                                >
                                  <ArrowDown size={12} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Numbering & Totals Toggles */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={groupConfig.showItemNumbers}
                        onChange={e => setGroupConfig(p => ({ ...p, showItemNumbers: e.target.checked }))}
                        className="rounded bg-slate-900 border-slate-700 text-violet-500 focus:ring-0"
                      />
                      <span className="text-slate-200 font-medium">Numbers (1. 2.)</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={groupConfig.showGroupTotal}
                        onChange={e => setGroupConfig(p => ({ ...p, showGroupTotal: e.target.checked }))}
                        className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0"
                      />
                      <span className="text-slate-200 font-medium">Group Total</span>
                    </label>
                  </div>

                  {groupConfig.showGroupTotal && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 shrink-0">Total Label:</span>
                      <input
                        type="text"
                        value={groupConfig.totalLabel}
                        onChange={e => setGroupConfig(p => ({ ...p, totalLabel: e.target.value }))}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500"
                        placeholder="Total"
                      />
                    </div>
                  )}

                  {/* Inline-only controls */}
                  {groupConfig.layoutStyle === "inline" && (
                    <div className="space-y-3 pt-1 border-t border-slate-800">
                      {/* Smart Line Break for Long Text */}
                      <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                        <div>
                          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                            <Sparkles size={13} className="text-sky-400" />
                            <span>Break Long Lines (සහ, හා, comma)</span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Wraps long donor names at natural conjunctions instead of shrinking font
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={groupConfig.breakLongLines}
                          onChange={e =>
                            setGroupConfig(p => ({ ...p, breakLongLines: e.target.checked }))
                          }
                          className="rounded bg-slate-900 border-slate-700 text-sky-500 focus:ring-0 w-4 h-4 shrink-0"
                        />
                      </label>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Field Separator:</span>
                        <select
                          value={groupConfig.fieldSeparator}
                          onChange={e => setGroupConfig(p => ({ ...p, fieldSeparator: e.target.value }))}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                        >
                          <option value=" - ">Dash ( - )</option>
                          <option value=" | ">Pipe ( | )</option>
                          <option value=" • ">Bullet ( • )</option>
                          <option value=", ">Comma (, )</option>
                          <option value=" : ">Colon ( : )</option>
                          <option value="   ">Space</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Alignment:</span>
                        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                          {([
                            { id: "left", icon: AlignLeft, defX: 10 },
                            { id: "center", icon: AlignCenter, defX: 50 },
                            { id: "right", icon: AlignRight, defX: 90 },
                          ] as const).map(al => {
                            const Icon = al.icon;
                            return (
                              <button
                                key={al.id}
                                type="button"
                                onClick={() =>
                                  setGroupConfig(p => ({
                                    ...p,
                                    textAlign: al.id,
                                    inlineXPercent: al.defX,
                                  }))
                                }
                                className={cn(
                                  "p-1.5 rounded-md transition-colors",
                                  groupConfig.textAlign === al.id
                                    ? "bg-violet-600 text-white"
                                    : "text-slate-400 hover:text-white"
                                )}
                                title={`Align ${al.id}`}
                              >
                                <Icon size={14} />
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-400">Horizontal Position X</span>
                          <span className="font-mono text-violet-300">{groupConfig.inlineXPercent}%</span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={95}
                          step={1}
                          value={groupConfig.inlineXPercent}
                          onChange={e =>
                            setGroupConfig(p => ({ ...p, inlineXPercent: Number(e.target.value) }))
                          }
                          className="w-full accent-violet-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* Auto-Adjust Background Space & Position Controls */}
                  <div className="space-y-3 pt-2 border-t border-slate-800">
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                      <label className="flex items-center justify-between gap-2 cursor-pointer">
                        <div>
                          <div className="text-xs font-semibold text-white">
                            Auto-Adjust Space for Rows
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Expands/contracts blank template gap to fit {activePreviewGroup.items.length}{" "}
                            {activePreviewGroup.items.length === 1 ? "row" : "rows"}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={groupConfig.autoAdjustSpace}
                          onChange={e =>
                            setGroupConfig(p => ({ ...p, autoAdjustSpace: e.target.checked }))
                          }
                          className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0 w-4 h-4 shrink-0"
                        />
                      </label>
                      {groupPreviewInfo && (
                        <div className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900 border border-slate-800/80 text-slate-300 flex items-center justify-between">
                          {groupPreviewInfo.spaceAdjusted ? (
                            <>
                              <span className="text-emerald-400 font-semibold">
                                {groupPreviewInfo.heightPreserved
                                  ? `Line Spacing ${groupPreviewInfo.reclaimedSpacePx ? `+${groupPreviewInfo.reclaimedSpacePx}px` : "Fit"}`
                                  : `Space ${groupPreviewInfo.deltaHeight >= 0 ? `+${groupPreviewInfo.deltaHeight}` : groupPreviewInfo.deltaHeight}px`}
                              </span>
                              <span className="text-slate-400">
                                {groupPreviewInfo.width} × {groupPreviewInfo.height}px
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-amber-300">
                                {groupConfig.autoAdjustSpace ? "No blank band detected (auto-fit)" : "Fixed template height"}
                              </span>
                              <span className="text-slate-400">
                                {groupPreviewInfo.width} × {groupPreviewInfo.height}px
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {groupConfig.autoAdjustSpace && groupPreviewInfo?.spaceAdjusted ? (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-400">Top / Bottom Space Padding</span>
                          <span className="font-mono text-emerald-300">
                            {groupConfig.spacePaddingPercent.toFixed(1)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={6.0}
                          step={0.25}
                          value={groupConfig.spacePaddingPercent}
                          onChange={e =>
                            setGroupConfig(p => ({
                              ...p,
                              spacePaddingPercent: Number(e.target.value),
                            }))
                          }
                          className="w-full accent-emerald-500"
                        />
                      </div>
                    ) : null}

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">
                          {groupPreviewInfo?.spaceAdjusted ? "Target Gap Anchor Y" : "List Start Y Position"}
                        </span>
                        <span className="font-mono text-violet-300">{groupConfig.startYPercent}%</span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={85}
                        step={1}
                        value={groupConfig.startYPercent}
                        onChange={e =>
                          setGroupConfig(p => ({ ...p, startYPercent: Number(e.target.value) }))
                        }
                        className="w-full accent-violet-500"
                      />
                    </div>

                    {(!groupConfig.autoAdjustSpace || !groupPreviewInfo?.spaceAdjusted) && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-slate-400">Bottom Limit Y (Auto-Fit)</span>
                          <span className="font-mono text-violet-300">
                            {groupConfig.endYPercent ?? "Auto"}
                            {groupConfig.endYPercent !== undefined ? "%" : ""}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={Math.min(92, groupConfig.startYPercent + 6)}
                          max={96}
                          step={1}
                          value={
                            groupConfig.endYPercent ??
                            (groupPreviewInfo?.detectedGap
                              ? Math.round((groupPreviewInfo.detectedGap.bottomY / groupPreviewInfo.originalHeight) * 100)
                              : 90)
                          }
                          onChange={e =>
                            setGroupConfig(p => ({ ...p, endYPercent: Number(e.target.value) }))
                          }
                          className="w-full accent-violet-500"
                        />
                      </div>
                    )}

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">Font Size Scale</span>
                        <span className="font-mono text-violet-300">
                          {Math.round(groupConfig.fontScale * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.4}
                        max={1.6}
                        step={0.05}
                        value={groupConfig.fontScale}
                        onChange={e =>
                          setGroupConfig(p => ({ ...p, fontScale: Number(e.target.value) }))
                        }
                        className="w-full accent-violet-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">Line Spacing</span>
                        <span className="font-mono text-violet-300">
                          {groupConfig.lineGapScale.toFixed(2)}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1.1}
                        max={2.4}
                        step={0.05}
                        value={groupConfig.lineGapScale}
                        onChange={e =>
                          setGroupConfig(p => ({ ...p, lineGapScale: Number(e.target.value) }))
                        }
                        className="w-full accent-violet-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-950 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPreviewGroupKey(null);
                    setMultiRowPreviewTarget(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  Close Preview
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePrintCard(groupPreviewCanvasRef.current, activePreviewGroup.displayValue)}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors"
                    title="Print card directly to printer"
                  >
                    <Printer size={14} className="text-sky-400" />
                    <span>Print Card</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGroupCardAction(activePreviewGroup, "share")}
                    disabled={processingGroupKey === activePreviewGroup.key}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/30 text-xs font-semibold disabled:opacity-50"
                  >
                    <Share2 size={14} />
                    <span>Share Group Image</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleGroupCardAction(activePreviewGroup, "download")}
                    disabled={processingGroupKey === activePreviewGroup.key}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg disabled:opacity-50"
                  >
                    {processingGroupKey === activePreviewGroup.key ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    <span>Download Group PNG</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MODAL 6: SINGLE-ROW PREVIEW & IMAGE SELECTOR MODAL */}
        {activeSinglePreviewItem && activeSinglePreviewSelection && (
          <div className="fixed inset-0 z-[178] flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4">
            <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[94vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-sky-600/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                    <Eye size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-bold text-white truncate">
                        Preview & Select Image:{" "}
                        {activeSinglePreviewItem.rowName ||
                          activeSinglePreviewItem.rowValues?.[effectiveRuleFieldId] ||
                          "Record"}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-400 hidden sm:block">
                      Review the rendered card and choose which template image to print on
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setPreviewSingleItemId(null)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                <div className="flex-1 bg-slate-950 p-4 flex items-center justify-center overflow-auto relative min-h-[260px]">
                  <canvas
                    ref={singlePreviewCanvasRef}
                    className="max-w-full max-h-[65vh] lg:max-h-[72vh] object-contain rounded-lg shadow-2xl border border-slate-800 bg-black"
                  />
                  {isRenderingSinglePreview && (
                    <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-slate-700 text-[11px] text-slate-300">
                      <RefreshCw size={12} className="animate-spin text-sky-400" />
                      <span>Rendering...</span>
                    </div>
                  )}
                </div>

                <div className="w-full lg:w-[375px] border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/95 overflow-y-auto p-4 space-y-4 text-xs shrink-0">
                  {renderPreviewImageSelector(
                    `row_${activeSinglePreviewItem.id}`,
                    activeSinglePreviewSelection,
                    "manualSingle"
                  )}

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Record Data
                    </div>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {activeLayers.map(layer => {
                        const val = activeSinglePreviewItem.rowValues?.[layer.id] || "";
                        const suf =
                          layer.hasSuffixList && activeSinglePreviewItem.rowValues?.[`${layer.id}__suffix`]
                            ? ` ${activeSinglePreviewItem.rowValues[`${layer.id}__suffix`]}`
                            : "";
                        return (
                          <div key={layer.id} className="text-xs flex items-start justify-between gap-2 border-b border-slate-900 pb-1 last:border-b-0">
                            <span className="text-slate-400 shrink-0">{layer.name}:</span>
                            <span className="text-slate-200 font-medium text-right break-words">
                              {val ? `${val}${suf}` : "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-950 shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewSingleItemId(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  Close Preview
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePrintCard(singlePreviewCanvasRef.current, activeSinglePreviewItem.rowName || "Card")}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors"
                    title="Print card directly to printer"
                  >
                    <Printer size={14} className="text-sky-400" />
                    <span>Print Card</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const idx = Math.max(
                        0,
                        items.findIndex(i => i.id === activeSinglePreviewItem.id)
                      );
                      handleRowCardAction(activeSinglePreviewItem, idx, "share");
                    }}
                    disabled={processingRowId === activeSinglePreviewItem.id}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/30 text-xs font-semibold disabled:opacity-50"
                  >
                    <Share2 size={14} />
                    <span>Share Image</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const idx = Math.max(
                        0,
                        items.findIndex(i => i.id === activeSinglePreviewItem.id)
                      );
                      handleRowCardAction(activeSinglePreviewItem, idx, "download");
                    }}
                    disabled={processingRowId === activeSinglePreviewItem.id}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg disabled:opacity-50"
                  >
                    {processingRowId === activeSinglePreviewItem.id ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    <span>Download PNG</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MODAL 7: TEMPLATE IMAGES & AUTO-RULES MANAGER */}
        {showTemplateManagerModal && (
          <div className="fixed inset-0 z-[182] flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4">
            <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-sky-600/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                    <ImageIcon size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-white truncate">
                      Project Template Images & Auto-Selection Rules
                    </h3>
                    <p className="text-xs text-slate-400">
                      Upload multiple background images within this project and auto-pick based on row count & name ending
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowTemplateManagerModal(false)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
                {/* Gallery of Project Images */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Saved Background Images ({projectTemplates.length + 1})
                    </h4>
                    <button
                      type="button"
                      disabled={isUploadingTemplate}
                      onClick={() => triggerTemplateUpload(null)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold shadow-sm disabled:opacity-50"
                    >
                      {isUploadingTemplate ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Plus size={13} />
                      )}
                      <span>Upload New Image</span>
                    </button>
                  </div>

                  {isLoadingTemplates ? (
                    <div className="flex items-center gap-2 text-slate-400 py-4">
                      <RefreshCw size={14} className="animate-spin text-sky-400" />
                      <span>Loading template images...</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {/* Default Image */}
                      <div className="rounded-xl border border-slate-700 bg-slate-950 overflow-hidden flex flex-col justify-between">
                        <div>
                          <div className="aspect-[4/3] w-full bg-black overflow-hidden relative">
                            <img src={image} alt="Default Image" className="w-full h-full object-cover" />
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-emerald-600/90 text-white text-[9px] font-bold shadow">
                              Default Canvas
                            </span>
                          </div>
                          <div className="p-2">
                            <div className="font-semibold text-white truncate text-xs">Default Image</div>
                            <div className="text-[10px] text-slate-400">Primary project canvas</div>
                          </div>
                        </div>
                        <div className="px-2 pb-2">
                          <button
                            type="button"
                            onClick={() => {
                              updateImageRules({ singleFallbackTemplateId: "" });
                              onNotification({ message: "Default Image set as fallback", type: "success" });
                            }}
                            className="w-full py-1 text-[10px] font-semibold rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                          >
                            Use as Fallback
                          </button>
                        </div>
                      </div>

                      {/* Additional Template Images */}
                      {projectTemplates.map(tpl => {
                        const isMale = activeRules.maleTemplateId === tpl.id;
                        const isFemale = activeRules.femaleTemplateId === tpl.id;
                        const isMulti = activeRules.multipleTemplateId === tpl.id;

                        return (
                          <div
                            key={tpl.id}
                            className="rounded-xl border border-slate-700 bg-slate-950 overflow-hidden flex flex-col justify-between"
                          >
                            <div>
                              <div className="aspect-[4/3] w-full bg-black overflow-hidden relative">
                                <img src={tpl.url} alt={tpl.name} className="w-full h-full object-cover" />
                                <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                                  {isMale && (
                                    <span className="px-1.5 py-0.5 rounded bg-sky-600/95 text-white text-[9px] font-bold shadow">
                                      Male (මයා/මහතා)
                                    </span>
                                  )}
                                  {isFemale && (
                                    <span className="px-1.5 py-0.5 rounded bg-pink-600/95 text-white text-[9px] font-bold shadow">
                                      Female (මිය/මහත්මිය)
                                    </span>
                                  )}
                                  {isMulti && (
                                    <span className="px-1.5 py-0.5 rounded bg-violet-600/95 text-white text-[9px] font-bold shadow">
                                      Multi-Row (2+)
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTemplate(tpl)}
                                  className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-black/75 hover:bg-rose-600 text-slate-300 hover:text-white transition-colors"
                                  title="Delete template"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                              <div className="p-2">
                                <input
                                  type="text"
                                  defaultValue={tpl.name}
                                  onBlur={e => {
                                    if (e.target.value.trim() && e.target.value.trim() !== tpl.name) {
                                      handleRenameTemplate(tpl.id, e.target.value);
                                    }
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white outline-none"
                                  title="Click to rename image"
                                />
                              </div>
                            </div>
                            <div className="px-2 pb-2 grid grid-cols-3 gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  updateImageRules({ enabled: true, maleTemplateId: tpl.id });
                                  onNotification({ message: `Set "${tpl.name}" as Male template`, type: "success" });
                                }}
                                className={cn(
                                  "py-0.5 text-[9px] font-bold rounded border transition-colors text-center",
                                  isMale ? "bg-sky-500/25 text-sky-200 border-sky-500/50" : "bg-slate-900 text-slate-400 border-slate-800 hover:text-sky-300"
                                )}
                                title="Auto-use for 1 record ending with male suffix (මයා, මහතා...)"
                              >
                                Male
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  updateImageRules({ enabled: true, femaleTemplateId: tpl.id });
                                  onNotification({ message: `Set "${tpl.name}" as Female template`, type: "success" });
                                }}
                                className={cn(
                                  "py-0.5 text-[9px] font-bold rounded border transition-colors text-center",
                                  isFemale ? "bg-pink-500/25 text-pink-200 border-pink-500/50" : "bg-slate-900 text-slate-400 border-slate-800 hover:text-pink-300"
                                )}
                                title="Auto-use for 1 record ending with female suffix (මිය, මහත්මිය...)"
                              >
                                Female
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  updateImageRules({ enabled: true, multipleTemplateId: tpl.id });
                                  onNotification({ message: `Set "${tpl.name}" as Multi-Row template`, type: "success" });
                                }}
                                className={cn(
                                  "py-0.5 text-[9px] font-bold rounded border transition-colors text-center",
                                  isMulti ? "bg-violet-500/25 text-violet-200 border-violet-500/50" : "bg-slate-900 text-slate-400 border-slate-800 hover:text-violet-300"
                                )}
                                title="Auto-use when printing multiple records together"
                              >
                                Multi
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Rules Configuration */}
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-sky-300 flex items-center gap-1.5">
                        <Sparkles size={14} />
                        <span>Conditional Print Image Rules</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Automatically pick the matching background image (you can still override inside Preview).
                      </p>
                    </div>
                    <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeRules.enabled}
                        onChange={e => updateImageRules({ enabled: e.target.checked })}
                        className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-0"
                      />
                      <span className="font-semibold text-white">Enable Rules</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[11px] font-semibold text-slate-300">
                        Field to Check Name Ending (when group or selection has 1 record)
                      </label>
                      <select
                        value={effectiveRuleFieldId}
                        onChange={e => updateImageRules({ nameFieldId: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-sky-500"
                      >
                        {activeLayers.map(l => (
                          <option key={l.id} value={l.id}>
                            {l.name || "Untitled Field"}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Male Rule */}
                    <div className="p-3 rounded-xl bg-slate-900/70 border border-sky-500/20 space-y-2">
                      <div className="font-bold text-sky-300">
                        1 Record • Name Ends With Male
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={activeRules.maleTemplateId}
                          onChange={e => updateImageRules({ maleTemplateId: e.target.value })}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none min-w-0"
                        >
                          <option value="">Default Project Image</option>
                          {projectTemplates.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => triggerTemplateUpload("male")}
                          className="px-2.5 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 font-semibold shrink-0"
                        >
                          + Upload
                        </button>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400">Endings (comma separated):</label>
                        <input
                          type="text"
                          value={activeRules.maleEndings}
                          onChange={e => updateImageRules({ maleEndings: e.target.value })}
                          className="mt-0.5 w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    {/* Female Rule */}
                    <div className="p-3 rounded-xl bg-slate-900/70 border border-pink-500/20 space-y-2">
                      <div className="font-bold text-pink-300">
                        1 Record • Name Ends With Female
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={activeRules.femaleTemplateId}
                          onChange={e => updateImageRules({ femaleTemplateId: e.target.value })}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none min-w-0"
                        >
                          <option value="">Default Project Image</option>
                          {projectTemplates.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => triggerTemplateUpload("female")}
                          className="px-2.5 py-1.5 rounded-lg bg-pink-600/20 hover:bg-pink-600/30 text-pink-300 border border-pink-500/30 font-semibold shrink-0"
                        >
                          + Upload
                        </button>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400">Endings (comma separated):</label>
                        <input
                          type="text"
                          value={activeRules.femaleEndings}
                          onChange={e => updateImageRules({ femaleEndings: e.target.value })}
                          className="mt-0.5 w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-pink-500"
                        />
                      </div>
                    </div>

                    {/* Multiple Rows Rule */}
                    <div className="p-3 rounded-xl bg-slate-900/70 border border-violet-500/20 space-y-2">
                      <div className="font-bold text-violet-300">
                        Multiple Records (2 or more rows in group)
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={activeRules.multipleTemplateId}
                          onChange={e => updateImageRules({ multipleTemplateId: e.target.value })}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none min-w-0"
                        >
                          <option value="">Default Project Image</option>
                          {projectTemplates.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => triggerTemplateUpload("multiple")}
                          className="px-2.5 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 font-semibold shrink-0"
                        >
                          + Upload
                        </button>
                      </div>
                    </div>

                    {/* Single Fallback Rule */}
                    <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-700 space-y-2">
                      <div className="font-bold text-slate-300">
                        1 Record • Other Ending (Fallback)
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={activeRules.singleFallbackTemplateId}
                          onChange={e => updateImageRules({ singleFallbackTemplateId: e.target.value })}
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none min-w-0"
                        >
                          <option value="">Default Project Image</option>
                          {projectTemplates.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => triggerTemplateUpload("fallback")}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 font-semibold shrink-0"
                        >
                          + Upload
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-950 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowTemplateManagerModal(false)}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MODAL 5: IN-APP CONFIRMATION DIALOG */}
        {confirmDialog && (
          <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-md w-full p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                  <Trash2 size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    {confirmDialog.title}
                  </h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {confirmDialog.message}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isConfirmExecuting}
                  onClick={() => setConfirmDialog(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isConfirmExecuting}
                  onClick={async () => {
                    setIsConfirmExecuting(true);
                    try {
                      await confirmDialog.onConfirm();
                    } finally {
                      setIsConfirmExecuting(false);
                      setConfirmDialog(null);
                    }
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg disabled:opacity-50 transition-colors"
                >
                  {isConfirmExecuting ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                  <span>{confirmDialog.confirmLabel}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
