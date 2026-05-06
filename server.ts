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

const FONTS_DIR = [
  path.join(process.cwd(), "api", "webfonts"),
  path.join(process.cwd(), "public", "fonts"),
  path.join(process.cwd(), "font")
].find(dir => fs.existsSync(dir) && fs.readdirSync(dir).length > 0) || path.join(process.cwd(), "public", "fonts");
const WRITABLE_FONTS_DIR = path.join(process.cwd(), "public", "fonts");

// Ensure directories exist
[FONTS_DIR, WRITABLE_FONTS_DIR].forEach(dir => {
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
  max: 3, 
  idleTimeoutMillis: 20000, // Increased to 20s to keep connections alive slightly longer
  connectionTimeoutMillis: 20000, // Increased to 20s to allow more time for connection establishment
});

// Helper for self-contained queries with retry logic on connection errors
async function safeQuery(text: string, params: any[] = [], retriesValue = 3): Promise<pg.QueryResult<any>> {
  for (let i = 0; i <= retriesValue; i++) {
    try {
      return await pool.query(text, params);
    } catch (err: any) {
      const errMsg = err.message?.toLowerCase() || '';
      const isConnError = errMsg.includes('connection slots') || 
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

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

if (!process.env.DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set. Database operations will fail.");
} else {
  console.log("DATABASE_URL is set. Length:", process.env.DATABASE_URL.length);
}

async function initDb() {
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
        CREATE TABLE IF NOT EXISTS custom_fonts (
          name TEXT PRIMARY KEY,
          data BYTEA NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const adminCheck = await safeQuery("SELECT * FROM users WHERE username = 'admin'");
      if (adminCheck.rowCount === 0) {
        await safeQuery("INSERT INTO users (username, password, role) VALUES ('admin', 'admin@1234', 'admin')");
        console.log("Default admin user created.");
      }
      console.log("Database initialized successfully.");
    } catch (err) {
      console.error("Postgres initialization error:", err);
    }
  }
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
const fontCache = new Map<string, Buffer>();

// Explicit font serving route
app.get("/fonts/:name", async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    
    // Check cache first
    if (fontCache.has(name)) {
      console.log(`[Font Service] Serving from memory cache: ${name}`);
      const cachedBuffer = fontCache.get(name)!;
      return res.send(cachedBuffer);
    }

    console.log(`[Font Service] Request for font: ${name}`);
      const ext = path.extname(name).toLowerCase();
      
      // Set correct MIME type
      if (ext === ".otf") res.setHeader("Content-Type", "font/otf");
      else if (ext === ".woff") res.setHeader("Content-Type", "font/woff");
      else if (ext === ".woff2") res.setHeader("Content-Type", "font/woff2");
      else res.setHeader("Content-Type", "application/octet-stream");
      
      res.setHeader("Cache-Control", "public, max-age=31536000");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Encoding", "identity");
      
      const projectPath = path.join(FONTS_DIR, name);
      const writablePath = path.join(WRITABLE_FONTS_DIR, name);
      
      if (fs.existsSync(projectPath)) {
        console.log(`[Font Service] Serving from project path: ${projectPath}`);
        const buffer = fs.readFileSync(projectPath);
        return res.send(buffer);
      }
      if (fs.existsSync(writablePath)) {
        console.log(`[Font Service] Serving from writable path: ${writablePath}`);
        const buffer = fs.readFileSync(writablePath);
        return res.send(buffer);
      }

      // Try database if not found in files
      if (HAS_POSTGRES) {
        console.log(`[Font Service] Searching DB for font: ${name}`);
        try {
          const result = await safeQuery("SELECT data FROM custom_fonts WHERE name = $1", [name]);
          if (result.rowCount && result.rowCount > 0) {
            const fontData = result.rows[0].data;
            console.log(`[Font Service] Serving from database: ${name} (${fontData.length} bytes)`);
            fontCache.set(name, fontData);
            return res.send(fontData);
          } else {
            console.warn(`[Font Service] Font not found in DB with exact name: ${name}`);
            // Try broader search: case-insensitive and replacing underscores with spaces or vice versa
            const fuzzyResult = await safeQuery(
              "SELECT data, name FROM custom_fonts WHERE name ILIKE $1 OR REPLACE(name, ' ', '_') ILIKE $1 OR name ILIKE REPLACE($1, '_', ' ') OR name ILIKE REPLACE($1, '_', '%')", 
              [name]
            );
            if (fuzzyResult.rowCount && fuzzyResult.rowCount > 0) {
              const fuzzyFontData = fuzzyResult.rows[0].data;
              console.log(`[Font Service] Serving from database (fuzzy match): ${fuzzyResult.rows[0].name}`);
              fontCache.set(name, fuzzyFontData);
              return res.send(fuzzyFontData);
            }
          }
        } catch (err) {
          console.error(`[Font Service] Error fetching font ${name} from DB:`, err);
        }
      }
      
      if (name !== "apex_apura_044.woff" && name !== "apex_apura_044") {
        console.error(`[Font Service] Font not found: ${name}. Checked: ${projectPath}, ${writablePath}, DB`);
      }
      res.status(404).send("Font not found");
    } catch (err) {
      console.error(`[Font Service] Error serving font:`, err);
      res.status(500).send("Internal server error");
    }
  });

  app.use("/fonts", express.static(FONTS_DIR));
  app.use("/fonts", express.static(WRITABLE_FONTS_DIR));

  // Auth
  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      console.log(`Login attempt for user: ${username}`);
      
      if (HAS_POSTGRES) {
        const result = await safeQuery(
          "SELECT username, role, selected_fonts as \"selectedFonts\", default_font as \"defaultFont\", default_font_size as \"defaultFontSize\", default_font_color as \"defaultFontColor\" FROM users WHERE username = $1 AND password = $2",
          [username, password]
        );
        
        if (result.rowCount && result.rowCount > 0) {
          const user = result.rows[0];
          console.log(`Login successful for user: ${username}`);
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
      }
      
      console.log(`Login failed for user: ${username} - Invalid credentials`);
      res.status(401).json({ success: false, message: "Invalid credentials" });
    } catch (err) {
      console.error("Login error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/v1/update", async (req, res) => {
    try {
      const authHeader = req.headers['x-sync-auth'];
      if (!authHeader || typeof authHeader !== 'string') {
        console.error("Missing x-sync-auth header");
        return res.status(403).json({ success: false, message: "Unauthorized: Missing auth header" });
      }

      const op = Buffer.from(authHeader, 'base64').toString('utf-8');
      const { a, id, c, t } = req.body;
      
      console.log(`Sync operation: op=${op}, action=${a}, target=${id}`);

      const adminResult = await safeQuery("SELECT * FROM users WHERE username = $1", [op]);
      const admin = adminResult.rows[0];
      
      if (!admin || admin.role !== "admin") {
        console.error(`Unauthorized access attempt by ${op}`);
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

  // Fonts
  app.get("/api/fonts", async (req, res) => {
    try {
      const projectFiles = fs.existsSync(FONTS_DIR) ? fs.readdirSync(FONTS_DIR) : [];
      const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
      
      let dbFiles: string[] = [];
      if (HAS_POSTGRES) {
        try {
          const result = await safeQuery("SELECT name FROM custom_fonts");
          dbFiles = result.rows.map(r => r.name);
        } catch (err) {
          console.error("Error fetching fonts from DB:", err);
        }
      }

      const projectFonts = projectFiles.map(f => ({ name: f, url: `/fonts/${f}` }));
      const writableFonts = writableFiles.map(f => ({ name: f, url: `/fonts/${f}` }));
      const dbFonts = dbFiles.map(f => ({ name: f, url: `/fonts/${f}` }));

      const allFonts = [...projectFonts, ...writableFonts, ...dbFonts];
      const uniqueFonts = Array.from(new Map(allFonts.map(f => [f.name, f])).values());
      res.json(uniqueFonts);
    } catch (err) {
      console.error("Fetch fonts error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/upload-font", upload.single("font"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ success: false, message: "No file uploaded" });

      const sanitized = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
      const fileName = sanitized;

      if (HAS_POSTGRES) {
        try {
          await safeQuery(
            "INSERT INTO custom_fonts (name, data) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET data = $2",
            [fileName, file.buffer]
          );
          return res.json({ success: true, url: `/fonts/${fileName}`, name: fileName });
        } catch (err) {
          console.error("DB Font upload error:", err);
        }
      }

      fs.writeFileSync(path.join(WRITABLE_FONTS_DIR, fileName), file.buffer);
      res.json({ success: true, url: `/fonts/${fileName}`, name: fileName });
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
      const dirsToSearch = Array.from(new Set([FONTS_DIR, WRITABLE_FONTS_DIR]));
      
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
        fontCache.delete(name);
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

      // 1. Rename in database if exists
      if (process.env.DATABASE_URL) {
        try {
          // Try both with and without extension if not provided
          const result = await safeQuery("UPDATE custom_fonts SET name = $1 WHERE name = $2", [newName, oldName]);
          if (result.rowCount && result.rowCount > 0) {
            console.log(`Renamed font in DB from ${oldName} to ${newName}`);
            renamed = true;
          }
        } catch (dbErr) {
          console.error("Error renaming font in DB:", dbErr);
        }
      }

      // 2. Rename in file system
      const dirsToSearch = Array.from(new Set([FONTS_DIR, WRITABLE_FONTS_DIR]));
      
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

  // Images Metadata
  app.get("/api/images", async (req, res) => {
    try {
      const { username } = req.query;
      
      if (!username) {
        return res.json([]);
      }

      if (HAS_POSTGRES) {
        const query = "SELECT id, username, image_url as \"imageUrl\", layers, name, is_locked as \"isLocked\", created_at as \"createdAt\" FROM font_app_images WHERE username = $1";
        const result = await safeQuery(query, [username]);
        return res.json(result.rows);
      }
      res.json([]);
    } catch (err) {
      console.error("Fetch images error details:", err instanceof Error ? err.message : String(err));
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/api/images", async (req, res) => {
    try {
      const { id, username, imageUrl, layers, name, isLocked } = req.body;
      
      if (HAS_POSTGRES) {
        await safeQuery(
          `INSERT INTO font_app_images (id, username, image_url, layers, name, is_locked)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username,
           image_url = EXCLUDED.image_url,
           layers = EXCLUDED.layers,
           name = EXCLUDED.name,
           is_locked = EXCLUDED.is_locked`,
          [id, username, imageUrl, JSON.stringify(layers), name, !!isLocked]
        );
      }
      
      res.json({ success: true });
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
      res.json({ success: true });
    } catch (err) {
      console.error("Delete image error details:", err instanceof Error ? err.message : String(err));
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
