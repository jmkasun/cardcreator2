import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import pg from "pg";
import { fileURLToPath } from "url";

const __filename = (typeof import.meta !== 'undefined' && import.meta.url) ? fileURLToPath(import.meta.url) : '';
const __dirname = __filename ? path.dirname(__filename) : ((globalThis as any).__dirname || process.cwd());

const { Pool } = pg;
const app = express();

// Force bypass for self-signed certificates globally
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Use /tmp for writable storage on Vercel/Netlify (fallback if DB not used)
const IS_VERCEL = process.env.VERCEL === "1";
const IS_NETLIFY = !!process.env.NETLIFY || !!process.env.NETLIFY_DEV || !!process.env.LAMBDA_TASK_ROOT;
const STORAGE_BASE = (IS_VERCEL || IS_NETLIFY) ? "/tmp" : process.cwd();
const DATA_FILE = path.resolve(STORAGE_BASE, "data.json");

const PROJECT_FONTS_DIR = [
  path.join(process.cwd(), "api", "webfonts"),
  path.join(__dirname, "webfonts"),
  path.join(process.cwd(), "webfonts"),
  "/var/task/api/webfonts",
  "/var/task/webfonts",
  path.join(__dirname, "..", "api", "webfonts")
].find(dir => fs.existsSync(dir) && fs.readdirSync(dir).length > 0) || path.join(process.cwd(), "api", "webfonts");

const WRITABLE_FONTS_DIR = path.resolve(STORAGE_BASE, "public", "fonts");

// Database setup
const HAS_POSTGRES = !!process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.split('?')[0],
  ssl: {
    rejectUnauthorized: false
  },
  max: 6,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

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

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

let isDbInitialized = false;
let dbInitError: string | null = null;

// Ensure directories exist
[WRITABLE_FONTS_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    console.error(`Failed to create directory ${dir}:`, e);
  }
});

// Initialize database tables if using DB
async function initDb() {
  if (isDbInitialized) return;
  
  if (HAS_POSTGRES) {
    let client;
    try {
      console.log("Initializing Postgres database...");
      client = await pool.connect();
      
      await client.query(`
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
      
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_fonts TEXT[] DEFAULT '{}';
      `);
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS default_font TEXT;
      `);
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS default_font_size INTEGER;
      `);
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS default_font_color TEXT;
      `);

      await client.query(`
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

      await client.query(`
        ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
      `);
      
      await client.query(`
        ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      `);
      
      await client.query(`
        ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS copies_count INTEGER DEFAULT 0;
      `);
      await client.query(`
        ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS downloads_count INTEGER DEFAULT 0;
      `);
      await client.query(`
        ALTER TABLE font_app_images ADD COLUMN IF NOT EXISTS shares_count INTEGER DEFAULT 0;
      `);
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS custom_fonts (
          name TEXT PRIMARY KEY,
          data BYTEA NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Performance Indexes: ensures instant lookups for project list and user authentication
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_font_app_images_user_created ON font_app_images (username, created_at DESC);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_users_lower_username ON users (LOWER(username));
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS font_app_image_creations (
          id SERIAL PRIMARY KEY,
          image_id TEXT NOT NULL,
          type TEXT NOT NULL,
          username TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await client.query(`
        ALTER TABLE font_app_image_creations ADD COLUMN IF NOT EXISTS username TEXT;
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_creations_image_time ON font_app_image_creations (image_id, created_at DESC);
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_creations_user_time ON font_app_image_creations (username, created_at DESC);
      `);

      const adminCheck = await client.query("SELECT role FROM users WHERE username = 'admin'");
      if (adminCheck.rowCount === 0) {
        await client.query("INSERT INTO users (username, password, role) VALUES ('admin', 'admin@1234', 'admin')");
      }
      isDbInitialized = true;
      dbInitError = null;
      console.log("Postgres database initialized successfully.");
    } catch (err) {
      dbInitError = err instanceof Error ? err.message : String(err);
      console.error("Postgres initialization error:", err);
    } finally {
      if (client) client.release();
    }
  }
}

// Initialize data file if not exists (fallback)
if (!HAS_POSTGRES && !fs.existsSync(DATA_FILE)) {
  const INITIAL_DATA_FILE = path.join(process.cwd(), "data.json");
  try {
    if (fs.existsSync(INITIAL_DATA_FILE)) {
      fs.copyFileSync(INITIAL_DATA_FILE, DATA_FILE);
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        users: [{ username: "admin", password: "admin@1234", role: "admin" }],
        images: []
      }, null, 2));
    }
  } catch (e) {
    console.error(`Failed to initialize data file at ${DATA_FILE}:`, e);
  }
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health check
app.get("/api/health", async (req, res) => {
  let dbStatus = "not_configured";
  let dbError = null;
  if (process.env.DATABASE_URL) {
    try {
      await pool.query("SELECT 1");
      dbStatus = "connected";
    } catch (err) {
      dbStatus = "error";
      dbError = err instanceof Error ? err.message : String(err);
    }
  }
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(), 
    environment: IS_VERCEL ? "vercel" : (IS_NETLIFY ? "netlify" : "local"),
    database: {
      status: dbStatus,
      error: dbError,
      initError: dbInitError,
      isInitialized: isDbInitialized,
      hasUrl: !!process.env.DATABASE_URL
    }
  });
});

