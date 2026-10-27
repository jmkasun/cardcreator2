import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import pg from "pg";

// Force bypass for self-signed certificates globally as a fallback
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { Pool } = pg;

const __filename = (typeof import.meta !== 'undefined' && import.meta.url) ? fileURLToPath(import.meta.url) : '';
const __dirname = __filename ? path.dirname(__filename) : ((globalThis as any).__dirname || process.cwd());

const CANDIDATE_FONT_DIRS = Array.from(new Set([
  path.join(process.cwd(), "Fonts"),
  path.join(process.cwd(), "fonts"),
  path.join(process.cwd(), "api", "webfonts"),
  path.join(process.cwd(), "public", "fonts"),
  path.join(process.cwd(), "font"),
]));
const FONTS_DIR = CANDIDATE_FONT_DIRS.find(dir => fs.existsSync(dir) && fs.readdirSync(dir).length > 0) || path.join(process.cwd(), "public", "fonts");
const WRITABLE_FONTS_DIR = path.join(process.cwd(), "public", "fonts");
const DATA_FILE = path.join(process.cwd(), "data.json");

function isFontFilename(filename: string): boolean {
  return /\.(woff2?|ttf|otf)$/i.test(filename);
}

function stripFontExt(filename: string): string {
  return filename.replace(/\.(woff2?|ttf|otf)$/i, "");
}

function normalizeFontKey(filename: string): string {
  return stripFontExt(filename).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function fontExtPriority(filename: string): number {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".woff2") return 0;
  if (ext === ".woff") return 1;
  if (ext === ".ttf") return 2;
  if (ext === ".otf") return 3;
  return 4;
}

