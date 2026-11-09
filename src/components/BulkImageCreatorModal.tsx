import React, { useState, useRef, useEffect, useMemo } from "react";
import { 
  X, Plus, Trash2, Copy, Download, Sparkles, FileSpreadsheet, Upload, 
  Eye, Check, AlertCircle, RefreshCw, Layers, ArrowDown, ChevronRight, FileDown, 
  CheckCircle2, Calendar, Share2, MessageCircle, Clock, Search, CheckCheck, FileUp,
  Coins, Tag, MoreVertical
} from "lucide-react";
import { 
  TextLayer, Font, prepareLayersForRow, generateBulkCardsZip, 
  generateCardBlob, BulkCardResult, renderLayersOnCanvas, loadImage
} from "../utils/cardRenderer";
import { convertNumberToSinhala } from "../utils/sinhalaConverter";
import { cn } from "../lib/utils";

/**
 * Checks if a layer represents a numeric Price tag column
 */
export function isPriceLayer(layer?: Partial<TextLayer> | null): boolean {
  if (!layer) return false;
  if (layer.type === 'number') return true;
  // Ignore linked words labels or list labels
  if (layer.isNumberLabel || layer.isListLabel) return false;
  const nameLower = (layer.name || '').toLowerCase().trim();
  return (
    nameLower.includes('price') || 
    nameLower.includes('මුදල') || 
    nameLower.includes('ගාස්තුව') || 
    nameLower.includes('මිල') || 
    nameLower.includes('amount') || 
    nameLower.includes('cost') || 
    nameLower.includes('fee') ||
    nameLower.includes('rate') ||
    nameLower.includes('tag')
  );
}

/**
 * Safely parses any number, currency string, or formatted price into a float
 */
export function parsePriceValue(val: any): number {
  if (val === undefined || val === null) return 0;
  const str = String(val).trim();
  if (!str) return 0;
  const cleaned = str
    .replace(/[RsrsLKRlkr\$\/\=\-]/g, "")
    .replace(/,/g, "")
    .trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Formats a number with comma separators
 */
export function formatPriceNumber(num: number): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export interface BulkRow {
  id: string;
  name: string;
  values: Record<string, string>;
}

interface ImageProject {
  id: string;
  username: string;
  imageUrl: string;
  layers: TextLayer[];
  name: string;
  createdAt: string;
  isLocked?: boolean;
  copiesCount?: number;
  downloadsCount?: number;
  sharesCount?: number;
  creationsCount?: number;
}

export interface BulkHistoryBatch {
  id: string;
  projectId: string;
  projectName: string;
  username: string;
  createdAt: string;
  createdDate: string;
  totalCards: number;
  rowsData: BulkRow[];
  layersData: TextLayer[];
}

export interface BulkHistoryDateSummary {
  date: string;
  batchCount: number;
  totalCards: number;
}

interface BulkImageCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ImageProject;
  image: string;
  fonts: Font[];
  user: { username: string; role: 'admin' | 'user' } | null;
  onRecordCreationEvents: (count: number, type?: 'copy' | 'download' | 'share') => Promise<void>;
  onNotification: (notif: { message: string; type: 'success' | 'error' | 'info' }) => void;
}

interface GeneratedCardData {
  blob: Blob;
  dataUrl: string;
  filename: string;
  name: string;
  createdAt: number;
}