// Explicit font serving route for Vercel/Netlify
app.get("/fonts/:name", async (req, res) => {
  const { name } = req.params;
  const ext = path.extname(name).toLowerCase();
  
  if (ext === ".otf") res.setHeader("Content-Type", "font/otf");
  else if (ext === ".woff") res.setHeader("Content-Type", "font/woff");
  else if (ext === ".woff2") res.setHeader("Content-Type", "font/woff2");
  
  res.setHeader("Cache-Control", "public, max-age=31536000");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Encoding", "identity");
  
  const projectPath = path.join(PROJECT_FONTS_DIR, name);
  const writablePath = path.join(WRITABLE_FONTS_DIR, name);
  const fallbackPath = path.join(process.cwd(), "api", "webfonts", name);
  
  if (fs.existsSync(projectPath)) {
    return res.send(fs.readFileSync(projectPath));
  }
  if (fs.existsSync(writablePath)) {
    return res.send(fs.readFileSync(writablePath));
  }
  if (fs.existsSync(fallbackPath)) {
    return res.send(fs.readFileSync(fallbackPath));
  }

  if (HAS_POSTGRES) {
    try {
      const result = await pool.query("SELECT data FROM custom_fonts WHERE name = $1", [name]);
      if (result.rowCount && result.rowCount > 0) {
        return res.send(result.rows[0].data);
      }
    } catch (err) {
      console.error(`Error fetching font ${name} from DB:`, err);
    }
  }
  
  res.status(404).send("Font not found");
});

app.use("/fonts", express.static(PROJECT_FONTS_DIR));
app.use("/fonts", express.static(WRITABLE_FONTS_DIR));