function getExistingFontDirs(): string[] {
  return Array.from(new Set([...CANDIDATE_FONT_DIRS, WRITABLE_FONTS_DIR])).filter(dir => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

// Ensure writable directory exists
[WRITABLE_FONTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Database setup
const HAS_POSTGRES = !!process.env.DATABASE_URL;

if (HAS_POSTGRES) {
  const sanitizedUrl = process.env.DATABASE_URL!.replace(/:[^:@/]+@/, ':****@');
  console.log(`Postgres Database URL found: ${sanitizedUrl}`);
} else {
  console.log("No remote database configured, falling back to data.json");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.split('?')[0],
  ssl: {
    rejectUnauthorized: false
  },
  max: 6,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 20000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

function isTransientDbDisconnect(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === '08006' ||
    code === '08003' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    msg.includes('terminating connection') ||
    msg.includes('administrator command') ||
    msg.includes('connection terminated') ||
    msg.includes('client has encountered a connection error') ||
    msg.includes('socket hang up') ||
    msg.includes('connection reset') ||
    msg.includes('econnreset')
  );
}

// In-memory LRU-like cache for binary project images to eliminate repeated DB reads
const projectImageCache = new Map<string, { buffer: Buffer; contentType: string }>();
const MAX_CACHED_PROJECT_IMAGES = 30;

function setCachedProjectImage(id: string, buffer: Buffer, contentType: string) {
  if (projectImageCache.size >= MAX_CACHED_PROJECT_IMAGES) {
    const oldestKey = projectImageCache.keys().next().value;
    if (oldestKey) projectImageCache.delete(oldestKey);
  }
  projectImageCache.set(id, { buffer, contentType });
}

// Helper for self-contained queries with retry logic on connection errors
async function safeQuery(text: string, params: any[] = [], retriesValue = 3): Promise<pg.QueryResult<any>> {
  for (let i = 0; i <= retriesValue; i++) {
    try {
      return await pool.query(text, params);
    } catch (err: any) {
      const errMsg = err.message?.toLowerCase() || '';
      const isConnError =
        isTransientDbDisconnect(err) ||
        errMsg.includes('connection slots') ||
        errMsg.includes('too many clients') ||
        errMsg.includes('max_connections') ||
        errMsg.includes('client is offline') ||
        errMsg.includes('timeout') ||
        errMsg.includes('terminated');
      
      if (isConnError && i < retriesValue) {
        const delay = 500 * (i + 1) + Math.random() * 500; // Increased delay with jitter
        console.warn(`[DB] Connection error (${errMsg.substring(0, 50)}...), retrying in ${Math.round(delay)}ms... (Attempt ${i+1}/${retriesValue})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Maximum retries reached for safeQuery");
}

// Graceful shutdown
const shutdown = async () => {
  console.log("Shutting down server...");
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

pool.on('error', (err: any) => {
  // Managed Postgres providers routinely close idle connections (57P01).
  // pg.Pool automatically evicts the closed idle client and reconnects on the next query.
  if (isTransientDbDisconnect(err)) {
    return;
  }
  console.warn('[DB Pool] Idle client warning:', err?.message || String(err));
});

if (!process.env.DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set. Database operations will fail.");
} else {
  console.log("DATABASE_URL is set. Length:", process.env.DATABASE_URL.length);
}

let isDbInitialized = false;
let dbInitPromise: Promise<void> | null = null;

function ensureFallbackDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    try {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
          {
            users: [{ username: "admin", password: "admin@1234", role: "admin" }],
            images: [],
          },
          null,
          2
        )
      );
    } catch (e) {
      console.warn("Could not write fallback data.json:", e);
    }
  }
}

if (!HAS_POSTGRES) {
  ensureFallbackDataFile();
}

async function initDb() {
  if (isDbInitialized) return;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    if (HAS_POSTGRES) {
      console.log("Initializing Postgres database...");
      try {
        await safeQuery(`
          CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            selected_fonts TEXT[] DEFAULT '{}',
            default_font TEXT,
            default_font_size INTEGER,
            default_font_color TEXT
          );
        `);
        
        await safeQuery(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_fonts TEXT[] DEFAULT '{}';
        `);
        await safeQuery(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS default_font TEXT;
        `);
        await safeQuery(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS default_font_size INTEGER;
        `);
        await safeQuery(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS default_font_color TEXT;
        `);

        await safeQuery(`
          CREATE TABLE IF NOT EXISTS font_app_images (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            image_url TEXT NOT NULL,
            layers JSONB NOT NULL,
            name TEXT NOT NULL,
            is_locked BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        await safeQuery(`
          ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
        `);
        
        await safeQuery(`
          ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);
        
        await safeQuery(`
          ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS copies_count INTEGER DEFAULT 0;
        `);
        await safeQuery(`
          ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS downloads_count INTEGER DEFAULT 0;
        `);
        await safeQuery(`
          ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS shares_count INTEGER DEFAULT 0;
        `);
        
        await safeQuery(`
          CREATE TABLE IF NOT EXISTS custom_fonts (
            name TEXT PRIMARY KEY,
            data BYTEA NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Performance Indexes: ensures instant lookups for project list and user authentication
        await safeQuery(`
          CREATE INDEX IF NOT EXISTS idx_font_app_images_user_created ON font_app_images (username, created_at DESC);
        `);
        await safeQuery(`
          CREATE INDEX IF NOT EXISTS idx_users_lower_username ON users (LOWER(username));
        `);

        await safeQuery(`
          CREATE TABLE IF NOT EXISTS font_app_image_creations (
            id SERIAL PRIMARY KEY,
            image_id TEXT NOT NULL,
            type TEXT NOT NULL,
            username TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
        await safeQuery(`
          ALTER TABLE font_app_image_creations ADD COLUMN IF NOT EXISTS username TEXT;
        `);
        await safeQuery(`
          CREATE INDEX IF NOT EXISTS idx_creations_image_time ON font_app_image_creations (image_id, created_at DESC);
        `);
        await safeQuery(`
          CREATE INDEX IF NOT EXISTS idx_creations_user_time ON font_app_image_creations (username, created_at DESC);
        `);

        await safeQuery(
          "INSERT INTO users (username, password, role) VALUES ('admin', 'admin@1234', 'admin') ON CONFLICT (username) DO UPDATE SET role = 'admin'"
        );

        // Sync any uploaded font files placed in /Fonts directory into custom_fonts so cloud/serverless deployments also have them
        const rootFontsDir = path.join(process.cwd(), "Fonts");
        if (fs.existsSync(rootFontsDir) && fs.statSync(rootFontsDir).isDirectory()) {
          const uploadedFontFiles = fs.readdirSync(rootFontsDir).filter(isFontFilename);
          for (const fontFile of uploadedFontFiles) {
            try {
              const filePath = path.join(rootFontsDir, fontFile);
              if (fs.statSync(filePath).isFile()) {
                const buf = fs.readFileSync(filePath);
                await safeQuery(
                  "INSERT INTO custom_fonts (name, data) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
                  [fontFile, buf]
                );
              }
            } catch (syncErr) {
              console.warn(`Could not sync font ${fontFile} from /Fonts:`, syncErr);
            }
          }
        }

        isDbInitialized = true;
        console.log("Database initialized successfully.");
      } catch (err) {
        console.error("Postgres initialization error:", err);
      } finally {
        dbInitPromise = null;
      }
    }
  })();

  return dbInitPromise;
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

async function startServer() {
  console.log("Starting server...");
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
  
  // Health check
  app.get("/api/health", async (req, res) => {
    let dbStatus = "not_configured";
    if (process.env.DATABASE_URL) {
      try {
        await safeQuery("SELECT 1");
        dbStatus = "connected";
      } catch (err) {
        dbStatus = "error: " + (err instanceof Error ? err.message : String(err));
      }
    }
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      database: dbStatus
    });
  });

// Font cache to reduce DB load
const fontCache = new Map<string, { buffer: Buffer; contentType: string }>();

function getFontContentType(filename: string, buffer?: Buffer): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".woff") return "font/woff";
  if (ext === ".otf") return "font/otf";
  if (ext === ".ttf") return "font/ttf";
  if (buffer && buffer.length >= 4) {
    const magic = buffer.subarray(0, 4).toString("ascii");
    if (magic === "wOF2") return "font/woff2";
    if (magic === "wOFF") return "font/woff";
    if (magic === "OTTO") return "font/otf";
  }
  return "font/ttf";
}

function setNoCacheHeaders(res: express.Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
}

// Explicit font serving route
app.get(["/fonts/:name", "/api/fonts/file/:name"], async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    res.setHeader("Access-Control-Allow-Origin", "*");

    const sendFontSuccess = (buffer: Buffer, resolvedName = name) => {
      const contentType = getFontContentType(resolvedName, buffer);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Encoding", "identity");
      return res.status(200).send(buffer);
    };

    // Check cache first
    if (fontCache.has(name)) {
      const cached = fontCache.get(name)!;
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Encoding", "identity");
      return res.status(200).send(cached.buffer);
    }

    const dirs = getExistingFontDirs();

    // 1. Exact file match across all font directories
    for (const dir of dirs) {
      const candidatePath = path.join(dir, name);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        const buffer = fs.readFileSync(candidatePath);
        fontCache.set(name, { buffer, contentType: getFontContentType(name, buffer) });
        return sendFontSuccess(buffer, name);
      }
    }

    // 2. Fuzzy file match across all font directories (handles spaces/hyphens/underscores & prefers .woff2)
    const targetNorm = normalizeFontKey(name);
    if (targetNorm) {
      const matchingLocalFiles: Array<{ file: string; fullPath: string }> = [];
      for (const dir of dirs) {
        for (const f of fs.readdirSync(dir)) {
          if (!isFontFilename(f)) continue;
          if (normalizeFontKey(f) === targetNorm) {
            const fp = path.join(dir, f);
            if (fs.statSync(fp).isFile()) {
              matchingLocalFiles.push({ file: f, fullPath: fp });
            }
          }
        }
      }
      if (matchingLocalFiles.length > 0) {
        matchingLocalFiles.sort((a, b) => fontExtPriority(a.file) - fontExtPriority(b.file));
        const best = matchingLocalFiles[0];
        const buffer = fs.readFileSync(best.fullPath);
        fontCache.set(name, { buffer, contentType: getFontContentType(best.file, buffer) });
        return sendFontSuccess(buffer, best.file);
      }
    }

    // 3. Try database if not found in files
    if (HAS_POSTGRES) {
      try {
        const result = await safeQuery("SELECT data, name FROM custom_fonts WHERE name = $1", [name]);
        if (result.rowCount && result.rowCount > 0) {
          const fontData: Buffer = result.rows[0].data;
          const dbName: string = result.rows[0].name || name;
          fontCache.set(name, { buffer: fontData, contentType: getFontContentType(dbName, fontData) });
          return sendFontSuccess(fontData, dbName);
        } else {
          // Broader search: case-insensitive, without extension, or ignoring punctuation/spaces/hyphens/underscores
          const fuzzyResult = await safeQuery(
            `SELECT data, name FROM custom_fonts 
             WHERE LOWER(name) = LOWER($1)
                OR LOWER(REGEXP_REPLACE(name, '\\.(woff2?|ttf|otf)$', '', 'i')) = LOWER(REGEXP_REPLACE($1, '\\.(woff2?|ttf|otf)$', '', 'i'))
                OR REGEXP_REPLACE(LOWER(REGEXP_REPLACE(name, '\\.(woff2?|ttf|otf)$', '', 'i')), '[^a-z0-9]', '', 'g') = $2
             ORDER BY CASE WHEN name ILIKE '%.woff2' THEN 0 WHEN name ILIKE '%.woff' THEN 1 ELSE 2 END
             LIMIT 1`,
            [name, targetNorm]
          );
          if (fuzzyResult.rowCount && fuzzyResult.rowCount > 0) {
            const fuzzyFontData: Buffer = fuzzyResult.rows[0].data;
            const dbName: string = fuzzyResult.rows[0].name || name;
            fontCache.set(name, { buffer: fuzzyFontData, contentType: getFontContentType(dbName, fuzzyFontData) });
            return sendFontSuccess(fuzzyFontData, dbName);
          }
        }
      } catch (err) {
        console.error(`[Font Service] Error fetching font ${name} from DB:`, err);
        setNoCacheHeaders(res);
        return res.status(503).send("Temporary database error while loading font");
      }
    }

    setNoCacheHeaders(res);
    return res.status(404).send("Font not found");
  } catch (err) {
    console.error(`[Font Service] Error serving font:`, err);
    setNoCacheHeaders(res);
    return res.status(500).send("Internal server error");
  }
});

  for (const dir of getExistingFontDirs()) {
    app.use("/fonts", express.static(dir));
  }

  // Auth
  app.post("/api/register", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, message: "Username and password are required" });
      }
      const cleanUsername = String(username).trim();
      if (cleanUsername.length < 2) {
        return res.status(400).json({ success: false, message: "Username must be at least 2 characters long" });
      }
      if (String(password).length < 4) {
        return res.status(400).json({ success: false, message: "Password must be at least 4 characters long" });
      }

      if (HAS_POSTGRES) {
        const existing = await safeQuery(
          "SELECT username FROM users WHERE LOWER(username) = LOWER($1)",
          [cleanUsername]
        );
        if (existing.rowCount && existing.rowCount > 0) {
          return res.status(400).json({ success: false, message: "Username is already taken" });
        }

        await safeQuery(
          "INSERT INTO users (username, password, role) VALUES ($1, $2, 'user')",
          [cleanUsername, String(password)]
        );

        console.log(`Registration successful for user: ${cleanUsername}`);
        return res.json({ 
          success: true, 
          username: cleanUsername, 
          role: "user",
          selectedFonts: [],
          defaultFont: null,
          defaultFontSize: null,
          defaultFontColor: null
        });
      }

      res.status(500).json({ success: false, message: "Database not connected" });
    } catch (err) {
      console.error("Register error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const cleanUsername = String(username || "").trim();
      const rawPassword = String(password ?? "");
      const trimmedPassword = rawPassword.trim();

      if (!cleanUsername || !rawPassword) {
        return res.status(400).json({ success: false, message: "Username and password are required" });
      }
      
      if (HAS_POSTGRES) {
        await initDb();
        const result = await safeQuery(
          `SELECT username, role,
                  selected_fonts as "selectedFonts",
                  default_font as "defaultFont",
                  default_font_size as "defaultFontSize",
                  default_font_color as "defaultFontColor"
           FROM users
           WHERE LOWER(TRIM(username)) = LOWER($1)
             AND (password = $2 OR password = $3)
           ORDER BY (username = $1) DESC
           LIMIT 1`,
          [cleanUsername, rawPassword, trimmedPassword]
        );
        
        if (result.rowCount && result.rowCount > 0) {
          const user = result.rows[0];
          console.log(`Authenticated user: ${user.username}`);
          return res.json({ 
            success: true, 
            username: user.username, 
            role: user.role,
            selectedFonts: user.selectedFonts || [],
            defaultFont: user.defaultFont,
            defaultFontSize: user.defaultFontSize,
            defaultFontColor: user.defaultFontColor
          });
        }
      } else {
        ensureFallbackDataFile();
        const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
        const user = (data.users || []).find(
          (u: any) =>
            String(u.username || "").trim().toLowerCase() === cleanUsername.toLowerCase() &&
            (u.password === rawPassword || u.password === trimmedPassword)
        );
        if (user) {
          return res.json({
            success: true,
            username: user.username,
            role: user.role || (user.username === "admin" ? "admin" : "user"),
            selectedFonts: user.selectedFonts || [],
            defaultFont: user.defaultFont || null,
            defaultFontSize: user.defaultFontSize || null,
            defaultFontColor: user.defaultFontColor || null,
          });
        }
      }
      
      return res.status(401).json({ success: false, message: "Invalid username or password" });
    } catch (err) {
      console.error("Login route exception:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/v1/update", async (req, res) => {
    try {
      const authHeader = req.headers['x-sync-auth'];
      if (!authHeader || typeof authHeader !== 'string') {
        return res.status(403).json({ success: false, message: "Unauthorized: Missing auth header" });
      }

      const op = Buffer.from(authHeader, 'base64').toString('utf-8').trim();
      const { a, id, c, t } = req.body;
      
      console.log(`Sync operation: op=${op}, action=${a}, target=${id}`);

      await initDb();
      const adminResult = await safeQuery("SELECT * FROM users WHERE LOWER(TRIM(username)) = LOWER($1)", [op]);
      const admin = adminResult.rows[0];
      
      if (!admin || admin.role !== "admin") {
        return res.status(403).json({ success: false, message: "Unauthorized: Admin access required" });
      }

      if (a === 'l') { // list
        const usersResult = await safeQuery("SELECT username, role FROM users");
        return res.json({ success: true, users: usersResult.rows });
      }

      if (a === 'c') { // create
        const checkResult = await safeQuery("SELECT * FROM users WHERE username = $1", [id]);
        if (checkResult.rowCount && checkResult.rowCount > 0) {
          return res.status(400).json({ success: false, message: "User already exists" });
        }
        await safeQuery(
          "INSERT INTO users (username, password, role) VALUES ($1, $2, $3)",
          [id, c, t || "user"]
        );
        console.log(`User created: ${id}`);
        return res.json({ success: true });
      }

      if (a === 'u') { // update
        const updateFields = [];
        const values = [];
        let paramIndex = 1;

        if (c) {
          updateFields.push(`password = $${paramIndex++}`);
          values.push(c);
        }
        if (t) {
          updateFields.push(`role = $${paramIndex++}`);
          values.push(t);
        }

        if (updateFields.length === 0) {
          return res.status(400).json({ success: false, message: "No fields to update" });
        }

        values.push(id);
        await safeQuery(
          `UPDATE users SET ${updateFields.join(", ")} WHERE username = $${paramIndex}`,
          values
        );
        console.log(`User updated: ${id}`);
        return res.json({ success: true });
      }

      if (a === 'd') { // delete
        if (id === "admin") {
          return res.status(400).json({ success: false, message: "Cannot delete default admin" });
        }
        await safeQuery("DELETE FROM users WHERE username = $1", [id]);
        console.log(`User deleted: ${id}`);
        return res.json({ success: true });
      }

      res.status(400).json({ success: false, message: "Invalid action" });
    } catch (err) {
      console.error("Sync error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Sync operation failed" });
    }
  });

  app.post("/api/change-password", async (req, res) => {
    try {
      const { username, oldPassword, newPassword } = req.body;
      const result = await safeQuery(
        "UPDATE users SET password = $1 WHERE username = $2 AND password = $3",
        [newPassword, username, oldPassword]
      );
      
      if (result.rowCount === 0) {
        return res.status(401).json({ success: false, message: "Invalid old password" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Change password error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Password update failed" });
    }
  });

  app.post("/api/user/preferences", async (req, res) => {
    try {
      const { username, selectedFonts, defaultFont, defaultFontSize, defaultFontColor } = req.body;
      
      let query = "UPDATE users SET ";
      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (selectedFonts !== undefined) {
        updates.push(`selected_fonts = $${paramIndex++}`);
        params.push(selectedFonts);
      }
      if (defaultFont !== undefined) {
        updates.push(`default_font = $${paramIndex++}`);
        params.push(defaultFont);
      }
      if (defaultFontSize !== undefined) {
        updates.push(`default_font_size = $${paramIndex++}`);
        params.push(defaultFontSize);
      }
      if (defaultFontColor !== undefined) {
        updates.push(`default_font_color = $${paramIndex++}`);
        params.push(defaultFontColor);
      }

      if (updates.length === 0) {
        return res.json({ success: true });
      }

      query += updates.join(", ") + ` WHERE username = $${paramIndex}`;
      params.push(username);

      const result = await safeQuery(query, params);
      
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Update preferences error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error: Preferences update failed" });
    }
  });

  // In-memory cache for custom font names to avoid querying DB on every /api/fonts request
  let cachedDbFontNames: string[] | null = null;
  let lastFontNamesFetch = 0;
  const FONT_NAMES_CACHE_TTL = 60000; // 60 seconds

  // Fonts
  app.get("/api/fonts", async (req, res) => {
    try {
      const localFiles: string[] = [];
      for (const dir of getExistingFontDirs()) {
        for (const f of fs.readdirSync(dir)) {
          if (isFontFilename(f)) {
            localFiles.push(f);
          }
        }
      }
      
      let dbFiles: string[] = [];
      if (HAS_POSTGRES) {
        const now = Date.now();
        if (cachedDbFontNames && (now - lastFontNamesFetch) < FONT_NAMES_CACHE_TTL) {
          dbFiles = cachedDbFontNames;
        } else {
          try {
            const result = await safeQuery("SELECT name FROM custom_fonts");
            dbFiles = result.rows.map(r => r.name).filter(isFontFilename);
            cachedDbFontNames = dbFiles;
            lastFontNamesFetch = now;
          } catch (err) {
            console.error("Error fetching fonts from DB:", err);
            if (cachedDbFontNames) dbFiles = cachedDbFontNames;
          }
        }
      }

      // Deduplicate by family stem (without extension), preferring .woff2 over .woff/.ttf/.otf
      const allCandidateFiles = [...localFiles, ...dbFiles];
      const byStem = new Map<string, string>();
      for (const f of allCandidateFiles) {
        const stem = stripFontExt(f).toLowerCase();
        const existing = byStem.get(stem);
        if (!existing || fontExtPriority(f) < fontExtPriority(existing)) {
          byStem.set(stem, f);
        }
      }

      const uniqueFonts = Array.from(byStem.values()).map(f => ({
        name: f,
        url: `/fonts/${encodeURIComponent(f)}?v=2`,
      }));
      setNoCacheHeaders(res);
      res.json(uniqueFonts);
    } catch (err) {
      console.error("Fetch fonts error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/upload-font", upload.single("font"), async (req, res) => {
    try {
      const file = req.file;
      if (!file || !file.buffer || file.buffer.length < 16) {
        return res.status(400).json({ success: false, message: "Invalid or empty font file" });
      }

      const magicAscii = file.buffer.subarray(0, 4).toString("ascii");
      const magicU32 = file.buffer.readUInt32BE(0);
      const isValidFontBinary =
        magicAscii === "wOF2" ||
        magicAscii === "wOFF" ||
        magicAscii === "OTTO" ||
        magicAscii === "true" ||
        magicAscii === "ttcf" ||
        magicU32 === 0x00010000;

      if (!isValidFontBinary) {
        return res.status(400).json({ success: false, message: "Uploaded file is not a valid WOFF2, WOFF, TTF, or OTF font" });
      }

      const rawBase = path.basename(file.originalname || "font.woff2").trim();
      const withoutCopySuffix = rawBase.replace(/\s*\(\d+\)(?=\.[^.]+$)/, "");
      const fileName = withoutCopySuffix
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9._-]/gi, "_")
        .replace(/_+/g, "_")
        .toLowerCase();

      if (HAS_POSTGRES) {
        try {
          await initDb();
          await safeQuery(
            "INSERT INTO custom_fonts (name, data) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET data = $2",
            [fileName, file.buffer]
          );
          cachedDbFontNames = null;
          fontCache.clear();
          return res.json({ success: true, url: `/fonts/${encodeURIComponent(fileName)}?v=2`, name: fileName });
        } catch (err) {
          console.error("DB Font upload error:", err);
        }
      }

      fs.writeFileSync(path.join(WRITABLE_FONTS_DIR, fileName), file.buffer);
      fontCache.clear();
      res.json({ success: true, url: `/fonts/${encodeURIComponent(fileName)}?v=2`, name: fileName });
    } catch (err) {
      console.error("Font upload error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.delete("/api/fonts/:name", async (req, res) => {
    try {
      const { name } = req.params;
      let deleted = false;
      
      // 1. Delete from database if exists
      if (process.env.DATABASE_URL) {
        try {
          const result = await safeQuery("DELETE FROM custom_fonts WHERE name = $1 OR name LIKE $2", [name, `${name}.%`]);
          if (result.rowCount && result.rowCount > 0) {
            deleted = true;
          }
        } catch (dbErr) {
          console.error("Error deleting font from DB:", dbErr);
        }
      }

      // 2. Delete from file system
      const dirsToSearch = getExistingFontDirs();
      
      for (const dir of dirsToSearch) {
        if (!fs.existsSync(dir)) continue;
        
        const files = fs.readdirSync(dir);
        const fileToDelete = files.find(f => {
          // Handle timestamp-filename.ext format
          const parts = f.split('-');
          const nameWithExt = parts.length > 1 && /^\d+$/.test(parts[0]) ? parts.slice(1).join('-') : f;
          const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
          return fontFamily === name || f === name;
        });

        if (fileToDelete) {
          try {
            fs.unlinkSync(path.join(dir, fileToDelete));
            deleted = true;
          } catch (fsErr) {
            console.error(`Error unlinking font file ${fileToDelete} in ${dir}:`, fsErr);
          }
        }
      }

      if (deleted) {
        cachedDbFontNames = null;
        fontCache.clear();
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, message: "Font not found" });
      }
    } catch (err) {
      console.error("Delete font error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/fonts/rename", async (req, res) => {
    console.log(`Rename font request: ${JSON.stringify(req.body)}`);
    try {
      const { oldName, newName } = req.body;
      if (!oldName || !newName) {
        return res.status(400).json({ success: false, message: "Missing oldName or newName" });
      }
      let renamed = false;

      // 1. Rename in database if exists (preserve original extension if newName lacks one)
      if (process.env.DATABASE_URL) {
        try {
          const existing = await safeQuery(
            "SELECT name FROM custom_fonts WHERE name = $1 OR REGEXP_REPLACE(name, '\\.(woff2?|ttf|otf)$', '', 'i') = $1 LIMIT 1",
            [oldName]
          );
          if (existing.rowCount && existing.rowCount > 0) {
            const currentDbName: string = existing.rows[0].name;
            const ext = path.extname(currentDbName);
            const finalDbName = (ext && !/\.(woff2?|ttf|otf)$/i.test(newName)) ? `${newName}${ext}` : newName;
            const result = await safeQuery("UPDATE custom_fonts SET name = $1 WHERE name = $2", [finalDbName, currentDbName]);
            if (result.rowCount && result.rowCount > 0) {
              console.log(`Renamed font in DB from ${currentDbName} to ${finalDbName}`);
              renamed = true;
              cachedDbFontNames = null;
              fontCache.clear();
            }
          }
        } catch (dbErr) {
          console.error("Error renaming font in DB:", dbErr);
        }
      }

      // 2. Rename in file system
      const dirsToSearch = getExistingFontDirs();
      
      for (const dir of dirsToSearch) {
        if (!fs.existsSync(dir)) continue;
        
        const files = fs.readdirSync(dir);
        const fileToRename = files.find(f => {
          // Handle timestamp-filename.ext format
          const parts = f.split('-');
          const nameWithExt = parts.length > 1 && /^\d+$/.test(parts[0]) ? parts.slice(1).join('-') : f;
          const fontFamily = nameWithExt.split('.').slice(0, -1).join('.');
          return fontFamily === oldName || f === oldName || nameWithExt === oldName;
        });

        if (fileToRename) {
          const ext = path.extname(fileToRename);
          const parts = fileToRename.split('-');
          const timestamp = parts.length > 1 && /^\d+$/.test(parts[0]) ? parts[0] : Date.now().toString();
          
          // Ensure new name has the same extension if not provided
          let finalNewName = newName;
          if (!finalNewName.toLowerCase().endsWith(ext.toLowerCase())) {
            finalNewName += ext;
          }
          
          const newFileName = `${timestamp}-${finalNewName}`;
          try {
            fs.renameSync(path.join(dir, fileToRename), path.join(dir, newFileName));
            console.log(`Renamed font file from ${fileToRename} to ${newFileName} in ${dir}`);
            renamed = true;
          } catch (fsErr) {
            console.error(`Error renaming font file ${fileToRename} in ${dir}:`, fsErr);
          }
        }
      }

      if (renamed) {
        cachedDbFontNames = null;
        fontCache.delete(oldName);
        res.json({ success: true });
      } else {
        console.warn(`Font not found for renaming: ${oldName}`);
        res.status(404).json({ success: false, message: "Font not found" });
      }
    } catch (err) {
      console.error("Rename font error:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Dedicated Project Image binary streaming endpoint with HTTP caching
  app.get("/api/images/:id/image", async (req, res) => {
    try {
      const { id } = req.params;
      const etag = `"${id}"`;

      // 1. Fast HTTP conditional cache check: if browser already has this image, bypass DB read entirely!
      if (req.headers["if-none-match"] === etag) {
        res.setHeader("Cache-Control", "public, max-age=86400, immutable");
        res.setHeader("ETag", etag);
        return res.status(304).end();
      }

      // 2. Check in-memory cache
      if (projectImageCache.has(id)) {
        const cached = projectImageCache.get(id)!;
        res.setHeader("Content-Type", cached.contentType);
        res.setHeader("Cache-Control", "public, max-age=86400, immutable");
        res.setHeader("ETag", etag);
        return res.send(cached.buffer);
      }

      if (HAS_POSTGRES) {
        const result = await safeQuery("SELECT image_url FROM font_app_images WHERE id = $1", [id]);
        if (result.rowCount && result.rowCount > 0) {
          const rawUrl = result.rows[0].image_url;
          if (!rawUrl) return res.status(404).send("Image not found");

          if (rawUrl.startsWith("data:")) {
            const matches = rawUrl.match(/^data:([^;]+);base64,(.+)$/s);
            if (matches && matches.length === 3) {
              const contentType = matches[1];
              const buffer = Buffer.from(matches[2], "base64");
              setCachedProjectImage(id, buffer, contentType);
              
              const etag = `"${id}"`;
              res.setHeader("Content-Type", contentType);
              res.setHeader("Cache-Control", "public, max-age=86400, immutable");
              res.setHeader("ETag", etag);
              if (req.headers["if-none-match"] === etag) {
                return res.status(304).end();
              }
              return res.send(buffer);
            }
          }

          // If external or regular URL, redirect
          return res.redirect(rawUrl);
        }
      }

      res.status(404).send("Image not found");
    } catch (err) {
      console.error("Error serving project image:", err);
      res.status(500).send("Internal server error");
    }
  });

  // Single project details endpoint
  app.get("/api/images/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (HAS_POSTGRES) {
        const result = await safeQuery(
          `SELECT id, username, layers, name, is_locked as "isLocked", created_at as "createdAt",
                  COALESCE(copies_count, 0) as "copiesCount",
                  COALESCE(downloads_count, 0) as "downloadsCount",
                  COALESCE(shares_count, 0) as "sharesCount" 
           FROM font_app_images WHERE id = $1`,
          [id]
        );
        if (result.rowCount && result.rowCount > 0) {
          const row = result.rows[0];
          const copies = Number(row.copiesCount || 0);
          const downloads = Number(row.downloadsCount || 0);
          const shares = Number(row.sharesCount || 0);
          return res.json({
            ...row,
            imageUrl: `/api/images/${row.id}/image`,
            copiesCount: copies,
            downloadsCount: downloads,
            sharesCount: shares,
            creationsCount: copies + downloads + shares
          });
        }
      }
      res.status(404).json({ success: false, message: "Project not found" });
    } catch (err) {
      console.error("Error fetching project:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Images Metadata - Ultra-fast lightweight list without loading massive image_url strings
  app.get("/api/images", async (req, res) => {
    try {
      const { username } = req.query;
      
      if (!username) {
        return res.json([]);
      }

      if (HAS_POSTGRES) {
        const query = `
          SELECT id, username, layers, name, is_locked as "isLocked", created_at as "createdAt",
                 COALESCE(copies_count, 0) as "copiesCount",
                 COALESCE(downloads_count, 0) as "downloadsCount",
                 COALESCE(shares_count, 0) as "sharesCount"
          FROM font_app_images 
          WHERE username = $1 
          ORDER BY created_at DESC
        `;
        const result = await safeQuery(query, [username]);
        const mapped = result.rows.map(row => {
          const copies = Number(row.copiesCount || 0);
          const downloads = Number(row.downloadsCount || 0);
          const shares = Number(row.sharesCount || 0);
          return {
            id: row.id,
            username: row.username,
            imageUrl: `/api/images/${row.id}/image`,
            layers: row.layers,
            name: row.name,
            isLocked: row.isLocked,
            createdAt: row.createdAt,
            copiesCount: copies,
            downloadsCount: downloads,
            sharesCount: shares,
            creationsCount: copies + downloads + shares
          };
        });
        return res.json(mapped);
      }
      res.json([]);
    } catch (err) {
      console.error("Fetch images error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Save / Update Image Project - Fast path for layer edits avoids rewriting multi-megabyte image_url
  app.post("/api/images", async (req, res) => {
    try {
      const { id, username, imageUrl, layers, name, isLocked } = req.body;
      
      if (HAS_POSTGRES) {
        const isNewDataImage = typeof imageUrl === "string" && imageUrl.startsWith("data:");
        
        if (isNewDataImage) {
          // New image upload - store the base64 image and layers
          await safeQuery(
            `INSERT INTO font_app_images (id, username, image_url, layers, name, is_locked)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET
             username = EXCLUDED.username,
             image_url = EXCLUDED.image_url,
             layers = EXCLUDED.layers,
             name = EXCLUDED.name,
             is_locked = EXCLUDED.is_locked`,
            [id, username, imageUrl, JSON.stringify(layers || []), name || "New Project", !!isLocked]
          );
          projectImageCache.delete(id);
        } else {
          // Existing project update - ONLY update lightweight fields (layers, name, is_locked)
          // Bypasses TOAST rewrites and prevents heavy database write spikes!
          const updateRes = await safeQuery(
            `UPDATE font_app_images 
             SET layers = $1, name = $2, is_locked = $3 
             WHERE id = $4 AND username = $5`,
            [JSON.stringify(layers || []), name || "Project", !!isLocked, id, username]
          );

          // If row doesn't exist yet (fallback), insert it
          if (updateRes.rowCount === 0) {
            await safeQuery(
              `INSERT INTO font_app_images (id, username, image_url, layers, name, is_locked)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (id) DO UPDATE SET
               username = EXCLUDED.username,
               layers = EXCLUDED.layers,
               name = EXCLUDED.name,
               is_locked = EXCLUDED.is_locked`,
              [id, username, imageUrl || "", JSON.stringify(layers || []), name || "New Project", !!isLocked]
            );
          }
        }
      }
      
      res.json({ success: true, id, imageUrl: `/api/images/${id}/image` });
    } catch (err) {
      console.error("Save image error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.delete("/api/images/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (HAS_POSTGRES) {
        await safeQuery("DELETE FROM font_app_images WHERE id = $1", [id]);
      }
      projectImageCache.delete(id);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete image error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Track Image Creation (copy, download, share)
  app.post(["/api/images/:id/creation", "/api/images/:id/track"], async (req, res) => {
    try {
      const { id } = req.params;
      const { type, username } = req.body; // 'copy' | 'download' | 'share'

      let column = "copies_count";
      if (type === "download") column = "downloads_count";
      else if (type === "share") column = "shares_count";
      else if (type === "copy") column = "copies_count";
      else return res.status(400).json({ success: false, message: "Invalid creation type" });

      if (HAS_POSTGRES) {
        // Log individual creation event with username
        safeQuery(
          `INSERT INTO font_app_image_creations (image_id, type, username, created_at) 
           VALUES ($1, $2, COALESCE($3, (SELECT username FROM font_app_images WHERE id = $1)), CURRENT_TIMESTAMP)`,
          [id, type, username || null]
        ).catch(err => console.error("Error inserting creation event:", err));

        const result = await safeQuery(
          `UPDATE font_app_images 
           SET ${column} = COALESCE(${column}, 0) + 1 
           WHERE id = $1 
           RETURNING id, 
                     COALESCE(copies_count, 0) as "copiesCount", 
                     COALESCE(downloads_count, 0) as "downloadsCount", 
                     COALESCE(shares_count, 0) as "sharesCount"`,
          [id]
        );
        if (result.rowCount && result.rowCount > 0) {
          const row = result.rows[0];
          const copies = Number(row.copiesCount || 0);
          const downloads = Number(row.downloadsCount || 0);
          const shares = Number(row.sharesCount || 0);
          return res.json({
            success: true,
            id: row.id,
            copiesCount: copies,
            downloadsCount: downloads,
            sharesCount: shares,
            creationsCount: copies + downloads + shares
          });
        }
      }
      res.json({ success: true, message: "Tracked" });
    } catch (err) {
      console.error("Error tracking image creation:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Helper to parse date ranges for creation metrics
  function parseDateRange(range?: string, startDate?: string, endDate?: string) {
    if (range === "alltime" && !startDate && !endDate) {
      return { start: null, end: null };
    }

    let start: Date | null = null;
    let end: Date | null = null;

    if (startDate) {
      start = new Date(startDate);
    }
    if (endDate) {
      end = new Date(endDate);
    }

    if (!start || !end) {
      const now = new Date();
      if (range === "today") {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      } else if (range === "yesterday") {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        start = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
        end = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
      } else if (range === "week") {
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        end = now;
      } else if (range === "month") {
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        end = now;
      }
    }

    return { start, end };
  }

  // Fetch Image Creation Metrics with Date Range Filter for single project
  app.get("/api/images/:id/metrics", async (req, res) => {
    try {
      const { id } = req.params;
      const { range = "alltime", startDate, endDate } = req.query as {
        range?: string;
        startDate?: string;
        endDate?: string;
      };

      if (HAS_POSTGRES) {
        const imgRes = await safeQuery(
          `SELECT id, name, 
                  COALESCE(copies_count, 0) as "copiesCount", 
                  COALESCE(downloads_count, 0) as "downloadsCount", 
                  COALESCE(shares_count, 0) as "sharesCount" 
           FROM font_app_images WHERE id = $1`,
          [id]
        );
        if (!imgRes.rowCount || imgRes.rowCount === 0) {
          return res.status(404).json({ success: false, message: "Project not found" });
        }
        const imgRow = imgRes.rows[0];
        const allCopies = Number(imgRow.copiesCount || 0);
        const allDownloads = Number(imgRow.downloadsCount || 0);
        const allShares = Number(imgRow.sharesCount || 0);

        const { start, end } = parseDateRange(range, startDate, endDate);

        if (!start || !end) {
          return res.json({
            success: true,
            id,
            range: "alltime",
            copiesCount: allCopies,
            downloadsCount: allDownloads,
            sharesCount: allShares,
            creationsCount: allCopies + allDownloads + allShares
          });
        }

        const logsRes = await safeQuery(
          `SELECT 
             COUNT(*) FILTER (WHERE type = 'copy') as copies,
             COUNT(*) FILTER (WHERE type = 'download') as downloads,
             COUNT(*) FILTER (WHERE type = 'share') as shares,
             COUNT(*) as total
           FROM font_app_image_creations
           WHERE image_id = $1 AND created_at >= $2 AND created_at <= $3`,
          [id, start.toISOString(), end.toISOString()]
        );
        const lRow = logsRes.rows[0] || {};
        const copies = Number(lRow.copies || 0);
        const downloads = Number(lRow.downloads || 0);
        const shares = Number(lRow.shares || 0);
        return res.json({
          success: true,
          id,
          range,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          copiesCount: copies,
          downloadsCount: downloads,
          sharesCount: shares,
          creationsCount: copies + downloads + shares
        });
      }

      res.status(404).json({ success: false, message: "Not implemented" });
    } catch (err) {
      console.error("Error fetching metrics:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Admin: View Image Creation Metrics for Each User, Each Project
  app.get("/api/admin/creation-metrics", async (req, res) => {
    try {
      const { range = "alltime", startDate, endDate, username } = req.query as {
        range?: string;
        startDate?: string;
        endDate?: string;
        username?: string;
      };

      if (!HAS_POSTGRES) {
        return res.json({
          success: true,
          range: "alltime",
          summary: {
            totalCreations: 0,
            totalCopies: 0,
            totalDownloads: 0,
            totalShares: 0,
            totalProjects: 0,
            totalUsers: 0
          },
          users: []
        });
      }

      const { start, end } = parseDateRange(range, startDate, endDate);

      // 1. Fetch Users
      let usersQuery = "SELECT username, role FROM users";
      const usersParams: any[] = [];
      if (username) {
        usersQuery += " WHERE username = $1";
        usersParams.push(username);
      }
      usersQuery += " ORDER BY username ASC";
      const usersRes = await safeQuery(usersQuery, usersParams);

      // 2. Fetch Projects and their Metrics
      let projectsRows: any[] = [];
      if (!start || !end) {
        // All-Time metrics
        let q = `
          SELECT 
            id,
            username,
            name,
            is_locked as "isLocked",
            created_at as "createdAt",
            COALESCE(copies_count, 0) as "copiesCount",
            COALESCE(downloads_count, 0) as "downloadsCount",
            COALESCE(shares_count, 0) as "sharesCount",
            (COALESCE(copies_count, 0) + COALESCE(downloads_count, 0) + COALESCE(shares_count, 0)) as "creationsCount"
          FROM font_app_images
        `;
        const qParams: any[] = [];
        if (username) {
          q += " WHERE username = $1";
          qParams.push(username);
        }
        q += ` ORDER BY "creationsCount" DESC, created_at DESC`;
        const pRes = await safeQuery(q, qParams);
        projectsRows = pRes.rows;
      } else {
        // Date-filtered metrics using creation event logs
        let q = `
          SELECT 
            img.id,
            img.username,
            img.name,
            img.is_locked as "isLocked",
            img.created_at as "createdAt",
            COUNT(c.id) FILTER (WHERE c.type = 'copy') as "copiesCount",
            COUNT(c.id) FILTER (WHERE c.type = 'download') as "downloadsCount",
            COUNT(c.id) FILTER (WHERE c.type = 'share') as "sharesCount",
            COUNT(c.id) as "creationsCount"
          FROM font_app_images img
          LEFT JOIN font_app_image_creations c 
            ON c.image_id = img.id 
            AND c.created_at >= $1 
            AND c.created_at <= $2
        `;
        const qParams: any[] = [start.toISOString(), end.toISOString()];
        if (username) {
          q += " WHERE img.username = $3";
          qParams.push(username);
        }
        q += `
          GROUP BY img.id, img.username, img.name, img.is_locked, img.created_at
          ORDER BY "creationsCount" DESC, img.created_at DESC
        `;
        const pRes = await safeQuery(q, qParams);
        projectsRows = pRes.rows;
      }

      // Group projects by user
      const projectsByUser = new Map<string, any[]>();
      for (const row of projectsRows) {
        const u = row.username;
        if (!projectsByUser.has(u)) {
          projectsByUser.set(u, []);
        }
        projectsByUser.get(u)!.push({
          id: row.id,
          name: row.name,
          imageUrl: `/api/images/${row.id}/image`,
          isLocked: !!row.isLocked,
          createdAt: row.createdAt,
          copiesCount: Number(row.copiesCount || 0),
          downloadsCount: Number(row.downloadsCount || 0),
          sharesCount: Number(row.sharesCount || 0),
          creationsCount: Number(row.creationsCount || 0)
        });
      }

      let grandTotalCreations = 0;
      let grandTotalCopies = 0;
      let grandTotalDownloads = 0;
      let grandTotalShares = 0;
      const grandTotalProjects = projectsRows.length;

      const userResults = usersRes.rows.map(userRow => {
        const uProjects = projectsByUser.get(userRow.username) || [];
        let userCreations = 0;
        let userCopies = 0;
        let userDownloads = 0;
        let userShares = 0;

        for (const p of uProjects) {
          userCreations += p.creationsCount;
          userCopies += p.copiesCount;
          userDownloads += p.downloadsCount;
          userShares += p.sharesCount;
        }

        grandTotalCreations += userCreations;
        grandTotalCopies += userCopies;
        grandTotalDownloads += userDownloads;
        grandTotalShares += userShares;

        return {
          username: userRow.username,
          role: userRow.role,
          totalCreations: userCreations,
          totalCopies: userCopies,
          totalDownloads: userDownloads,
          totalShares: userShares,
          projectCount: uProjects.length,
          projects: uProjects
        };
      });

      // Sort users by totalCreations desc, then projectCount desc
      userResults.sort((a, b) => b.totalCreations - a.totalCreations || b.projectCount - a.projectCount);

      return res.json({
        success: true,
        range,
        startDate: start ? start.toISOString() : undefined,
        endDate: end ? end.toISOString() : undefined,
        summary: {
          totalCreations: grandTotalCreations,
          totalCopies: grandTotalCopies,
          totalDownloads: grandTotalDownloads,
          totalShares: grandTotalShares,
          totalProjects: grandTotalProjects,
          totalUsers: userResults.length
        },
        users: userResults
      });
    } catch (err) {
      console.error("Error fetching admin creation metrics:", err);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  // Error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", async () => {
    await initDb();
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

console.log("Calling startServer()...");
startServer().catch(err => {
  console.error("Failed to start server:", err);
});
