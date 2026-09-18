import React, { useState, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Type, Download, LogOut, Plus, Minus, Trash2, Settings, Image as ImageIcon, Type as FontIcon, Save, AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline, Calendar, UserCircle, Shield, Key, Users, ChevronDown, UserPlus, UserMinus, Edit2, Share2, MessageCircle, Menu, X, Check, Lock, Unlock, FileUp, FileDown, Copy, Undo2, List, Eye, EyeOff, Tag, Move, Hash, ListOrdered, Coins, Loader2, Sparkles, BarChart3 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { convertNumberToSinhala, numberToSinhalaWords, formatNumberForCanvas, isUnicodeFont } from "./utils/sinhalaConverter";

interface User {
  username: string;
  role: 'admin' | 'user';
  selectedFonts?: string[];
  defaultFont?: string;
  defaultFontSize?: number;
  defaultFontColor?: string;
}

interface Font {
  name: string;
  url: string;
}

interface TextLayer {
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
}

export interface SuffixLineConfig {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [projects, setProjects] = useState<ImageProject[]>([]);
  const [isProjectsLoading, setIsProjectsLoading] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [selectedStatsProject, setSelectedStatsProject] = useState<ImageProject | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [projectSortMode, setProjectSortMode] = useState<'recent' | 'creations'>('recent');
  const [image, setImage] = useState<string | null>(null);
  const [layers, setLayers] = useState<TextLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const lastSavedLayersRef = useRef<string>("");
  const [fonts, setFonts] = useState<Font[]>([]);
  const [isFontLoading, setIsFontLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [newAccountUsername, setNewAccountUsername] = useState("");
  const [newAccountPassword, setNewAccountPassword] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [projectToDeleteId, setProjectToDeleteId] = useState<string | null>(null);
  const [projectToRename, setProjectToRename] = useState<{ id: string; name: string } | null>(null);
  const [renameInputVal, setRenameInputVal] = useState("");
  const [isEditingHeaderName, setIsEditingHeaderName] = useState(false);
  const [headerNameInput, setHeaderNameInput] = useState("");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showUserManagementModal, setShowUserManagementModal] = useState(false);
  const [showFontManagementModal, setShowFontManagementModal] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingFont, setEditingFont] = useState<Font | null>(null);
  const [fontToDelete, setFontToDelete] = useState<Font | null>(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [newFontName, setNewFontName] = useState("");
  const [userManagementPassword, setUserManagementPassword] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("sidebar_width");
    // Ensure initial width doesn't exceed 50% of screen
    const defaultWidth = Math.min(600, window.innerWidth * 0.4);
    return saved ? parseInt(saved) : defaultWidth;
  });
  const [isResizing, setIsResizing] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragTargetRef = useRef<'layer' | 'line-p1' | 'line-p2' | 'line-move' | null>(null);
  const lineDragStartRef = useRef<{ x1: number; y1: number; x2: number; y2: number; mouseX: number; mouseY: number }>({ x1: 0, y1: 0, x2: 0, y2: 0, mouseX: 0, mouseY: 0 });
  const isExportingRef = useRef(false);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        console.log("Server health:", data);
      } catch (err) {
        console.error("Server health check failed:", err);
      }
    };
    checkHealth();
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebar_width", sidebarWidth.toString());
  }, [sidebarWidth]);

  useEffect(() => {
    const savedUser = localStorage.getItem("app_user");
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
      } catch (e) {
        console.error("Failed to parse saved user", e);
        localStorage.removeItem("app_user");
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem("app_user", JSON.stringify(user));
      fetchFonts();
      fetchProjects();
    } else {
      localStorage.removeItem("app_user");
    }
  }, [user]);

  const imageCacheRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (image) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = image;
      img.onload = () => {
        imageCacheRef.current = img;
        drawCanvas();
        
        const mainElement = document.querySelector('main');
        if (mainElement) {
          const padding = 64;
          const maxWidth = mainElement.clientWidth - padding;
          const maxHeight = mainElement.clientHeight - padding;
          const scaleX = maxWidth / img.width;
          const newZoom = Math.min(scaleX, 1);
          setZoom(newZoom);
        }
      };
    } else {
      imageCacheRef.current = null;
    }
  }, [image]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const newWidth = e.clientX;
      const maxWidth = window.innerWidth * 0.5;
      if (newWidth > 200 && newWidth < maxWidth) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const fetchFonts = async () => {
    try {
      console.log("Fetching fonts from API...");
      const res = await fetch("/api/fonts");
      if (!res.ok) {
        console.error(`Failed to fetch fonts: ${res.status} ${res.statusText}`);
        return;
      }
      const data = await res.json();
      
      if (!Array.isArray(data)) {
        console.error("Received non-array data for fonts:", data);
        setFonts([]);
        return;
      }
      
      console.log(`API returned ${data.length} fonts:`, data);
      
      // Map API data to Font objects with cleaned names for the UI
      const apiFonts = data.map((font: any) => {
        const fontFamily = font.name.split('.').slice(0, -1).join('.');
        return { name: fontFamily, url: font.url };
      });
      
      // Set fonts immediately so they show up in the list
      setFonts(apiFonts);
      
      // Load fonts in the background
      const loadPromises = apiFonts.map(async (font: any) => {
        const fontFamily = font.name;
        
        if (Array.from(document.fonts.values()).some(face => face.family === fontFamily)) {
          return;
        }

        try {
          const fontUrl = font.url.startsWith('/') ? font.url : `/fonts/${font.url}`;
          
          const response = await fetch(fontUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const buffer = await response.arrayBuffer();
          
          const fontFace = new FontFace(fontFamily, buffer);
          const loadedFace = await fontFace.load();
          document.fonts.add(loadedFace);
        } catch (e) {
          if (fontFamily !== "apex_apura_044") {
            console.error(`Failed to load font: "${fontFamily}" from ${font.url}`, e);
          }
        }
      });
      
      await Promise.all(loadPromises);
      drawCanvas(); // Force a redraw after all fonts are loaded
    } catch (err) {
      console.error("Failed to fetch fonts", err);
    }
  };

  const fetchProjects = async () => {
    if (!user) return;
    setIsProjectsLoading(true);
    try {
      const res = await fetch(`/api/images?username=${user.username}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setProjects(data);
        
        // Auto-select the last edited project
        if (data.length > 0 && !currentProjectId) {
          const lastProject = [...data].sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
          })[0];
          if (lastProject) loadProject(lastProject);
        }
      } else {
        console.error("Received non-array data for projects:", data);
        setProjects([]);
      }
    } catch (err) {
      console.error("Failed to fetch projects", err);
    } finally {
      setIsProjectsLoading(false);
    }
  };

  const recordCreationEvent = async (projectId: string | null, type: 'copy' | 'download' | 'share') => {
    if (!projectId) return;

    // 1. Optimistic update
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const copies = (p.copiesCount || 0) + (type === 'copy' ? 1 : 0);
      const downloads = (p.downloadsCount || 0) + (type === 'download' ? 1 : 0);
      const shares = (p.sharesCount || 0) + (type === 'share' ? 1 : 0);
      return {
        ...p,
        copiesCount: copies,
        downloadsCount: downloads,
        sharesCount: shares,
        creationsCount: copies + downloads + shares
      };
    }));

    // 2. Persist to API
    try {
      const res = await fetch(`/api/images/${projectId}/creation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.creationsCount !== undefined) {
          setProjects(prev => prev.map(p => p.id === projectId ? {
            ...p,
            copiesCount: data.copiesCount,
            downloadsCount: data.downloadsCount,
            sharesCount: data.sharesCount,
            creationsCount: data.creationsCount
          } : p));
        }
      }
    } catch (err) {
      console.error("Failed to record creation metric:", err);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        setUser({ 
          username: data.username, 
          role: data.role, 
          selectedFonts: data.selectedFonts,
          defaultFont: data.defaultFont,
          defaultFontSize: data.defaultFontSize,
          defaultFontColor: data.defaultFontColor
        });
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUser = username.trim();
    if (!trimmedUser) {
      setError("Please enter a username");
      return;
    }
    if (trimmedUser.length < 2) {
      setError("Username must be at least 2 characters long");
      return;
    }
    if (!password) {
      setError("Please enter a password");
      return;
    }
    if (password.length < 4) {
      setError("Password must be at least 4 characters long");
      return;
    }
    if (password !== registerConfirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedUser, password }),
      });
      const data = await res.json();
      if (data.success) {
        setUser({ 
          username: data.username, 
          role: data.role, 
          selectedFonts: data.selectedFonts || [],
          defaultFont: data.defaultFont,
          defaultFontSize: data.defaultFontSize,
          defaultFontColor: data.defaultFontColor
        });
        setNotification({ message: "Account created successfully! Welcome to FontOverlay Pro.", type: 'success' });
      } else {
        setError(data.message || "Registration failed");
      }
    } catch (err) {
      setError("Failed to create account. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setNotification({ message: "Passwords do not match", type: 'error' });
      return;
    }
    try {
      const res = await fetch("/api/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          username: user?.username, 
          oldPassword, 
          newPassword 
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNotification({ message: "Password changed successfully", type: 'success' });
        setShowChangePasswordModal(false);
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setNotification({ message: data.message || "Failed to change password", type: 'error' });
      }
    } catch (err) {
      console.error("Failed to change password", err);
      setNotification({ message: "Failed to change password", type: 'error' });
    }
  };

  const fetchAllUsers = async () => {
    if (!user || user.role !== 'admin') return;
    try {
      const res = await fetch(`/api/v1/update`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          'x-sync-auth': btoa(user.username) 
        },
        body: JSON.stringify({ a: 'l' })
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Fetch users failed with status ${res.status}:`, text);
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        setAllUsers(data.users);
      } else {
        console.error("Fetch users failed:", data.message);
      }
    } catch (err) {
      console.error("Failed to fetch users", err);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin' || !editingUser) return;
    try {
      const res = await fetch(`/api/v1/update`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-sync-auth": btoa(user.username)
        },
        body: JSON.stringify({ 
          a: 'u',
          id: editingUser.username,
          c: userManagementPassword,
          t: editingUser.role
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNotification({ message: "User updated successfully", type: 'success' });
        setEditingUser(null);
        setUserManagementPassword("");
        fetchAllUsers();
      } else {
        setNotification({ message: data.message || "Failed to update user", type: 'error' });
      }
    } catch (err) {
      console.error("Failed to update user", err);
      setNotification({ message: "Failed to update user", type: 'error' });
    }
  };

  const handleDeleteUser = async (usernameToDelete: string) => {
    if (!user || user.role !== 'admin') return;
    try {
      const res = await fetch(`/api/v1/update`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-sync-auth": btoa(user.username)
        },
        body: JSON.stringify({ 
          a: 'd',
          id: usernameToDelete
        }),
      });
      const data = await res.json();
      if (data.success) {
        fetchAllUsers();
        setNotification({ message: "User deleted successfully", type: 'success' });
      } else {
        setNotification({ message: data.message || "Failed to delete user", type: 'error' });
      }
    } catch (err) {
      console.error("Failed to delete user", err);
      setNotification({ message: "Failed to delete user", type: 'error' });
    }
  };

  const saveProject = async () => {
    if (!user || !image) return;
    setIsSaving(true);
    const projectId = currentProjectId || Math.random().toString(36).substr(2, 9);
    
    // Find existing project in the state or current projects
    const existingProject = projects.find(p => p.id === projectId);
    
    const projectName = existingProject ? existingProject.name : (currentProjectId ? `Project ${new Date().toLocaleDateString()}` : `New Project`);
    const isLocked = existingProject?.isLocked || false;

    // Only send the image blob if it is a brand new data: URL not yet persisted
    const isDataUrl = typeof image === 'string' && image.startsWith('data:');

    const project: ImageProject = {
      id: projectId,
      username: user.username,
      imageUrl: isDataUrl ? image : (existingProject?.imageUrl || `/api/images/${projectId}/image`),
      layers,
      name: projectName,
      createdAt: existingProject?.createdAt || new Date().toISOString(),
      isLocked: isLocked,
    };

    try {
      // Lightweight payload: only send imageUrl if it's a new data URL
      const payload: any = {
        id: projectId,
        username: user.username,
        layers,
        name: projectName,
        isLocked,
      };
      if (isDataUrl) {
        payload.imageUrl = image;
      }

      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        setCurrentProjectId(projectId);
        lastSavedLayersRef.current = JSON.stringify(layers);

        // If newly saved from data URL, transition local image to endpoint URL
        if (resData.imageUrl) {
          project.imageUrl = resData.imageUrl;
          if (isDataUrl) {
            setImage(resData.imageUrl);
          }
        }

        setProjects(prev => {
          const exists = prev.some(p => p.id === project.id);
          if (exists) {
            return prev.map(p => p.id === project.id ? { ...project, imageUrl: p.imageUrl || project.imageUrl } : p);
          }
          return [project, ...prev];
        });
      } else {
        console.error("Failed to save project:", await res.text());
      }
    } catch (err) {
      console.error("Failed to save project", err);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProject = (id: string) => {
    setProjectToDeleteId(id);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDeleteId) return;
    
    // Save current list for potential rollback
    const previousProjects = [...projects];
    const isCurrentProject = currentProjectId === projectToDeleteId;
    
    // Optimistic update
    setProjects(prev => prev.filter(p => p.id !== projectToDeleteId));
    if (isCurrentProject) {
      setCurrentProjectId(null);
      setImage(null);
      setLayers([]);
    }
    
    try {
      const res = await fetch(`/api/images/${projectToDeleteId}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Failed to delete project from server");
      }
    } catch (err) {
      console.error("Failed to delete project", err);
      // Rollback on error
      setProjects(previousProjects);
      if (isCurrentProject) {
        const deletedProject = previousProjects.find(p => p.id === projectToDeleteId);
        if (deletedProject) loadProject(deletedProject);
      }
      setNotification({ message: "Failed to delete project. Please try again.", type: 'error' });
    } finally {
      setProjectToDeleteId(null);
    }
  };

  const toggleProjectLock = async (idOrEvent?: string | React.MouseEvent) => {
    const targetId = typeof idOrEvent === 'string' ? idOrEvent : currentProjectId;
    if (!targetId) return;
    const project = projects.find(p => p.id === targetId);
    if (!project) return;

    const newLockedStatus = !project.isLocked;
    
    // When locking, immediately hide properties by clearing active layer selection
    if (newLockedStatus && targetId === currentProjectId) {
      setSelectedLayerId(null);
    }

    // Update local state first for immediate feedback
    setProjects(prev => prev.map(p => p.id === targetId ? { ...p, isLocked: newLockedStatus } : p));
    
    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          username: user?.username || project.username,
          layers: project.layers,
          name: project.name,
          isLocked: newLockedStatus,
        }),
      });
      if (res.ok) {
        setNotification({ message: `Project ${newLockedStatus ? 'locked' : 'unlocked'}`, type: 'success' });
      }
    } catch (err) {
      console.error("Failed to toggle project lock", err);
    }
  };

  const exportLayers = (idOrEvent?: string | React.MouseEvent, projectLayers?: TextLayer[]) => {
    const targetId = typeof idOrEvent === 'string' ? idOrEvent : currentProjectId;
    const targetLayers = projectLayers || layers;
    
    if (targetLayers.length === 0) {
      setNotification({ message: "No layers to export", type: 'error' });
      return;
    }

    const project = projects.find(p => p.id === targetId);
    const dateStr = new Date().toISOString().split('T')[0];
    const baseName = project?.name || 'layers';
    const fileName = `${baseName}_layers_${dateStr}.json`;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(targetLayers));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    setNotification({ message: "Layers exported successfully", type: 'success' });
  };

  const importLayers = (e: React.ChangeEvent<HTMLInputElement>, projectId?: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const targetId = projectId || currentProjectId;
    const targetProject = projects.find(p => p.id === targetId);
    
    if (targetProject?.isLocked) {
      setNotification({ message: "Cannot import layers to a locked project", type: 'error' });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedLayers = JSON.parse(event.target?.result as string);
        if (Array.isArray(importedLayers)) {
          const validLayers = importedLayers.map(l => ({
            ...l,
            id: l.id || Math.random().toString(36).substr(2, 9)
          }));
          
          if (targetId === currentProjectId) {
            setLayers(validLayers);
          } else if (targetProject) {
            // Import to another project, we need to save it back
            const updatedProject = { ...targetProject, layers: validLayers };
            try {
              await fetch("/api/images", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updatedProject),
              });
              setProjects(prev => prev.map(p => p.id === targetId ? updatedProject : p));
            } catch (err) {
              console.error("Failed to save imported layers to project", err);
            }
          }
          
          setNotification({ message: "Layers imported successfully", type: 'success' });
        } else {
          throw new Error("Invalid format");
        }
      } catch (err) {
        console.error("Import error:", err);
        setNotification({ message: "Failed to import layers. Invalid JSON file.", type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  const loadProject = (project: ImageProject) => {
    setCurrentProjectId(project.id);
    setImage(project.imageUrl);
    // Clear text contents when loading as requested
    const preparedLayers = project.layers.map(l => ({ ...l, text: "", name: l.name || l.text }));
    setLayers(preparedLayers);
    lastSavedLayersRef.current = JSON.stringify(preparedLayers);
    setSelectedLayerId(null);
  };

  const onDrop = async (acceptedFiles: File[]) => {
    console.log("onDrop triggered with files:", acceptedFiles.map(f => f.name));
    if (!acceptedFiles.length) {
      console.warn("onDrop: No files accepted by dropzone");
      return;
    }
    
    if (!user) {
      console.error("onDrop: User is not logged in, cannot upload");
      setNotification({ message: "Please sign in to upload images.", type: 'error' });
      return;
    }

    setLoading(true); // Show loading state during upload
    try {
      for (const file of acceptedFiles) {
        console.log(`Processing image: ${file.name} (${file.size} bytes)`);
        
        // Convert to base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (e) => reject(e);
          reader.readAsDataURL(file);
        });
        
        const base64 = await base64Promise;
        const projectId = Math.random().toString(36).substr(2, 9);
        const fileName = file.name.split('.').slice(0, -1).join('.') || file.name;
        
        const project: ImageProject = {
          id: projectId,
          username: user.username,
          imageUrl: base64,
          layers: [],
          name: fileName,
          createdAt: new Date().toISOString(),
        };

        console.log(`Saving project with base64 image for ${file.name}...`);
        const saveRes = await fetch("/api/images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(project),
        });
        
        if (!saveRes.ok) {
          console.error(`Failed to save project for ${file.name}`);
          throw new Error(`Failed to save project for ${file.name}`);
        } else {
          console.log(`Project saved successfully for ${file.name}`);
        }

        const resData = await saveRes.json().catch(() => ({}));
        const serverImageUrl = resData.imageUrl || `/api/images/${projectId}/image`;
        project.imageUrl = serverImageUrl;
        
        // If it's the last one, load it
        if (file === acceptedFiles[acceptedFiles.length - 1]) {
          console.log(`Loading last uploaded image: ${file.name}`);
          setImage(serverImageUrl);
          setLayers([]);
          lastSavedLayersRef.current = JSON.stringify([]);
          setCurrentProjectId(projectId);
          setSelectedLayerId(null);
          setProjects(prev => [project, ...prev]);
        }
      }
    } catch (err) {
      console.error("Critical upload error:", err);
      setNotification({ message: err instanceof Error ? err.message : "An error occurred during processing.", type: 'error' });
    } finally {
      setLoading(false);
    }
    await fetchProjects();
  };

  const { getRootProps: getSidebarRootProps, getInputProps: getSidebarInputProps, isDragActive: isSidebarDragActive } = useDropzone({
    onDrop,
    onDropRejected: (fileRejections) => {
      console.error("Sidebar files rejected:", fileRejections);
      setNotification({ message: "Some files were rejected. Please upload only images.", type: 'error' });
    },
    accept: { "image/*": [] },
    multiple: true,
  } as any);

  const { getRootProps: getMainRootProps, getInputProps: getMainInputProps, isDragActive: isMainDragActive } = useDropzone({
    onDrop,
    onDropRejected: (fileRejections) => {
      console.error("Main area files rejected:", fileRejections);
      setNotification({ message: "Some files were rejected. Please upload only images.", type: 'error' });
    },
    accept: { "image/*": [] },
    multiple: true,
  } as any);

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'woff' && extension !== 'woff2') {
      setNotification({ message: "Only .woff and .woff2 font formats are supported.", type: 'error' });
      return;
    }

    setIsFontLoading(true);
    const formData = new FormData();
    formData.append("font", file);

    try {
      const res = await fetch("/api/upload-font", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(`Font upload failed: ${res.status}`);
      const data = await res.json();
      if (data.success) {
        await fetchFonts();
      }
    } catch (err) {
      console.error("Font upload failed:", err);
    } finally {
      setIsFontLoading(false);
    }
  };

  const deleteFont = async (fontName: string) => {
    try {
      const res = await fetch(`/api/fonts/${encodeURIComponent(fontName)}`, { method: "DELETE" });
      if (res.ok) {
        await fetchFonts();
      }
    } catch (err) {
      console.error("Failed to delete font", err);
    }
  };

  const renameProject = async (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const project = projects.find(p => p.id === id);
    if (!project || project.name === trimmed) return;
    
    // Optimistic local update
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));

    try {
      const res = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          username: user?.username || project.username,
          layers: project.layers,
          name: trimmed,
          isLocked: project.isLocked,
        }),
      });
      if (res.ok) {
        setNotification({ message: `Project renamed to "${trimmed}"`, type: 'success' });
      } else {
        setNotification({ message: "Failed to update project name on server.", type: 'error' });
      }
    } catch (err) {
      console.error("Failed to rename project", err);
      setNotification({ message: "Failed to rename project.", type: 'error' });
    }
  };

  const updatePreferences = async (preferences: Partial<User> | string[]) => {
    if (!user) return;
    const payload = Array.isArray(preferences) ? { selectedFonts: preferences } : preferences;
    
    // Optimistic update
    const previousUser = { ...user };
    const newUser = { ...user, ...payload };
    setUser(newUser);
    
    try {
      const res = await fetch("/api/user/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, ...payload }),
      });
      if (!res.ok) {
        throw new Error("Server error updating preferences");
      }
    } catch (err) {
      console.error("Failed to update preferences", err);
      // Rollback on error
      setUser(previousUser);
      setNotification({ message: "Failed to save preferences", type: 'error' });
    }
  };

  const prefDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedUpdatePreferences = (preferences: Partial<User>) => {
    if (!user) return;
    
    // Update local state immediately for snappy UI
    setUser({ ...user, ...preferences });
    
    // Debounce the server call
    if (prefDebounceRef.current) clearTimeout(prefDebounceRef.current);
    prefDebounceRef.current = setTimeout(() => {
      updatePreferences(preferences);
    }, 500);
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'admin') return;
    setIsCreatingAccount(true);
    try {
      const res = await fetch("/api/v1/update", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-sync-auth": btoa(user.username)
        },
        body: JSON.stringify({ 
          a: 'c',
          id: newAccountUsername,
          c: newAccountPassword,
          t: 'user'
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`Create account failed with status ${res.status}:`, text);
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        setNewAccountUsername("");
        setNewAccountPassword("");
        await fetchAllUsers();
        setNotification({ message: "Account created successfully!", type: 'success' });
      } else {
        setNotification({ message: data.message || "Failed to create account", type: 'error' });
      }
    } catch (err) {
      console.error("Failed to create account", err);
      setNotification({ message: "Failed to create account", type: 'error' });
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const addLayer = () => {
    const newLayer: TextLayer = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Text Layer ${layers.length + 1}`,
      text: "New Text Layer",
      x: 50,
      y: 50,
      fontSize: user?.defaultFontSize || 60,
      color: user?.defaultFontColor || "#000064",
      fontFamily: user?.defaultFont || fonts[0]?.name || "sans-serif",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadowBlur: 0,
      shadowColor: "#000000",
      textAlign: 'left',
      type: 'text',
      isBold: false,
      isItalic: false,
      isUnderline: false,
      hasSuffixList: false,
      suffixList: ["uy;d", "uy;añh", "ñh"],
      selectedSuffix: "uy;d",
      suffixGap: 4,
      showSuffixLine: false,
      suffixLineWidth: 3,
      suffixLines: {
        "uy;d": { x1: 45, y1: 54, x2: 65, y2: 54 },
        "uy;añh": { x1: 45, y1: 58, x2: 65, y2: 58 },
        "ñh": { x1: 45, y1: 62, x2: 65, y2: 62 },
      },
    };
    setLayers([...layers, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const addDateLayer = () => {
    const today = new Date().toISOString().split('T')[0];
    const newLayer: TextLayer = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Date Layer ${layers.length + 1}`,
      text: today,
      x: 50,
      y: 50,
      fontSize: user?.defaultFontSize || 60,
      color: user?.defaultFontColor || "#000064",
      fontFamily: user?.defaultFont || fonts[0]?.name || "sans-serif",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadowBlur: 0,
      shadowColor: "#000000",
      textAlign: 'left',
      type: 'date',
      useSinhalaMonth: false,
      sinhalaMonthFontSize: user?.defaultFontSize || 60,
      sinhalaMonths: ["ckjdß", "fmnrjdß", "ud¾;=", "wfma%,a", "uehs", "cQks", "cQ,s", "wf.daia;=", "iema;eïn¾", "Tlaf;dan¾", "fkdjeïn¾", "foieïn¾"],
      isBold: false,
      isItalic: false,
      isUnderline: false,
    };
    setLayers([...layers, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const addLabelLayer = () => {
    const newLayer: TextLayer = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Label ${layers.filter(l => l.type === 'label').length + 1}`,
      text: "New Label",
      x: 50,
      y: 50,
      fontSize: user?.defaultFontSize || 60,
      color: user?.defaultFontColor || "#000064",
      fontFamily: user?.defaultFont || fonts[0]?.name || "sans-serif",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadowBlur: 0,
      shadowColor: "#000000",
      textAlign: 'left',
      type: 'label',
      isBold: false,
      isItalic: false,
      isUnderline: false,
    };
    setLayers([...layers, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const addListLayer = () => {
    const newLayer: TextLayer = {
      id: Math.random().toString(36).substr(2, 9),
      name: `List Layer ${layers.filter(l => l.type === 'list').length + 1}`,
      text: "10",
      options: ["10", "20", "30"],
      optionLabels: ["Ten", "Twenty", "Thirty"],
      hasOptionLabel: false,
      x: 50,
      y: 50,
      fontSize: user?.defaultFontSize || 60,
      color: user?.defaultFontColor || "#000064",
      fontFamily: user?.defaultFont || fonts[0]?.name || "sans-serif",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadowBlur: 0,
      shadowColor: "#000000",
      textAlign: 'left',
      type: 'list',
      isBold: false,
      isItalic: false,
      isUnderline: false,
    };
    setLayers([...layers, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const addNumberLayer = () => {
    const newLayer: TextLayer = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Price Layer ${layers.filter(l => l.type === 'number').length + 1}`,
      text: "1000",
      x: 50,
      y: 50,
      fontSize: user?.defaultFontSize || 60,
      color: user?.defaultFontColor || "#000064",
      fontFamily: "sans-serif",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadowBlur: 0,
      shadowColor: "#000000",
      textAlign: 'left',
      type: 'number',
      options: ["500", "1000", "1500", "2000", "2500", "5000", "10000"],
      hasNumberLabel: false,
      numberFontMode: 'fm',
      numberSuffix: 'auto',
      isBold: false,
      isItalic: false,
      isUnderline: false,
    };
    setLayers([...layers, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const toggleNumberOptionLabel = (numberLayerId: string) => {
    const numberLayer = layers.find(l => l.id === numberLayerId);
    if (!numberLayer) return;

    const willEnable = !numberLayer.hasNumberLabel;
    if (willEnable) {
      const mode = numberLayer.numberFontMode || 'fm';
      const convertedText = convertNumberToSinhala(numberLayer.text, mode);
      const existingLabel = layers.find(l => l.linkedNumberId === numberLayerId);
      const labelFont = mode === 'unicode' ? 'sans-serif' : (fonts[0]?.name || 'sans-serif');

      if (existingLabel) {
        setLayers(layers.map(l => {
          if (l.id === numberLayerId) return { ...l, hasNumberLabel: true };
          if (l.id === existingLabel.id) return { ...l, visible: true, text: convertedText, fontFamily: existingLabel.fontFamily || labelFont };
          return l;
        }));
        setSelectedLayerId(existingLabel.id);
      } else {
        const newLabelLayer: TextLayer = {
          id: Math.random().toString(36).substr(2, 9),
          name: `${numberLayer.name} - Label`,
          text: convertedText,
          x: Math.min(numberLayer.x + 8, 85),
          y: Math.min(numberLayer.y + 6, 85),
          fontSize: Math.round(numberLayer.fontSize * 0.85),
          color: numberLayer.color,
          fontFamily: labelFont,
          strokeColor: numberLayer.strokeColor,
          strokeWidth: numberLayer.strokeWidth,
          shadowBlur: numberLayer.shadowBlur,
          shadowColor: numberLayer.shadowColor,
          textAlign: numberLayer.textAlign,
          type: 'label',
          isNumberLabel: true,
          linkedNumberId: numberLayerId,
          numberFontMode: mode,
          isBold: numberLayer.isBold,
          isItalic: numberLayer.isItalic,
          isUnderline: numberLayer.isUnderline,
          visible: true,
        };
        setLayers([
          ...layers.map(l => l.id === numberLayerId ? { ...l, hasNumberLabel: true } : l),
          newLabelLayer
        ]);
        setSelectedLayerId(newLabelLayer.id);
      }
    } else {
      setLayers(layers.filter(l => l.linkedNumberId !== numberLayerId).map(l => l.id === numberLayerId ? { ...l, hasNumberLabel: false } : l));
      if (selectedLayerId && layers.find(l => l.id === selectedLayerId)?.linkedNumberId === numberLayerId) {
        setSelectedLayerId(numberLayerId);
      }
    }
  };

  const handleNumberInputChange = (numberLayerId: string, newNumberText: string) => {
    const numberLayer = layers.find(l => l.id === numberLayerId);
    if (!numberLayer) return;

    const mode = numberLayer.numberFontMode || 'fm';
    const convertedLabelText = convertNumberToSinhala(newNumberText, mode);

    setLayers(layers.map(l => {
      if (l.id === numberLayerId) return { ...l, text: newNumberText };
      if (l.linkedNumberId === numberLayerId) return { ...l, text: convertedLabelText };
      return l;
    }));
  };

  const handleNumberFontModeChange = (numberLayerId: string, newMode: 'fm' | 'unicode') => {
    const numberLayer = layers.find(l => l.id === numberLayerId);
    if (!numberLayer) return;

    const convertedLabelText = convertNumberToSinhala(numberLayer.text, newMode);

    setLayers(layers.map(l => {
      if (l.id === numberLayerId) {
        return { 
          ...l, 
          numberFontMode: newMode,
          numberSuffix: newMode === 'unicode' ? '/=' : (l.numberSuffix === '/=' ? 'auto' : l.numberSuffix)
        };
      }
      if (l.linkedNumberId === numberLayerId) {
        let newFont = l.fontFamily;
        if (newMode === 'unicode' && fonts.some(f => f.name === l.fontFamily)) {
          newFont = 'sans-serif';
        } else if (newMode === 'fm' && (l.fontFamily === 'sans-serif' || !fonts.some(f => f.name === l.fontFamily))) {
          newFont = fonts[0]?.name || 'sans-serif';
        }
        return { ...l, text: convertedLabelText, numberFontMode: newMode, fontFamily: newFont };
      }
      return l;
    }));
  };

  const updateLayer = (id: string, updates: Partial<TextLayer>) => {
    setLayers(layers.map((l) => {
      if (l.id === id) {
        const updated = { ...l, ...updates };
        // If updating a number layer's text via generic updateLayer, sync linked label
        return updated;
      }
      if (l.linkedListId === id && updates.name) {
        return { ...l, name: `${updates.name} - Label` };
      }
      if (l.linkedNumberId === id && updates.name) {
        return { ...l, name: `${updates.name} - Label` };
      }
      if (l.linkedNumberId === id && updates.text !== undefined) {
        const parentNumber = layers.find(p => p.id === id);
        if (parentNumber) {
          const mode = parentNumber.numberFontMode || 'fm';
          return { ...l, text: convertNumberToSinhala(updates.text, mode) };
        }
      }
      return l;
    }));
  };

  const deleteLayer = (id: string) => {
    const target = layers.find(l => l.id === id);
    if (target?.isListLabel && target.linkedListId) {
      setLayers(layers.filter((l) => l.id !== id).map(l => l.id === target.linkedListId ? { ...l, hasOptionLabel: false } : l));
    } else if (target?.isNumberLabel && target.linkedNumberId) {
      setLayers(layers.filter((l) => l.id !== id).map(l => l.id === target.linkedNumberId ? { ...l, hasNumberLabel: false } : l));
    } else {
      setLayers(layers.filter((l) => l.id !== id && l.linkedListId !== id && l.linkedNumberId !== id));
    }
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  const toggleListOptionLabel = (listLayerId: string) => {
    const listLayer = layers.find(l => l.id === listLayerId);
    if (!listLayer) return;

    const willEnable = !listLayer.hasOptionLabel;
    if (willEnable) {
      const currentOpts = listLayer.options || ["10", "20", "30"];
      const currentLabels = listLayer.optionLabels && listLayer.optionLabels.length > 0 
        ? [...listLayer.optionLabels] 
        : currentOpts.map((opt, i) => i === 0 && opt === "10" ? "Ten" : `Label ${i + 1}`);
      while (currentLabels.length < currentOpts.length) {
        currentLabels.push(`Label ${currentLabels.length + 1}`);
      }

      const optIndex = currentOpts.indexOf(listLayer.text);
      const activeLabelText = optIndex >= 0 && currentLabels[optIndex] 
        ? currentLabels[optIndex] 
        : (currentLabels[0] || "Label");

      const existingLabel = layers.find(l => l.linkedListId === listLayerId);
      if (existingLabel) {
        setLayers(layers.map(l => {
          if (l.id === listLayerId) return { ...l, hasOptionLabel: true, optionLabels: currentLabels };
          if (l.id === existingLabel.id) return { ...l, visible: true, text: activeLabelText };
          return l;
        }));
        setSelectedLayerId(existingLabel.id);
      } else {
        const newLabelLayer: TextLayer = {
          id: Math.random().toString(36).substr(2, 9),
          name: `${listLayer.name} - Label`,
          text: activeLabelText,
          x: Math.min(listLayer.x + 8, 85),
          y: Math.min(listLayer.y + 6, 85),
          fontSize: Math.round(listLayer.fontSize * 0.85),
          color: listLayer.color,
          fontFamily: listLayer.fontFamily,
          strokeColor: listLayer.strokeColor,
          strokeWidth: listLayer.strokeWidth,
          shadowBlur: listLayer.shadowBlur,
          shadowColor: listLayer.shadowColor,
          textAlign: listLayer.textAlign,
          type: 'label',
          isListLabel: true,
          linkedListId: listLayerId,
          isBold: listLayer.isBold,
          isItalic: listLayer.isItalic,
          isUnderline: listLayer.isUnderline,
          visible: true,
        };
        setLayers([
          ...layers.map(l => l.id === listLayerId ? { ...l, hasOptionLabel: true, optionLabels: currentLabels } : l),
          newLabelLayer
        ]);
        setSelectedLayerId(newLabelLayer.id);
      }
    } else {
      setLayers(layers.filter(l => l.linkedListId !== listLayerId).map(l => l.id === listLayerId ? { ...l, hasOptionLabel: false } : l));
      if (selectedLayerId && layers.find(l => l.id === selectedLayerId)?.linkedListId === listLayerId) {
        setSelectedLayerId(listLayerId);
      }
    }
  };

  const handleListSelectChange = (listLayerId: string, newSelectedVal: string) => {
    const listLayer = layers.find(l => l.id === listLayerId);
    if (!listLayer) return;

    const optIndex = listLayer.options ? listLayer.options.indexOf(newSelectedVal) : -1;
    const newLabelText = optIndex >= 0 && listLayer.optionLabels ? (listLayer.optionLabels[optIndex] || "") : "";

    setLayers(layers.map(l => {
      if (l.id === listLayerId) return { ...l, text: newSelectedVal };
      if (l.linkedListId === listLayerId) return { ...l, text: newLabelText };
      return l;
    }));
  };

  const handleListInputChange = (listLayerId: string, newText: string) => {
    const listLayer = layers.find(l => l.id === listLayerId);
    if (!listLayer) return;

    const optIndex = listLayer.options ? listLayer.options.indexOf(newText) : -1;
    const matchingLabel = optIndex >= 0 && listLayer.optionLabels ? listLayer.optionLabels[optIndex] : undefined;

    setLayers(layers.map(l => {
      if (l.id === listLayerId) return { ...l, text: newText };
      if (l.linkedListId === listLayerId && matchingLabel !== undefined) {
        return { ...l, text: matchingLabel };
      }
      return l;
    }));
  };

  const handleListLabelInputChange = (labelLayerId: string, newLabelText: string) => {
    const labelLayer = layers.find(l => l.id === labelLayerId);
    if (!labelLayer) return;

    setLayers(layers.map(l => {
      if (l.id === labelLayerId) return { ...l, text: newLabelText };
      if (l.id === labelLayer.linkedListId) {
        const optIndex = l.options ? l.options.indexOf(l.text) : -1;
        if (optIndex >= 0 && l.optionLabels) {
          const nextLabels = [...l.optionLabels];
          nextLabels[optIndex] = newLabelText;
          return { ...l, optionLabels: nextLabels };
        }
      }
      return l;
    }));
  };

  const updateListOption = (listLayerId: string, index: number, field: 'value' | 'label', newValue: string) => {
    const listLayer = layers.find(l => l.id === listLayerId);
    if (!listLayer) return;

    const newOptions = [...(listLayer.options || [])];
    const newLabels = [...(listLayer.optionLabels || [])];

    while (newLabels.length < newOptions.length) {
      newLabels.push("");
    }

    if (field === 'value') {
      const oldValue = newOptions[index];
      newOptions[index] = newValue;
      const isCurrentlySelected = listLayer.text === oldValue;
      const updatedText = isCurrentlySelected ? newValue : listLayer.text;

      setLayers(layers.map(l => {
        if (l.id === listLayerId) {
          return { ...l, options: newOptions, optionLabels: newLabels, text: updatedText };
        }
        return l;
      }));
    } else {
      newLabels[index] = newValue;
      const optIndex = newOptions.indexOf(listLayer.text);
      const shouldUpdateLinked = optIndex === index;

      setLayers(layers.map(l => {
        if (l.id === listLayerId) {
          return { ...l, options: newOptions, optionLabels: newLabels };
        }
        if (l.linkedListId === listLayerId && shouldUpdateLinked) {
          return { ...l, text: newValue };
        }
        return l;
      }));
    }
  };

  const addOptionToList = (listLayerId: string) => {
    const listLayer = layers.find(l => l.id === listLayerId);
    if (!listLayer) return;

    const count = (listLayer.options?.length || 0) + 1;
    const newOptions = [...(listLayer.options || []), `Item ${count}`];
    const newLabels = [...(listLayer.optionLabels || []), `Label ${count}`];

    updateLayer(listLayerId, { options: newOptions, optionLabels: newLabels });
  };

  const removeOptionFromList = (listLayerId: string, index: number) => {
    const listLayer = layers.find(l => l.id === listLayerId);
    if (!listLayer) return;

    const removedValue = listLayer.options?.[index];
    const newOptions = listLayer.options?.filter((_, idx) => idx !== index) || [];
    const newLabels = listLayer.optionLabels?.filter((_, idx) => idx !== index) || [];

    let nextSelectedText = listLayer.text;
    if (listLayer.text === removedValue) {
      nextSelectedText = newOptions[0] || "";
    }

    const nextOptIdx = newOptions.indexOf(nextSelectedText);
    const nextLabelText = nextOptIdx >= 0 && newLabels[nextOptIdx] ? newLabels[nextOptIdx] : "";

    setLayers(layers.map(l => {
      if (l.id === listLayerId) {
        return { ...l, options: newOptions, optionLabels: newLabels, text: nextSelectedText };
      }
      if (l.linkedListId === listLayerId) {
        return { ...l, text: nextLabelText };
      }
      return l;
    }));
  };

  const addPriceOption = (numberLayerId: string) => {
    const layer = layers.find(l => l.id === numberLayerId);
    if (!layer) return;

    const currentOptions = layer.options && layer.options.length > 0
      ? layer.options
      : ["500", "1000", "1500", "2000", "2500", "5000", "10000"];

    const lastVal = parseInt(currentOptions[currentOptions.length - 1], 10);
    const nextVal = !isNaN(lastVal) ? (lastVal + 500).toString() : "3000";
    const newOptions = [...currentOptions, nextVal];

    updateLayer(numberLayerId, { options: newOptions });
  };

  const updatePriceOption = (numberLayerId: string, index: number, newValue: string) => {
    const layer = layers.find(l => l.id === numberLayerId);
    if (!layer) return;

    const currentOptions = layer.options && layer.options.length > 0
      ? [...layer.options]
      : ["500", "1000", "1500", "2000", "2500", "5000", "10000"];

    const oldValue = currentOptions[index];
    currentOptions[index] = newValue;
    const isCurrentlySelected = layer.text === oldValue;
    
    if (isCurrentlySelected) {
      handleNumberInputChange(numberLayerId, newValue);
      updateLayer(numberLayerId, { options: currentOptions });
    } else {
      updateLayer(numberLayerId, { options: currentOptions });
    }
  };

  const removePriceOption = (numberLayerId: string, index: number) => {
    const layer = layers.find(l => l.id === numberLayerId);
    if (!layer) return;

    const currentOptions = layer.options && layer.options.length > 0
      ? layer.options
      : ["500", "1000", "1500", "2000", "2500", "5000", "10000"];

    const removedVal = currentOptions[index];
    const newOptions = currentOptions.filter((_, idx) => idx !== index);

    if (layer.text === removedVal && newOptions.length > 0) {
      handleNumberInputChange(numberLayerId, newOptions[0]);
    }

    updateLayer(numberLayerId, { options: newOptions });
  };

  const updateSuffixLineConfig = (layerId: string, suffixKey: string, partial: Partial<SuffixLineConfig>) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;
    const current = getSuffixLineConfig(layer, suffixKey, layer.suffixList?.indexOf(suffixKey));
    const updated: SuffixLineConfig = {
      x1: partial.x1 !== undefined ? Math.round(partial.x1 * 10) / 10 : current.x1,
      y1: partial.y1 !== undefined ? Math.round(partial.y1 * 10) / 10 : current.y1,
      x2: partial.x2 !== undefined ? Math.round(partial.x2 * 10) / 10 : current.x2,
      y2: partial.y2 !== undefined ? Math.round(partial.y2 * 10) / 10 : current.y2,
    };
    const newLines = {
      ...(layer.suffixLines || {}),
      [suffixKey]: updated,
    };
    updateLayer(layerId, { suffixLines: newLines });
  };

  const toggleSuffixList = (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const willEnable = !layer.hasSuffixList;
    const defaultSuffixes = ["uy;d", "uy;añh", "ñh"];
    const suffixList = layer.suffixList && layer.suffixList.length > 0 ? layer.suffixList : defaultSuffixes;
    const selectedSuffix = layer.selectedSuffix || suffixList[0] || "uy;d";

    const suffixLines = { ...(layer.suffixLines || {}) };
    suffixList.forEach((suf, idx) => {
      if (!suffixLines[suf]) {
        suffixLines[suf] = {
          x1: Math.round(Math.max(2, Math.min(85, layer.x))),
          y1: Math.round(Math.max(2, Math.min(95, layer.y + 4 + idx * 3.5))),
          x2: Math.round(Math.max(5, Math.min(98, layer.x + 20))),
          y2: Math.round(Math.max(2, Math.min(95, layer.y + 4 + idx * 3.5))),
        };
      }
    });

    updateLayer(layerId, {
      hasSuffixList: willEnable,
      suffixList,
      selectedSuffix: willEnable ? selectedSuffix : layer.selectedSuffix,
      suffixGap: layer.suffixGap !== undefined ? layer.suffixGap : 4,
      suffixLines,
    });
  };

  const addSuffixOption = (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const count = (layer.suffixList?.length || 0) + 1;
    const newSuffix = `/${count}`;
    const newSuffixList = [...(layer.suffixList || []), newSuffix];

    const newSuffixLines = { ...(layer.suffixLines || {}) };
    if (!newSuffixLines[newSuffix]) {
      newSuffixLines[newSuffix] = getSuffixLineConfig(layer, newSuffix, newSuffixList.length - 1);
    }

    updateLayer(layerId, {
      suffixList: newSuffixList,
      selectedSuffix: layer.selectedSuffix || newSuffix,
      suffixLines: newSuffixLines,
    });
  };

  const updateSuffixOption = (layerId: string, index: number, newValue: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const oldVal = layer.suffixList?.[index];
    const newSuffixList = [...(layer.suffixList || [])];
    newSuffixList[index] = newValue;

    const isCurrent = layer.selectedSuffix === oldVal;
    const newSuffixLines = { ...(layer.suffixLines || {}) };
    if (oldVal && newSuffixLines[oldVal]) {
      newSuffixLines[newValue] = newSuffixLines[oldVal];
      delete newSuffixLines[oldVal];
    }

    updateLayer(layerId, {
      suffixList: newSuffixList,
      selectedSuffix: isCurrent ? newValue : layer.selectedSuffix,
      suffixLines: newSuffixLines,
    });
  };

  const removeSuffixOption = (layerId: string, index: number) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const removedVal = layer.suffixList?.[index];
    const newSuffixList = (layer.suffixList || []).filter((_, idx) => idx !== index);
    let nextSelected = layer.selectedSuffix;
    if (layer.selectedSuffix === removedVal) {
      nextSelected = newSuffixList[0] || "";
    }

    const newSuffixLines = { ...(layer.suffixLines || {}) };
    if (removedVal && newSuffixLines[removedVal]) {
      delete newSuffixLines[removedVal];
    }

    updateLayer(layerId, {
      suffixList: newSuffixList,
      selectedSuffix: nextSelected,
      suffixLines: newSuffixLines,
    });
  };

  const copyImageToClipboard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      // 1. Save current layers state to memory (localStorage) before clearing
      if (currentProjectId) {
        localStorage.setItem(`prev_layers_${currentProjectId}`, JSON.stringify(layers));
      }

      // 2. Hide editing handles for clean export
      isExportingRef.current = true;
      drawCanvas();

      setTimeout(() => {
        // Copy to clipboard
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          try {
            const item = new ClipboardItem({ "image/png": blob });
            await navigator.clipboard.write([item]);
            setNotification({ message: "Image copied to clipboard!", type: 'success' });
            if (currentProjectId) {
              recordCreationEvent(currentProjectId, 'copy');
            }
          } catch (clipErr) {
            console.error("Clipboard copy error:", clipErr);
            setNotification({ message: "Failed to copy image to clipboard", type: 'error' });
          }
        });

        isExportingRef.current = false;
        // 3. Clear all layers text except labels
        setLayers(prev => prev.map(layer => {
          if (layer.type === 'label') return layer;
          return { ...layer, text: "" };
        }));
      }, 50);
    } catch (err) {
      isExportingRef.current = false;
      console.error("Failed to copy image", err);
      setNotification({ message: "Failed to copy image", type: 'error' });
    }
  };

  const restorePreviousState = () => {
    if (!currentProjectId) return;
    const saved = localStorage.getItem(`prev_layers_${currentProjectId}`);
    if (saved) {
      try {
        const restoredLayers = JSON.parse(saved);
        setLayers(restoredLayers);
        setNotification({ message: "Previous state restored", type: 'success' });
      } catch (err) {
        console.error("Failed to restore layers", err);
      }
    } else {
      setNotification({ message: "No previous state found", type: 'error' });
    }
  };

  const drawCanvasRef = useRef<number | null>(null);
  const drawTimerRef = useRef<NodeJS.Timeout | null>(null);

  const drawCanvas = () => {
    if (drawTimerRef.current) clearTimeout(drawTimerRef.current);
    
    drawTimerRef.current = setTimeout(() => {
      if (drawCanvasRef.current) cancelAnimationFrame(drawCanvasRef.current);
      
      drawCanvasRef.current = requestAnimationFrame(async () => {
        const canvas = canvasRef.current;
        if (!canvas || !imageCacheRef.current) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        const img = imageCacheRef.current;
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
          setCanvasSize({ width: img.width, height: img.height });
        }
        
        ctx.drawImage(img, 0, 0);

        for (const layer of layers) {
          if (layer.visible === false) continue;
          ctx.save();
          const fontStyle = layer.isItalic ? "italic " : "";
          const fontWeight = layer.isBold ? "bold " : "";
          const fontFamily = layer.fontFamily || "sans-serif";
          const fontStr = `${fontStyle}${fontWeight}${layer.fontSize}px "${fontFamily}", sans-serif`;
          
          if (fontFamily !== "sans-serif" && !document.fonts.check(fontStr)) {
            try {
              await document.fonts.load(fontStr);
            } catch (e) {
              if (!fontFamily.includes("apex_apura_044")) {
                console.warn(`Failed to load font for canvas: ${fontStr}`, e);
              }
            }
          }

          if (layer.hasSuffixList && layer.selectedSuffix && layer.suffixFontFamily && layer.suffixFontFamily !== "sans-serif" && layer.suffixFontFamily !== fontFamily) {
            const sufFontStr = `${fontStyle}${fontWeight}${layer.suffixFontSize || layer.fontSize}px "${layer.suffixFontFamily}", sans-serif`;
            if (!document.fonts.check(sufFontStr)) {
              try {
                await document.fonts.load(sufFontStr);
              } catch (_) {}
            }
          }

          ctx.font = fontStr;
          ctx.textAlign = layer.textAlign || "center";
          ctx.textBaseline = "middle";
          
          const x = (layer.x / 100) * canvas.width;
          const y = (layer.y / 100) * canvas.height;
          
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
            ctx.shadowBlur = layer.shadowBlur * (canvas.width / 1000);
            ctx.shadowColor = layer.shadowColor;
          }

          if (isSinhalaDate) {
            const monthFontSize = ((layer.sinhalaMonthFontSize || layer.fontSize) * (canvas.width / 1000));
            const monthFontStr = `${layer.isItalic ? 'italic ' : ''}${layer.isBold ? 'bold ' : ''}${monthFontSize}px "${layer.fontFamily}"`;
            
            // Calculate total width
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
              ctx.lineWidth = layer.strokeWidth * (canvas.width / 1000);
              
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
              ctx.lineWidth = layer.strokeWidth * (canvas.width / 1000);
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
              const suffixFontStr = `${fontStyle}${fontWeight}${suffixFontSize}px "${suffixFontFamily}", sans-serif`;

              ctx.font = suffixFontStr;
              ctx.textAlign = 'left';

              if (layer.strokeWidth > 0) {
                ctx.strokeStyle = layer.strokeColor;
                ctx.lineWidth = layer.strokeWidth * (canvas.width / 1000);
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
            const width = metrics.width;
            const height = layer.fontSize;
            let underlineX = x;
            if (ctx.textAlign === 'center') underlineX = x - width / 2;
            if (ctx.textAlign === 'right') underlineX = x - width;
            
            let totalWidth = width;
            if (layer.hasSuffixList && layer.selectedSuffix) {
              const prevFont = ctx.font;
              const suffixFontSize = layer.suffixFontSize || layer.fontSize;
              const suffixFontFamily = layer.suffixFontFamily || layer.fontFamily;
              ctx.font = `${fontStyle}${fontWeight}${suffixFontSize}px "${suffixFontFamily}", sans-serif`;
              const sufMetrics = ctx.measureText(layer.selectedSuffix);
              const gap = (layer.suffixGap !== undefined ? layer.suffixGap : 4);
              totalWidth += gap + sufMetrics.width;
              ctx.font = prevFont;
            }

            ctx.beginPath();
            ctx.strokeStyle = layer.color;
            ctx.lineWidth = Math.max(1, layer.fontSize / 15);
            ctx.moveTo(underlineX, y + height / 2);
            ctx.lineTo(underlineX + totalWidth, y + height / 2);
            ctx.stroke();
          }
          ctx.restore();

          // Draw suffix line if enabled and has selected suffix
          if (layer.hasSuffixList && layer.showSuffixLine && layer.selectedSuffix) {
            const lineCfg = getSuffixLineConfig(layer, layer.selectedSuffix, layer.suffixList?.indexOf(layer.selectedSuffix));
            if (lineCfg) {
              const lx1 = (lineCfg.x1 / 100) * canvas.width;
              const ly1 = (lineCfg.y1 / 100) * canvas.height;
              const lx2 = (lineCfg.x2 / 100) * canvas.width;
              const ly2 = (lineCfg.y2 / 100) * canvas.height;

              ctx.save();
              ctx.beginPath();
              ctx.strokeStyle = layer.suffixLineColor || layer.color;
              const lineThickness = (layer.suffixLineWidth || 3) * (canvas.width / 1000);
              ctx.lineWidth = Math.max(1, lineThickness);
              ctx.lineCap = 'round';
              ctx.moveTo(lx1, ly1);
              ctx.lineTo(lx2, ly2);
              ctx.stroke();

              const currentProject = projects.find(p => p.id === currentProjectId);
              const isLocked = currentProject?.isLocked;
              if (selectedLayerId === layer.id && !isLocked && !isPreviewMode && !isExportingRef.current) {
                const handleR = Math.max(5, 7 * (canvas.width / 1000));
                
                // Endpoint 1 Handle
                ctx.beginPath();
                ctx.arc(lx1, ly1, handleR, 0, Math.PI * 2);
                ctx.fillStyle = '#0284c7';
                ctx.fill();
                ctx.lineWidth = Math.max(1.5, 2 * (canvas.width / 1000));
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();

                // Endpoint 2 Handle
                ctx.beginPath();
                ctx.arc(lx2, ly2, handleR, 0, Math.PI * 2);
                ctx.fillStyle = '#0284c7';
                ctx.fill();
                ctx.lineWidth = Math.max(1.5, 2 * (canvas.width / 1000));
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
              }
              ctx.restore();
            }
          }
        }
      });
    }, 16);
  };

  useEffect(() => {
    drawCanvas();
  }, [image, layers, fonts, selectedLayerId, isPreviewMode]);

  // Auto-save effect
  useEffect(() => {
    if (!user || !image || !currentProjectId) return;
    
    // Check if current project is locked
    const currentProject = projects.find(p => p.id === currentProjectId);
    if (currentProject?.isLocked) return;

    // Check if layers actually changed from last saved state
    const currentLayersStr = JSON.stringify(layers);
    if (currentLayersStr === lastSavedLayersRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      saveProject();
    }, 1500); // Debounce save for 1.5 seconds

    return () => clearTimeout(timer);
  }, [layers, image, currentProjectId, projects]);

  const getLayerAtPosition = (mouseX: number, mouseY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    return [...layers].reverse().find((layer) => {
      if (layer.visible === false) return false;
      let displayText = layer.text || layer.name || "Text Layer";
      if (layer.type === 'number') {
        const linkedLabel = layers.find(l => l.linkedNumberId === layer.id);
        const effectiveMode = linkedLabel?.numberFontMode || layer.numberFontMode;
        displayText = formatNumberForCanvas(layer.text, layer.numberSuffix, layer.fontFamily, effectiveMode) || layer.name || "Price";
      } else if (layer.isListLabel && layer.linkedListId) {
        const parentList = layers.find(l => l.id === layer.linkedListId);
        if (parentList) {
          const optIndex = parentList.options ? parentList.options.indexOf(parentList.text) : -1;
          if (optIndex >= 0 && parentList.optionLabels && parentList.optionLabels[optIndex] !== undefined && parentList.optionLabels[optIndex] !== "") {
            displayText = parentList.optionLabels[optIndex];
          } else if (layer.text) {
            displayText = layer.text;
          }
        }
      } else if (layer.isNumberLabel && layer.linkedNumberId) {
        const parentNumber = layers.find(l => l.id === layer.linkedNumberId);
        if (parentNumber) {
          const mode = parentNumber.numberFontMode || layer.numberFontMode || 'fm';
          displayText = convertNumberToSinhala(parentNumber.text, mode) || layer.text || "";
        }
      }
      ctx.font = `${layer.fontSize}px "${layer.fontFamily}"`;
      const metrics = ctx.measureText(displayText);
      const x = (layer.x / 100) * canvas.width;
      const y = (layer.y / 100) * canvas.height;
      
      const width = metrics.width;
      const height = layer.fontSize;
      
      let startX = x - width / 2;
      if (layer.textAlign === 'left') startX = x;
      if (layer.textAlign === 'right') startX = x - width;

      let endX = startX + width;
      if (layer.hasSuffixList && layer.selectedSuffix) {
        const prevFont = ctx.font;
        ctx.font = `${layer.suffixFontSize || layer.fontSize}px "${layer.suffixFontFamily || layer.fontFamily}"`;
        const sufMetrics = ctx.measureText(layer.selectedSuffix);
        const gap = layer.suffixGap !== undefined ? layer.suffixGap : 4;
        endX += gap + sufMetrics.width;
        ctx.font = prevFont;
      }

      return (
        mouseX >= startX &&
        mouseX <= endX &&
        mouseY >= y - height / 2 &&
        mouseY <= y + height / 2
      );
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const currentProject = projects.find(p => p.id === currentProjectId);
    const isLocked = currentProject?.isLocked;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // 1. Check if clicked on suffix line handle or line for CURRENTLY selected layer
    if (selectedLayerId && !isLocked) {
      const selected = layers.find(l => l.id === selectedLayerId);
      if (selected?.hasSuffixList && selected?.showSuffixLine && selected?.selectedSuffix) {
        const lineCfg = getSuffixLineConfig(selected, selected.selectedSuffix, selected.suffixList?.indexOf(selected.selectedSuffix));
        const lx1 = (lineCfg.x1 / 100) * canvas.width;
        const ly1 = (lineCfg.y1 / 100) * canvas.height;
        const lx2 = (lineCfg.x2 / 100) * canvas.width;
        const ly2 = (lineCfg.y2 / 100) * canvas.height;
        const handleThreshold = Math.max(14, 18 * (canvas.width / 1000));

        if (Math.hypot(mouseX - lx1, mouseY - ly1) <= handleThreshold) {
          dragTargetRef.current = 'line-p1';
          isDraggingRef.current = true;
          return;
        }
        if (Math.hypot(mouseX - lx2, mouseY - ly2) <= handleThreshold) {
          dragTargetRef.current = 'line-p2';
          isDraggingRef.current = true;
          return;
        }
        if (distToSegment(mouseX, mouseY, lx1, ly1, lx2, ly2) <= handleThreshold) {
          dragTargetRef.current = 'line-move';
          isDraggingRef.current = true;
          lineDragStartRef.current = {
            x1: lineCfg.x1,
            y1: lineCfg.y1,
            x2: lineCfg.x2,
            y2: lineCfg.y2,
            mouseX,
            mouseY,
          };
          return;
        }
      }
    }

    // 2. Check if clicked on any layer's suffix line to select it
    for (const layer of [...layers].reverse()) {
      if (layer.visible === false || !layer.hasSuffixList || !layer.showSuffixLine || !layer.selectedSuffix) continue;
      const lineCfg = getSuffixLineConfig(layer, layer.selectedSuffix, layer.suffixList?.indexOf(layer.selectedSuffix));
      const lx1 = (lineCfg.x1 / 100) * canvas.width;
      const ly1 = (lineCfg.y1 / 100) * canvas.height;
      const lx2 = (lineCfg.x2 / 100) * canvas.width;
      const ly2 = (lineCfg.y2 / 100) * canvas.height;
      const handleThreshold = Math.max(14, 18 * (canvas.width / 1000));

      if (distToSegment(mouseX, mouseY, lx1, ly1, lx2, ly2) <= handleThreshold) {
        if (!isLocked) {
          setSelectedLayerId(layer.id);
          dragTargetRef.current = 'line-move';
          isDraggingRef.current = true;
          lineDragStartRef.current = {
            x1: lineCfg.x1,
            y1: lineCfg.y1,
            x2: lineCfg.x2,
            y2: lineCfg.y2,
            mouseX,
            mouseY,
          };
        }
        return;
      }
    }

    // 3. Fallback to text layer selection
    const clickedLayer = getLayerAtPosition(mouseX, mouseY);

    if (clickedLayer) {
      if (!isLocked) {
        setSelectedLayerId(clickedLayer.id);
        dragTargetRef.current = 'layer';
        isDraggingRef.current = true;
        dragStartPos.current = {
          x: mouseX - (clickedLayer.x / 100) * canvas.width,
          y: mouseY - (clickedLayer.y / 100) * canvas.height,
        };
      }
    } else {
      setSelectedLayerId(null);
      dragTargetRef.current = null;
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const currentProject = projects.find(p => p.id === currentProjectId);
    const isLocked = currentProject?.isLocked;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    if (isDraggingRef.current && selectedLayerId && !isLocked) {
      const selected = layers.find(l => l.id === selectedLayerId);
      if (!selected) return;

      if (dragTargetRef.current === 'line-p1' && selected.selectedSuffix) {
        const newX1 = Math.max(0, Math.min(100, (mouseX / canvas.width) * 100));
        const newY1 = Math.max(0, Math.min(100, (mouseY / canvas.height) * 100));
        updateSuffixLineConfig(selectedLayerId, selected.selectedSuffix, {
          x1: Math.round(newX1 * 10) / 10,
          y1: Math.round(newY1 * 10) / 10,
        });
        canvas.style.cursor = 'crosshair';
        return;
      }

      if (dragTargetRef.current === 'line-p2' && selected.selectedSuffix) {
        const newX2 = Math.max(0, Math.min(100, (mouseX / canvas.width) * 100));
        const newY2 = Math.max(0, Math.min(100, (mouseY / canvas.height) * 100));
        updateSuffixLineConfig(selectedLayerId, selected.selectedSuffix, {
          x2: Math.round(newX2 * 10) / 10,
          y2: Math.round(newY2 * 10) / 10,
        });
        canvas.style.cursor = 'crosshair';
        return;
      }

      if (dragTargetRef.current === 'line-move' && selected.selectedSuffix) {
        const dx = ((mouseX - lineDragStartRef.current.mouseX) / canvas.width) * 100;
        const dy = ((mouseY - lineDragStartRef.current.mouseY) / canvas.height) * 100;
        const w = lineDragStartRef.current.x2 - lineDragStartRef.current.x1;
        const h = lineDragStartRef.current.y2 - lineDragStartRef.current.y1;
        const newX1 = Math.max(0, Math.min(100 - Math.max(0, w), lineDragStartRef.current.x1 + dx));
        const newY1 = Math.max(0, Math.min(100 - Math.max(0, h), lineDragStartRef.current.y1 + dy));
        updateSuffixLineConfig(selectedLayerId, selected.selectedSuffix, {
          x1: Math.round(newX1 * 10) / 10,
          y1: Math.round(newY1 * 10) / 10,
          x2: Math.round((newX1 + w) * 10) / 10,
          y2: Math.round((newY1 + h) * 10) / 10,
        });
        canvas.style.cursor = 'move';
        return;
      }

      // Default: dragging layer text
      const newX = ((mouseX - dragStartPos.current.x) / canvas.width) * 100;
      const newY = ((mouseY - dragStartPos.current.y) / canvas.height) * 100;
      updateLayer(selectedLayerId, { x: newX, y: newY });
      canvas.style.cursor = 'move';
    } else {
      // Check if cursor hovers over selected layer's line handles or line
      if (selectedLayerId && !isLocked) {
        const selected = layers.find(l => l.id === selectedLayerId);
        if (selected?.hasSuffixList && selected?.showSuffixLine && selected?.selectedSuffix) {
          const lineCfg = getSuffixLineConfig(selected, selected.selectedSuffix, selected.suffixList?.indexOf(selected.selectedSuffix));
          const lx1 = (lineCfg.x1 / 100) * canvas.width;
          const ly1 = (lineCfg.y1 / 100) * canvas.height;
          const lx2 = (lineCfg.x2 / 100) * canvas.width;
          const ly2 = (lineCfg.y2 / 100) * canvas.height;
          const handleThreshold = Math.max(14, 18 * (canvas.width / 1000));

          if (Math.hypot(mouseX - lx1, mouseY - ly1) <= handleThreshold || Math.hypot(mouseX - lx2, mouseY - ly2) <= handleThreshold) {
            canvas.style.cursor = 'crosshair';
            return;
          }
          if (distToSegment(mouseX, mouseY, lx1, ly1, lx2, ly2) <= handleThreshold) {
            canvas.style.cursor = 'move';
            return;
          }
        }
      }

      const hoveredLayer = getLayerAtPosition(mouseX, mouseY);
      if (hoveredLayer) {
        canvas.style.cursor = isLocked ? 'pointer' : 'move';
      } else {
        canvas.style.cursor = 'default';
      }
    }
  };

  const handleCanvasMouseUp = () => {
    isDraggingRef.current = false;
    dragTargetRef.current = null;
  };

  const downloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    isExportingRef.current = true;
    drawCanvas();

    setTimeout(() => {
      const link = document.createElement("a");
      link.download = "overlay-image.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      isExportingRef.current = false;
      drawCanvas();
      if (currentProjectId) {
        recordCreationEvent(currentProjectId, 'download');
      }
      setNotification({ message: "Image downloaded successfully!", type: 'success' });
    }, 50);
  };

  const shareImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    isExportingRef.current = true;
    drawCanvas();
    
    setTimeout(async () => {
      try {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return;
        
        const file = new File([blob], 'shared-image.png', { type: 'image/png' });
        
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Shared Image',
            text: 'Check out this image I created!',
          });
          if (currentProjectId) {
            recordCreationEvent(currentProjectId, 'share');
          }
        } else {
          setNotification({ message: "Sharing is not supported on this browser. You can download the image instead.", type: 'error' });
        }
      } catch (err) {
        console.error("Error sharing image:", err);
      } finally {
        isExportingRef.current = false;
        drawCanvas();
      }
    }, 50);
  };

  const shareWhatsApp = () => {
    const currentProject = projects.find(p => p.id === currentProjectId);
    const text = `Check out this image: ${currentProject?.name || 'Image'}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
    if (currentProjectId) {
      recordCreationEvent(currentProjectId, 'share');
    }
  };

  // Keyboard shortcut Ctrl+C / Cmd+C on canvas to copy and track creation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (image && currentProjectId) {
          e.preventDefault();
          copyImageToClipboard();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [image, currentProjectId, layers]);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 border border-slate-800 p-8 rounded-2xl w-full max-w-md shadow-2xl"
        >
          <div className="flex flex-col items-center mb-6">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-900/20">
              <ImageIcon className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white">FontOverlay Pro</h1>
            <p className="text-slate-400 text-sm mt-1">
              {isRegisterMode ? "Create an account to start creating" : "Sign in to start creating"}
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex bg-slate-800/80 p-1 rounded-xl mb-6 border border-slate-700/60">
            <button
              type="button"
              onClick={() => {
                setIsRegisterMode(false);
                setError("");
              }}
              className={cn(
                "flex-1 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5",
                !isRegisterMode
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              )}
            >
              <UserCircle size={14} />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegisterMode(true);
                setError("");
              }}
              className={cn(
                "flex-1 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5",
                isRegisterMode
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              )}
            >
              <UserPlus size={14} />
              Create Account
            </button>
          </div>

          <form onSubmit={isRegisterMode ? handleRegister : handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                placeholder={isRegisterMode ? "Choose a username" : "Enter your username"}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                placeholder={isRegisterMode ? "At least 4 characters" : "••••"}
                required
              />
            </div>
            {isRegisterMode && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={registerConfirmPassword}
                  onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  placeholder="Re-enter your password"
                  required
                />
              </div>
            )}
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-colors shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
            >
              {loading ? (
                isRegisterMode ? "Creating Account..." : "Signing in..."
              ) : isRegisterMode ? (
                <>
                  <UserPlus size={16} />
                  Create Account
                </>
              ) : (
                <>
                  <UserCircle size={16} />
                  Sign In
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-400">
            {isRegisterMode ? (
              <p>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsRegisterMode(false);
                    setError("");
                  }}
                  className="text-blue-400 hover:text-blue-300 font-semibold transition-colors underline-offset-2 hover:underline ml-1"
                >
                  Sign In
                </button>
              </p>
            ) : (
              <p>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsRegisterMode(true);
                    setError("");
                  }}
                  className="text-blue-400 hover:text-blue-300 font-semibold transition-colors underline-offset-2 hover:underline ml-1"
                >
                  Create Account
                </button>
              </p>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  const selectedLayer = layers.find((l) => l.id === selectedLayerId);

  return (
    <div className="h-screen bg-slate-950 text-slate-200 flex flex-col overflow-hidden">
      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn(
              "fixed top-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border backdrop-blur-md",
              notification.type === 'success' ? "bg-green-600/20 border-green-500/50 text-green-400" : "bg-red-600/20 border-red-500/50 text-red-400"
            )}
          >
            {notification.type === 'success' ? <Check size={18} /> : <X size={18} />}
            <span className="text-sm font-bold">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md sticky top-0 z-[100]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <ImageIcon className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-lg tracking-tight hidden sm:inline shrink-0">My Card Creator</span>

          {/* Current Project Name & Quick Rename */}
          {(() => {
            const currentProject = projects.find(p => p.id === currentProjectId);
            if (!currentProject) return null;

            return (
              <div className="flex items-center gap-1.5 ml-1 sm:ml-3 pl-2 sm:pl-3 border-l border-slate-800 min-w-0">
                {isEditingHeaderName ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (headerNameInput.trim()) {
                        renameProject(currentProject.id, headerNameInput);
                      }
                      setIsEditingHeaderName(false);
                    }}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="text"
                      value={headerNameInput}
                      onChange={(e) => setHeaderNameInput(e.target.value)}
                      onBlur={() => {
                        if (headerNameInput.trim() && headerNameInput.trim() !== currentProject.name) {
                          renameProject(currentProject.id, headerNameInput);
                        }
                        setIsEditingHeaderName(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setIsEditingHeaderName(false);
                      }}
                      autoFocus
                      className="bg-slate-800 border border-blue-500 rounded-lg px-2.5 py-1 text-xs sm:text-sm text-white focus:outline-none w-36 sm:w-56 md:w-72 shadow-inner"
                    />
                    <button
                      type="submit"
                      className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shrink-0"
                      title="Save name"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsEditingHeaderName(false);
                      }}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors shrink-0"
                      title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => {
                      setHeaderNameInput(currentProject.name);
                      setIsEditingHeaderName(true);
                    }}
                    className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-200 hover:text-white bg-slate-800/70 hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700/60 transition-all group max-w-[150px] sm:max-w-xs md:max-w-sm truncate"
                    title="Click to rename project"
                  >
                    <span className="truncate">{currentProject.name}</span>
                    <Edit2 size={13} className="text-slate-400 group-hover:text-blue-400 shrink-0 transition-colors" />
                  </button>
                )}

                {/* Creation Count Pill */}
                <button
                  type="button"
                  onClick={() => setSelectedStatsProject(currentProject)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all shadow-sm group shrink-0"
                  title={`Image Creations: ${currentProject.creationsCount || 0} (${currentProject.copiesCount || 0} copies, ${currentProject.downloadsCount || 0} downloads, ${currentProject.sharesCount || 0} shares). Click for details.`}
                >
                  <Sparkles size={13} className="text-amber-400 group-hover:scale-110 transition-transform" />
                  <span>{currentProject.creationsCount || 0}</span>
                  <span className="text-amber-400/80 hidden sm:inline text-[11px] font-normal">Creations</span>
                </button>
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          {image && (
            <div className="flex items-center gap-2">
              <button
                onClick={shareWhatsApp}
                title="Share on WhatsApp"
                className="p-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-all border border-green-600/30"
              >
                <MessageCircle size={18} />
              </button>
              <button
                onClick={shareImage}
                title="Share Image"
                className="p-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg transition-all border border-blue-600/30"
              >
                <Share2 size={18} />
              </button>
              <button
                onClick={downloadImage}
                title="Download Image"
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-all border border-slate-700"
              >
                <Download size={18} />
              </button>
            </div>
          )}
          <button 
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className={cn(
              "p-2 rounded-lg transition-all",
              isPreviewMode ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            )}
            title={isPreviewMode ? "Exit Preview" : "Enter Preview"}
          >
            <ImageIcon size={20} />
          </button>
          <button 
            onClick={() => setShowSidebar(!showSidebar)}
            className="md:hidden p-2 bg-slate-800 rounded-lg text-slate-300"
          >
            {showSidebar ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-2 sm:px-3 py-1.5">
            <button onClick={() => setZoom(Math.max(0.1, zoom - 0.1))} className="hover:text-blue-400 p-1">
              <Minus size={14} />
            </button>
            <span className="text-[10px] sm:text-xs font-mono w-8 sm:w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(Math.min(3, zoom + 0.1))} className="hover:text-blue-400 p-1">
              <Plus size={14} />
            </button>
          </div>
          
          <div className="relative">
            <button 
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5 transition-all"
            >
              <UserCircle size={18} className="text-blue-400" />
              <span className="text-sm font-medium">{user.username}</span>
              <ChevronDown size={14} className={cn("transition-transform", showUserMenu && "rotate-180")} />
            </button>

            <AnimatePresence>
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-[110]" onClick={() => setShowUserMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl z-[120] overflow-hidden"
                  >
                    <div className="p-3 border-b border-slate-800">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Account</p>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600/20 rounded-full flex items-center justify-center">
                          <span className="text-blue-400 font-bold text-sm">{user.username[0].toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{user.username}</p>
                          <p className="text-[10px] text-slate-500 flex items-center gap-1">
                            {user.role === 'admin' ? <Shield size={10} /> : <UserCircle size={10} />}
                            {user.role.toUpperCase()}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-1">
                      <button 
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowChangePasswordModal(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                      >
                        <Key size={16} />
                        Change Password
                      </button>
                      
                      <button 
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowFontManagementModal(true);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                      >
                        <FontIcon size={16} />
                        Manage Fonts
                      </button>

                      {user.role === 'admin' && (
                        <>
                          <button 
                            onClick={() => {
                              setShowUserMenu(false);
                              fetchAllUsers();
                              setShowUserManagementModal(true);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
                          >
                            <Users size={16} />
                            Manage Users
                          </button>
                        </>
                      )}
                    </div>
                    
                    <div className="p-1 border-t border-slate-800">
                      <button 
                        onClick={() => setUser(null)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      >
                        <LogOut size={16} />
                        Sign Out
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {showChangePasswordModal && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowChangePasswordModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white">Change Password</h3>
                <button onClick={() => setShowChangePasswordModal(false)} className="text-slate-500 hover:text-white">
                  <Plus size={20} className="rotate-45" />
                </button>
              </div>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Old Password</label>
                  <input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Enter old password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Enter new password"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Confirm new password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-900/20"
                >
                  Update Password
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {showFontManagementModal && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowFontManagementModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between mb-6 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center">
                    <FontIcon size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white leading-tight">Font Management</h3>
                    <p className="text-xs text-slate-500">Select, order and manage custom fonts</p>
                  </div>
                </div>
                <button onClick={() => setShowFontManagementModal(false)} className="text-slate-500 hover:text-white transition-colors">
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
                {/* Default Preferences Section */}
                <div className="bg-slate-800/30 border border-slate-800 p-4 rounded-xl space-y-4">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Settings size={16} className="text-blue-400" />
                    Default Text Settings
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase tracking-widest block mb-1.5">Default Font</label>
                      <select 
                        value={user?.defaultFont || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          debouncedUpdatePreferences({ defaultFont: val });
                          if (selectedLayerId) {
                            updateLayer(selectedLayerId, { fontFamily: val });
                          }
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Select Font</option>
                        <option value="sans-serif">System Sans</option>
                        {fonts.map(f => (
                          <option key={f.name} value={f.name}>{f.name.split('-').slice(1).join('-') || f.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase tracking-widest block mb-1.5">Default Size</label>
                      <input 
                        type="number"
                        value={user?.defaultFontSize || 60}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val)) {
                            debouncedUpdatePreferences({ defaultFontSize: val });
                            if (selectedLayerId) {
                              updateLayer(selectedLayerId, { fontSize: val });
                            }
                          }
                        }}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase tracking-widest block mb-1.5">Default Color</label>
                      <div className="flex items-center gap-2">
                        <input 
                          type="color"
                          value={user?.defaultFontColor || '#000064'}
                          onChange={(e) => {
                            const val = e.target.value;
                            debouncedUpdatePreferences({ defaultFontColor: val });
                            if (selectedLayerId) {
                              updateLayer(selectedLayerId, { color: val });
                            }
                          }}
                          className="w-8 h-8 bg-transparent border-none cursor-pointer"
                        />
                        <span className="text-xs text-slate-400 font-mono uppercase">{user?.defaultFontColor || '#000064'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Upload Section */}
                <div className="bg-slate-800/30 border border-slate-800 p-4 rounded-xl">
                  <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <Upload size={16} className="text-green-400" />
                    Upload New Font
                  </h4>
                  <div className="flex items-center gap-4">
                    <label className="flex-1 cursor-pointer bg-slate-900 border border-slate-700 border-dashed rounded-xl p-6 hover:border-blue-500 hover:bg-blue-500/5 transition-all text-center group">
                      <input type="file" accept=".woff,.woff2" className="hidden" onChange={handleFontUpload} />
                      <div className="flex flex-col items-center gap-2">
                        <Plus size={24} className="text-slate-500 group-hover:text-blue-400 transition-colors" />
                        <span className="text-sm text-slate-400 group-hover:text-slate-300">Click to browse font files</span>
                        <span className="text-[10px] text-slate-600 uppercase tracking-widest">WOFF, WOFF2 ONLY</span>
                      </div>
                    </label>
                    {isFontLoading && (
                      <div className="w-12 h-12 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin shrink-0" />
                    )}
                  </div>
                </div>

                {/* Font List Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Installed Fonts</h4>
                  <div className="grid grid-cols-1 gap-2">
                    {fonts.length === 0 ? (
                      <div className="text-center py-8 bg-slate-800/20 rounded-xl border border-slate-800 border-dashed">
                        <p className="text-sm text-slate-500 italic">No custom fonts installed</p>
                      </div>
                    ) : (
                      fonts.map((f, index) => {
                        const isSelected = user?.selectedFonts?.includes(f.name);
                        const selectedIndex = user?.selectedFonts?.indexOf(f.name) ?? -1;
                        
                        return (
                          <div key={`${f.name}-${index}`} className="bg-slate-800/30 border border-slate-800 p-3 rounded-xl flex items-center justify-between group">
                            <div className="flex items-center gap-3 flex-1">
                              <button 
                                onClick={() => {
                                  const currentSelected = user?.selectedFonts || [];
                                  if (isSelected) {
                                    debouncedUpdatePreferences({ selectedFonts: currentSelected.filter(name => name !== f.name) });
                                  } else {
                                    debouncedUpdatePreferences({ selectedFonts: [...currentSelected, f.name] });
                                    if (selectedLayer) {
                                      updateLayer(selectedLayer.id, { fontFamily: f.name });
                                    }
                                  }
                                }}
                                className={cn(
                                  "w-6 h-6 rounded border flex items-center justify-center transition-all",
                                  isSelected ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-900 border-slate-700 text-transparent"
                                )}
                              >
                                {isSelected ? <Check size={14} /> : <Plus size={14} className="opacity-0" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-sm font-bold text-white truncate">{f.name.split('-').slice(1).join('-') || f.name}</p>
                                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                                    {isSelected ? `Selected (Position: ${selectedIndex + 1})` : 'Not Selected'}
                                  </p>
                                </div>
                                <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800/50">
                                  <p className="text-xl sm:text-2xl text-white truncate" style={{ fontFamily: f.name }}>
                                    The quick brown fox
                                  </p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 ml-4">
                              {isSelected && (
                                <div className="flex gap-1 mr-2">
                                  <button 
                                    disabled={selectedIndex === 0}
                                    onClick={() => {
                                      const currentSelected = [...(user?.selectedFonts || [])];
                                      if (selectedIndex > 0) {
                                        [currentSelected[selectedIndex - 1], currentSelected[selectedIndex]] = [currentSelected[selectedIndex], currentSelected[selectedIndex - 1]];
                                        updatePreferences(currentSelected);
                                      }
                                    }}
                                    className="p-1.5 hover:bg-slate-700 text-slate-400 rounded disabled:opacity-30"
                                  >
                                    <ChevronDown size={14} className="rotate-180" />
                                  </button>
                                  <button 
                                    disabled={selectedIndex === (user?.selectedFonts?.length || 0) - 1}
                                    onClick={() => {
                                      const currentSelected = [...(user?.selectedFonts || [])];
                                      if (selectedIndex < currentSelected.length - 1) {
                                        [currentSelected[selectedIndex + 1], currentSelected[selectedIndex]] = [currentSelected[selectedIndex], currentSelected[selectedIndex + 1]];
                                        updatePreferences(currentSelected);
                                      }
                                    }}
                                    className="p-1.5 hover:bg-slate-700 text-slate-400 rounded disabled:opacity-30"
                                  >
                                    <ChevronDown size={14} />
                                  </button>
                                </div>
                              )}

                              {user?.role === 'admin' && (
                                <>
                                  <button 
                                    onClick={() => {
                                      setEditingFont(f);
                                      setNewFontName(f.name);
                                    }}
                                    className="p-2 hover:bg-blue-600/20 text-slate-400 hover:text-blue-400 rounded-lg transition-all"
                                    title="Rename Font"
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setFontToDelete(f);
                                    }}
                                    className="p-2 hover:bg-red-600/20 text-slate-400 hover:text-red-400 rounded-lg transition-all"
                                    title="Delete Font"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Rename Font Modal Overlay */}
              <AnimatePresence>
                {editingFont && (
                  <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md rounded-2xl">
                    <div className="w-full max-w-sm space-y-6">
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-bold text-white">Rename Font: {editingFont.name}</h4>
                        <button onClick={() => setEditingFont(null)} className="text-slate-500 hover:text-white">
                          <Plus size={20} className="rotate-45" />
                        </button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">New Font Name</label>
                          <input
                            type="text"
                            value={newFontName}
                            onChange={(e) => setNewFontName(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            placeholder="Enter new name"
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setEditingFont(null)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={async () => {
                              if (!newFontName || newFontName === editingFont.name) return;
                              try {
                                const res = await fetch("/api/fonts/rename", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ oldName: editingFont.name, newName: newFontName }),
                                });
                                if (res.ok) {
                                  await fetchFonts();
                                  setEditingFont(null);
                                  setNotification({ message: "Font renamed successfully", type: 'success' });
                                } else {
                                  const data = await res.json();
                                  setNotification({ message: data.message || "Failed to rename font", type: 'error' });
                                }
                              } catch (err) {
                                console.error("Failed to rename font", err);
                                setNotification({ message: "Failed to rename font", type: 'error' });
                              }
                            }}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl transition-all"
                          >
                            Save Changes
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </AnimatePresence>

              {/* Delete Font Modal Overlay */}
              <AnimatePresence>
                {fontToDelete && (
                  <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md rounded-2xl">
                    <div className="w-full max-w-sm space-y-6 text-center">
                      <div className="w-16 h-16 bg-red-600/20 rounded-full flex items-center justify-center mx-auto">
                        <Trash2 size={32} className="text-red-500" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-white mb-2">Delete Font?</h4>
                        <p className="text-sm text-slate-400">
                          Are you sure you want to delete the font <span className="text-white font-bold">"{fontToDelete.name}"</span>? This action cannot be undone.
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setFontToDelete(null)}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            await deleteFont(fontToDelete.name);
                            setFontToDelete(null);
                          }}
                          className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}

        {showUserManagementModal && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowUserManagementModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Users className="text-blue-400" />
                  <h3 className="text-lg font-bold text-white">User Management</h3>
                </div>
                <button onClick={() => setShowUserManagementModal(false)} className="text-slate-500 hover:text-white">
                  <Plus size={20} className="rotate-45" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
                {/* Create New User Section */}
                <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-xl">
                  <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <UserPlus size={16} className="text-green-400" />
                    Create New User
                  </h4>
                  <form onSubmit={handleCreateAccount} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <input
                        type="text"
                        value={newAccountUsername}
                        onChange={(e) => setNewAccountUsername(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                        placeholder="Username"
                        required
                      />
                    </div>
                    <div>
                      <input
                        type="password"
                        value={newAccountPassword}
                        onChange={(e) => setNewAccountPassword(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                        placeholder="Password"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isCreatingAccount}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg text-sm transition-all"
                    >
                      {isCreatingAccount ? "Creating..." : "Add User"}
                    </button>
                  </form>
                </div>

                {/* User List Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Existing Users</h4>
                  <div className="grid grid-cols-1 gap-2">
                    {allUsers.map((u, index) => (
                      <div key={`${u.username}-${index}`} className="bg-slate-800/30 border border-slate-800 p-3 rounded-xl flex items-center justify-between group">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center">
                            <span className="text-slate-400 font-bold">{u.username[0].toUpperCase()}</span>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white flex items-center gap-2">
                              {u.username}
                              {u.role === 'admin' && <Shield size={12} className="text-blue-400" />}
                            </p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest">{u.role}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setEditingUser(u)}
                            className="p-2 hover:bg-blue-600/20 text-slate-400 hover:text-blue-400 rounded-lg transition-all"
                            title="Edit User"
                          >
                            <Edit2 size={16} />
                          </button>
                          {u.username !== 'admin' && (
                            <button 
                              onClick={() => setUserToDelete(u.username)}
                              className="p-2 hover:bg-red-600/20 text-slate-400 hover:text-red-400 rounded-lg transition-all"
                              title="Delete User"
                            >
                              <UserMinus size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Edit User Modal Overlay */}
              <AnimatePresence>
                {editingUser && (
                  <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md rounded-2xl">
                    <div className="w-full max-w-sm space-y-6">
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-bold text-white">Edit User: {editingUser.username}</h4>
                        <button onClick={() => setEditingUser(null)} className="text-slate-500 hover:text-white">
                          <Plus size={20} className="rotate-45" />
                        </button>
                      </div>
                      <form onSubmit={handleUpdateUser} className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">New Password (leave blank to keep current)</label>
                          <input
                            type="password"
                            value={userManagementPassword}
                            onChange={(e) => setUserManagementPassword(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            placeholder="Enter new password"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Role</label>
                          <select
                            value={editingUser.role}
                            onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as 'admin' | 'user' })}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                            disabled={editingUser.username === 'admin'}
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                        <div className="flex gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => setEditingUser(null)}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-xl transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-900/20"
                          >
                            Save Changes
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </AnimatePresence>

              {/* Delete User Modal Overlay */}
              <AnimatePresence>
                {userToDelete && (
                  <div className="absolute inset-0 z-[110] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-md rounded-2xl">
                    <div className="w-full max-w-sm space-y-6 text-center">
                      <div className="w-16 h-16 bg-red-600/20 rounded-full flex items-center justify-center mx-auto">
                        <UserMinus size={32} className="text-red-500" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-white mb-2">Delete User?</h4>
                        <p className="text-sm text-slate-400">
                          Are you sure you want to delete user <span className="text-white font-bold">"{userToDelete}"</span>? This action cannot be undone.
                        </p>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setUserToDelete(null)}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            await handleDeleteUser(userToDelete);
                            setUserToDelete(null);
                          }}
                          className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl transition-all"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}

        {projectToDeleteId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl"
            >
              <h3 className="text-lg font-bold text-white mb-2">Delete Project?</h3>
              <p className="text-slate-400 text-sm mb-6">This action cannot be undone. Are you sure you want to delete this project?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setProjectToDeleteId(null)}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteProject}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all font-medium"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {projectToRename && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-sm shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Edit2 size={18} className="text-blue-500" />
                  Rename Project
                </h3>
                <button
                  onClick={() => setProjectToRename(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renameInputVal.trim()) {
                    renameProject(projectToRename.id, renameInputVal.trim());
                    setProjectToRename(null);
                  }
                }}
              >
                <div className="mb-5">
                  <label className="text-xs text-slate-400 block mb-2 font-medium">Project Name</label>
                  <input
                    type="text"
                    value={renameInputVal}
                    onChange={(e) => setRenameInputVal(e.target.value)}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    placeholder="Enter project name..."
                    className="w-full bg-slate-800/80 border border-slate-700 focus:border-blue-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors shadow-inner"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setProjectToRename(null)}
                    className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all font-medium text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!renameInputVal.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl transition-all font-medium text-sm flex items-center justify-center gap-1.5 shadow-lg shadow-blue-600/20"
                  >
                    <Check size={16} />
                    Save
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Image Creation Analytics Modal */}
        {selectedStatsProject && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setSelectedStatsProject(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Sparkles size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Image Creation Metrics</h3>
                    <p className="text-xs text-slate-400 truncate max-w-[240px]">{selectedStatsProject.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedStatsProject(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-5 space-y-4">
                {/* Total creations showcase banner */}
                <div className="bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent border border-amber-500/30 rounded-xl p-4 text-center">
                  <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-1">
                    Total Creations Recorded
                  </div>
                  <div className="text-4xl font-extrabold text-amber-300 font-mono tracking-tight">
                    {selectedStatsProject.creationsCount || 0}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Accumulated copies (button or right-click), shares, and downloads
                  </p>
                </div>

                {/* Breakdown cards */}
                <div className="grid grid-cols-3 gap-2.5">
                  {/* Copies */}
                  <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 text-center flex flex-col items-center">
                    <div className="w-7 h-7 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-1.5">
                      <Copy size={14} />
                    </div>
                    <div className="text-xl font-bold text-white font-mono">
                      {selectedStatsProject.copiesCount || 0}
                    </div>
                    <div className="text-[11px] font-medium text-slate-300 mt-0.5">Copies</div>
                    <div className="text-[9px] text-slate-500">Button & R-click</div>
                  </div>

                  {/* Downloads */}
                  <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 text-center flex flex-col items-center">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-1.5">
                      <Download size={14} />
                    </div>
                    <div className="text-xl font-bold text-white font-mono">
                      {selectedStatsProject.downloadsCount || 0}
                    </div>
                    <div className="text-[11px] font-medium text-slate-300 mt-0.5">Downloads</div>
                    <div className="text-[9px] text-slate-500">PNG exports</div>
                  </div>

                  {/* Shares */}
                  <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 text-center flex flex-col items-center">
                    <div className="w-7 h-7 rounded-lg bg-green-500/20 border border-green-500/30 flex items-center justify-center text-green-400 mb-1.5">
                      <Share2 size={14} />
                    </div>
                    <div className="text-xl font-bold text-white font-mono">
                      {selectedStatsProject.sharesCount || 0}
                    </div>
                    <div className="text-[11px] font-medium text-slate-300 mt-0.5">Shares</div>
                    <div className="text-[9px] text-slate-500">Direct / WhatsApp</div>
                  </div>
                </div>

                {/* Project Details Footer */}
                <div className="flex items-center gap-3 p-2.5 bg-slate-800/40 rounded-xl border border-slate-800">
                  <img 
                    src={selectedStatsProject.imageUrl} 
                    alt={selectedStatsProject.name} 
                    className="w-11 h-11 rounded-lg object-cover border border-slate-700 shrink-0" 
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white truncate">{selectedStatsProject.name}</div>
                    <div className="text-[10px] text-slate-400">
                      ID: <span className="font-mono">{selectedStatsProject.id.slice(0, 8)}</span>
                    </div>
                  </div>
                  {currentProjectId !== selectedStatsProject.id && (
                    <button
                      onClick={() => {
                        loadProject(selectedStatsProject);
                        setSelectedStatsProject(null);
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors shrink-0"
                    >
                      Open Project
                    </button>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-3.5 bg-slate-900/90 border-t border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedStatsProject(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Sidebar Left - Layers & Controls */}
        <aside 
          ref={sidebarRef}
          style={{ width: window.innerWidth >= 768 ? sidebarWidth : undefined }}
          className={cn(
            "fixed inset-y-0 left-0 z-[60] bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-300 md:relative md:translate-x-0 group/sidebar",
            !sidebarWidth && "w-80",
            showSidebar ? "translate-x-0" : "-translate-x-full",
            isPreviewMode && "md:-translate-x-full md:absolute"
          )}
        >
          {/* Resize Handle */}
          <div 
            onMouseDown={() => setIsResizing(true)}
            className="hidden md:block absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors z-[70]"
          />
          {/* Mobile Close Button */}
          <button 
            onClick={() => setShowSidebar(false)}
            className="md:hidden absolute top-4 right-4 p-2 text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
          <div className="p-4 border-b border-slate-800 space-y-4 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div
                {...getSidebarRootProps()}
                className={cn(
                  "flex-1 border-2 border-dashed rounded-lg py-2 flex flex-col items-center justify-center transition-all cursor-pointer text-xs",
                  isSidebarDragActive ? "border-blue-500 bg-blue-500/5" : "border-slate-800 hover:border-slate-700 bg-slate-800/50"
                )}
              >
                <input {...getSidebarInputProps()} />
                <span className="text-slate-400">Upload Image(s)</span>
              </div>
              
              {currentProjectId && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={exportLayers}
                    className="p-2.5 rounded-lg transition-all border bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-blue-400"
                    title="Export Layers"
                  >
                    <FileDown size={16} />
                  </button>
                  <label 
                    className={cn(
                      "p-2.5 rounded-lg transition-all border bg-slate-800 border-slate-700 text-slate-400 cursor-pointer flex items-center justify-center",
                      projects.find(p => p.id === currentProjectId)?.isLocked ? "opacity-30 cursor-not-allowed" : "hover:bg-slate-700 hover:text-green-400"
                    )}
                    title="Import Layers"
                  >
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".json" 
                      onChange={importLayers} 
                      disabled={projects.find(p => p.id === currentProjectId)?.isLocked}
                    />
                    <FileUp size={16} />
                  </label>
                  <button
                    onClick={toggleProjectLock}
                    className={cn(
                      "p-2.5 rounded-lg transition-all border shrink-0",
                      projects.find(p => p.id === currentProjectId)?.isLocked 
                        ? "bg-red-600/20 border-red-600/30 text-red-400 shadow-lg shadow-red-900/10" 
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700"
                    )}
                    title={projects.find(p => p.id === currentProjectId)?.isLocked ? "Unlock Project" : "Lock Project"}
                  >
                    {projects.find(p => p.id === currentProjectId)?.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* Projects Section */}
            <div className="border-b border-slate-800">
              <div className="p-4 pb-2 flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">My Projects</h3>
                  {projects.length > 0 && (
                    <span className="text-[10px] text-slate-500 font-mono">({projects.length})</span>
                  )}
                </div>
                {projects.length > 1 && (
                  <button
                    onClick={() => setProjectSortMode(prev => prev === 'recent' ? 'creations' : 'recent')}
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded-md flex items-center gap-1 border transition-all",
                      projectSortMode === 'creations'
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                        : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
                    )}
                    title="Toggle sorting between Most Recent and Top Creations"
                  >
                    <Sparkles size={10} className={projectSortMode === 'creations' ? 'text-amber-400' : 'text-slate-500'} />
                    <span>{projectSortMode === 'creations' ? 'Top Creations' : 'Recent'}</span>
                  </button>
                )}
              </div>
              <div className="p-4 pt-0">
                <div className="grid grid-cols-4 gap-1.5">
                  {isProjectsLoading && projects.length === 0 ? (
                    <div className="col-span-4 flex items-center justify-center py-6 gap-2 text-xs text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      <span>Loading projects...</span>
                    </div>
                  ) : projects.length === 0 ? (
                    <p className="text-[10px] text-slate-600 italic col-span-4 text-center py-4">No projects yet</p>
                  ) : (
                    [...projects]
                      .sort((a, b) => {
                        if (projectSortMode === 'creations') {
                          return (b.creationsCount || 0) - (a.creationsCount || 0);
                        }
                        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                        return timeB - timeA;
                      })
                      .map((proj) => (
                      <div
                        key={proj.id}
                        onClick={() => loadProject(proj)}
                        className={cn(
                          "relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all group",
                          currentProjectId === proj.id ? "border-blue-500" : "border-transparent hover:border-slate-700"
                        )}
                      >
                        <img 
                          src={proj.imageUrl} 
                          alt={proj.name} 
                          loading="lazy" 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                        />

                        {/* Creation Count Badge (Top-Left) */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStatsProject(proj);
                          }}
                          className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 hover:bg-black text-[9px] font-bold text-amber-300 border border-amber-500/40 backdrop-blur-sm flex items-center gap-1 shadow-md z-10 transition-all cursor-pointer hover:scale-105"
                          title={`Total creations: ${proj.creationsCount || 0} (${proj.copiesCount || 0} copies, ${proj.downloadsCount || 0} downloads, ${proj.sharesCount || 0} shares). Click for breakdown.`}
                        >
                          <Sparkles size={9} className="text-amber-400 shrink-0" />
                          <span>{proj.creationsCount || 0}</span>
                        </div>
                        
                        {/* Actions Overlay */}
                        <div className="absolute top-1 right-1 flex flex-row gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleProjectLock(proj.id);
                            }}
                            className={cn(
                              "p-1.5 rounded backdrop-blur-sm shadow-lg border transition-all",
                              proj.isLocked 
                                ? "bg-red-600/80 border-red-500 text-white" 
                                : "bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
                            )}
                            title={proj.isLocked ? "Unlock Project" : "Lock Project"}
                          >
                            {proj.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                          </button>
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              exportLayers(proj.id, proj.layers);
                            }}
                            className="p-1.5 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded text-slate-300 hover:text-blue-400 backdrop-blur-sm shadow-lg transition-all"
                            title="Export Layers"
                          >
                            <FileDown size={14} />
                          </button>

                          <label 
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              "p-1.5 rounded border backdrop-blur-sm shadow-lg transition-all flex items-center justify-center cursor-pointer",
                              proj.isLocked 
                                ? "bg-slate-900/50 border-slate-800 text-slate-600 cursor-not-allowed" 
                                : "bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-green-400"
                            )}
                            title="Import Layers"
                          >
                            <input 
                              type="file" 
                              className="hidden" 
                              accept=".json" 
                              onChange={(e) => importLayers(e, proj.id)} 
                              disabled={proj.isLocked}
                            />
                            <FileUp size={14} />
                          </label>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setProjectToRename({ id: proj.id, name: proj.name });
                              setRenameInputVal(proj.name);
                            }}
                            className="p-1.5 bg-slate-800/80 hover:bg-blue-600 border border-slate-700 rounded text-slate-300 hover:text-white backdrop-blur-sm shadow-lg transition-all"
                            title="Rename Project"
                          >
                            <Edit2 size={14} />
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteProject(proj.id);
                            }}
                            className="p-1.5 bg-red-600/80 hover:bg-red-600 rounded text-white backdrop-blur-sm shadow-lg transition-all"
                            title="Delete Project"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Name Overlay */}
                        <div 
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToRename({ id: proj.id, name: proj.name });
                            setRenameInputVal(proj.name);
                          }}
                          className="absolute bottom-0 left-0 right-0 p-1 bg-black/75 backdrop-blur-md flex items-center justify-center gap-1 cursor-pointer hover:bg-black/90 transition-colors group/name"
                          title={`Click to rename: ${proj.name}`}
                        >
                          <span className="text-[10px] text-white font-medium truncate text-center select-none max-w-[85%]">
                            {proj.name}
                          </span>
                          <Edit2 size={9} className="text-slate-400 group-hover/name:text-blue-400 opacity-0 group-hover/name:opacity-100 transition-opacity shrink-0" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Layers & Properties Section */}
            <div className="p-4 space-y-4">
              <div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    onClick={addLayer}
                    disabled={!image || projects.find(p => p.id === currentProjectId)?.isLocked}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all text-xs"
                  >
                    <Plus size={14} /> Add Text
                  </button>
                  <button
                    onClick={addLabelLayer}
                    disabled={!image || projects.find(p => p.id === currentProjectId)?.isLocked}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all text-xs"
                  >
                    <Plus size={14} /> Add Label
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5 mb-4">
                  <button
                    onClick={addDateLayer}
                    disabled={!image || projects.find(p => p.id === currentProjectId)?.isLocked}
                    className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg flex items-center justify-center gap-1 transition-all text-xs"
                  >
                    <Calendar size={13} /> Date
                  </button>
                  <button
                    onClick={addListLayer}
                    disabled={!image || projects.find(p => p.id === currentProjectId)?.isLocked}
                    className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg flex items-center justify-center gap-1 transition-all text-xs"
                  >
                    <List size={13} /> List
                  </button>
                  <button
                    onClick={addNumberLayer}
                    disabled={!image || projects.find(p => p.id === currentProjectId)?.isLocked}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg flex items-center justify-center gap-1 transition-all text-xs shadow-sm"
                    title="Add Price Layer with automatic Sinhala words conversion"
                  >
                    <Coins size={13} /> Price
                  </button>
                </div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Layers</h3>
                <div className="space-y-2">
                  {layers.length === 0 ? (
                    <p className="text-sm text-slate-600 italic text-center py-4">No layers yet</p>
                  ) : (
                    <AnimatePresence mode="popLayout">
                      {layers.map((layer) => (
                        <motion.div
                          layout
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          key={layer.id}
                          onClick={() => {
                            setSelectedLayerId(layer.id);
                            if (window.innerWidth < 768) setShowSidebar(false);
                          }}
                          className={cn(
                            "group flex flex-col p-3 rounded-xl cursor-pointer transition-all border gap-2",
                            layer.visible === false && "opacity-60",
                            selectedLayerId === layer.id
                              ? "bg-blue-600/10 border-blue-600/50 text-blue-400 ring-1 ring-blue-600/20"
                              : "bg-slate-800/50 border-transparent hover:bg-slate-800 text-slate-400"
                          )}
                        >
                          <div className="space-y-2">
                            {/* Actions & Header */}
                            <div className="flex items-center justify-between gap-2 overflow-hidden border-b border-slate-700/30 pb-2 mb-1">
                              <div className="flex items-center gap-2 overflow-hidden flex-1">
                                <button
                                  tabIndex={-1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateLayer(layer.id, { visible: layer.visible !== false ? false : true });
                                  }}
                                  className="p-1 hover:text-blue-400 text-slate-400 hover:bg-slate-700/50 rounded transition-all shrink-0"
                                  title={layer.visible !== false ? "Hide Layer" : "Show Layer"}
                                >
                                  {layer.visible !== false ? <Eye size={14} /> : <EyeOff size={14} className="text-slate-500" />}
                                </button>
                                <Type size={12} className="shrink-0 opacity-50" />
                                <span 
                                  className="text-base font-normal tracking-wider truncate text-inherit flex items-center gap-1.5"
                                  style={{ fontFamily: `"${layer.fontFamily}", sans-serif` }}
                                >
                                  {layer.name}
                                  {layer.isListLabel ? (
                                    <span className="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded font-sans uppercase font-bold tracking-tight">Option Label</span>
                                  ) : layer.isNumberLabel ? (
                                    <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-sans uppercase font-bold tracking-tight">
                                      Price Label {layer.numberFontMode === 'unicode' ? '(Unicode)' : '(FM)'}
                                    </span>
                                  ) : layer.type === 'number' ? (
                                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-sans uppercase font-bold tracking-tight flex items-center gap-1">
                                      <Coins size={10} className="shrink-0" /> Price {layer.hasNumberLabel && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Label active" />}
                                    </span>
                                  ) : layer.type === 'label' ? (
                                    <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded font-sans uppercase font-bold tracking-tight">Label</span>
                                  ) : layer.type === 'date' ? (
                                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-sans uppercase font-bold tracking-tight">Date</span>
                                  ) : layer.type === 'list' ? (
                                    <span className="text-[9px] bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded font-sans uppercase font-bold tracking-tight flex items-center gap-1">
                                      List {layer.hasOptionLabel && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Option label active" />}
                                    </span>
                                  ) : layer.hasSuffixList ? (
                                    <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded uppercase font-bold tracking-tight flex items-center gap-1">
                                      +Suffix{layer.selectedSuffix ? (
                                        <span 
                                          style={{ fontFamily: `"${layer.suffixFontFamily || layer.fontFamily}", sans-serif` }}
                                          className="text-amber-200 normal-case"
                                        >
                                          : {layer.selectedSuffix}
                                        </span>
                                      ) : ""}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-1 shrink-0">
                                {layer.type === 'date' && (
                                  <div className="relative group/date">
                                    <button
                                      tabIndex={-1}
                                      className="p-1 hover:text-blue-400 transition-all"
                                    >
                                      <Calendar size={14} />
                                    </button>
                                    <input
                                      type="date"
                                      tabIndex={-1}
                                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                      onClick={(e) => e.stopPropagation()}
                                      onFocus={() => setSelectedLayerId(layer.id)}
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          updateLayer(layer.id, { text: e.target.value });
                                        }
                                      }}
                                    />
                                  </div>
                                )}
                                <button
                                  tabIndex={-1}
                                  disabled={projects.find(p => p.id === currentProjectId)?.isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteLayer(layer.id);
                                  }}
                                  className="p-1 hover:text-red-400 transition-all disabled:opacity-30"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
 
                            <div className="w-full">
                              {layer.isNumberLabel ? (() => {
                                const parentNum = layers.find(l => l.id === layer.linkedNumberId);
                                const mode = layer.numberFontMode || parentNum?.numberFontMode || 'fm';
                                const displayVal = convertNumberToSinhala(parentNum?.text || "0", mode) || layer.text;
                                return (
                                  <div className="space-y-1 w-full">
                                    <div className="flex gap-1.5 items-center w-full">
                                      <input
                                        type="text"
                                        value={layer.text || displayVal}
                                        placeholder="Sinhala number words..."
                                        onChange={(e) => updateLayer(layer.id, { text: e.target.value })}
                                        onFocus={() => setSelectedLayerId(layer.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="bg-slate-900 border border-emerald-900/60 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-0 outline-none text-emerald-200 focus:ring-1 focus:ring-emerald-500/20"
                                        style={{ 
                                          fontFamily: `"${layer.fontFamily}", sans-serif`,
                                          fontWeight: layer.isBold ? 'bold' : 'normal',
                                          fontStyle: layer.isItalic ? 'italic' : 'normal'
                                        }}
                                      />
                                      <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800/60 px-2 py-1 rounded font-mono shrink-0">
                                        {mode.toUpperCase()}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 flex items-center justify-between px-0.5">
                                      <span>Syncs with {parentNum?.name || "Price"} ({parentNum?.text || "—"})</span>
                                      {mode === 'fm' && (
                                        <span className="text-emerald-400/80 font-sans truncate max-w-[140px]" title="Unicode preview">
                                          {numberToSinhalaWords(parentNum?.text || "0")}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })() : layer.type === 'number' ? (() => {
                                const mode = layer.numberFontMode || 'fm';
                                const convertedPreview = convertNumberToSinhala(layer.text, mode);
                                const unicodePreview = numberToSinhalaWords(layer.text);
                                const linkedLabel = layers.find(l => l.linkedNumberId === layer.id);

                                return (
                                  <div className="space-y-1.5 w-full">
                                    <div className="flex gap-1.5 items-center w-full">
                                      <div className="relative flex-1 min-w-0">
                                        <input
                                          type="text"
                                          value={layer.text}
                                          placeholder="Type price (e.g. 1000)..."
                                          onChange={(e) => handleNumberInputChange(layer.id, e.target.value)}
                                          onFocus={() => setSelectedLayerId(layer.id)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="bg-slate-900 border border-slate-700/50 rounded-lg pl-6 pr-2.5 py-1.5 text-sm w-full outline-none text-inherit focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20"
                                          style={{ 
                                            fontFamily: `"${layer.fontFamily}", sans-serif`,
                                            fontWeight: layer.isBold ? 'bold' : 'normal',
                                            fontStyle: layer.isItalic ? 'italic' : 'normal'
                                          }}
                                        />
                                        <Coins size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 select-none pointer-events-none" />
                                      </div>
                                      <select
                                        value={(layer.options || ["500", "1000", "1500", "2000", "2500", "5000", "10000"]).includes(layer.text) ? layer.text : ""}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          if (e.target.value) {
                                            handleNumberInputChange(layer.id, e.target.value);
                                          }
                                        }}
                                        onFocus={() => setSelectedLayerId(layer.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="bg-slate-900 border border-emerald-900/80 hover:border-emerald-700 text-emerald-300 rounded-lg px-1.5 py-1.5 text-xs outline-none cursor-pointer shrink-0 max-w-[95px] font-mono"
                                        title="Select pre-entered price"
                                      >
                                        <option value="" className="bg-slate-900 text-slate-400 font-sans">Prices ▼</option>
                                        {(layer.options && layer.options.length > 0 
                                          ? layer.options 
                                          : ["500", "1000", "1500", "2000", "2500", "5000", "10000"]
                                        ).map((priceOpt, i) => (
                                          <option key={i} value={priceOpt} className="bg-slate-900 text-white font-mono">
                                            {priceOpt}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] bg-slate-900/60 px-2 py-1 rounded border border-slate-800">
                                      <span className="text-slate-400 flex items-center gap-1">
                                        <span className="text-[10px] text-slate-500 font-mono">Image:</span>
                                        <span className="text-emerald-300 font-mono font-medium">
                                          {formatNumberForCanvas(layer.text, layer.numberSuffix, layer.fontFamily, (linkedLabel?.numberFontMode || layer.numberFontMode)) || "—"}
                                        </span>
                                      </span>
                                      {convertedPreview && (
                                        <span className="text-slate-400 flex items-center gap-1">
                                          <span className="text-[10px] text-emerald-400 font-mono">[{mode.toUpperCase()}]:</span>
                                          <span 
                                            style={{ fontFamily: mode === 'fm' ? `"${linkedLabel?.fontFamily || fonts[0]?.name || 'sans-serif'}"` : 'sans-serif' }}
                                            className="text-emerald-300 font-medium"
                                          >
                                            {convertedPreview}
                                          </span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })() : layer.isListLabel ? (() => {
                                const parentList = layers.find(l => l.id === layer.linkedListId);
                                return (
                                  <div className="flex gap-1.5 items-center w-full">
                                    <input
                                      type="text"
                                      value={layer.text}
                                      placeholder="Type label text..."
                                      onChange={(e) => handleListLabelInputChange(layer.id, e.target.value)}
                                      onFocus={() => setSelectedLayerId(layer.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="bg-slate-900 border border-purple-900/60 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-0 outline-none text-purple-200 focus:ring-1 focus:ring-purple-500/20"
                                      style={{ 
                                        fontFamily: `"${layer.fontFamily}", sans-serif`,
                                        fontWeight: layer.isBold ? 'bold' : 'normal',
                                        fontStyle: layer.isItalic ? 'italic' : 'normal'
                                      }}
                                    />
                                    {parentList?.options && parentList.options.length > 0 && (
                                      <select
                                        value={parentList.text}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          if (e.target.value) handleListSelectChange(parentList.id, e.target.value);
                                        }}
                                        onFocus={() => setSelectedLayerId(layer.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="bg-slate-900 border border-purple-900/80 hover:border-purple-700 text-purple-300 rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer shrink-0 max-w-[110px]"
                                        style={{ 
                                          fontFamily: `"${layer.fontFamily}", sans-serif`,
                                          fontWeight: layer.isBold ? 'bold' : 'normal',
                                          fontStyle: layer.isItalic ? 'italic' : 'normal'
                                        }}
                                        title="Pick list option to sync label"
                                      >
                                        <option value="" disabled className="bg-slate-900 text-slate-400 font-sans">Options ▼</option>
                                        {parentList.options.map((opt, i) => (
                                          <option key={i} value={opt} className="bg-slate-900 text-white" style={{ fontFamily: `"${layer.fontFamily}", sans-serif` }}>
                                            {parentList.optionLabels?.[i] || opt}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                );
                              })() : layer.type === 'list' ? (
                                <div className="flex gap-1.5 items-center w-full">
                                  <input
                                    type="text"
                                    value={layer.text}
                                    placeholder="Type or select..."
                                    onChange={(e) => handleListInputChange(layer.id, e.target.value)}
                                    onFocus={() => setSelectedLayerId(layer.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-slate-900 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-sm flex-1 min-w-0 outline-none text-inherit focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                                    style={{ 
                                      fontFamily: `"${layer.fontFamily}", sans-serif`,
                                      fontWeight: layer.isBold ? 'bold' : 'normal',
                                      fontStyle: layer.isItalic ? 'italic' : 'normal'
                                    }}
                                  />
                                  <select
                                    value={layer.options?.includes(layer.text) ? layer.text : ""}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      if (e.target.value !== undefined) {
                                        handleListSelectChange(layer.id, e.target.value);
                                      }
                                    }}
                                    onFocus={() => setSelectedLayerId(layer.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer shrink-0 max-w-[110px] text-slate-300"
                                    style={{ 
                                      fontFamily: `"${layer.fontFamily}", sans-serif`,
                                      fontWeight: layer.isBold ? 'bold' : 'normal',
                                      fontStyle: layer.isItalic ? 'italic' : 'normal'
                                    }}
                                    title="Select option from list"
                                  >
                                    <option value="" className="bg-slate-900 text-slate-400 font-sans">Options ▼</option>
                                    {layer.options?.map((opt, i) => {
                                      const optLabel = layer.optionLabels?.[i];
                                      return (
                                        <option 
                                          key={i} 
                                          value={opt} 
                                          className="bg-slate-900 text-white"
                                          style={{ fontFamily: `"${layer.fontFamily}", sans-serif` }}
                                        >
                                          {opt} {layer.hasOptionLabel && optLabel ? `(${optLabel})` : ""}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                              ) : layer.hasSuffixList ? (
                                <div className="space-y-1 w-full">
                                  <div className="flex gap-1.5 items-center w-full">
                                    <input
                                      type="text"
                                      value={layer.text}
                                      onChange={(e) => updateLayer(layer.id, { text: e.target.value })}
                                      onFocus={() => setSelectedLayerId(layer.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="bg-slate-900 border border-slate-700/50 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-0 outline-none text-inherit focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                                      style={{ fontFamily: layer.fontFamily }}
                                    />
                                    <select
                                      value={layer.selectedSuffix || ""}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        updateLayer(layer.id, { selectedSuffix: e.target.value });
                                      }}
                                      onFocus={() => setSelectedLayerId(layer.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="bg-slate-900 border border-amber-500/60 hover:border-amber-400 text-amber-300 rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer shrink-0 max-w-[110px]"
                                      style={{ 
                                        fontFamily: `"${layer.suffixFontFamily || layer.fontFamily}", sans-serif`,
                                        fontWeight: layer.isBold ? 'bold' : 'normal',
                                        fontStyle: layer.isItalic ? 'italic' : 'normal'
                                      }}
                                      title="Selected Suffix"
                                    >
                                      <option value="" className="bg-slate-900 text-slate-400 font-sans">(None)</option>
                                      {layer.suffixList?.map((suf, i) => (
                                        <option 
                                          key={i} 
                                          value={suf} 
                                          className="bg-slate-900 text-white"
                                          style={{ fontFamily: `"${layer.suffixFontFamily || layer.fontFamily}", sans-serif` }}
                                        >
                                          {suf}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  {layer.showSuffixLine && layer.selectedSuffix && (
                                    <div className="flex items-center gap-1 text-[10px] text-sky-400 pl-0.5">
                                      <Minus size={11} className="stroke-[2.5]" />
                                      <span>Line ({Math.round(getSuffixLineConfig(layer, layer.selectedSuffix, layer.suffixList?.indexOf(layer.selectedSuffix)).x1)}%, {Math.round(getSuffixLineConfig(layer, layer.selectedSuffix, layer.suffixList?.indexOf(layer.selectedSuffix)).y1)}%)</span>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <input
                                  type="text"
                                  value={layer.text}
                                  onChange={(e) => updateLayer(layer.id, { text: e.target.value })}
                                  onFocus={() => setSelectedLayerId(layer.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="bg-slate-900 border border-slate-700/50 rounded-lg px-2 py-1.5 text-sm w-full outline-none text-inherit focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                                  style={{ fontFamily: layer.fontFamily }}
                                />
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </div>

                {/* Quick Actions after Layers */}
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    onClick={restorePreviousState}
                    disabled={!image}
                    className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all text-xs border border-slate-600 shadow-lg"
                  >
                    <Undo2 size={16} /> Go Back
                  </button>
                  <button
                    onClick={copyImageToClipboard}
                    disabled={!image}
                    className="bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all text-xs shadow-lg relative group"
                    title="Copy image to clipboard & count as creation (Shortcut: Ctrl+C)"
                  >
                    <Copy size={15} /> 
                    <span>Copy</span>
                    {(() => {
                      const cur = projects.find(p => p.id === currentProjectId);
                      if (cur && (cur.copiesCount || 0) > 0) {
                        return (
                          <span className="text-[10px] bg-teal-900/90 text-teal-200 border border-teal-400/30 px-1.5 py-0.5 rounded-full font-mono ml-0.5" title={`${cur.copiesCount} copies recorded`}>
                            {cur.copiesCount}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </button>
                </div>
              </div>

              {selectedLayer && !projects.find(p => p.id === currentProjectId)?.isLocked && (
                <div className="pt-4 border-t border-slate-800 space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Properties</h3>
                <div className="space-y-4">
                  {!projects.find(p => p.id === currentProjectId)?.isLocked && (
                    <div>
                      <label className="text-xs text-slate-500 block mb-1.5">Layer Name</label>
                      <input
                        type="text"
                        value={selectedLayer.name}
                        onChange={(e) => updateLayer(selectedLayer.id, { name: e.target.value })}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                        style={{ fontFamily: `"${selectedLayer.fontFamily}", sans-serif` }}
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-slate-500 block mb-1.5">{projects.find(p => p.id === currentProjectId)?.isLocked ? "Editing Content" : "Text Content"}</label>
                    {selectedLayer.isListLabel ? (() => {
                      const parent = layers.find(l => l.id === selectedLayer.linkedListId);
                      return (
                        <div className="bg-purple-950/20 border border-purple-800/40 rounded-xl p-3 text-xs space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-purple-300 flex items-center gap-1.5">
                              <Tag size={14} /> Option Label
                            </span>
                            {parent && (
                              <button
                                type="button"
                                onClick={() => setSelectedLayerId(parent.id)}
                                className="text-[11px] bg-purple-600/80 hover:bg-purple-600 text-white px-2 py-0.5 rounded transition-all font-medium"
                              >
                                Go to List Layer
                              </button>
                            )}
                          </div>

                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Type Label Text</label>
                            <input
                              type="text"
                              value={selectedLayer.text}
                              onChange={(e) => handleListLabelInputChange(selectedLayer.id, e.target.value)}
                              placeholder="Type label text..."
                              className="w-full bg-slate-900 border border-purple-800/60 focus:border-purple-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-purple-500/30 text-purple-200"
                              style={{ 
                                fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                                fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                              }}
                            />
                          </div>

                          {parent?.options && parent.options.length > 0 && (
                            <div className="flex items-center justify-between gap-2 pt-2 border-t border-purple-900/30">
                              <span className="text-[11px] text-slate-400">Sync with Option:</span>
                              <select
                                value={parent.text}
                                onChange={(e) => handleListSelectChange(parent.id, e.target.value)}
                                className="bg-slate-900 border border-purple-800/80 text-purple-300 rounded px-2 py-1 text-xs outline-none cursor-pointer max-w-[160px]"
                                style={{ 
                                  fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                                  fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                  fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                                }}
                              >
                                <option value="" disabled className="bg-slate-900 text-slate-400 font-sans">Options ▼</option>
                                {parent.options.map((opt, i) => (
                                  <option key={i} value={opt} className="bg-slate-900 text-white" style={{ fontFamily: `"${selectedLayer.fontFamily}", sans-serif` }}>
                                    {parent.optionLabels?.[i] || opt}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      );
                    })() : selectedLayer.isNumberLabel ? (() => {
                      const parentNum = layers.find(l => l.id === selectedLayer.linkedNumberId);
                      const mode = selectedLayer.numberFontMode || parentNum?.numberFontMode || 'fm';
                      const unicodeWords = numberToSinhalaWords(parentNum?.text || "0");
                      return (
                        <div className="space-y-2.5 bg-slate-900/50 p-3 rounded-xl border border-emerald-800/40">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                              <Tag size={13} />
                              Linked Price Label
                            </span>
                            <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded border border-slate-700 text-[10px]">
                              <button
                                type="button"
                                onClick={() => parentNum && handleNumberFontModeChange(parentNum.id, 'fm')}
                                className={cn(
                                  "px-2 py-0.5 rounded font-medium transition-colors",
                                  mode === 'fm' ? "bg-emerald-600 text-white font-bold" : "text-slate-400 hover:text-white"
                                )}
                              >
                                FM Font
                              </button>
                              <button
                                type="button"
                                onClick={() => parentNum && handleNumberFontModeChange(parentNum.id, 'unicode')}
                                className={cn(
                                  "px-2 py-0.5 rounded font-medium transition-colors",
                                  mode === 'unicode' ? "bg-emerald-600 text-white font-bold" : "text-slate-400 hover:text-white"
                                )}
                              >
                                Unicode
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                              Sinhala Text {mode === 'fm' ? '(FM Font Encoded)' : '(Unicode Sinhala)'}
                            </label>
                            <input
                              type="text"
                              value={selectedLayer.text}
                              onChange={(e) => updateLayer(selectedLayer.id, { text: e.target.value })}
                              placeholder="Converted Sinhala text..."
                              className="w-full bg-slate-800 border border-emerald-700/60 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500 text-emerald-200"
                              style={{ 
                                fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                                fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                              }}
                            />
                          </div>

                          {parentNum && (
                            <div className="flex items-center justify-between text-xs bg-slate-800/80 p-2 rounded-lg border border-slate-700">
                              <span className="text-slate-400">
                                Parent: <strong className="text-white">{parentNum.name}</strong> ({parentNum.text})
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedLayerId(parentNum.id)}
                                className="text-emerald-400 hover:text-emerald-300 font-medium text-[11px] underline"
                              >
                                Edit Price
                              </button>
                            </div>
                          )}

                          {mode === 'fm' && unicodeWords && (
                            <div className="text-[11px] bg-emerald-950/40 text-emerald-300/90 p-2 rounded border border-emerald-800/30 flex items-center justify-between">
                              <span className="text-slate-400">Unicode Sinhala:</span>
                              <span className="font-medium">{unicodeWords}</span>
                            </div>
                          )}
                        </div>
                      );
                    })() : selectedLayer.type === 'number' ? (() => {
                      const mode = selectedLayer.numberFontMode || 'fm';
                      const convertedText = convertNumberToSinhala(selectedLayer.text, mode);
                      const unicodeWords = numberToSinhalaWords(selectedLayer.text);
                      const linkedLabel = layers.find(l => l.linkedNumberId === selectedLayer.id);

                      return (
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs text-slate-400 font-semibold block mb-1.5 flex items-center gap-1">
                              <Coins size={13} className="text-emerald-400" />
                              Price Value
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={selectedLayer.text}
                                onChange={(e) => handleNumberInputChange(selectedLayer.id, e.target.value)}
                                placeholder="Enter price (e.g. 1000, 25000)..."
                                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
                                style={{ 
                                  fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                                  fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                  fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                                }}
                              />
                              <select
                                value={(selectedLayer.options || ["500", "1000", "1500", "2000", "2500", "5000", "10000"]).includes(selectedLayer.text) ? selectedLayer.text : ""}
                                onChange={(e) => {
                                  if (e.target.value) handleNumberInputChange(selectedLayer.id, e.target.value);
                                }}
                                className="bg-slate-800 border border-emerald-900/80 hover:border-emerald-700 text-emerald-300 rounded-lg px-2.5 py-2 text-xs outline-none cursor-pointer font-mono shrink-0 max-w-[120px]"
                                title="Pick from pre-entered prices"
                              >
                                <option value="" className="bg-slate-900 text-slate-400 font-sans">Prices ▼</option>
                                {(selectedLayer.options && selectedLayer.options.length > 0
                                  ? selectedLayer.options
                                  : ["500", "1000", "1500", "2000", "2500", "5000", "10000"]
                                ).map((priceOpt, i) => (
                                  <option key={i} value={priceOpt} className="bg-slate-900 text-white font-mono">
                                    {priceOpt}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {/* Quick pick pills */}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {(selectedLayer.options && selectedLayer.options.length > 0
                                ? selectedLayer.options
                                : ["500", "1000", "1500", "2000", "2500", "5000", "10000"]
                              ).map((priceOpt, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => handleNumberInputChange(selectedLayer.id, priceOpt)}
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[11px] font-mono transition-all border",
                                    selectedLayer.text === priceOpt
                                      ? "bg-emerald-600/30 text-emerald-300 border-emerald-500 font-bold shadow-sm"
                                      : "bg-slate-900/80 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200"
                                  )}
                                >
                                  {priceOpt}
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 px-0.5">
                              <span>Image Canvas Output:</span>
                              <span className="text-emerald-300 font-mono font-bold">
                                {formatNumberForCanvas(selectedLayer.text, selectedLayer.numberSuffix, selectedLayer.fontFamily, (linkedLabel?.numberFontMode || selectedLayer.numberFontMode)) || "—"}
                              </span>
                            </div>
                          </div>

                          {/* Suffix / Ending Control */}
                          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-[11px] font-semibold text-slate-300">Price Ending Suffix</label>
                              <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded border border-slate-700 text-xs">
                                <button
                                  type="button"
                                  onClick={() => updateLayer(selectedLayer.id, { numberSuffix: 'auto' })}
                                  className={cn(
                                    "px-2 py-0.5 rounded font-medium transition-colors text-[10px]",
                                    (!selectedLayer.numberSuffix || selectedLayer.numberSuffix === 'auto')
                                      ? "bg-emerald-600 text-white font-bold"
                                      : "text-slate-400 hover:text-white"
                                  )}
                                  title="Auto-detect based on font (/= for Unicode, $= for FM)"
                                >
                                  Auto ({isUnicodeFont(selectedLayer.fontFamily) ? '/=' : '$='})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateLayer(selectedLayer.id, { numberSuffix: '/=' })}
                                  className={cn(
                                    "px-2 py-0.5 rounded font-medium transition-colors text-[10px]",
                                    selectedLayer.numberSuffix === '/='
                                      ? "bg-emerald-600 text-white font-bold"
                                      : "text-slate-400 hover:text-white"
                                  )}
                                  title="Use /= for price suffix"
                                >
                                  /=
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateLayer(selectedLayer.id, { numberSuffix: '$=' })}
                                  className={cn(
                                    "px-2 py-0.5 rounded font-medium transition-colors text-[10px]",
                                    selectedLayer.numberSuffix === '$='
                                      ? "bg-emerald-600 text-white font-bold"
                                      : "text-slate-400 hover:text-white"
                                  )}
                                  title="Use $= (renders as /= in FM fonts)"
                                >
                                  $= (FM)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateLayer(selectedLayer.id, { numberSuffix: '/-' })}
                                  className={cn(
                                    "px-2 py-0.5 rounded font-medium transition-colors text-[10px]",
                                    selectedLayer.numberSuffix === '/-'
                                      ? "bg-emerald-600 text-white font-bold"
                                      : "text-slate-400 hover:text-white"
                                  )}
                                  title="Use /-"
                                >
                                  /-
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Font Mode: FM Font or Unicode */}
                          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-[11px] font-semibold text-slate-300">Sinhala Font Mode</label>
                              <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded border border-slate-700 text-xs">
                                <button
                                  type="button"
                                  onClick={() => handleNumberFontModeChange(selectedLayer.id, 'fm')}
                                  className={cn(
                                    "px-2.5 py-0.5 rounded font-medium transition-colors text-[11px]",
                                    mode === 'fm' ? "bg-emerald-600 text-white font-bold" : "text-slate-400 hover:text-white"
                                  )}
                                >
                                  FM Font (1000 → oyi)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleNumberFontModeChange(selectedLayer.id, 'unicode')}
                                  className={cn(
                                    "px-2.5 py-0.5 rounded font-medium transition-colors text-[11px]",
                                    mode === 'unicode' ? "bg-emerald-600 text-white font-bold" : "text-slate-400 hover:text-white"
                                  )}
                                >
                                  Unicode (දහස)
                                </button>
                              </div>
                            </div>

                            {/* Real-time Preview */}
                            <div className="bg-slate-950/80 p-2 rounded border border-emerald-900/40 text-xs flex items-center justify-between">
                              <div className="text-slate-400 text-[11px]">
                                Automatic Sinhala name:
                              </div>
                              <div className="text-right">
                                <div 
                                  className="text-emerald-300 font-medium"
                                  style={{ fontFamily: mode === 'fm' ? `"${linkedLabel?.fontFamily || fonts[0]?.name || 'sans-serif'}"` : 'sans-serif' }}
                                >
                                  {convertedText || "—"}
                                </div>
                                {mode === 'fm' && unicodeWords && (
                                  <div className="text-[10px] text-slate-500 font-sans">
                                    {unicodeWords}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })() : selectedLayer.type === 'list' ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={selectedLayer.text}
                            onChange={(e) => handleListInputChange(selectedLayer.id, e.target.value)}
                            placeholder="Type or select value..."
                            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                            style={{ 
                              fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                              fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                              fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                            }}
                          />
                          <select
                            value={selectedLayer.options?.includes(selectedLayer.text) ? selectedLayer.text : ""}
                            onChange={(e) => {
                              if (e.target.value) handleListSelectChange(selectedLayer.id, e.target.value);
                            }}
                            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-xs outline-none cursor-pointer text-slate-300 max-w-[130px]"
                            style={{ 
                              fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                              fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                              fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                            }}
                            title="Select from options"
                          >
                            <option value="" className="bg-slate-900 text-slate-400 font-sans">Options ▼</option>
                            {selectedLayer.options?.map((opt, i) => {
                              const optLabel = selectedLayer.optionLabels?.[i];
                              return (
                                <option key={i} value={opt} className="bg-slate-900 text-white" style={{ fontFamily: `"${selectedLayer.fontFamily}", sans-serif` }}>
                                  {opt} {selectedLayer.hasOptionLabel && optLabel ? `(${optLabel})` : ""}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        {selectedLayer.hasOptionLabel && (
                          <div className="text-[11px] text-slate-400 flex items-center justify-between px-0.5">
                            <span>Type freely or pick from options</span>
                            <span className="text-purple-300 font-mono text-[10px]">
                              Label: {layers.find(l => l.linkedListId === selectedLayer.id)?.text || "—"}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <textarea
                          value={selectedLayer.text}
                          onChange={(e) => updateLayer(selectedLayer.id, { text: e.target.value })}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500 resize-none h-20"
                          style={{ 
                            fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                            fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                            fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                          }}
                        />
                        {selectedLayer.hasSuffixList && (
                          <div className="flex items-center justify-between gap-2 bg-slate-900/80 p-2 rounded-lg border border-amber-500/30">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[11px] font-semibold text-amber-300 shrink-0 font-sans">Active Suffix:</span>
                              <select
                                value={selectedLayer.selectedSuffix || ""}
                                onChange={(e) => updateLayer(selectedLayer.id, { selectedSuffix: e.target.value })}
                                className="bg-slate-800 border border-amber-600/50 rounded px-2 py-1 text-xs text-white outline-none cursor-pointer max-w-[120px]"
                                style={{ 
                                  fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif`,
                                  fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                  fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                                }}
                              >
                                <option value="" className="bg-slate-900 text-slate-400 font-sans">(No suffix)</option>
                                {selectedLayer.suffixList?.map((suf, i) => (
                                  <option 
                                    key={i} 
                                    value={suf}
                                    className="bg-slate-900 text-white"
                                    style={{ fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif` }}
                                  >
                                    {suf}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div 
                              className="text-xs text-amber-200 bg-slate-800/90 px-2 py-1 rounded truncate border border-slate-700/40" 
                              title="Full text preview"
                              style={{ 
                                fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                                fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                              }}
                            >
                              <span>{selectedLayer.text}</span>
                              {selectedLayer.selectedSuffix && (
                                <span 
                                  className="text-amber-300"
                                  style={{ fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif` }}
                                >
                                  {selectedLayer.selectedSuffix}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedLayer.type === 'list' && !projects.find(p => p.id === currentProjectId)?.isLocked && (
                    <div className="space-y-3 bg-slate-900/30 p-3 rounded-xl border border-slate-800/50">
                      {/* Option Label Toggle */}
                      <div className="flex items-center justify-between bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/60">
                        <div className="flex items-center gap-2">
                          <Tag size={15} className={selectedLayer.hasOptionLabel ? "text-purple-400" : "text-slate-400"} />
                          <div>
                            <div className="text-xs font-semibold text-slate-200">Option Labels & Placeholder</div>
                            <div className="text-[10px] text-slate-400">Add label for each option & show separate placeholder on image</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleListOptionLabel(selectedLayer.id)}
                          className={cn(
                            "relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                            selectedLayer.hasOptionLabel ? "bg-purple-600" : "bg-slate-700"
                          )}
                          title={selectedLayer.hasOptionLabel ? "Disable option labels" : "Enable option labels"}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                              selectedLayer.hasOptionLabel ? "translate-x-5" : "translate-x-0"
                            )}
                          />
                        </button>
                      </div>

                      {/* Jump to Label Placeholder if enabled */}
                      {selectedLayer.hasOptionLabel && (
                        <div className="flex items-center justify-between text-xs bg-purple-950/30 border border-purple-800/40 px-2.5 py-1.5 rounded-lg">
                          <span className="text-[11px] text-purple-300 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Label placeholder is active on image
                          </span>
                          {(() => {
                            const linked = layers.find(l => l.linkedListId === selectedLayer.id);
                            if (!linked) return null;
                            return (
                              <button
                                type="button"
                                onClick={() => setSelectedLayerId(linked.id)}
                                className="text-[10px] text-purple-200 hover:text-white bg-purple-700/50 hover:bg-purple-600 px-2 py-0.5 rounded transition-all font-medium flex items-center gap-1 border border-purple-600/40"
                              >
                                <Move size={11} /> Move / Style Label
                              </button>
                            );
                          })()}
                        </div>
                      )}

                      {/* Dropdown Options List Editor */}
                      {(() => {
                        const linkedLabel = layers.find(l => l.linkedListId === selectedLayer.id);
                        const labelFont = linkedLabel?.fontFamily || selectedLayer.fontFamily;

                        return (
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="text-xs text-slate-400 font-semibold">
                                Dropdown Options {selectedLayer.hasOptionLabel && <span className="text-purple-400 font-normal">& Labels</span>}
                              </label>
                              <span className="text-[10px] text-slate-500">
                                {selectedLayer.options?.length || 0} items
                              </span>
                            </div>

                            {/* Font Selectors for Option Value & Option Label */}
                            <div className="grid grid-cols-2 gap-2 p-2 mb-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
                              <div>
                                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1 truncate">
                                  Value Font
                                </label>
                                <select
                                  value={selectedLayer.fontFamily}
                                  onChange={(e) => updateLayer(selectedLayer.id, { fontFamily: e.target.value })}
                                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none cursor-pointer"
                                  style={{ fontFamily: `"${selectedLayer.fontFamily}", sans-serif` }}
                                  title="Font for Option Values"
                                >
                                  <option value="sans-serif" className="bg-slate-900 text-white font-sans">System Sans</option>
                                  {fonts.map((f, idx) => (
                                    <option key={idx} value={f.name} className="bg-slate-900 text-white" style={{ fontFamily: `"${f.name}", sans-serif` }}>
                                      {f.name.split('-').slice(1).join('-') || f.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="text-[10px] uppercase font-bold text-purple-300 block mb-1 truncate">
                                  {selectedLayer.hasOptionLabel ? "Label Font" : "Label Font (Disabled)"}
                                </label>
                                {selectedLayer.hasOptionLabel ? (
                                  <select
                                    value={labelFont}
                                    onChange={(e) => {
                                      const newFont = e.target.value;
                                      if (linkedLabel) {
                                        updateLayer(linkedLabel.id, { fontFamily: newFont });
                                      }
                                    }}
                                    className="w-full bg-slate-800 border border-purple-800/60 rounded px-2 py-1 text-xs text-purple-200 outline-none cursor-pointer"
                                    style={{ fontFamily: `"${labelFont}", sans-serif` }}
                                    title="Font for Option Labels"
                                  >
                                    <option value="sans-serif" className="bg-slate-900 text-white font-sans">System Sans</option>
                                    {fonts.map((f, idx) => (
                                      <option key={idx} value={f.name} className="bg-slate-900 text-white" style={{ fontFamily: `"${f.name}", sans-serif` }}>
                                        {f.name.split('-').slice(1).join('-') || f.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="text-[10px] text-slate-500 py-1 italic">
                                    Enable labels above
                                  </div>
                                )}
                              </div>
                            </div>

                            {selectedLayer.hasOptionLabel && (
                              <div className="grid grid-cols-[1fr_1fr_28px] gap-2 px-1 mb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                <span>Option Value</span>
                                <span>Option Label</span>
                                <span />
                              </div>
                            )}

                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                              {selectedLayer.options?.map((opt, i) => (
                                <div key={i} className={cn("gap-2 items-center", selectedLayer.hasOptionLabel ? "grid grid-cols-[1fr_1fr_28px]" : "flex")}>
                                  <input 
                                    type="text" 
                                    value={opt}
                                    placeholder="Value (e.g. 10)"
                                    onChange={(e) => updateListOption(selectedLayer.id, i, 'value', e.target.value)}
                                    className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 w-full"
                                    style={{ 
                                      fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                                      fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                      fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                                    }}
                                  />
                                  {selectedLayer.hasOptionLabel && (
                                    <input 
                                      type="text" 
                                      value={selectedLayer.optionLabels?.[i] ?? ""}
                                      placeholder="Label (e.g. Ten)"
                                      onChange={(e) => updateListOption(selectedLayer.id, i, 'label', e.target.value)}
                                      className="bg-slate-800 border border-purple-900/60 focus:border-purple-500 rounded-lg px-2.5 py-1.5 text-xs outline-none w-full text-purple-200"
                                      style={{ 
                                        fontFamily: `"${labelFont}", sans-serif`,
                                        fontWeight: linkedLabel?.isBold ? 'bold' : 'normal',
                                        fontStyle: linkedLabel?.isItalic ? 'italic' : 'normal'
                                      }}
                                    />
                                  )}
                                  <button 
                                    type="button"
                                    onClick={() => removeOptionFromList(selectedLayer.id, i)}
                                    className="p-1 text-slate-500 hover:text-red-400 transition-colors shrink-0 flex items-center justify-center"
                                    title="Delete Option"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>

                            <button 
                              type="button"
                              onClick={() => addOptionToList(selectedLayer.id)}
                              className="w-full py-1.5 border border-dashed border-slate-700 rounded-lg text-[10px] uppercase tracking-wider font-bold text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-all flex items-center justify-center gap-1 mt-2"
                            >
                              <Plus size={12} /> Add New Item
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Number Layer Option Label Section */}
                  {selectedLayer.type === 'number' && !projects.find(p => p.id === currentProjectId)?.isLocked && (() => {
                    const linkedLabel = layers.find(l => l.linkedNumberId === selectedLayer.id);
                    const mode = selectedLayer.numberFontMode || 'fm';
                    const convertedVal = convertNumberToSinhala(selectedLayer.text, mode);

                    return (
                      <div className="space-y-3 bg-slate-900/30 p-3 rounded-xl border border-slate-800/50">
                        {/* Option Label Toggle */}
                        <div className="flex items-center justify-between bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/60">
                          <div className="flex items-center gap-2">
                            <Tag size={15} className={selectedLayer.hasNumberLabel ? "text-emerald-400" : "text-slate-400"} />
                            <div>
                              <div className="text-xs font-semibold text-slate-200">Option Label (Sinhala Words)</div>
                              <div className="text-[10px] text-slate-400">Creates another field on the image typing Sinhala words automatically</div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleNumberOptionLabel(selectedLayer.id)}
                            className={cn(
                              "relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                              selectedLayer.hasNumberLabel ? "bg-emerald-600" : "bg-slate-700"
                            )}
                            title={selectedLayer.hasNumberLabel ? "Disable option label" : "Enable option label"}
                          >
                            <span
                              className={cn(
                                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                                selectedLayer.hasNumberLabel ? "translate-x-5" : "translate-x-0"
                              )}
                            />
                          </button>
                        </div>

                        {/* If Option Label is Enabled */}
                        {selectedLayer.hasNumberLabel && linkedLabel && (
                          <div className="space-y-2.5 bg-emerald-950/20 border border-emerald-800/40 p-2.5 rounded-lg">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[11px] text-emerald-300 flex items-center gap-1.5 font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Linked Label Active on Image
                              </span>
                              <button
                                type="button"
                                onClick={() => setSelectedLayerId(linkedLabel.id)}
                                className="text-emerald-400 hover:text-emerald-300 text-[11px] underline font-medium"
                              >
                                Edit Label Layer →
                              </button>
                            </div>

                            {/* Label Font Picker */}
                            <div className="space-y-1">
                              <label className="text-[10px] uppercase font-bold text-emerald-400 block">
                                Label Font Family ({mode === 'fm' ? 'FM Font Recommended' : 'Unicode Recommended'})
                              </label>
                              <select
                                value={linkedLabel.fontFamily}
                                onChange={(e) => {
                                  const newFont = e.target.value;
                                  const isUni = isUnicodeFont(newFont);
                                  const newMode = isUni ? 'unicode' : 'fm';
                                  updateLayer(linkedLabel.id, { fontFamily: newFont, numberFontMode: newMode });
                                  updateLayer(selectedLayer.id, { 
                                    numberFontMode: newMode,
                                    numberSuffix: newMode === 'unicode' ? '/=' : selectedLayer.numberSuffix 
                                  });
                                }}
                                className="w-full bg-slate-800 border border-emerald-800/60 rounded px-2 py-1 text-xs text-emerald-200 outline-none cursor-pointer"
                                style={{ fontFamily: `"${linkedLabel.fontFamily}", sans-serif` }}
                              >
                                <option value="sans-serif" className="bg-slate-900 text-white font-sans">System Sans (Unicode)</option>
                                {fonts.map((f, idx) => (
                                  <option key={idx} value={f.name} className="bg-slate-900 text-white" style={{ fontFamily: `"${f.name}", sans-serif` }}>
                                    {f.name.split('-').slice(1).join('-') || f.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Live Value Preview */}
                            <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-emerald-900/40">
                              <span>Output on Canvas:</span>
                              <span 
                                className="text-white font-medium"
                                style={{ fontFamily: `"${linkedLabel.fontFamily}", sans-serif` }}
                              >
                                {convertedVal}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Pre-entered Prices Management Section for Price Layer */}
                  {selectedLayer.type === 'number' && !projects.find(p => p.id === currentProjectId)?.isLocked && (
                    <div className="space-y-3 bg-slate-900/30 p-3 rounded-xl border border-slate-800/50">
                      <div className="flex items-center justify-between bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/60">
                        <div className="flex items-center gap-2">
                          <ListOrdered size={15} className="text-emerald-400" />
                          <div>
                            <div className="text-xs font-semibold text-slate-200">Pre-entered Prices</div>
                            <div className="text-[10px] text-slate-400">Configure prices available in the dropdown selector</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded">
                          {(selectedLayer.options || ["500", "1000", "1500", "2000", "2500", "5000", "10000"]).length} presets
                        </span>
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {(selectedLayer.options && selectedLayer.options.length > 0
                          ? selectedLayer.options
                          : ["500", "1000", "1500", "2000", "2500", "5000", "10000"]
                        ).map((priceOpt, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-slate-800/40 p-1.5 rounded-lg border border-slate-700/40">
                            <span className="text-[10px] text-slate-500 font-mono w-5 text-center shrink-0">#{idx + 1}</span>
                            <input
                              type="text"
                              value={priceOpt}
                              onChange={(e) => updatePriceOption(selectedLayer.id, idx, e.target.value)}
                              placeholder="Price..."
                              className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-emerald-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleNumberInputChange(selectedLayer.id, priceOpt)}
                              className={cn(
                                "px-2 py-1 rounded text-[10px] font-medium transition-all shrink-0",
                                selectedLayer.text === priceOpt
                                  ? "bg-emerald-600 text-white font-bold"
                                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                              )}
                              title="Set as current price"
                            >
                              {selectedLayer.text === priceOpt ? "Active" : "Apply"}
                            </button>
                            <button
                              type="button"
                              onClick={() => removePriceOption(selectedLayer.id, idx)}
                              className="p-1 text-slate-500 hover:text-red-400 rounded transition-colors shrink-0"
                              title="Delete preset"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => addPriceOption(selectedLayer.id)}
                          className="w-full py-1.5 border border-dashed border-slate-700 rounded-lg text-[10px] uppercase tracking-wider font-bold text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-all flex items-center justify-center gap-1 mt-2"
                        >
                          <Plus size={12} /> Add Price Preset
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Suffix List Section for Text Layers */}
                  {(selectedLayer.type === 'text' || !selectedLayer.type) && !selectedLayer.isListLabel && !projects.find(p => p.id === currentProjectId)?.isLocked && (
                    <div className="space-y-3 bg-slate-900/30 p-3 rounded-xl border border-slate-800/50">
                      {/* Suffix Toggle Header */}
                      <div className="flex items-center justify-between bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/60">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-mono text-xs font-bold">
                            +S
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-200">Suffix List</div>
                            <div className="text-[10px] text-slate-400">Append selected suffix after text on the same line</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleSuffixList(selectedLayer.id)}
                          className={cn(
                            "relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                            selectedLayer.hasSuffixList ? "bg-amber-600" : "bg-slate-700"
                          )}
                          title={selectedLayer.hasSuffixList ? "Disable suffix list" : "Enable suffix list"}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                              selectedLayer.hasSuffixList ? "translate-x-5" : "translate-x-0"
                            )}
                          />
                        </button>
                      </div>

                      {/* Suffix Configuration if Enabled */}
                      {selectedLayer.hasSuffixList && (
                        <div className="space-y-3 pt-1">
                          {/* Active Suffix Picker & Quick Chips */}
                          <div className="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/40 space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-[11px] font-semibold text-slate-300 font-sans">Active Suffix on Image</label>
                              <span 
                                className="text-xs text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40"
                                style={{
                                  fontFamily: `"${selectedLayer.fontFamily}", sans-serif`,
                                  fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                  fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                                }}
                              >
                                <span>{selectedLayer.text}</span>
                                {selectedLayer.selectedSuffix && (
                                  <span style={{ fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif` }}>
                                    {selectedLayer.selectedSuffix}
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => updateLayer(selectedLayer.id, { selectedSuffix: "" })}
                                className={cn(
                                  "px-2 py-1 rounded text-xs transition-all border font-sans",
                                  !selectedLayer.selectedSuffix
                                    ? "bg-amber-600 text-white border-amber-500 shadow-sm font-bold"
                                    : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200"
                                )}
                              >
                                (None)
                              </button>
                              {selectedLayer.suffixList?.map((suf, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => updateLayer(selectedLayer.id, { selectedSuffix: suf })}
                                  className={cn(
                                    "px-2.5 py-1 rounded text-xs transition-all border",
                                    selectedLayer.selectedSuffix === suf
                                      ? "bg-amber-600 text-white border-amber-500 shadow-sm font-bold"
                                      : "bg-slate-800 text-slate-300 border-slate-700 hover:border-amber-600/50 hover:text-amber-300"
                                  )}
                                  style={{
                                    fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif`,
                                    fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                    fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                                  }}
                                >
                                  {suf}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Suffix Items List Editor */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs text-slate-400 font-semibold font-sans">
                                Suffix Options ({selectedLayer.suffixList?.length || 0})
                              </label>
                              <button
                                type="button"
                                onClick={() => addSuffixOption(selectedLayer.id)}
                                className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold"
                              >
                                <Plus size={11} /> Add Suffix
                              </button>
                            </div>

                            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                              {selectedLayer.suffixList?.map((suf, i) => {
                                const isSelected = selectedLayer.selectedSuffix === suf;
                                return (
                                  <div key={i} className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => updateLayer(selectedLayer.id, { selectedSuffix: suf })}
                                      className={cn(
                                        "w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 border transition-all",
                                        isSelected
                                          ? "bg-amber-600 border-amber-500 text-white"
                                          : "border-slate-700 text-slate-500 hover:border-slate-500"
                                      )}
                                      title={isSelected ? "Currently selected" : "Click to select this suffix"}
                                    >
                                      ✓
                                    </button>
                                    <input
                                      type="text"
                                      value={suf}
                                      onChange={(e) => updateSuffixOption(selectedLayer.id, i, e.target.value)}
                                      className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs outline-none focus:border-amber-500 w-full text-white"
                                      style={{
                                        fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif`,
                                        fontWeight: selectedLayer.isBold ? 'bold' : 'normal',
                                        fontStyle: selectedLayer.isItalic ? 'italic' : 'normal'
                                      }}
                                      placeholder="e.g. /-"
                                    />
                                    {selectedLayer.showSuffixLine && (
                                      <button
                                        type="button"
                                        onClick={() => updateLayer(selectedLayer.id, { selectedSuffix: suf })}
                                        className={cn(
                                          "text-[10px] px-1.5 py-0.5 rounded border shrink-0 font-mono transition-colors",
                                          isSelected
                                            ? "bg-sky-500/20 text-sky-300 border-sky-500/50 font-bold"
                                            : "bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200"
                                        )}
                                        title={`Line coordinates: (${Math.round(getSuffixLineConfig(selectedLayer, suf, i).x1)}%, ${Math.round(getSuffixLineConfig(selectedLayer, suf, i).y1)}%)`}
                                      >
                                        Line
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => removeSuffixOption(selectedLayer.id, i)}
                                      className="p-1 text-slate-500 hover:text-red-400 transition-colors shrink-0"
                                      title="Delete suffix"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Suffix Appearance (Gap, Font Size, Color) */}
                          <div className="pt-2 border-t border-slate-800/80 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <label className="text-[11px] font-semibold text-slate-400">Suffix Spacing (Gap)</label>
                              <span className="text-[11px] font-mono text-amber-300">{selectedLayer.suffixGap ?? 4}px</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="40"
                              value={selectedLayer.suffixGap ?? 4}
                              onChange={(e) => updateLayer(selectedLayer.id, { suffixGap: parseInt(e.target.value) || 0 })}
                              className="w-full accent-amber-500"
                            />

                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <div>
                                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Suffix Font Size</label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    min="8"
                                    max="300"
                                    value={selectedLayer.suffixFontSize || selectedLayer.fontSize}
                                    onChange={(e) => updateLayer(selectedLayer.id, { suffixFontSize: parseInt(e.target.value) || selectedLayer.fontSize })}
                                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs outline-none focus:border-amber-500"
                                  />
                                  {selectedLayer.suffixFontSize && selectedLayer.suffixFontSize !== selectedLayer.fontSize && (
                                    <button
                                      type="button"
                                      onClick={() => updateLayer(selectedLayer.id, { suffixFontSize: undefined })}
                                      className="text-[10px] text-slate-500 hover:text-slate-300 shrink-0"
                                      title="Reset to main font size"
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Suffix Color</label>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="color"
                                    value={selectedLayer.suffixColor || selectedLayer.color}
                                    onChange={(e) => updateLayer(selectedLayer.id, { suffixColor: e.target.value })}
                                    className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer shrink-0"
                                  />
                                  <span className="text-[10px] font-mono text-slate-400 truncate">{selectedLayer.suffixColor || selectedLayer.color}</span>
                                  {selectedLayer.suffixColor && selectedLayer.suffixColor !== selectedLayer.color && (
                                    <button
                                      type="button"
                                      onClick={() => updateLayer(selectedLayer.id, { suffixColor: undefined })}
                                      className="text-[10px] text-slate-500 hover:text-slate-300 shrink-0"
                                      title="Reset to main text color"
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="pt-1">
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[10px] uppercase font-bold text-slate-500 block">Suffix Font Override</label>
                                {selectedLayer.suffixFontFamily && selectedLayer.suffixFontFamily !== selectedLayer.fontFamily && (
                                  <button
                                    type="button"
                                    onClick={() => updateLayer(selectedLayer.id, { suffixFontFamily: undefined })}
                                    className="text-[10px] text-slate-500 hover:text-slate-300"
                                    title="Reset to inherit layer font"
                                  >
                                    Reset to Layer Font ({selectedLayer.fontFamily})
                                  </button>
                                )}
                              </div>
                              <select
                                value={selectedLayer.suffixFontFamily || ""}
                                onChange={(e) => updateLayer(selectedLayer.id, { suffixFontFamily: e.target.value || undefined })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-amber-500 cursor-pointer"
                                style={{ fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif` }}
                              >
                                <option value="" className="bg-slate-900 text-slate-400 font-sans">
                                  Default: Inherit from layer ({selectedLayer.fontFamily})
                                </option>
                                <option value="sans-serif" className="bg-slate-900 text-white font-sans">System Sans</option>
                                {fonts.map((f, i) => (
                                  <option 
                                    key={i} 
                                    value={f.name}
                                    className="bg-slate-900 text-white"
                                    style={{ fontFamily: `"${f.name}", sans-serif` }}
                                  >
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Show Line Toggle & Per-Option Position Editor */}
                            <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                              <div className="flex items-center justify-between bg-slate-800/80 p-2.5 rounded-lg border border-slate-700/60">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                                    <Minus size={14} className="stroke-[2.5]" />
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold text-slate-200">Show Line</div>
                                    <div className="text-[10px] text-slate-400">Draw line at custom location for each suffix option</div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => updateLayer(selectedLayer.id, { showSuffixLine: !selectedLayer.showSuffixLine })}
                                  className={cn(
                                    "relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                                    selectedLayer.showSuffixLine ? "bg-sky-600" : "bg-slate-700"
                                  )}
                                  title={selectedLayer.showSuffixLine ? "Disable line" : "Enable line"}
                                >
                                  <span
                                    className={cn(
                                      "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                                      selectedLayer.showSuffixLine ? "translate-x-5" : "translate-x-0"
                                    )}
                                  />
                                </button>
                              </div>

                              {selectedLayer.showSuffixLine && (
                                <div className="bg-slate-800/60 p-3 rounded-xl border border-sky-500/30 space-y-3">
                                  {/* Suffix Option Selector for Line Position */}
                                  <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                      <label className="text-[11px] font-semibold text-slate-300">
                                        Suffix Option ({selectedLayer.suffixList?.length || 0})
                                      </label>
                                      <span className="text-[10px] text-sky-400 font-medium">
                                        Location defined per option
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                      {selectedLayer.suffixList?.map((suf, i) => {
                                        const isSelected = selectedLayer.selectedSuffix === suf;
                                        const cfg = getSuffixLineConfig(selectedLayer, suf, i);
                                        return (
                                          <button
                                            key={i}
                                            type="button"
                                            onClick={() => updateLayer(selectedLayer.id, { selectedSuffix: suf })}
                                            className={cn(
                                              "px-2.5 py-1 rounded text-xs transition-all border flex items-center gap-1.5",
                                              isSelected
                                                ? "bg-sky-600 text-white border-sky-400 shadow-sm font-bold ring-1 ring-sky-400/40"
                                                : "bg-slate-800 text-slate-300 border-slate-700 hover:border-sky-500/50 hover:text-sky-300"
                                            )}
                                            style={{ fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif` }}
                                            title={`Configure line location for "${suf}"`}
                                          >
                                            <span>{suf}</span>
                                            <span className="text-[9px] font-mono opacity-75">
                                              ({Math.round(cfg.x1)}%,{Math.round(cfg.y1)}%)
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* Line Coordinates Editor */}
                                  {selectedLayer.selectedSuffix ? (() => {
                                    const suf = selectedLayer.selectedSuffix;
                                    const cfg = getSuffixLineConfig(selectedLayer, suf, selectedLayer.suffixList?.indexOf(suf));

                                    return (
                                      <div className="space-y-2.5 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                                        <div className="flex items-center justify-between text-xs">
                                          <span className="font-semibold text-sky-300 flex items-center gap-1.5">
                                            <span>Line position for:</span>
                                            <span className="px-1.5 py-0.5 bg-sky-950 border border-sky-800 rounded font-bold" style={{ fontFamily: `"${selectedLayer.suffixFontFamily || selectedLayer.fontFamily}", sans-serif` }}>
                                              {suf}
                                            </span>
                                          </span>
                                          <span className="text-[10px] text-slate-400 font-mono">
                                            ({cfg.x1}%, {cfg.y1}%) → ({cfg.x2}%, {cfg.y2}%)
                                          </span>
                                        </div>

                                        {/* Start Point X1, Y1 */}
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                              <span>Start X1</span>
                                              <span className="font-mono text-sky-300">{cfg.x1}%</span>
                                            </div>
                                            <input
                                              type="range"
                                              min="0"
                                              max="100"
                                              step="0.5"
                                              value={cfg.x1}
                                              onChange={(e) => updateSuffixLineConfig(selectedLayer.id, suf, { x1: parseFloat(e.target.value) || 0 })}
                                              className="w-full accent-sky-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                                            />
                                          </div>
                                          <div>
                                            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                              <span>Start Y1</span>
                                              <span className="font-mono text-sky-300">{cfg.y1}%</span>
                                            </div>
                                            <input
                                              type="range"
                                              min="0"
                                              max="100"
                                              step="0.5"
                                              value={cfg.y1}
                                              onChange={(e) => updateSuffixLineConfig(selectedLayer.id, suf, { y1: parseFloat(e.target.value) || 0 })}
                                              className="w-full accent-sky-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                                            />
                                          </div>
                                        </div>

                                        {/* End Point X2, Y2 */}
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                              <span>End X2</span>
                                              <span className="font-mono text-sky-300">{cfg.x2}%</span>
                                            </div>
                                            <input
                                              type="range"
                                              min="0"
                                              max="100"
                                              step="0.5"
                                              value={cfg.x2}
                                              onChange={(e) => updateSuffixLineConfig(selectedLayer.id, suf, { x2: parseFloat(e.target.value) || 0 })}
                                              className="w-full accent-sky-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                                            />
                                          </div>
                                          <div>
                                            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                              <span>End Y2</span>
                                              <span className="font-mono text-sky-300">{cfg.y2}%</span>
                                            </div>
                                            <input
                                              type="range"
                                              min="0"
                                              max="100"
                                              step="0.5"
                                              value={cfg.y2}
                                              onChange={(e) => updateSuffixLineConfig(selectedLayer.id, suf, { y2: parseFloat(e.target.value) || 0 })}
                                              className="w-full accent-sky-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                                            />
                                          </div>
                                        </div>

                                        {/* Quick Positioning Helpers */}
                                        <div className="pt-1 flex flex-wrap gap-1.5 text-[10px]">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              updateSuffixLineConfig(selectedLayer.id, suf, { y2: cfg.y1 });
                                            }}
                                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-700"
                                            title="Make line perfectly horizontal"
                                          >
                                            Horizontal (Level)
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              updateSuffixLineConfig(selectedLayer.id, suf, {
                                                x1: Math.round(Math.max(2, selectedLayer.x - 2)),
                                                y1: Math.round(Math.max(2, selectedLayer.y + 4)),
                                                x2: Math.round(Math.min(98, selectedLayer.x + 18)),
                                                y2: Math.round(Math.max(2, selectedLayer.y + 4)),
                                              });
                                            }}
                                            className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-700"
                                            title="Position line near the text layer"
                                          >
                                            Place near Text
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const newLines: Record<string, SuffixLineConfig> = { ...(selectedLayer.suffixLines || {}) };
                                              selectedLayer.suffixList?.forEach(s => {
                                                newLines[s] = { ...cfg };
                                              });
                                              updateLayer(selectedLayer.id, { suffixLines: newLines });
                                              setNotification({ message: "Copied line position to all suffix options", type: 'success' });
                                            }}
                                            className="bg-slate-800 hover:bg-slate-700 text-sky-400 px-2 py-1 rounded border border-slate-700 ml-auto"
                                            title="Copy this line position to all suffix options"
                                          >
                                            Copy to All
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })() : (
                                    <div className="text-xs text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40">
                                      Please select a suffix option above to configure its line location.
                                    </div>
                                  )}

                                  {/* Line Styling (Color & Width) */}
                                  <div className="pt-2 border-t border-slate-700/60 grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Line Thickness</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="range"
                                          min="1"
                                          max="20"
                                          value={selectedLayer.suffixLineWidth || 3}
                                          onChange={(e) => updateLayer(selectedLayer.id, { suffixLineWidth: parseInt(e.target.value) || 1 })}
                                          className="w-full accent-sky-500 h-1.5 bg-slate-700 rounded-lg cursor-pointer"
                                        />
                                        <span className="text-xs font-mono text-sky-300 shrink-0 w-8 text-right">
                                          {selectedLayer.suffixLineWidth || 3}px
                                        </span>
                                      </div>
                                    </div>
                                    <div>
                                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Line Color</label>
                                      <div className="flex items-center gap-1.5">
                                        <input
                                          type="color"
                                          value={selectedLayer.suffixLineColor || selectedLayer.color}
                                          onChange={(e) => updateLayer(selectedLayer.id, { suffixLineColor: e.target.value })}
                                          className="w-7 h-7 rounded border border-slate-700 bg-transparent cursor-pointer shrink-0"
                                        />
                                        <span className="text-[10px] font-mono text-slate-300 truncate">
                                          {selectedLayer.suffixLineColor || selectedLayer.color}
                                        </span>
                                        {selectedLayer.suffixLineColor && selectedLayer.suffixLineColor !== selectedLayer.color && (
                                          <button
                                            type="button"
                                            onClick={() => updateLayer(selectedLayer.id, { suffixLineColor: undefined })}
                                            className="text-[10px] text-slate-500 hover:text-slate-300 shrink-0"
                                            title="Reset to text color"
                                          >
                                            Reset
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="text-[10px] text-slate-400 flex items-center gap-1.5 bg-slate-900/40 p-2 rounded border border-slate-800">
                                    <Move size={12} className="text-sky-400 shrink-0" />
                                    <span>Drag the line or its blue circular endpoints directly on the image to position!</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedLayer.type === 'date' && (
                    <div className="space-y-4 bg-slate-900/30 p-3 rounded-xl border border-slate-800/50">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-400">Sinhala Month</label>
                        <button
                          onClick={() => updateLayer(selectedLayer.id, { useSinhalaMonth: !selectedLayer.useSinhalaMonth })}
                          className={cn(
                            "relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                            selectedLayer.useSinhalaMonth ? "bg-teal-600" : "bg-slate-700"
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
                              selectedLayer.useSinhalaMonth ? "translate-x-5" : "translate-x-1"
                            )}
                          />
                        </button>
                      </div>

                      {selectedLayer.useSinhalaMonth && !projects.find(p => p.id === currentProjectId)?.isLocked && (
                        <div className="space-y-4">
                          <div>
                            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 block mb-1.5">Month Font Size</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="1"
                                max="1000"
                                value={selectedLayer.sinhalaMonthFontSize || selectedLayer.fontSize}
                                onChange={(e) => updateLayer(selectedLayer.id, { sinhalaMonthFontSize: parseInt(e.target.value) || 0 })}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <div className="flex gap-1">
                                <button 
                                  onClick={() => updateLayer(selectedLayer.id, { sinhalaMonthFontSize: (selectedLayer.sinhalaMonthFontSize || selectedLayer.fontSize) + 1 })}
                                  className="bg-slate-800 hover:bg-slate-700 p-2 rounded-lg border border-slate-700 transition-colors"
                                >
                                  <Plus size={14} />
                                </button>
                                <button 
                                  onClick={() => updateLayer(selectedLayer.id, { sinhalaMonthFontSize: Math.max(1, (selectedLayer.sinhalaMonthFontSize || selectedLayer.fontSize) - 1) })}
                                  className="bg-slate-800 hover:bg-slate-700 p-2 rounded-lg border border-slate-700 transition-colors"
                                >
                                  <Minus size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 block">Month Names (1-12)</label>
                            <button 
                              onClick={() => {
                                updateLayer(selectedLayer.id, { 
                                  sinhalaMonths: ["ckjdß", "fmnrjdß", "ud¾;=", "wfma%,a", "uehs", "cQks", "cQ,s", "wf.daia;=", "iema;eïn¾", "Tlaf;dan¾", "fkdjeïn¾", "foieïn¾"] 
                                });
                              }}
                              className="text-[9px] text-blue-400 hover:text-blue-300 transition-colors uppercase font-bold tracking-tighter"
                            >
                              Reset to Default
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                            {selectedLayer.sinhalaMonths?.map((month, idx) => (
                              <div key={idx} className="flex flex-col gap-1">
                                <span className="text-[9px] text-slate-600 font-mono">{(idx + 1).toString().padStart(2, '0')}</span>
                                <input
                                  type="text"
                                  value={month}
                                  onChange={(e) => {
                                    const newMonths = [...(selectedLayer.sinhalaMonths || [])];
                                    newMonths[idx] = e.target.value;
                                    updateLayer(selectedLayer.id, { sinhalaMonths: newMonths });
                                  }}
                                  className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-[11px] outline-none focus:border-teal-500"
                                  style={{ fontFamily: selectedLayer.fontFamily }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {!projects.find(p => p.id === currentProjectId)?.isLocked && (
                    <>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-slate-500 block">Font Family</label>
                    </div>
                    
                    <div className="relative">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          const dropdown = document.getElementById('font-dropdown');
                          if (dropdown) dropdown.classList.toggle('hidden');
                        }}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-left flex justify-between items-center hover:border-slate-600 transition-all outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <span className="truncate">{selectedLayer.fontFamily}</span>
                        <Plus size={14} className="rotate-45 opacity-50" />
                      </button>
                      
                      <div 
                        id="font-dropdown"
                        className="hidden absolute z-[100] w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-h-64 overflow-y-auto"
                      >
                        <div 
                          className="px-3 py-2.5 hover:bg-blue-600/20 cursor-pointer border-b border-slate-800/50 transition-colors"
                          onClick={() => {
                            updateLayer(selectedLayer.id, { fontFamily: 'sans-serif' });
                            document.getElementById('font-dropdown')?.classList.add('hidden');
                          }}
                        >
                          <span className="font-sans text-xs text-slate-400 block mb-1 uppercase tracking-tighter">System Sans</span>
                          <span className="font-sans text-lg">The quick brown fox</span>
                        </div>
                        {(() => {
                          const userSelected = (user?.selectedFonts && user.selectedFonts.length > 0)
                            ? user.selectedFonts.map(name => fonts.find(f => f.name === name)).filter(Boolean) as Font[]
                            : fonts;
                          const finalFonts = userSelected.length > 0 ? userSelected : fonts;
                          return finalFonts.map((f, index) => (
                            <div 
                              key={`${f.name}-${index}`}
                              className="px-3 py-2.5 hover:bg-blue-600/20 cursor-pointer border-b border-slate-800/50 transition-colors group/font"
                              onClick={() => {
                                updateLayer(selectedLayer.id, { fontFamily: f.name });
                                document.getElementById('font-dropdown')?.classList.add('hidden');
                              }}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-sans text-xs text-slate-400 block uppercase tracking-tighter">{f.name.split('-').slice(1).join('-') || f.name}</span>
                              </div>
                              <span style={{ fontFamily: f.name }} className="text-lg">
                                The quick brown fox
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    {isFontLoading && (
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-blue-400">
                        <div className="w-2 h-2 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                        <span>Uploading font...</span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1.5">Size</label>
                      <input
                        type="number"
                        value={selectedLayer.fontSize}
                        onChange={(e) => updateLayer(selectedLayer.id, { fontSize: parseInt(e.target.value) })}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1.5">Color</label>
                      <input
                        type="color"
                        value={selectedLayer.color}
                        onChange={(e) => updateLayer(selectedLayer.id, { color: e.target.value })}
                        className="w-full h-9 bg-slate-800 border border-slate-700 rounded-lg px-1 py-1 outline-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 block mb-1.5">Font Style</label>
                    <div className="flex bg-slate-800 border border-slate-700 rounded-lg p-1 gap-1">
                      <button
                        onClick={() => updateLayer(selectedLayer.id, { isBold: !selectedLayer.isBold })}
                        className={cn(
                          "flex-1 py-1.5 rounded-md flex items-center justify-center transition-all",
                          selectedLayer.isBold 
                            ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                            : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                        )}
                        title="Bold"
                      >
                        <Bold size={16} />
                      </button>
                      <button
                        onClick={() => updateLayer(selectedLayer.id, { isItalic: !selectedLayer.isItalic })}
                        className={cn(
                          "flex-1 py-1.5 rounded-md flex items-center justify-center transition-all",
                          selectedLayer.isItalic 
                            ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                            : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                        )}
                        title="Italic"
                      >
                        <Italic size={16} />
                      </button>
                      <button
                        onClick={() => updateLayer(selectedLayer.id, { isUnderline: !selectedLayer.isUnderline })}
                        className={cn(
                          "flex-1 py-1.5 rounded-md flex items-center justify-center transition-all",
                          selectedLayer.isUnderline 
                            ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                            : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                        )}
                        title="Underline"
                      >
                        <Underline size={16} />
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 block mb-1.5">Alignment</label>
                    <div className="flex bg-slate-800 border border-slate-700 rounded-lg p-1 gap-1">
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                          key={align}
                          onClick={() => updateLayer(selectedLayer.id, { textAlign: align })}
                          className={cn(
                            "flex-1 py-1.5 rounded-md flex items-center justify-center transition-all",
                            selectedLayer.textAlign === align 
                              ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
                              : "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                          )}
                        >
                          {align === 'left' && <AlignLeft size={16} />}
                          {align === 'center' && <AlignCenter size={16} />}
                          {align === 'right' && <AlignRight size={16} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-slate-800/50">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Stroke Width</label>
                      <span className="text-[10px] text-slate-400">{selectedLayer.strokeWidth}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      value={selectedLayer.strokeWidth}
                      onChange={(e) => updateLayer(selectedLayer.id, { strokeWidth: parseInt(e.target.value) })}
                      className="w-full"
                    />
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Stroke Color</label>
                      <input
                        type="color"
                        value={selectedLayer.strokeColor}
                        onChange={(e) => updateLayer(selectedLayer.id, { strokeColor: e.target.value })}
                        className="w-8 h-8 bg-slate-800 border border-slate-700 rounded-lg px-1 py-1 outline-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-slate-800/50">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Shadow Blur</label>
                      <span className="text-[10px] text-slate-400">{selectedLayer.shadowBlur}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={selectedLayer.shadowBlur}
                      onChange={(e) => updateLayer(selectedLayer.id, { shadowBlur: parseInt(e.target.value) })}
                      className="w-full"
                    />
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-slate-500">Shadow Color</label>
                      <input
                        type="color"
                        value={selectedLayer.shadowColor}
                        onChange={(e) => updateLayer(selectedLayer.id, { shadowColor: e.target.value })}
                        className="w-8 h-8 bg-slate-800 border border-slate-700 rounded-lg px-1 py-1 outline-none cursor-pointer"
                      />
                    </div>
                  </div>
                  </>
                  )}
                  <button
                    onClick={() => deleteLayer(selectedLayer.id)}
                    disabled={projects.find(p => p.id === currentProjectId)?.isLocked}
                    className="w-full mt-6 py-2.5 bg-red-600/10 hover:bg-red-600 border border-red-600/20 text-red-500 hover:text-white rounded-xl transition-all flex items-center justify-center gap-2 font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} /> Delete Layer
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

        {/* Main Editor Area */}
        <main className={cn(
          "flex-1 bg-slate-950 relative overflow-auto custom-scrollbar flex flex-col transition-all duration-300",
          isPreviewMode ? "p-0" : "p-4 sm:p-8"
        )}>
          {/* Mobile Sidebar Overlay */}
          <AnimatePresence>
            {showSidebar && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSidebar(false)}
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] md:hidden"
              />
            )}
          </AnimatePresence>
          {/* Mobile Quick Actions */}
          {!isPreviewMode && image && (
            <div className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md border border-slate-800 p-2 rounded-2xl shadow-2xl">
              <button 
                onClick={addLayer}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold"
              >
                <Plus size={16} /> Text
              </button>
              <button 
                onClick={addLabelLayer}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold"
              >
                <Plus size={16} /> Label
              </button>
              <button 
                onClick={addDateLayer}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-slate-200 rounded-xl text-xs font-bold"
              >
                <Calendar size={16} /> Date
              </button>
              <div className="w-px h-6 bg-slate-800 mx-1" />
              <button 
                onClick={shareImage}
                className="p-2 text-blue-400"
              >
                <Share2 size={20} />
              </button>
              <button 
                onClick={() => setShowSidebar(true)}
                className="p-2 text-slate-400"
              >
                <Settings size={20} />
              </button>
            </div>
          )}
          {!image ? (
            <div className="min-h-full w-full flex items-center justify-center p-8">
              <div
                {...getMainRootProps()}
                className={cn(
                  "w-full max-w-2xl aspect-video border-2 border-dashed rounded-3xl flex flex-col items-center justify-center transition-all cursor-pointer",
                  isMainDragActive ? "border-blue-500 bg-blue-500/5" : "border-slate-800 hover:border-slate-700 bg-slate-900/50"
                )}
              >
                <input {...getMainInputProps()} />
                <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
                  <Upload className="text-slate-400" />
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">Upload your image</h2>
                <p className="text-slate-500 text-sm">Drag and drop or click to browse</p>
              </div>
            </div>
          ) : (
            <div className="min-h-full min-w-full flex p-8">
              <div 
                className="relative group m-auto" 
                style={{ 
                  width: canvasSize.width * zoom, 
                  height: canvasSize.height * zoom,
                  transition: 'width 0.1s ease-out, height 0.1s ease-out' 
                }}
              >
                <div 
                  className="absolute inset-0 origin-top-left"
                  style={{ transform: `scale(${zoom})`, transition: 'transform 0.1s ease-out' }}
                >
                  <div className="rounded-xl overflow-visible shadow-2xl border border-slate-800 bg-slate-900">
                    <canvas 
                      ref={canvasRef} 
                      className="block cursor-default"
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseUp}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const x = Math.min(e.clientX, window.innerWidth - 240);
                        const y = Math.min(e.clientY, window.innerHeight - 250);
                        setCanvasContextMenu({ x, y });
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Custom Context Menu on Canvas Right Click */}
      {canvasContextMenu && (
        <div 
          className="fixed inset-0 z-[100]" 
          onClick={() => setCanvasContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setCanvasContextMenu(null);
          }}
        >
          <div 
            style={{ top: canvasContextMenu.y, left: canvasContextMenu.x }}
            className="absolute bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl p-1.5 w-56 animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-0.5 text-xs z-[101]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              Image Actions
            </div>
            <button
              onClick={() => {
                setCanvasContextMenu(null);
                copyImageToClipboard();
              }}
              className="flex items-center justify-between px-2.5 py-2 text-slate-200 hover:text-white hover:bg-blue-600/20 rounded-lg transition-colors group text-left"
            >
              <div className="flex items-center gap-2">
                <Copy size={14} className="text-teal-400 group-hover:text-teal-300" />
                <span className="font-medium">Copy Image</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">Ctrl+C</span>
            </button>

            <button
              onClick={() => {
                setCanvasContextMenu(null);
                downloadImage();
              }}
              className="flex items-center gap-2 px-2.5 py-2 text-slate-200 hover:text-white hover:bg-blue-600/20 rounded-lg transition-colors group text-left"
            >
              <Download size={14} className="text-blue-400 group-hover:text-blue-300" />
              <span className="font-medium">Download Image</span>
            </button>

            <button
              onClick={() => {
                setCanvasContextMenu(null);
                shareImage();
              }}
              className="flex items-center gap-2 px-2.5 py-2 text-slate-200 hover:text-white hover:bg-blue-600/20 rounded-lg transition-colors group text-left"
            >
              <Share2 size={14} className="text-indigo-400 group-hover:text-indigo-300" />
              <span className="font-medium">Share Image</span>
            </button>

            {currentProjectId && (
              <>
                <div className="my-1 border-t border-slate-800" />
                <button
                  onClick={() => {
                    const cur = projects.find(p => p.id === currentProjectId);
                    setCanvasContextMenu(null);
                    if (cur) setSelectedStatsProject(cur);
                  }}
                  className="flex items-center justify-between px-2.5 py-2 text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors group text-left"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-amber-400" />
                    <span className="font-medium">Creation Stats</span>
                  </div>
                  {(() => {
                    const cur = projects.find(p => p.id === currentProjectId);
                    return cur ? (
                      <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full font-mono">
                        {cur.creationsCount || 0}
                      </span>
                    ) : null;
                  })()}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