export function BulkImageCreatorModal({
  isOpen,
  onClose,
  project,
  image,
  fonts,
  user,
  onRecordCreationEvents,
  onNotification,
}: BulkImageCreatorModalProps) {
  // Active Tab: 'editor' (Generator) or 'history' (Creation History)
  const [activeTab, setActiveTab] = useState<'editor' | 'history'>('editor');

  // Track mobile visual viewport (keyboard height changes) so the modal never overflows under the keyboard
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

    updateHeight();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateHeight);
    }
    window.addEventListener("resize", updateHeight);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateHeight);
      }
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  // Columns are the project's visible layers
  const activeLayers = useMemo(() => {
    return (project.layers || []).filter(l => l.visible !== false);
  }, [project.layers]);

  // Initial rows: default to 1 row pre-filled with current project layer values
  const [rows, setRows] = useState<BulkRow[]>(() => {
    const initialValues: Record<string, string> = {};
    activeLayers.forEach(l => {
      initialValues[l.id] = l.text || "";
      if (l.hasSuffixList && l.selectedSuffix) {
        initialValues[`${l.id}__suffix`] = l.selectedSuffix;
      }
    });
    return [
      {
        id: `row_1_${Date.now()}`,
        name: `${project.name} 1`,
        values: initialValues,
      }
    ];
  });

  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number; status: string }>({
    current: 0,
    total: 0,
    status: "",
  });

  // Map of generated cards for each row in the editor
  const [generatedCardsMap, setGeneratedCardsMap] = useState<Record<string, GeneratedCardData>>({});

  // Price tag column totals and statistics for current editor rows
  const priceColumnTotals = useMemo(() => {
    const totals: Record<string, { total: number; count: number; avg: number; label: string }> = {};
    activeLayers.forEach(layer => {
      if (isPriceLayer(layer)) {
        let sum = 0;
        let count = 0;
        rows.forEach(r => {
          const val = parsePriceValue(r.values[layer.id]);
          if (val > 0) {
            sum += val;
            count++;
          }
        });
        totals[layer.id] = {
          total: sum,
          count,
          avg: count > 0 ? sum / count : 0,
          label: layer.name || "Price",
        };
      }
    });
    return totals;
  }, [activeLayers, rows]);

  const priceColumnsList = useMemo(() => {
    return Object.entries(priceColumnTotals);
  }, [priceColumnTotals]);
  
  // Modals & Panels
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteRawText, setPasteRawText] = useState("");
  const [pasteHasHeaders, setPasteHasHeaders] = useState(true);
  const [showLivePreview, setShowLivePreview] = useState(false);

  // Single card share fallback modal
  const [shareTargetCard, setShareTargetCard] = useState<{ name: string; filename: string; blob: Blob; dataUrl: string } | null>(null);
  const [isProcessingRowId, setIsProcessingRowId] = useState<string | null>(null);
  const [activeKebabRowId, setActiveKebabRowId] = useState<string | null>(null);

  // Close kebab menu when clicking anywhere outside
  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveKebabRowId(null);
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  // History states
  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>(todayStr);
  const [historyBatches, setHistoryBatches] = useState<BulkHistoryBatch[]>([]);
  const [historyDates, setHistoryDates] = useState<BulkHistoryDateSummary[]>([]);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Preview canvas ref
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageObjRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load base background image once
  useEffect(() => {
    if (!image) return;
    let isMounted = true;
    loadImage(image).then(img => {
      if (isMounted) {
        bgImageObjRef.current = img;
        drawPreview();
      }
    }).catch(err => {
      console.error("Failed to load project background image for bulk preview", err);
    });
    return () => {
      isMounted = false;
    };
  }, [image]);

  // Redraw preview whenever selectedRowIndex or row values change
  const drawPreview = async () => {
    const canvas = previewCanvasRef.current;
    const img = bgImageObjRef.current;
    if (!canvas || !img || rows.length === 0) return;

    const currentRow = rows[selectedRowIndex] || rows[0];
    if (!currentRow) return;

    const rowLayers = prepareLayersForRow(activeLayers, currentRow.values);

    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    ctx.drawImage(img, 0, 0);
    await renderLayersOnCanvas(ctx, canvas.width, canvas.height, rowLayers, fonts, {
      isPreviewMode: true,
      isExporting: true,
    });
  };

  useEffect(() => {
    if (isOpen && bgImageObjRef.current && activeTab === 'editor') {
      drawPreview();
    }
  }, [selectedRowIndex, rows, isOpen, activeLayers, fonts, activeTab]);

  // Load History from DB and local storage
  const loadHistory = async (dateFilter?: string) => {
    setIsLoadingHistory(true);
    try {
      const q = new URLSearchParams();
      if (project.id && project.id !== 'temp') {
        q.append('projectId', project.id);
      }
      if (user?.username) {
        q.append('username', user.username);
      }
      if (dateFilter && dateFilter !== 'all') {
        q.append('date', dateFilter);
      }

      // Fetch remote history
      const res = await fetch(`/api/bulk-history?${q.toString()}`);
      let serverBatches: BulkHistoryBatch[] = [];
      if (res.ok) {
        serverBatches = await res.json();
      }

      // Fetch local storage history fallback/merge
      let localBatches: BulkHistoryBatch[] = [];
      try {
        const localKey = `bulk_history_${project.id}`;
        const rawLocal = localStorage.getItem(localKey);
        if (rawLocal) {
          localBatches = JSON.parse(rawLocal);
        }
      } catch (e) {
        console.warn("Could not read local bulk history", e);
      }

      // Merge by ID
      const batchMap = new Map<string, BulkHistoryBatch>();
      serverBatches.forEach(b => batchMap.set(b.id, b));
      localBatches.forEach(b => {
        if (!batchMap.has(b.id)) {
          if (!dateFilter || dateFilter === 'all' || b.createdDate === dateFilter) {
            batchMap.set(b.id, b);
          }
        }
      });

      const merged = Array.from(batchMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setHistoryBatches(merged);

      // Fetch distinct dates
      const datesRes = await fetch(`/api/bulk-history/dates?projectId=${project.id}&username=${user?.username || ''}`);
      if (datesRes.ok) {
        const dJson = await datesRes.json();
        setHistoryDates(dJson);
      } else {
        // Compute from merged
        const dMap: Record<string, BulkHistoryDateSummary> = {};
        merged.forEach(b => {
          const d = b.createdDate || b.createdAt.split('T')[0];
          if (!dMap[d]) dMap[d] = { date: d, batchCount: 0, totalCards: 0 };
          dMap[d].batchCount++;
          dMap[d].totalCards += b.totalCards || (b.rowsData?.length || 0);
        });
        setHistoryDates(Object.values(dMap).sort((a, b) => b.date.localeCompare(a.date)));
      }
    } catch (err) {
      console.error("Error loading bulk history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Trigger history fetch when switching to history tab or changing selected date
  useEffect(() => {
    if (isOpen && activeTab === 'history') {
      loadHistory(selectedHistoryDate);
    }
  }, [isOpen, activeTab, selectedHistoryDate, project.id]);

  // Ref for table scroll container and pending row to focus
  const tableScrollContainerRef = useRef<HTMLDivElement>(null);
  const pendingFocusRowIndexRef = useRef<number | null>(null);

  // Automatically focus first column when a new row is added
  useEffect(() => {
    if (pendingFocusRowIndexRef.current === null) return;
    const targetIdx = pendingFocusRowIndexRef.current;
    pendingFocusRowIndexRef.current = null;

    const timer = setTimeout(() => {
      const container = tableScrollContainerRef.current;
      if (!container) return;

      const rowEl = container.querySelector(`tr[data-row-index="${targetIdx}"]`) as HTMLElement | null;
      if (rowEl) {
        const inputToFocus = (rowEl.querySelector('[data-first-col="true"]') ||
                              rowEl.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled])')) as HTMLElement | null;
        if (inputToFocus) {
          inputToFocus.focus();
          if (inputToFocus instanceof HTMLInputElement && (inputToFocus.type === 'text' || inputToFocus.type === 'number')) {
            try { inputToFocus.select(); } catch {}
          }
          // Ensure newly focused row is comfortably scrolled into view
          try {
            rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch {}
        }
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [rows.length]);

  // Add new rows and automatically focus the first column of the newly added row
  const handleAddRows = (count: number) => {
    const targetIndex = rows.length;
    pendingFocusRowIndexRef.current = targetIndex;
    setSelectedRowIndex(targetIndex);

    setRows(prev => {
      const next = [...prev];
      for (let i = 0; i < count; i++) {
        const rowNum = next.length + 1;
        const newValues: Record<string, string> = {};
        activeLayers.forEach(l => {
          if (l.type === 'date') {
            newValues[l.id] = new Date().toISOString().split('T')[0];
          } else {
            newValues[l.id] = "";
          }
          if (l.hasSuffixList && l.suffixList && l.suffixList.length > 0) {
            newValues[`${l.id}__suffix`] = l.selectedSuffix || l.suffixList[0];
          }
        });
        next.push({
          id: `row_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: `${project.name} ${rowNum}`,
          values: newValues,
        });
      }
      return next;
    });
  };

  // Duplicate a row
  const handleDuplicateRow = (idx: number) => {
    pendingFocusRowIndexRef.current = idx + 1;
    setSelectedRowIndex(idx + 1);
    setRows(prev => {
      const target = prev[idx];
      if (!target) return prev;
      const copy: BulkRow = {
        id: `row_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: `${target.name} (Copy)`,
        values: { ...target.values },
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  };

  // Delete a row
  const handleDeleteRow = (idx: number) => {
    if (rows.length <= 1) {
      onNotification({ message: "At least one row is required", type: "info" });
      return;
    }
    const targetRow = rows[idx];
    setRows(prev => prev.filter((_, i) => i !== idx));
    if (targetRow) {
      setGeneratedCardsMap(prev => {
        const copy = { ...prev };
        delete copy[targetRow.id];
        return copy;
      });
    }
    if (selectedRowIndex >= rows.length - 1) {
      setSelectedRowIndex(Math.max(0, rows.length - 2));
    }
  };

  // Update a single cell
  const handleCellChange = (rowIndex: number, layerId: string, value: string) => {
    setRows(prev => {
      const next = [...prev];
      const targetRow = { ...next[rowIndex], values: { ...next[rowIndex].values } };
      targetRow.values[layerId] = value;

      // Check if this layer is a number layer with linked number labels
      const thisLayer = activeLayers.find(l => l.id === layerId);
      if (thisLayer && thisLayer.type === 'number') {
        const linkedLabels = activeLayers.filter(l => l.linkedNumberId === layerId);
        linkedLabels.forEach(lbl => {
          const mode = lbl.numberFontMode || thisLayer.numberFontMode || 'fm';
          targetRow.values[lbl.id] = convertNumberToSinhala(value, mode) || "";
        });
      }

      next[rowIndex] = targetRow;
      return next;
    });

    // Invalidate cached generated card for this row since value changed
    const targetId = rows[rowIndex]?.id;
    if (targetId && generatedCardsMap[targetId]) {
      setGeneratedCardsMap(prev => {
        const copy = { ...prev };
        delete copy[targetId];
        return copy;
      });
    }
  };

  // Update row name / card title
  const handleRowNameChange = (rowIndex: number, name: string) => {
    setRows(prev => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], name };
      return next;
    });
  };

  // Download CSV template
  const handleDownloadCsvTemplate = () => {
    const headers = activeLayers.map(l => l.name || l.id);
    const sampleRow = activeLayers.map(l => l.text || "");
    const csvContent = "data:text/csv;charset=utf-8," + [
      headers.map(h => `"${h.replace(/"/g, '""')}"`).join(","),
      sampleRow.map(v => `"${v.replace(/"/g, '""')}"`).join(",")
    ].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${project.name.replace(/\s+/g, "_")}_Bulk_Template.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // Parse TSV/CSV text from clipboard or paste modal
  const handleParsePastedData = () => {
    if (!pasteRawText.trim()) {
      setShowPasteModal(false);
      return;
    }

    const lines = pasteRawText.trim().split(/\r\n|\n|\r/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return;

    const firstLine = lines[0];
    const delimiter = firstLine.includes("\t") ? "\t" : ",";

    const parseLine = (line: string): string[] => {
      if (delimiter === "\t") {
        return line.split("\t").map(s => s.trim().replace(/^"|"$/g, ''));
      }
      const result: string[] = [];
      let inQuotes = false;
      let current = "";
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const parsedLines = lines.map(parseLine);
    let dataRows = parsedLines;
    if (pasteHasHeaders && parsedLines.length > 1) {
      dataRows = parsedLines.slice(1);
    }

    const newRows: BulkRow[] = dataRows.map((cols, idx) => {
      const rowNum = idx + 1;
      const cardName = cols.length > activeLayers.length ? cols[0] : `${project.name} ${rowNum}`;
      const colOffset = cols.length > activeLayers.length ? 1 : 0;

      const values: Record<string, string> = {};
      activeLayers.forEach((layer, layerIdx) => {
        const cellVal = cols[layerIdx + colOffset] !== undefined ? cols[layerIdx + colOffset] : (layer.text || "");
        values[layer.id] = cellVal;

        if (layer.hasSuffixList && layer.selectedSuffix) {
          values[`${layer.id}__suffix`] = layer.selectedSuffix;
        }
      });

      // Auto-compute linked number labels if empty
      activeLayers.forEach(layer => {
        if (layer.isNumberLabel && layer.linkedNumberId && !values[layer.id]) {
          const parentNumber = activeLayers.find(l => l.id === layer.linkedNumberId);
          if (parentNumber) {
            const numVal = values[parentNumber.id] || "";
            const mode = parentNumber.numberFontMode || layer.numberFontMode || 'fm';
            values[layer.id] = convertNumberToSinhala(numVal, mode) || "";
          }
        }
      });

      return {
        id: `row_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
        name: cardName,
        values,
      };
    });

    if (newRows.length > 0) {
      setRows(newRows);
      setSelectedRowIndex(0);
      setGeneratedCardsMap({});
      onNotification({ message: `Successfully loaded ${newRows.length} rows from clipboard/CSV!`, type: "success" });
    }
    setShowPasteModal(false);
    setPasteRawText("");
  };

  // CSV file upload handler
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setPasteRawText(content);
        setPasteHasHeaders(true);
        setShowPasteModal(true);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Render a single row card helper
  const renderRowCard = async (row: BulkRow, index: number): Promise<GeneratedCardData> => {
    const img = bgImageObjRef.current;
    if (!img) throw new Error("Base image is not loaded");

    const cardTitle = row.name?.trim() || `${project.name} ${index + 1}`;
    const safeFilename = `${String(index + 1).padStart(2, "0")}_${cardTitle.replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_")}.png`;
    const rowLayers = prepareLayersForRow(activeLayers, row.values);

    const blob = await generateCardBlob(img, rowLayers, fonts);
    const dataUrl = URL.createObjectURL(blob);

    const cardData: GeneratedCardData = {
      blob,
      dataUrl,
      filename: safeFilename,
      name: cardTitle,
      createdAt: Date.now(),
    };

    return cardData;
  };

  // Execute bulk creation (DOES NOT download bulk ZIP - generates and shows download/share icons on each row)
  const handleCreateAllImages = async () => {
    if (!bgImageObjRef.current || rows.length === 0) {
      onNotification({ message: "No data rows to generate", type: "error" });
      return;
    }

    setIsGenerating(true);
    setGenerationProgress({
      current: 0,
      total: rows.length,
      status: `Generating ${rows.length} cards...`,
    });

    try {
      const newMap: Record<string, GeneratedCardData> = {};

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cardTitle = row.name?.trim() || `${project.name} ${i + 1}`;
        setGenerationProgress({
          current: i + 1,
          total: rows.length,
          status: `Creating image ${i + 1} of ${rows.length}: ${cardTitle}...`,
        });

        const cardData = await renderRowCard(row, i);
        newMap[row.id] = cardData;
      }

      setGeneratedCardsMap(newMap);

      // Save to Bulk History
      const now = new Date();
      const batchId = `bh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const newBatch: BulkHistoryBatch = {
        id: batchId,
        projectId: project.id || 'temp',
        projectName: project.name || "Bulk Project",
        username: user?.username || 'user',
        createdAt: now.toISOString(),
        createdDate: now.toISOString().split("T")[0],
        totalCards: rows.length,
        rowsData: rows.map(r => ({ id: r.id, name: r.name, values: { ...r.values } })),
        layersData: activeLayers.map(l => ({ ...l })),
      };

      // Save locally
      try {
        const localKey = `bulk_history_${project.id}`;
        const rawLocal = localStorage.getItem(localKey);
        const list: BulkHistoryBatch[] = rawLocal ? JSON.parse(rawLocal) : [];
        list.unshift(newBatch);
        localStorage.setItem(localKey, JSON.stringify(list.slice(0, 50)));
      } catch (e) {
        console.warn("Could not save to local storage", e);
      }

      // Save to server database
      try {
        await fetch("/api/bulk-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newBatch),
        });
      } catch (e) {
        console.warn("Could not save bulk history to server:", e);
      }

      // Track metric
      try {
        await onRecordCreationEvents(rows.length, 'download');
      } catch (err) {
        console.error("Failed to record bulk creation events:", err);
      }

      onNotification({
        message: `Successfully created all ${rows.length} images! Use the Download or Share icons on each row.`,
        type: "success",
      });
    } catch (err) {
      console.error("Bulk card creation error:", err);
      onNotification({
        message: "Failed to create images: " + (err instanceof Error ? err.message : String(err)),
        type: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Optional manual download all as ZIP
  const handleDownloadAllZip = async () => {
    if (!bgImageObjRef.current || rows.length === 0) return;
    setIsGenerating(true);
    setGenerationProgress({
      current: 0,
      total: rows.length,
      status: `Compiling ZIP archive for ${rows.length} cards...`,
    });

    try {
      const { zipBlob } = await generateBulkCardsZip(
        bgImageObjRef.current,
        activeLayers,
        rows,
        fonts,
        (current, total, status) => {
          setGenerationProgress({ current, total, status });
        }
      );

      const safeProjectName = project.name.replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_") || "Cards";
      const dateStr = new Date().toISOString().split("T")[0];
      const zipFileName = `${safeProjectName}_Bulk_Cards_${dateStr}.zip`;

      const downloadUrl = URL.createObjectURL(zipBlob);
      const downloadLink = document.createElement("a");
      downloadLink.href = downloadUrl;
      downloadLink.download = zipFileName;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();

      setTimeout(() => {
        URL.revokeObjectURL(downloadUrl);
      }, 30000);

      onNotification({
        message: `Downloaded ZIP file "${zipFileName}"`,
        type: "success",
      });
    } catch (err) {
      console.error("ZIP download error:", err);
      onNotification({
        message: "Failed to create ZIP: " + (err instanceof Error ? err.message : String(err)),
        type: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Download a single card for a specific row
  const handleDownloadRow = async (row: BulkRow, index: number) => {
    try {
      setIsProcessingRowId(row.id);
      let cardData = generatedCardsMap[row.id];

      if (!cardData) {
        cardData = await renderRowCard(row, index);
        setGeneratedCardsMap(prev => ({ ...prev, [row.id]: cardData }));
      }

      const link = document.createElement("a");
      link.href = cardData.dataUrl;
      link.download = cardData.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();

      onRecordCreationEvents(1, 'download').catch(() => {});
      onNotification({
        message: `Downloaded "${cardData.filename}"`,
        type: "success",
      });
    } catch (err) {
      console.error("Failed to download single card:", err);
      onNotification({
        message: "Download failed: " + (err instanceof Error ? err.message : String(err)),
        type: "error",
      });
    } finally {
      setIsProcessingRowId(null);
    }
  };

  // Share a single card for a specific row
  const handleShareRow = async (row: BulkRow, index: number) => {
    try {
      setIsProcessingRowId(row.id);
      let cardData = generatedCardsMap[row.id];

      if (!cardData) {
        cardData = await renderRowCard(row, index);
        setGeneratedCardsMap(prev => ({ ...prev, [row.id]: cardData }));
      }

      const file = new File([cardData.blob], cardData.filename, { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: cardData.name,
            text: `Card: ${cardData.name}`,
          });
          onRecordCreationEvents(1, 'share').catch(() => {});
          onNotification({ message: "Card shared successfully!", type: "success" });
          return;
        } catch (shareErr) {
          if ((shareErr as Error).name === "AbortError") {
            return;
          }
          console.warn("Native share failed, showing share options modal", shareErr);
        }
      }

      // Fallback modal if native share is not available or failed
      setShareTargetCard({
        name: cardData.name,
        filename: cardData.filename,
        blob: cardData.blob,
        dataUrl: cardData.dataUrl,
      });
    } catch (err) {
      console.error("Failed to share card:", err);
      onNotification({
        message: "Share failed: " + (err instanceof Error ? err.message : String(err)),
        type: "error",
      });
    } finally {
      setIsProcessingRowId(null);
    }
  };

  // Share an item directly from the history batch
  const handleDownloadHistoryItem = async (batch: BulkHistoryBatch, row: BulkRow, index: number) => {
    try {
      const img = bgImageObjRef.current;
      if (!img) throw new Error("Project background image is not loaded");

      const cardTitle = row.name || `Card_${index + 1}`;
      const safeFilename = `${String(index + 1).padStart(2, "0")}_${cardTitle.replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_")}.png`;
      const rowLayers = prepareLayersForRow(batch.layersData || activeLayers, row.values);
      const blob = await generateCardBlob(img, rowLayers, fonts);
      const dataUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = safeFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);

      onRecordCreationEvents(1, 'download').catch(() => {});
      onNotification({ message: `Downloaded "${safeFilename}" from history`, type: "success" });
    } catch (err) {
      console.error("Download history card failed:", err);
      onNotification({ message: "Failed to download card: " + String(err), type: "error" });
    }
  };

  const handleShareHistoryItem = async (batch: BulkHistoryBatch, row: BulkRow, index: number) => {
    try {
      const img = bgImageObjRef.current;
      if (!img) throw new Error("Project background image is not loaded");

      const cardTitle = row.name || `Card_${index + 1}`;
      const safeFilename = `${String(index + 1).padStart(2, "0")}_${cardTitle.replace(/[^a-zA-Z0-9_\u0D80-\u0DFF-]/g, "_")}.png`;
      const rowLayers = prepareLayersForRow(batch.layersData || activeLayers, row.values);
      const blob = await generateCardBlob(img, rowLayers, fonts);
      const dataUrl = URL.createObjectURL(blob);

      const file = new File([blob], safeFilename, { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: cardTitle,
            text: `Card: ${cardTitle}`,
          });
          onRecordCreationEvents(1, 'share').catch(() => {});
          onNotification({ message: "Card shared successfully!", type: "success" });
          setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);
          return;
        } catch (shareErr) {
          if ((shareErr as Error).name === "AbortError") {
            setTimeout(() => URL.revokeObjectURL(dataUrl), 20000);
            return;
          }
        }
      }

      setShareTargetCard({
        name: cardTitle,
        filename: safeFilename,
        blob,
        dataUrl,
      });
    } catch (err) {
      console.error("Share history card failed:", err);
      onNotification({ message: "Failed to share card: " + String(err), type: "error" });
    }
  };

  // Load a history batch back into the current editor table
  const handleLoadBatchIntoEditor = (batch: BulkHistoryBatch) => {
    if (!batch.rowsData || batch.rowsData.length === 0) return;
    setRows(batch.rowsData.map(r => ({ ...r, id: `row_${Date.now()}_${Math.random().toString(36).substring(2, 6)}` })));
    setSelectedRowIndex(0);
    setGeneratedCardsMap({});
    setActiveTab('editor');
    onNotification({
      message: `Loaded ${batch.rowsData.length} entries from history (${batch.createdDate}) into the editor!`,
      type: "success",
    });
  };

  // Delete a history batch
  const handleDeleteBatch = async (batchId: string) => {
    if (!confirm("Are you sure you want to delete this creation history batch?")) return;
    try {
      await fetch(`/api/bulk-history/${batchId}`, { method: "DELETE" });
      setHistoryBatches(prev => prev.filter(b => b.id !== batchId));

      try {
        const localKey = `bulk_history_${project.id}`;
        const rawLocal = localStorage.getItem(localKey);
        if (rawLocal) {
          const list: BulkHistoryBatch[] = JSON.parse(rawLocal);
          localStorage.setItem(localKey, JSON.stringify(list.filter(b => b.id !== batchId)));
        }
      } catch (e) {
        console.warn("Could not update local storage on delete", e);
      }

      onNotification({ message: "History batch deleted", type: "info" });
    } catch (err) {
      console.error("Failed to delete history batch:", err);
    }
  };

  // Copy card image to clipboard
  const handleCopyCardToClipboard = async (blob: Blob) => {
    try {
      if (navigator.clipboard && (window as any).ClipboardItem) {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ "image/png": blob })
        ]);
        onNotification({ message: "Card image copied to clipboard!", type: "success" });
      } else {
        throw new Error("Clipboard write not supported");
      }
    } catch (err) {
      console.warn("Clipboard copy failed:", err);
      onNotification({ message: "Could not copy image to clipboard in this browser", type: "error" });
    }
  };

  // Filtered history batches by search query
  const filteredHistoryBatches = useMemo(() => {
    if (!historySearchQuery.trim()) return historyBatches;
    const q = historySearchQuery.toLowerCase();
    return historyBatches.filter(b => {
      if (b.projectName?.toLowerCase().includes(q)) return true;
      if (b.createdDate?.includes(q)) return true;
      return b.rowsData?.some(r => {
        if (r.name?.toLowerCase().includes(q)) return true;
        return Object.values(r.values || {}).some(v => String(v).toLowerCase().includes(q));
      });
    });
  }, [historyBatches, historySearchQuery]);

  // Layers to display in the unified history table
  const historyLayers = useMemo(() => {
    for (const b of filteredHistoryBatches) {
      if (b.layersData && b.layersData.length > 0) {
        return b.layersData.filter(l => l.visible !== false);
      }
    }
    return activeLayers;
  }, [filteredHistoryBatches, activeLayers]);

  // Flattened history rows across all filtered batches into one continuous list
  const allHistoryRows = useMemo(() => {
    const list: Array<{
      id: string;
      batch: BulkHistoryBatch;
      row: BulkRow;
      originalIndex: number;
      createdAt: number;
      projectName: string;
    }> = [];

    filteredHistoryBatches.forEach(batch => {
      (batch.rowsData || []).forEach((row, rIdx) => {
        list.push({
          id: `${batch.id}_${row.id || rIdx}`,
          batch,
          row,
          originalIndex: rIdx,
          createdAt: batch.createdAt,
          projectName: batch.projectName || project.name,
        });
      });
    });

    return list;
  }, [filteredHistoryBatches, project.name]);

  // Unified totals across all cards in the list for price layers
  const historyUnifiedPriceTotals = useMemo(() => {
    const totals: Record<string, { id: string; label: string; total: number; count: number }> = {};
    historyLayers.forEach(layer => {
      if (isPriceLayer(layer)) {
        let sum = 0;
        let count = 0;
        allHistoryRows.forEach(item => {
          const val = parsePriceValue(item.row.values?.[layer.id]);
          if (val > 0) {
            sum += val;
            count++;
          }
        });
        totals[layer.id] = {
          id: layer.id,
          label: layer.name || "Price",
          total: sum,
          count,
        };
      }
    });
    return totals;
  }, [historyLayers, allHistoryRows]);

  // Load all history cards from current view into the bulk generator editor
  const handleLoadAllHistoryIntoEditor = () => {
    if (allHistoryRows.length === 0) return;
    setRows(allHistoryRows.map((item, idx) => ({
      ...item.row,
      id: `row_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
    })));
    setSelectedRowIndex(0);
    setGeneratedCardsMap({});
    setActiveTab('editor');
    onNotification({
      message: `Loaded all ${allHistoryRows.length} cards from history into the editor!`,
      type: "success",
    });
  };

  // Delete all batches for the selected date
  const handleClearDateHistory = async () => {
    if (filteredHistoryBatches.length === 0) return;
    const count = allHistoryRows.length;
    const dateLabel = selectedHistoryDate === 'all' ? 'all dates' : selectedHistoryDate;
    if (!confirm(`Are you sure you want to delete all ${count} history cards for ${dateLabel}?`)) return;

    try {
      for (const b of filteredHistoryBatches) {
        await fetch(`/api/bulk-history/${b.id}`, { method: "DELETE" });
      }
      const batchIdsToRemove = new Set(filteredHistoryBatches.map(b => b.id));
      setHistoryBatches(prev => prev.filter(b => !batchIdsToRemove.has(b.id)));

      try {
        const localKey = `bulk_history_${project.id}`;
        const rawLocal = localStorage.getItem(localKey);
        if (rawLocal) {
          const list: BulkHistoryBatch[] = JSON.parse(rawLocal);
          localStorage.setItem(localKey, JSON.stringify(list.filter(b => !batchIdsToRemove.has(b.id))));
        }
      } catch (e) {
        console.warn("Could not update local storage on delete", e);
      }

      onNotification({ message: `History cleared for ${dateLabel}`, type: "info" });
    } catch (err) {
      console.error("Failed to delete history batches:", err);
      onNotification({ message: "Failed to clear history", type: "error" });
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[150] flex items-start sm:items-center justify-center bg-black/85 backdrop-blur-md p-0 sm:p-4 overflow-hidden animate-in fade-in duration-200"
      style={{
        height: mobileViewportHeight ? `${mobileViewportHeight}px` : undefined,
        maxHeight: mobileViewportHeight ? `${mobileViewportHeight}px` : undefined,
      }}
    >
      <div 
        style={{
          height: mobileViewportHeight ? `${mobileViewportHeight}px` : undefined,
          maxHeight: mobileViewportHeight ? `${mobileViewportHeight}px` : undefined,
        }}
        className="bg-slate-900 border-0 sm:border border-slate-800 rounded-none sm:rounded-2xl shadow-2xl flex flex-col w-full sm:max-w-[96vw] h-full sm:h-[92vh] max-h-full sm:max-h-[96vh] overflow-hidden"
      >
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-800/90 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Layers size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                Bulk Card Generator
              </h2>
            </div>
          </div>

          {/* Tab Selector & Controls */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('editor')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                  activeTab === 'editor'
                    ? "bg-blue-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                )}
              >
                <FileSpreadsheet size={14} />
                <span>Bulk Generator</span>
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all relative",
                  activeTab === 'history'
                    ? "bg-blue-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                )}
              >
                <Calendar size={14} />
                <span>History</span>
                {historyBatches.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 text-[10px] font-mono rounded-full bg-slate-800 text-blue-300 border border-slate-700">
                    {historyBatches.length}
                  </span>
                )}
              </button>
            </div>

            {activeTab === 'editor' && (
              <button
                onClick={() => setShowLivePreview(!showLivePreview)}
                className={cn(
                  "hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                  showLivePreview 
                    ? "bg-blue-600/20 text-blue-300 border-blue-500/30" 
                    : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
                )}
                title="Toggle Live Card Preview"
              >
                <Eye size={14} />
                <span>{showLivePreview ? "Preview On" : "Preview Off"}</span>
              </button>
            )}

            <button
              onClick={onClose}
              disabled={isGenerating}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* TAB 1: BULK GENERATOR (EDITOR) */}
        {activeTab === 'editor' && (
          <>
            {/* Toolbar Bar */}
            <div className="flex items-center justify-between gap-1.5 sm:gap-2 px-2.5 sm:px-6 py-1.5 sm:py-2.5 bg-slate-950/60 border-b border-slate-800/80 shrink-0 text-xs overflow-x-auto">
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Paste from Excel Button */}
                <button
                  onClick={() => setShowPasteModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-medium transition-colors"
                  title="Paste tab-separated data copied from Excel or Google Sheets"
                >
                  <FileSpreadsheet size={14} className="text-emerald-400" />
                  <span>Paste from Excel / CSV</span>
                </button>

                {/* Upload CSV */}
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-medium cursor-pointer transition-colors">
                  <Upload size={13} />
                  <span>Import CSV</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    onChange={handleCsvFileUpload}
                    className="hidden"
                  />
                </label>

                {/* Download Template */}
                <button
                  onClick={handleDownloadCsvTemplate}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  title="Download empty CSV template matching current project columns"
                >
                  <FileDown size={13} />
                  <span className="hidden sm:inline">CSV Template</span>
                </button>

                {/* Reset Rows */}
                {rows.length > 1 && (
                  <button
                    onClick={() => {
                      if (confirm("Reset rows back to 1 entry?")) {
                        setRows([rows[0]]);
                        setSelectedRowIndex(0);
                        setGeneratedCardsMap({});
                      }
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Clear extra rows"
                  >
                    <Trash2 size={13} />
                    <span>Reset</span>
                  </button>
                )}
              </div>

              {/* Action Buttons: Create Button (no bulk download) + Optional ZIP download */}
              <div className="flex items-center gap-2">
                {/* Optional manual download all ZIP */}
                <button
                  onClick={handleDownloadAllZip}
                  disabled={isGenerating || rows.length === 0}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium transition-colors"
                  title="Optionally download all cards in a single ZIP file"
                >
                  <FileDown size={14} />
                  <span>Download All (ZIP)</span>
                </button>

                {/* Primary Create Button (Does NOT auto-download bulk - prepares each row with download & share) */}
                <button
                  onClick={handleCreateAllImages}
                  disabled={isGenerating || rows.length === 0}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-lg",
                    isGenerating || rows.length === 0
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98]"
                  )}
                  title="Render cards for each row and enable individual download and share icons"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw size={15} className="animate-spin text-white" />
                      <span>Generating {generationProgress.current}/{generationProgress.total}...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} className="text-amber-300" />
                      <span>Create All {rows.length} Images</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Main Content Area: Split View (Spreadsheet Grid + Live Preview) */}
            <div className="flex-1 flex overflow-hidden">
              
              {/* Spreadsheet Grid */}
              <div className="flex-1 flex flex-col min-w-0 bg-slate-900 overflow-hidden">
                <div ref={tableScrollContainerRef} className="flex-1 overflow-auto border-r border-slate-800/80">
                  <table className="w-full border-collapse text-left text-xs">
                    {/* Table Header */}
                    <thead className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800 text-slate-400 select-none shadow-sm">
                      <tr>
                        <th className="w-14 px-2 py-3 text-center font-semibold text-slate-500 border-r border-slate-800/60">
                          #
                        </th>
                        {activeLayers.map((layer) => {
                          const isPrice = isPriceLayer(layer);
                          const isAutoNumberLabel = layer.isNumberLabel && layer.linkedNumberId;
                          const isAutoListLabel = layer.isListLabel && layer.linkedListId;
                          const priceStat = isPrice ? priceColumnTotals[layer.id] : null;

                          return (
                            <th 
                              key={layer.id} 
                              className={cn(
                                "min-w-[180px] max-w-[280px] px-3 py-2.5 font-semibold border-r border-slate-800/60",
                                isPrice && "bg-amber-500/[0.03]"
                              )}
                            >
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <div className="flex items-center gap-1.5 truncate">
                                  {isPrice && (
                                    <Coins size={13} className="text-amber-400 shrink-0" />
                                  )}
                                  <span className="text-slate-200 truncate font-bold text-xs" title={layer.name}>
                                    {layer.name || "Untitled Layer"}
                                  </span>
                                </div>
                                <span className={cn(
                                  "text-[10px] px-1.5 py-0.2 rounded font-mono uppercase font-bold shrink-0",
                                  isPrice ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                                  layer.type === 'date' ? "bg-purple-500/20 text-purple-300" :
                                  layer.type === 'list' ? "bg-emerald-500/20 text-emerald-300" :
                                  isAutoNumberLabel || isAutoListLabel ? "bg-sky-500/20 text-sky-300" :
                                  "bg-slate-800 text-slate-400"
                                )}>
                                  {isPrice ? "Price" : isAutoNumberLabel ? "words" : (layer.type || "text")}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-1 text-[10px] text-slate-400 font-mono">
                                <div className="flex items-center gap-1 truncate">
                                  <span className="truncate">{layer.fontFamily}</span>
                                  <span>•</span>
                                  <span>{layer.fontSize}px</span>
                                  {layer.hasSuffixList && (
                                    <span className="text-indigo-400 font-semibold">• Suffix</span>
                                  )}
                                </div>
                                {priceStat && (
                                  <span className="text-amber-300 font-bold shrink-0 bg-amber-500/10 px-1 rounded">
                                    Σ {formatPriceNumber(priceStat.total)}
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                        <th className="w-36 min-w-[140px] px-3 py-3 text-center font-semibold text-slate-300">
                          Actions & Share
                        </th>
                      </tr>
                    </thead>

                    {/* Table Rows */}
                    <tbody className="divide-y divide-slate-800/60">
                      {rows.map((row, idx) => {
                        const isSelected = selectedRowIndex === idx;
                        const isGenerated = !!generatedCardsMap[row.id];
                        const isProcessing = isProcessingRowId === row.id;

                        return (
                          <tr
                            key={row.id}
                            data-row-index={idx}
                            onClick={() => setSelectedRowIndex(idx)}
                            className={cn(
                              "transition-colors group cursor-pointer",
                              isSelected 
                                ? "bg-blue-600/10 border-l-4 border-l-blue-500" 
                                : "hover:bg-slate-800/40"
                            )}
                          >
                            {/* Row Index */}
                            <td className="px-2 py-2 text-center text-slate-500 font-mono text-[11px] border-r border-slate-800/60">
                              <div className="flex items-center justify-center gap-1">
                                <span>{idx + 1}</span>
                                {isGenerated && (
                                  <CheckCheck size={12} className="text-emerald-400" title="Ready to download or share" />
                                )}
                              </div>
                            </td>

                            {/* Layer Columns */}
                            {activeLayers.map((layer, colIdx) => {
                              const val = row.values[layer.id] ?? "";
                              const isAutoNumberLabel = layer.isNumberLabel && layer.linkedNumberId;
                              const isAutoListLabel = layer.isListLabel && layer.linkedListId;
                              const isFirstCol = colIdx === 0;
                              const isLastCell = colIdx === activeLayers.length - 1 && idx === rows.length - 1;
                              const isPrice = isPriceLayer(layer);

                              return (
                                <td key={layer.id} className="px-2 py-1.5 border-r border-slate-800/60">
                                  <div className="flex flex-col gap-1">
                                    {layer.type === 'date' ? (
                                      <input
                                        type="date"
                                        value={val}
                                        onChange={(e) => handleCellChange(idx, layer.id, e.target.value)}
                                        onFocus={() => setSelectedRowIndex(idx)}
                                        data-first-col={isFirstCol ? "true" : undefined}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && isLastCell) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleAddRows(1);
                                          }
                                        }}
                                        className="w-full bg-slate-950/70 border border-slate-800 focus:border-blue-500 rounded px-2 py-1 text-slate-200 outline-none text-xs font-mono"
                                      />
                                    ) : layer.type === 'list' && layer.options && layer.options.length > 0 ? (
                                      <select
                                        value={val}
                                        onChange={(e) => handleCellChange(idx, layer.id, e.target.value)}
                                        onFocus={() => setSelectedRowIndex(idx)}
                                        data-first-col={isFirstCol ? "true" : undefined}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && isLastCell) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleAddRows(1);
                                          }
                                        }}
                                        className="w-full bg-slate-950/70 border border-slate-800 focus:border-blue-500 rounded px-2 py-1 text-slate-200 outline-none text-xs"
                                      >
                                        <option value="">(Select Option)</option>
                                        {layer.options.map((opt, optIdx) => (
                                          <option key={optIdx} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type="text"
                                        inputMode={isPrice || layer.type === 'number' ? "decimal" : undefined}
                                        pattern={isPrice || layer.type === 'number' ? "[0-9]*" : undefined}
                                        enterKeyHint={isLastCell ? "done" : "next"}
                                        value={val}
                                        onChange={(e) => handleCellChange(idx, layer.id, e.target.value)}
                                        onFocus={() => setSelectedRowIndex(idx)}
                                        data-first-col={isFirstCol ? "true" : undefined}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && isLastCell) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleAddRows(1);
                                          }
                                        }}
                                        placeholder={
                                          isAutoNumberLabel
                                            ? "(Auto from Number)"
                                            : isAutoListLabel
                                            ? "(Auto from List)"
                                            : isPrice
                                            ? "Enter price..."
                                            : `Enter ${layer.name}...`
                                        }
                                        className={cn(
                                          "w-full bg-slate-950/40 hover:bg-slate-800/80 focus:bg-slate-950 border border-slate-800/80 focus:border-blue-500 rounded px-2 py-1.5 text-slate-200 outline-none text-xs transition-colors focus:ring-1 focus:ring-blue-500/30",
                                          isAutoNumberLabel && !val && "italic text-sky-400/80",
                                          (isPrice || layer.type === 'number') && "font-mono"
                                        )}
                                      />
                                    )}

                                    {/* Suffix Selector if layer has suffix list */}
                                    {layer.hasSuffixList && layer.suffixList && layer.suffixList.length > 0 && (
                                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                        <span className="text-slate-500 font-mono">Suffix:</span>
                                        <select
                                          value={row.values[`${layer.id}__suffix`] || layer.selectedSuffix || layer.suffixList[0]}
                                          onChange={(e) => {
                                            setRows(prev => {
                                              const next = [...prev];
                                              const trg = { ...next[idx], values: { ...next[idx].values } };
                                              trg.values[`${layer.id}__suffix`] = e.target.value;
                                              next[idx] = trg;
                                              return next;
                                            });
                                          }}
                                          className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-300 text-[10px] outline-none"
                                        >
                                          {layer.suffixList.map((suf, sIdx) => (
                                            <option key={sIdx} value={suf}>{suf}</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            })}

                            {/* Action Buttons: SHARE + COPY + KEBAB (Download & Delete) */}
                            <td className="px-2 py-1.5 text-center relative">
                              <div className="flex items-center justify-center gap-1.5">
                                {/* Share Icon Button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleShareRow(row, idx);
                                  }}
                                  disabled={isProcessing}
                                  className={cn(
                                    "p-1.5 rounded-lg transition-all flex items-center justify-center",
                                    isGenerated
                                      ? "bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30"
                                      : "bg-slate-800 hover:bg-purple-600/20 text-slate-300 hover:text-purple-400 border border-slate-700 hover:border-purple-500/40"
                                  )}
                                  title="Share this card"
                                >
                                  <Share2 size={13} />
                                </button>

                                {/* Copy / Duplicate Button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDuplicateRow(idx);
                                  }}
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-blue-600/20 text-slate-300 hover:text-blue-400 border border-slate-700 hover:border-blue-500/40 transition-colors flex items-center justify-center"
                                  title="Copy / Duplicate this row"
                                >
                                  <Copy size={13} />
                                </button>

                                {/* Kebab Menu (Download & Delete) */}
                                <div className="relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveKebabRowId(activeKebabRowId === row.id ? null : row.id);
                                    }}
                                    className={cn(
                                      "p-1.5 rounded-lg transition-colors flex items-center justify-center border",
                                      activeKebabRowId === row.id
                                        ? "bg-slate-700 text-white border-slate-600"
                                        : "bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border-slate-700"
                                    )}
                                    title="More options (Download, Delete)"
                                  >
                                    <MoreVertical size={13} />
                                  </button>

                                  {activeKebabRowId === row.id && (
                                    <div
                                      onClick={(e) => e.stopPropagation()}
                                      className={cn(
                                        "absolute right-0 z-50 min-w-[145px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1.5 backdrop-blur-md",
                                        idx >= rows.length - 2 && rows.length > 2
                                          ? "bottom-full mb-1"
                                          : "top-full mt-1"
                                      )}
                                    >
                                      {/* Download Action */}
                                      <button
                                        onClick={() => {
                                          setActiveKebabRowId(null);
                                          handleDownloadRow(row, idx);
                                        }}
                                        disabled={isProcessing}
                                        className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-emerald-600/20 hover:text-emerald-300 flex items-center gap-2 transition-colors disabled:opacity-50"
                                      >
                                        {isProcessing ? (
                                          <RefreshCw size={13} className="animate-spin text-blue-400 shrink-0" />
                                        ) : (
                                          <Download size={13} className="text-emerald-400 shrink-0" />
                                        )}
                                        <span className="font-medium">Download PNG</span>
                                      </button>

                                      <div className="h-[1px] bg-slate-800 my-1" />

                                      {/* Delete Action */}
                                      <button
                                        onClick={() => {
                                          setActiveKebabRowId(null);
                                          handleDeleteRow(idx);
                                        }}
                                        className="w-full px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 flex items-center gap-2 transition-colors"
                                      >
                                        <Trash2 size={13} className="shrink-0" />
                                        <span className="font-medium">Delete row</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>

                    {/* Table Footer: Column Totals for Price tag columns */}
                    <tfoot className="sm:sticky sm:bottom-0 z-10 bg-slate-950/95 backdrop-blur-md border-t-2 border-slate-700/80">
                      <tr>
                        {/* Index Total Symbol & Count */}
                        <td className="px-2 py-2.5 text-center font-mono font-bold text-amber-400 text-xs border-r border-slate-800 bg-slate-950/90" title={`Total: ${rows.length} entries`}>
                          <div className="flex flex-col items-center justify-center leading-tight">
                            <span className="text-[11px] text-amber-400 font-bold">Σ</span>
                            <span className="text-[10px] text-slate-400 font-sans font-semibold">({rows.length})</span>
                          </div>
                        </td>

                        {/* Layer Column Totals */}
                        {activeLayers.map((layer) => {
                          const isPrice = isPriceLayer(layer);
                          const stat = priceColumnTotals[layer.id];

                          return (
                            <td 
                              key={layer.id} 
                              className={cn(
                                "px-3 py-2 border-r border-slate-800 bg-slate-950/90",
                                isPrice && "bg-amber-500/[0.04]"
                              )}
                            >
                              {isPrice && stat ? (
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <Coins size={13} className="text-amber-400 shrink-0" />
                                    <span className="font-mono font-bold text-amber-300 text-xs">
                                      {formatPriceNumber(stat.total)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                                    <span>{stat.count} {stat.count === 1 ? 'item' : 'items'}</span>
                                    {stat.count > 0 && (
                                      <>
                                        <span>•</span>
                                        <span>Avg: {formatPriceNumber(Math.round(stat.avg))}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ) : layer.isNumberLabel && layer.linkedNumberId && priceColumnTotals[layer.linkedNumberId] ? (
                                <div className="flex flex-col gap-0.5" title="Total in Sinhala Words">
                                  <span className="text-[10px] text-slate-500 font-mono">Total words:</span>
                                  <span className="text-[11px] text-sky-300 font-medium truncate max-w-[200px]">
                                    {convertNumberToSinhala(priceColumnTotals[layer.linkedNumberId].total, layer.numberFontMode || 'fm') || "—"}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-600 text-xs">—</span>
                              )}
                            </td>
                          );
                        })}

                        {/* Summary Action Column */}
                        <td className="px-2 py-2 text-center bg-slate-950/90">
                          {priceColumnsList.length > 0 ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                              Totals
                            </span>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Bottom Status Bar */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-slate-800 bg-slate-950 text-slate-400 text-xs shrink-0">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="font-medium text-slate-300">
                      Total Entries: {rows.length}
                    </span>
                    <span>•</span>
                    <span>
                      Ready: <strong className="text-emerald-400">{Object.keys(generatedCardsMap).length}</strong>
                    </span>

                    {/* Price Tag Column Totals */}
                    {priceColumnsList.map(([layerId, stat]) => (
                      <React.Fragment key={layerId}>
                        <span>•</span>
                        <span className="text-amber-300 font-medium flex items-center gap-1">
                          <Coins size={12} className="text-amber-400" />
                          <span>{stat.label} Total: <strong>{formatPriceNumber(stat.total)}</strong></span>
                        </span>
                      </React.Fragment>
                    ))}

                    <span>•</span>
                    <span>
                      Selected: <strong className="text-blue-400">#{selectedRowIndex + 1}</strong> ({rows[selectedRowIndex]?.name || 'Card'})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAddRows(1)}
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium"
                    >
                      <Plus size={13} />
                      <span>Add Entry</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Live Preview Panel */}
              {showLivePreview && (
                <div className="w-[360px] lg:w-[420px] xl:w-[460px] bg-slate-950 border-l border-slate-800 flex flex-col shrink-0 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 bg-slate-900/60 text-xs">
                    <div className="flex items-center gap-1.5 font-medium text-slate-300">
                      <Eye size={13} className="text-blue-400" />
                      <span>Live Preview (Row #{selectedRowIndex + 1})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDownloadRow(rows[selectedRowIndex], selectedRowIndex)}
                        className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                        title="Download current preview card"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={() => handleShareRow(rows[selectedRowIndex], selectedRowIndex)}
                        className="p-1 rounded text-slate-400 hover:text-purple-400 hover:bg-slate-800 transition-colors"
                        title="Share current preview card"
                      >
                        <Share2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Canvas Preview Container */}
                  <div className="flex-1 p-3 overflow-auto flex items-center justify-center bg-slate-950/80 pattern-grid">
                    <div className="relative border border-slate-800 rounded-lg overflow-hidden shadow-2xl max-w-full max-h-full">
                      <canvas
                        ref={previewCanvasRef}
                        className="w-full h-auto max-h-[58vh] object-contain rounded"
                      />
                    </div>
                  </div>

                  {/* Selected Row Layer Values Summary */}
                  <div className="p-3 border-t border-slate-800/80 bg-slate-900/60 text-[11px] max-h-40 overflow-y-auto divide-y divide-slate-800/60">
                    <div className="flex items-center justify-between pb-1.5">
                      <p className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
                        Applied Row Values
                      </p>
                      {generatedCardsMap[rows[selectedRowIndex]?.id] && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                          <CheckCheck size={12} />
                          <span>Generated</span>
                        </span>
                      )}
                    </div>
                    {activeLayers.map((l) => (
                      <div key={l.id} className="flex items-center justify-between py-1 gap-2">
                        <span className="text-slate-400 truncate">{l.name}:</span>
                        <span className="text-slate-200 font-mono truncate max-w-[200px]">
                          {rows[selectedRowIndex]?.values[l.id] || <span className="text-slate-600 italic">empty</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* TAB 2: CREATION HISTORY (FILTER BY CREATED DATE) */}
        {activeTab === 'history' && (
          <div className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden">
            
            {/* History Filter Bar: Select Created Date */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-slate-900/90 border-b border-slate-800 shrink-0">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-2 text-slate-300 font-semibold text-xs sm:text-sm">
                  <Calendar size={16} className="text-blue-400" />
                  <span>Select Created Date:</span>
                </div>

                {/* Date Input */}
                <input
                  type="date"
                  value={selectedHistoryDate === 'all' ? '' : selectedHistoryDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedHistoryDate(val || 'all');
                  }}
                  className="bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-lg px-2.5 py-1 text-slate-200 text-xs font-mono outline-none cursor-pointer"
                />

                {/* Quick Date Selectors */}
                <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs">
                  <button
                    onClick={() => setSelectedHistoryDate(todayStr)}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors font-medium",
                      selectedHistoryDate === todayStr
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => {
                      const y = new Date();
                      y.setDate(y.getDate() - 1);
                      setSelectedHistoryDate(y.toISOString().split("T")[0]);
                    }}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors font-medium",
                      (() => {
                        const y = new Date();
                        y.setDate(y.getDate() - 1);
                        return selectedHistoryDate === y.toISOString().split("T")[0];
                      })()
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    Yesterday
                  </button>
                  <button
                    onClick={() => setSelectedHistoryDate('all')}
                    className={cn(
                      "px-2.5 py-1 rounded transition-colors font-medium",
                      selectedHistoryDate === 'all'
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    )}
                  >
                    All Dates
                  </button>
                </div>

                {/* Quick Date Pills from available history dates */}
                {historyDates.length > 0 && (
                  <div className="hidden lg:flex items-center gap-1 overflow-x-auto max-w-md py-0.5">
                    {historyDates.slice(0, 4).map(d => (
                      <button
                        key={d.date}
                        onClick={() => setSelectedHistoryDate(d.date)}
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[11px] font-mono whitespace-nowrap transition-colors border",
                          selectedHistoryDate === d.date
                            ? "bg-blue-600/20 text-blue-300 border-blue-500/50 font-bold"
                            : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200"
                        )}
                        title={`${d.batchCount} batches, ${d.totalCards} cards`}
                      >
                        {d.date} ({d.totalCards})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Search Bar & Refresh */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    placeholder="Search history cards..."
                    className="bg-slate-950 border border-slate-800 focus:border-blue-500/70 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none w-44 sm:w-56"
                  />
                  {historySearchQuery && (
                    <button
                      onClick={() => setHistorySearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => loadHistory(selectedHistoryDate)}
                  disabled={isLoadingHistory}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
                  title="Refresh history"
                >
                  <RefreshCw size={14} className={isLoadingHistory ? "animate-spin text-blue-400" : ""} />
                </button>
              </div>
            </div>

            {/* History Content Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                  <RefreshCw size={28} className="animate-spin text-blue-400" />
                  <p className="text-xs">Loading creation history for {selectedHistoryDate === 'all' ? 'all dates' : selectedHistoryDate}...</p>
                </div>
              ) : filteredHistoryBatches.length === 0 ? (
                /* Empty state */
                <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto">
                  <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/80 flex items-center justify-center text-slate-500 mb-4">
                    <Calendar size={28} />
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">
                    No Cards Created on {selectedHistoryDate === 'all' ? 'Any Date' : selectedHistoryDate}
                  </h3>
                  <p className="text-xs text-slate-400 mb-5 leading-relaxed">
                    {selectedHistoryDate !== 'all' 
                      ? `There are no recorded bulk creation batches for this date. Choose another date above or generate cards in the Bulk Generator tab.`
                      : `No history has been saved yet. Generate cards in the Bulk Generator tab to see them listed here.`}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedHistoryDate('all')}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                    >
                      View All Dates
                    </button>
                    <button
                      onClick={() => setActiveTab('editor')}
                      className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition-colors"
                    >
                      Go to Bulk Generator
                    </button>
                  </div>
                </div>
              ) : (
                /* Unified Single List for all cards */
                <div className="space-y-4">
                  {/* Summary Bar */}
                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800/80 gap-3">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span className="font-semibold text-slate-200 text-sm">
                        Showing {allHistoryRows.length} Cards Created
                      </span>
                      {(Object.values(historyUnifiedPriceTotals) as Array<{ id: string; label: string; total: number; count: number }>).map(g => (
                        <span key={g.id} className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono text-xs font-semibold shadow-sm">
                          <Coins size={12} className="text-amber-400" />
                          <span>{g.label} Total: <strong className="text-amber-200">{formatPriceNumber(g.total)}</strong></span>
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleLoadAllHistoryIntoEditor}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
                        title="Load all cards from this date into Bulk Generator editor"
                      >
                        <FileUp size={13} className="text-blue-400" />
                        <span>Load into Editor</span>
                      </button>

                      <button
                        onClick={handleClearDateHistory}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-colors"
                        title={`Clear history cards for ${selectedHistoryDate === 'all' ? 'all dates' : selectedHistoryDate}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Single Unified Table */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                    <div className="overflow-x-auto max-h-[calc(92vh-220px)]">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-sm text-slate-400 border-b border-slate-800 select-none shadow-sm">
                          <tr>
                            <th className="w-12 px-3 py-2.5 text-center font-mono">#</th>
                            {historyLayers.slice(0, 6).map(l => {
                              const isPrice = isPriceLayer(l);
                              const pStat = isPrice ? historyUnifiedPriceTotals[l.id] : null;
                              return (
                                <th key={l.id} className="px-3 py-2.5 font-semibold">
                                  <div className="flex items-center gap-1.5">
                                    {isPrice && <Coins size={12} className="text-amber-400 shrink-0" />}
                                    <span className="text-slate-200">{l.name}</span>
                                  </div>
                                  {pStat && (
                                    <div className="text-[10px] text-amber-300 font-mono font-normal">
                                      Σ {formatPriceNumber(pStat.total)}
                                    </div>
                                  )}
                                </th>
                              );
                            })}
                            <th className="w-24 px-3 py-2.5 text-center font-semibold text-slate-400">
                              Time
                            </th>
                            <th className="w-28 px-3 py-2.5 text-center font-semibold text-slate-300">
                              Download / Share
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {allHistoryRows.map((item, gIdx) => {
                            const timeFormatted = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            return (
                              <tr
                                key={item.id}
                                className="hover:bg-slate-800/40 transition-colors"
                              >
                                <td className="px-3 py-2 text-center text-slate-500 font-mono text-[11px]">
                                  {gIdx + 1}
                                </td>
                                {historyLayers.slice(0, 6).map(l => {
                                  const val = item.row.values?.[l.id];
                                  const isPrice = isPriceLayer(l);
                                  return (
                                    <td key={l.id} className="px-3 py-2 text-slate-300 font-mono text-[11px] truncate max-w-[200px]">
                                      {val !== undefined && val !== "" ? (
                                        isPrice ? (
                                          <span className="text-amber-200 font-semibold">{val}</span>
                                        ) : (
                                          <span>{val}</span>
                                        )
                                      ) : (
                                        <span className="text-slate-600 italic">-</span>
                                      )}
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-2 text-center text-slate-400 font-mono text-[11px] whitespace-nowrap">
                                  {timeFormatted}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    {/* Download Button */}
                                    <button
                                      onClick={() => handleDownloadHistoryItem(item.batch, item.row, item.originalIndex)}
                                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600/20 text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 transition-colors"
                                      title="Download card as PNG"
                                    >
                                      <Download size={13} />
                                    </button>

                                    {/* Share Button */}
                                    <button
                                      onClick={() => handleShareHistoryItem(item.batch, item.row, item.originalIndex)}
                                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-purple-600/20 text-slate-300 hover:text-purple-400 border border-slate-700 hover:border-purple-500/40 transition-colors"
                                      title="Share this card"
                                    >
                                      <Share2 size={13} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="sticky bottom-0 z-10 bg-slate-950/95 backdrop-blur-sm border-t border-slate-800 text-[11px] font-mono shadow-md">
                          <tr>
                            <td className="px-3 py-2.5 text-center text-amber-400 font-bold whitespace-nowrap">
                              Σ ({allHistoryRows.length})
                            </td>
                            {historyLayers.slice(0, 6).map(l => {
                              const isPrice = isPriceLayer(l);
                              const stat = isPrice ? historyUnifiedPriceTotals[l.id] : null;
                              return (
                                <td key={l.id} className="px-3 py-2.5">
                                  {isPrice && stat ? (
                                    <div className="flex items-center gap-1 text-amber-300 font-bold">
                                      <Coins size={12} className="text-amber-400 shrink-0" />
                                      <span>{formatPriceNumber(stat.total)}</span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-600">—</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className="px-3 py-2.5 text-center text-slate-500">—</td>
                            <td className="px-3 py-2.5 text-center text-[10px] text-slate-400 font-sans font-medium">
                              Total
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Overlay: Paste from Excel / CSV Dialog */}
        {showPasteModal && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-white font-bold text-base">
                  <FileSpreadsheet className="text-emerald-400" size={18} />
                  <span>Paste Data from Excel / Google Sheets</span>
                </div>
                <button
                  onClick={() => setShowPasteModal(false)}
                  className="p-1 text-slate-400 hover:text-white rounded"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="text-xs text-slate-400 flex flex-col gap-1.5">
                <p>
                  Copy cells directly from Excel or Google Sheets (Ctrl+C) and paste below (Ctrl+V).
                </p>
                <p className="text-slate-500">
                  Target columns in order: <span className="text-slate-300 font-mono">{activeLayers.map(l => l.name).join(", ")}</span>
                </p>
              </div>

              <textarea
                value={pasteRawText}
                onChange={(e) => setPasteRawText(e.target.value)}
                rows={8}
                placeholder="Paste rows here...&#10;Nimal Perera&#9;5000&#9;2026-11-09&#10;Kamal Silva&#9;10000&#9;2026-11-10"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/70"
              />

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pasteHasHeaders}
                    onChange={(e) => setPasteHasHeaders(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-800 text-blue-600 focus:ring-0"
                  />
                  <span>First line contains header row (ignore first line)</span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowPasteModal(false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleParsePastedData}
                    disabled={!pasteRawText.trim()}
                    className={cn(
                      "px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all",
                      pasteRawText.trim()
                        ? "bg-emerald-600 hover:bg-emerald-500"
                        : "bg-slate-800 text-slate-600 cursor-not-allowed"
                    )}
                  >
                    Import into Table
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Overlay: Generation Progress (Spinning overlay during bulk creation) */}
        {isGenerating && (
          <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 max-w-md w-full flex flex-col items-center text-center gap-4 animate-in zoom-in-95 duration-150">
              <div className="relative w-16 h-16 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                <Sparkles size={28} className="text-blue-400 animate-pulse" />
                <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-white mb-1">
                  Creating Cards
                </h3>
                <p className="text-xs text-slate-400">
                  {generationProgress.status}
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full">
                <div className="flex justify-between text-xs text-slate-400 mb-1 font-mono">
                  <span>Progress</span>
                  <span>
                    {Math.round((generationProgress.current / (generationProgress.total || 1)) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-150"
                    style={{
                      width: `${Math.round((generationProgress.current / (generationProgress.total || 1)) * 100)}%`
                    }}
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                Rendering cards at full resolution. Individual download and share icons will be enabled on each row.
              </p>
            </div>
          </div>
        )}

        {/* Modal Overlay: Fallback Share Dialog */}
        {shareTargetCard && (
          <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2 text-white font-bold text-base">
                  <Share2 className="text-purple-400" size={18} />
                  <span>Share Card</span>
                </div>
                <button
                  onClick={() => setShareTargetCard(null)}
                  className="p-1 text-slate-400 hover:text-white rounded"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Card Thumbnail Preview */}
              <div className="flex items-center gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <img
                  src={shareTargetCard.dataUrl}
                  alt={shareTargetCard.name}
                  className="w-16 h-16 object-cover rounded-lg border border-slate-800"
                />
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-white truncate">{shareTargetCard.name}</h4>
                  <p className="text-[10px] text-slate-400 font-mono truncate">{shareTargetCard.filename}</p>
                  <p className="text-[10px] text-emerald-400 mt-1">Ready to share or copy</p>
                </div>
              </div>

              {/* Share Options */}
              <div className="space-y-2">
                {/* Copy Image to Clipboard */}
                <button
                  onClick={() => handleCopyCardToClipboard(shareTargetCard.blob)}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-white text-xs font-medium border border-slate-700/80 transition-all hover:scale-[1.01]"
                >
                  <div className="flex items-center gap-2.5">
                    <Copy size={16} className="text-blue-400" />
                    <span>Copy Image to Clipboard</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">PNG</span>
                </button>

                {/* WhatsApp Share */}
                <button
                  onClick={() => {
                    const text = `Card: ${shareTargetCard.name}`;
                    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
                    window.open(url, "_blank");
                    onRecordCreationEvents(1, 'share').catch(() => {});
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-medium border border-emerald-500/30 transition-all hover:scale-[1.01]"
                >
                  <div className="flex items-center gap-2.5">
                    <MessageCircle size={16} className="text-emerald-400" />
                    <span>Share on WhatsApp</span>
                  </div>
                  <ChevronRight size={14} className="text-emerald-400/60" />
                </button>

                {/* Direct Download Button */}
                <button
                  onClick={() => {
                    const link = document.createElement("a");
                    link.href = shareTargetCard.dataUrl;
                    link.download = shareTargetCard.filename;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    onRecordCreationEvents(1, 'download').catch(() => {});
                    onNotification({ message: `Downloaded "${shareTargetCard.filename}"`, type: "success" });
                    setShareTargetCard(null);
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-xs font-medium border border-blue-500/30 transition-all hover:scale-[1.01]"
                >
                  <div className="flex items-center gap-2.5">
                    <Download size={16} className="text-blue-400" />
                    <span>Download Image PNG</span>
                  </div>
                  <span className="text-[10px] text-blue-400/80 font-mono">Save</span>
                </button>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setShareTargetCard(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
