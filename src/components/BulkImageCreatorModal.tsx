import React, { useState, useRef, useEffect, useMemo } from "react";
import { 
  X, Plus, Trash2, Copy, Download, Sparkles, FileSpreadsheet, Upload, 
  Eye, Check, AlertCircle, RefreshCw, Layers, ArrowDown, ChevronRight, FileDown, CheckCircle2
} from "lucide-react";
import { 
  TextLayer, Font, prepareLayersForRow, generateBulkCardsZip, 
  generateCardBlob, BulkCardResult, renderLayersOnCanvas, loadImage
} from "../utils/cardRenderer";
import { convertNumberToSinhala } from "../utils/sinhalaConverter";
import { cn } from "../lib/utils";

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

interface BulkImageCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ImageProject;
  image: string;
  fonts: Font[];
  user: { username: string; role: 'admin' | 'user' } | null;
  onRecordCreationEvents: (count: number) => Promise<void>;
  onNotification: (notif: { message: string; type: 'success' | 'error' | 'info' }) => void;
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
        id: "row_1",
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
  const [generatedResults, setGeneratedResults] = useState<BulkCardResult[] | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteRawText, setPasteRawText] = useState("");
  const [pasteHasHeaders, setPasteHasHeaders] = useState(true);
  const [showLivePreview, setShowLivePreview] = useState(true);

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
    if (isOpen && bgImageObjRef.current) {
      drawPreview();
    }
  }, [selectedRowIndex, rows, isOpen, activeLayers, fonts]);

  if (!isOpen) return null;

  // Add new rows
  const handleAddRows = (count: number) => {
    setRows(prev => {
      const next = [...prev];
      for (let i = 0; i < count; i++) {
        const rowNum = next.length + 1;
        const newValues: Record<string, string> = {};
        // Initialize with default or empty
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
    setSelectedRowIndex(idx + 1);
  };

  // Delete a row
  const handleDeleteRow = (idx: number) => {
    if (rows.length <= 1) {
      onNotification({ message: "At least one row is required", type: "info" });
      return;
    }
    setRows(prev => prev.filter((_, i) => i !== idx));
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
          // Auto-calculate Sinhala words if user hasn't explicitly locked it
          const mode = lbl.numberFontMode || thisLayer.numberFontMode || 'fm';
          targetRow.values[lbl.id] = convertNumberToSinhala(value, mode) || "";
        });
      }

      next[rowIndex] = targetRow;
      return next;
    });
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
    const headers = ["Card Name", ...activeLayers.map(l => l.name || l.id)];
    const sampleRow = [
      `${project.name} 1`,
      ...activeLayers.map(l => l.text || "")
    ];
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

    // Detect delimiter: tab or comma
    const firstLine = lines[0];
    const delimiter = firstLine.includes("\t") ? "\t" : ",";

    const parseLine = (line: string): string[] => {
      if (delimiter === "\t") {
        return line.split("\t").map(s => s.trim().replace(/^"|"$/g, ''));
      }
      // Simple CSV split with quotes support
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
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Execute bulk generation
  const handleStartGeneration = async () => {
    if (!bgImageObjRef.current || rows.length === 0) {
      onNotification({ message: "No data rows to generate", type: "error" });
      return;
    }

    setIsGenerating(true);
    setGenerationProgress({
      current: 0,
      total: rows.length,
      status: `Initializing generation for ${rows.length} cards...`,
    });

    try {
      const { zipBlob, cards } = await generateBulkCardsZip(
        bgImageObjRef.current,
        activeLayers,
        rows,
        fonts,
        (current, total, status) => {
          setGenerationProgress({ current, total, status });
        }
      );

      setGeneratedResults(cards);

      // Trigger ZIP download
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

      // Record creation metrics for each generated image in the database
      try {
        await onRecordCreationEvents(rows.length);
      } catch (err) {
        console.error("Failed to record bulk creation events:", err);
      }

      onNotification({
        message: `Successfully created ${rows.length} cards and downloaded "${zipFileName}"!`,
        type: "success",
      });
    } catch (err) {
      console.error("Bulk card generation error:", err);
      onNotification({
        message: "Failed to generate bulk cards: " + (err instanceof Error ? err.message : String(err)),
        type: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Download individual card from results
  const handleDownloadSingleCard = (card: BulkCardResult) => {
    const link = document.createElement("a");
    link.href = card.dataUrl;
    link.download = card.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-hidden animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col w-full max-w-[96vw] h-[92vh] max-h-[96vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-800/90 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Layers size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  Bulk Image Generator
                </h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-blue-300 border border-slate-700 font-medium">
                  {project.name}
                </span>
                <span className="text-xs text-slate-400 hidden md:inline">
                  • {activeLayers.length} Columns • {rows.length} {rows.length === 1 ? 'Entry' : 'Entries'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Enter column values or paste from Excel to generate and download cards in a single ZIP file
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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

            <button
              onClick={onClose}
              disabled={isGenerating}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Toolbar Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-2.5 bg-slate-950/60 border-b border-slate-800/80 shrink-0 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* Add Row Buttons */}
            <div className="flex items-center rounded-lg bg-slate-800 p-0.5 border border-slate-700">
              <button
                onClick={() => handleAddRows(1)}
                className="flex items-center gap-1 px-2.5 py-1 text-slate-200 hover:text-white hover:bg-slate-700/60 rounded transition-colors"
                title="Add 1 new entry row"
              >
                <Plus size={13} className="text-blue-400" />
                <span>Add Row</span>
              </button>
              <span className="text-slate-600">|</span>
              <button
                onClick={() => handleAddRows(5)}
                className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded transition-colors"
                title="Add 5 new entry rows"
              >
                +5
              </button>
              <button
                onClick={() => handleAddRows(10)}
                className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded transition-colors"
                title="Add 10 new entry rows"
              >
                +10
              </button>
            </div>

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

            {/* Clear all but 1 */}
            {rows.length > 1 && (
              <button
                onClick={() => {
                  if (confirm("Reset rows back to 1 entry?")) {
                    setRows([rows[0]]);
                    setSelectedRowIndex(0);
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

          {/* Primary Action Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleStartGeneration}
              disabled={isGenerating || rows.length === 0}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-lg",
                isGenerating || rows.length === 0
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98]"
              )}
            >
              {isGenerating ? (
                <>
                  <RefreshCw size={15} className="animate-spin text-white" />
                  <span>Generating {generationProgress.current}/{generationProgress.total}...</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} className="text-amber-300" />
                  <span>Generate All {rows.length} Images (ZIP)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Main Content Area: Split View (Spreadsheet Grid + Live Preview) */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left / Center: Interactive Spreadsheet Grid */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-900 overflow-hidden">
            <div className="flex-1 overflow-auto border-r border-slate-800/80">
              <table className="w-full border-collapse text-left text-xs">
                {/* Table Header */}
                <thead className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur-sm border-b border-slate-800 text-slate-400 select-none shadow-sm">
                  <tr>
                    <th className="w-12 px-2 py-3 text-center font-semibold text-slate-500 border-r border-slate-800/60">
                      #
                    </th>
                    <th className="w-40 min-w-[150px] px-3 py-3 font-semibold text-slate-300 border-r border-slate-800/60">
                      <div className="flex items-center gap-1.5">
                        <span>Card Name</span>
                        <span className="text-[10px] text-slate-500 font-normal">filename</span>
                      </div>
                    </th>
                    {activeLayers.map((layer) => {
                      const isAutoNumberLabel = layer.isNumberLabel && layer.linkedNumberId;
                      const isAutoListLabel = layer.isListLabel && layer.linkedListId;
                      return (
                        <th 
                          key={layer.id} 
                          className="min-w-[180px] max-w-[280px] px-3 py-2.5 font-semibold border-r border-slate-800/60"
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-slate-200 truncate font-bold text-xs" title={layer.name}>
                              {layer.name || "Untitled Layer"}
                            </span>
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.2 rounded font-mono uppercase font-bold shrink-0",
                              layer.type === 'number' ? "bg-amber-500/20 text-amber-300" :
                              layer.type === 'date' ? "bg-purple-500/20 text-purple-300" :
                              layer.type === 'list' ? "bg-emerald-500/20 text-emerald-300" :
                              isAutoNumberLabel || isAutoListLabel ? "bg-sky-500/20 text-sky-300" :
                              "bg-slate-800 text-slate-400"
                            )}>
                              {isAutoNumberLabel ? "words" : (layer.type || "text")}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono truncate">
                            <span className="truncate">{layer.fontFamily}</span>
                            <span>•</span>
                            <span>{layer.fontSize}px</span>
                            {layer.hasSuffixList && (
                              <span className="text-indigo-400 font-semibold">• Suffix</span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                    <th className="w-24 px-3 py-3 text-center font-semibold text-slate-400">
                      Actions
                    </th>
                  </tr>
                </thead>

                {/* Table Rows */}
                <tbody className="divide-y divide-slate-800/60">
                  {rows.map((row, idx) => {
                    const isSelected = selectedRowIndex === idx;
                    return (
                      <tr
                        key={row.id}
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
                          {idx + 1}
                        </td>

                        {/* Card Name / Filename */}
                        <td className="px-2 py-1.5 border-r border-slate-800/60">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => handleRowNameChange(idx, e.target.value)}
                            className="w-full bg-transparent hover:bg-slate-800/80 focus:bg-slate-900 border border-transparent focus:border-blue-500/60 rounded px-2 py-1 text-slate-200 outline-none text-xs font-medium"
                            placeholder={`Card ${idx + 1}`}
                          />
                        </td>

                        {/* Layer Columns */}
                        {activeLayers.map((layer) => {
                          const val = row.values[layer.id] ?? "";
                          const isAutoNumberLabel = layer.isNumberLabel && layer.linkedNumberId;
                          const isAutoListLabel = layer.isListLabel && layer.linkedListId;

                          return (
                            <td key={layer.id} className="px-2 py-1.5 border-r border-slate-800/60">
                              <div className="flex flex-col gap-1">
                                {layer.type === 'date' ? (
                                  <input
                                    type="date"
                                    value={val}
                                    onChange={(e) => handleCellChange(idx, layer.id, e.target.value)}
                                    className="w-full bg-slate-950/70 border border-slate-800 focus:border-blue-500/70 rounded px-2 py-1 text-slate-200 outline-none text-xs font-mono"
                                  />
                                ) : layer.type === 'list' && layer.options && layer.options.length > 0 ? (
                                  <select
                                    value={val}
                                    onChange={(e) => handleCellChange(idx, layer.id, e.target.value)}
                                    className="w-full bg-slate-950/70 border border-slate-800 focus:border-blue-500/70 rounded px-2 py-1 text-slate-200 outline-none text-xs"
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
                                    value={val}
                                    onChange={(e) => handleCellChange(idx, layer.id, e.target.value)}
                                    placeholder={
                                      isAutoNumberLabel
                                        ? "(Auto from Number)"
                                        : isAutoListLabel
                                        ? "(Auto from List)"
                                        : `Enter ${layer.name}...`
                                    }
                                    className={cn(
                                      "w-full bg-transparent hover:bg-slate-800/80 focus:bg-slate-950 border border-transparent focus:border-blue-500/70 rounded px-2 py-1 text-slate-200 outline-none text-xs transition-colors",
                                      isAutoNumberLabel && !val && "italic text-sky-400/80"
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

                        {/* Action buttons */}
                        <td className="px-2 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateRow(idx);
                              }}
                              className="p-1 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded transition-colors"
                              title="Duplicate this row"
                            >
                              <Copy size={13} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteRow(idx);
                              }}
                              className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                              title="Delete this row"
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
            </div>

            {/* Bottom Status Bar */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-800 bg-slate-950 text-slate-400 text-xs shrink-0">
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-300">
                  Total Rows: {rows.length}
                </span>
                <span>•</span>
                <span>
                  Active Entry: <strong className="text-blue-400">#{selectedRowIndex + 1}</strong> ({rows[selectedRowIndex]?.name || 'Card'})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAddRows(1)}
                  className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium"
                >
                  <Plus size={13} />
                  <span>Add Another Entry</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Pane: Live Card Preview of Selected Row */}
          {showLivePreview && (
            <div className="w-[360px] lg:w-[420px] xl:w-[460px] bg-slate-950 border-l border-slate-800 flex flex-col shrink-0 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 bg-slate-900/60 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-slate-300">
                  <Eye size={13} className="text-blue-400" />
                  <span>Live Preview (Row #{selectedRowIndex + 1})</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  {bgImageObjRef.current ? `${bgImageObjRef.current.naturalWidth}x${bgImageObjRef.current.naturalHeight}` : ""}
                </span>
              </div>

              {/* Canvas Preview Container */}
              <div className="flex-1 p-3 overflow-auto flex items-center justify-center bg-slate-950/80 pattern-grid">
                <div className="relative border border-slate-800 rounded-lg overflow-hidden shadow-2xl max-w-full max-h-full">
                  <canvas
                    ref={previewCanvasRef}
                    className="w-full h-auto max-h-[60vh] object-contain rounded"
                  />
                </div>
              </div>

              {/* Selected Row Layer Values Summary */}
              <div className="p-3 border-t border-slate-800/80 bg-slate-900/60 text-[11px] max-h-40 overflow-y-auto divide-y divide-slate-800/60">
                <p className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] mb-1.5">
                  Applied Row Values
                </p>
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
                  Target columns in order: <span className="text-slate-300 font-mono">Card Name (optional), {activeLayers.map(l => l.name).join(", ")}</span>
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

        {/* Modal Overlay: Generation Progress */}
        {isGenerating && (
          <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 max-w-md w-full flex flex-col items-center text-center gap-4 animate-in zoom-in-95 duration-150">
              <div className="relative w-16 h-16 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                <Sparkles size={28} className="text-blue-400 animate-pulse" />
                <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-white mb-1">
                  Generating Bulk Images
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
                Please wait while we render each card at full resolution and package into a ZIP file.
              </p>
            </div>
          </div>
        )}

        {/* Modal Overlay: Completed Results Drawer */}
        {generatedResults && !isGenerating && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 size={22} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      Generated {generatedResults.length} Images!
                    </h3>
                    <p className="text-xs text-slate-400">
                      ZIP file was automatically downloaded. You can also view or save individual cards below.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setGeneratedResults(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Cards Grid */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 bg-slate-950/40">
                {generatedResults.map((card) => (
                  <div
                    key={card.index}
                    className="group bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-blue-500/60 transition-all flex flex-col"
                  >
                    <div className="relative aspect-square bg-black/40 flex items-center justify-center overflow-hidden">
                      <img
                        src={card.dataUrl}
                        alt={card.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <button
                        onClick={() => handleDownloadSingleCard(card)}
                        className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity gap-1.5 text-xs font-semibold"
                        title="Download PNG"
                      >
                        <Download size={15} />
                        <span>Download</span>
                      </button>
                    </div>
                    <div className="p-2.5">
                      <p className="text-xs font-medium text-slate-200 truncate" title={card.name}>
                        {card.name}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">
                        {card.filename}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex justify-end">
                <button
                  onClick={() => setGeneratedResults(null)}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