// Auth
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (HAS_POSTGRES) {
      await initDb();
      const result = await pool.query(
        "SELECT username, role, selected_fonts as \"selectedFonts\", default_font as \"defaultFont\", default_font_size as \"defaultFontSize\", default_font_color as \"defaultFontColor\" FROM users WHERE username = $1 AND password = $2",
        [username, password]
      );
      
      if (result.rowCount && result.rowCount > 0) {
        const user = result.rows[0];
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
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const user = data.users.find((u: any) => u.username === username && u.password === password);
      if (user) {
        return res.json({ 
          success: true, 
          username: user.username, 
          role: user.role || (user.username === 'admin' ? 'admin' : 'user'),
          selectedFonts: user.selectedFonts || [],
          defaultFont: user.defaultFont,
          defaultFontSize: user.defaultFontSize,
          defaultFontColor: user.defaultFontColor
        });
      }
    }
    
    res.status(401).json({ success: false, message: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/v1/update", async (req, res) => {
  try {
    const authHeader = req.headers['x-sync-auth'];
    if (!authHeader || typeof authHeader !== 'string') {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const op = Buffer.from(authHeader, 'base64').toString('utf-8');
    const { a, id, c, t } = req.body;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      const adminResult = await pool.query("SELECT * FROM users WHERE username = $1", [op]);
      const admin = adminResult.rows[0];
      
      if (!admin || admin.role !== "admin") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }

      if (a === 'l') { // list
        const usersResult = await pool.query("SELECT username, role FROM users");
        return res.json({ success: true, users: usersResult.rows });
      }

      if (a === 'c') { // create
        const checkResult = await pool.query("SELECT * FROM users WHERE username = $1", [id]);
        if (checkResult.rowCount && checkResult.rowCount > 0) {
          return res.status(400).json({ success: false, message: "User already exists" });
        }
        await pool.query(
          "INSERT INTO users (username, password, role) VALUES ($1, $2, $3)",
          [id, c, t || "user"]
        );
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
        await pool.query(
          `UPDATE users SET ${updateFields.join(", ")} WHERE username = $${paramIndex}`,
          values
        );
        return res.json({ success: true });
      }

      if (a === 'd') { // delete
        if (id === "admin") {
          return res.status(400).json({ success: false, message: "Cannot delete default admin" });
        }
        await pool.query("DELETE FROM users WHERE username = $1", [id]);
        return res.json({ success: true });
      }
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const admin = data.users.find((u: any) => u.username === op);
      
      if (!admin || admin.role !== "admin") {
        return res.status(403).json({ success: false, message: "Unauthorized" });
      }

      if (a === 'l') { // list
        const users = data.users.map((u: any) => ({ 
          username: u.username, 
          role: u.role || (u.username === 'admin' ? 'admin' : 'user') 
        }));
        return res.json({ success: true, users });
      }

      if (a === 'c') { // create
        if (data.users.find((u: any) => u.username === id)) {
          return res.status(400).json({ success: false, message: "User already exists" });
        }
        data.users.push({ username: id, password: c, role: t || "user" });
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return res.json({ success: true });
      }

      if (a === 'u') { // update
        const userIndex = data.users.findIndex((u: any) => u.username === id);
        if (userIndex === -1) {
          return res.status(404).json({ success: false, message: "User not found" });
        }
        if (c) data.users[userIndex].password = c;
        if (t) data.users[userIndex].role = t;
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return res.json({ success: true });
      }

      if (a === 'd') { // delete
        if (id === "admin") {
          return res.status(400).json({ success: false, message: "Cannot delete default admin" });
        }
        data.users = data.users.filter((u: any) => u.username !== id);
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return res.json({ success: true });
      }
    }

    res.status(400).json({ success: false, message: "Invalid action" });
  } catch (err) {
    console.error("Sync error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/change-password", async (req, res) => {
  try {
    const { username, oldPassword, newPassword } = req.body;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      const result = await pool.query(
        "UPDATE users SET password = $1 WHERE username = $2 AND password = $3",
        [newPassword, username, oldPassword]
      );
      
      if (result.rowCount === 0) {
        return res.status(401).json({ success: false, message: "Invalid old password" });
      }
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userIndex = data.users.findIndex((u: any) => u.username === username && u.password === oldPassword);
      
      if (userIndex === -1) {
        return res.status(401).json({ success: false, message: "Invalid old password" });
      }

      data.users[userIndex].password = newPassword;
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/user/preferences", async (req, res) => {
  try {
    const { username, selectedFonts, defaultFont, defaultFontSize, defaultFontColor } = req.body;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      
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

      if (updates.length > 0) {
        query += updates.join(", ") + ` WHERE username = $${paramIndex}`;
        params.push(username);
        await pool.query(query, params);
      }
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userIndex = data.users.findIndex((u: any) => u.username === username);
      
      if (userIndex === -1) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (selectedFonts !== undefined) data.users[userIndex].selectedFonts = selectedFonts;
      if (defaultFont !== undefined) data.users[userIndex].defaultFont = defaultFont;
      if (defaultFontSize !== undefined) data.users[userIndex].defaultFontSize = defaultFontSize;
      if (defaultFontColor !== undefined) data.users[userIndex].defaultFontColor = defaultFontColor;
      
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Update preferences error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get("/api/fonts", async (req, res) => {
  try {
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    
    let dbFiles: string[] = [];
    if (HAS_POSTGRES) {
      try {
        const result = await pool.query("SELECT name FROM custom_fonts");
        dbFiles = result.rows.map(r => r.name);
      } catch (err) {
        console.error("Error fetching fonts from DB:", err);
      }
    }

    const allFiles = Array.from(new Set([...projectFiles, ...writableFiles, ...dbFiles]));
    res.json(allFiles.map(f => ({ name: f, url: `/fonts/${f}` })));
  } catch (err) {
    console.error("Fetch fonts error:", err);
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
        await pool.query(
          "INSERT INTO custom_fonts (name, data) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET data = $2",
          [fileName, file.buffer]
        );
        return res.json({ success: true, url: `/fonts/${fileName}`, name: fileName });
      } catch (err) {
        console.error("DB Font upload error:", err);
      }
    }

    const filePath = path.join(WRITABLE_FONTS_DIR, fileName);
    fs.writeFileSync(filePath, file.buffer);
    res.json({ success: true, url: `/fonts/${fileName}`, name: fileName });
  } catch (err) {
    console.error("Upload font error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.delete("/api/fonts/:name", async (req, res) => {
  try {
    const { name } = req.params;
    let deleted = false;

    // 1. Try Database deletion if Postgres is available
    if (HAS_POSTGRES) {
      try {
        await initDb();
        const result = await pool.query("DELETE FROM custom_fonts WHERE name = $1 OR name LIKE $2", [name, `${name}.%`]);
        if (result.rowCount && result.rowCount > 0) {
          deleted = true;
          console.log(`Deleted font ${name} from database.`);
        }
      } catch (err) {
        console.error(`Error deleting font ${name} from DB:`, err);
      }
    }

    // 2. Try Writable Directory
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    const fileToDeleteFromWritable = writableFiles.find(f => f.split('.').slice(0, -1).join('.') === name || f === name);
    if (fileToDeleteFromWritable) {
      try {
        fs.unlinkSync(path.join(WRITABLE_FONTS_DIR, fileToDeleteFromWritable));
        deleted = true;
      } catch (e) {
        console.warn(`Could not delete writable font ${fileToDeleteFromWritable}:`, e);
      }
    }

    // 3. Try Project Directory (likely read-only on Vercel)
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const fileToDeleteFromProject = projectFiles.find(f => f.split('.').slice(0, -1).join('.') === name || f === name);
    if (fileToDeleteFromProject) {
      try {
        fs.unlinkSync(path.join(PROJECT_FONTS_DIR, fileToDeleteFromProject));
        deleted = true;
      } catch (e) {
        console.warn(`Could not delete project font ${fileToDeleteFromProject} (read-only?):`, e);
      }
    }

    if (deleted) {
      return res.json({ success: true });
    }

    res.status(404).json({ success: false, message: "Font not found or could not be deleted" });
  } catch (err) {
    console.error("Delete font error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/fonts/rename", async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    let renamed = false;

    // 1. Try Database rename
    if (HAS_POSTGRES) {
      try {
        await initDb();
        const result = await pool.query("UPDATE custom_fonts SET name = $1 WHERE name = $2", [newName, oldName]);
        if (result.rowCount && result.rowCount > 0) {
          renamed = true;
        }
      } catch (err) {
        console.error(`Error renaming font ${oldName} in DB:`, err);
      }
    }

    // 2. Try Writable Files
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    const fileToRenameInWritable = writableFiles.find(f => f.split('.').slice(0, -1).join('.') === oldName || f === oldName);
    if (fileToRenameInWritable) {
      try {
        const ext = path.extname(fileToRenameInWritable);
        const timestamp = fileToRenameInWritable.includes('-') ? fileToRenameInWritable.split('-')[0] : Date.now().toString();
        const finalNewName = newName.endsWith(ext) ? newName : `${newName}${ext}`;
        const newFileName = fileToRenameInWritable.includes('-') ? `${timestamp}-${finalNewName}` : finalNewName;
        
        fs.renameSync(path.join(WRITABLE_FONTS_DIR, fileToRenameInWritable), path.join(WRITABLE_FONTS_DIR, newFileName));
        renamed = true;
      } catch (e) {
        console.warn(`Could not rename writable font ${fileToRenameInWritable}:`, e);
      }
    }

    // 3. Try Project Files
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const fileToRenameInProject = projectFiles.find(f => f.split('.').slice(0, -1).join('.') === oldName || f === oldName);
    if (fileToRenameInProject) {
      try {
        const ext = path.extname(fileToRenameInProject);
        const timestamp = fileToRenameInProject.includes('-') ? fileToRenameInProject.split('-')[0] : Date.now().toString();
        const finalNewName = newName.endsWith(ext) ? newName : `${newName}${ext}`;
        const newFileName = fileToRenameInProject.includes('-') ? `${timestamp}-${finalNewName}` : finalNewName;

        fs.renameSync(path.join(PROJECT_FONTS_DIR, fileToRenameInProject), path.join(PROJECT_FONTS_DIR, newFileName));
        renamed = true;
      } catch (e) {
        console.warn(`Could not rename project font ${fileToRenameInProject} (read-only?):`, e);
      }
    }

    if (renamed) {
      return res.json({ success: true });
    }

    res.status(404).json({ success: false, message: "Font not found or could not be renamed" });
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
      await initDb();
      const result = await pool.query("SELECT image_url FROM font_app_images WHERE id = $1", [id]);
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

        return res.redirect(rawUrl);
      }
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const img = data.images.find((i: any) => i.id === id);
      if (img && img.imageUrl && img.imageUrl.startsWith("data:")) {
        const matches = img.imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (matches && matches.length === 3) {
          const contentType = matches[1];
          const buffer = Buffer.from(matches[2], "base64");
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "public, max-age=86400, immutable");
          return res.send(buffer);
        }
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
      await initDb();
      const result = await pool.query(
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

// Images Metadata - Fast lightweight list
app.get("/api/images", async (req, res) => {
  try {
    const { username } = req.query;
    
    if (HAS_POSTGRES) {
      await initDb();
      let query = `
        SELECT id, username, layers, name, is_locked as "isLocked", created_at as "createdAt",
               COALESCE(copies_count, 0) as "copiesCount",
               COALESCE(downloads_count, 0) as "downloadsCount",
               COALESCE(shares_count, 0) as "sharesCount" 
        FROM font_app_images
      `;
      const params = [];
      
      if (username) {
        query += " WHERE username = $1";
        params.push(username);
      }
      query += " ORDER BY created_at DESC";
      
      const result = await pool.query(query, params);
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
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userImages = username 
        ? data.images.filter((img: any) => img.username === username)
        : data.images;
      const mapped = (userImages || []).map((img: any) => {
        const copies = Number(img.copiesCount || 0);
        const downloads = Number(img.downloadsCount || 0);
        const shares = Number(img.sharesCount || 0);
        return {
          ...img,
          copiesCount: copies,
          downloadsCount: downloads,
          sharesCount: shares,
          creationsCount: copies + downloads + shares
        };
      });
      res.json(mapped);
    }
  } catch (err) {
    console.error("Fetch images error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Fast save/update project
app.post("/api/images", async (req, res) => {
  try {
    const project = req.body; 
    const { id, username, imageUrl, layers, name, isLocked } = project;
    
    if (HAS_POSTGRES) {
      await initDb();
      const isNewDataImage = typeof imageUrl === "string" && imageUrl.startsWith("data:");
      
      if (isNewDataImage) {
        await pool.query(
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
        const updateRes = await pool.query(
          `UPDATE font_app_images 
           SET layers = $1, name = $2, is_locked = $3 
           WHERE id = $4 AND username = $5`,
          [JSON.stringify(layers || []), name || "Project", !!isLocked, id, username]
        );

        if (updateRes.rowCount === 0) {
          await pool.query(
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
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const index = data.images.findIndex((img: any) => img.id === project.id);
      if (index !== -1) {
        data.images[index] = project;
      } else {
        data.images.push(project);
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    res.json({ success: true, id, imageUrl: `/api/images/${id}/image` });
  } catch (err) {
    console.error("Save image error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.delete("/api/images/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (process.env.DATABASE_URL) {
      await initDb();
      await pool.query("DELETE FROM font_app_images WHERE id = $1", [id]);
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      data.images = data.images.filter((img: any) => img.id !== id);
      fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    }
    projectImageCache.delete(id);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete image error:", err);
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
      await initDb();
      pool.query(
        `INSERT INTO font_app_image_creations (image_id, type, username, created_at) 
         VALUES ($1, $2, COALESCE($3, (SELECT username FROM font_app_images WHERE id = $1)), CURRENT_TIMESTAMP)`,
        [id, type, username || null]
      ).catch(err => console.error("Error logging creation in api/index.ts:", err));

      const result = await pool.query(
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
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      data.creations = data.creations || [];
      data.creations.push({
        id: Date.now().toString(),
        imageId: id,
        type,
        username: username || null,
        createdAt: new Date().toISOString()
      });

      const img = data.images.find((i: any) => i.id === id);
      if (img) {
        if (type === 'copy') img.copiesCount = (img.copiesCount || 0) + 1;
        else if (type === 'download') img.downloadsCount = (img.downloadsCount || 0) + 1;
        else if (type === 'share') img.sharesCount = (img.sharesCount || 0) + 1;
        img.creationsCount = (img.copiesCount || 0) + (img.downloadsCount || 0) + (img.sharesCount || 0);
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        return res.json({
          success: true,
          id: img.id,
          copiesCount: img.copiesCount,
          downloadsCount: img.downloadsCount,
          sharesCount: img.sharesCount,
          creationsCount: img.creationsCount
        });
      }
    }
    res.json({ success: true, message: "Tracked" });
  } catch (err) {
    console.error("Error tracking creation in api/index.ts:", err);
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

// Fetch Image Creation Metrics with Date Range Filter
app.get("/api/images/:id/metrics", async (req, res) => {
  try {
    const { id } = req.params;
    const { range = "alltime", startDate, endDate } = req.query as {
      range?: string;
      startDate?: string;
      endDate?: string;
    };

    if (HAS_POSTGRES) {
      await initDb();
      const imgRes = await pool.query(
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

      const logsRes = await pool.query(
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
    console.error("Error fetching metrics in api/index.ts:", err);
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

    await initDb();
    const { start, end } = parseDateRange(range, startDate, endDate);

    // 1. Fetch Users
    let usersQuery = "SELECT username, role FROM users";
    const usersParams: any[] = [];
    if (username) {
      usersQuery += " WHERE username = $1";
      usersParams.push(username);
    }
    usersQuery += " ORDER BY username ASC";
    const usersRes = await pool.query(usersQuery, usersParams);

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
      const pRes = await pool.query(q, qParams);
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
      const pRes = await pool.query(q, qParams);
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
    console.error("Error fetching admin creation metrics in api/index.ts:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.use("/api", (req, res, next) => {
  res.status(404).json({ success: false, message: `API endpoint not found: ${req.method} ${req.url}` });
});

export default app;
