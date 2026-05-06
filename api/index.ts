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
  }
});

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
        CREATE TABLE IF NOT EXISTS custom_fonts (
          name TEXT PRIMARY KEY,
          data BYTEA NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const adminCheck = await client.query("SELECT * FROM users WHERE username = 'admin'");
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
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    
    let fileToDelete = writableFiles.find(f => f.split('.').slice(0, -1).join('.') === name || f === name);
    if (fileToDelete) {
      fs.unlinkSync(path.join(WRITABLE_FONTS_DIR, fileToDelete));
      return res.json({ success: true });
    }

    fileToDelete = projectFiles.find(f => f.split('.').slice(0, -1).join('.') === name || f === name);
    if (fileToDelete) {
      try {
        fs.unlinkSync(path.join(PROJECT_FONTS_DIR, fileToDelete));
        return res.json({ success: true });
      } catch (e) {
        console.warn("Could not delete project font:", e);
      }
    }

    res.status(404).json({ success: false, message: "Font not found" });
  } catch (err) {
    console.error("Delete font error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/fonts/rename", async (req, res) => {
  try {
    const { oldName, newName } = req.body;
    const projectFiles = fs.existsSync(PROJECT_FONTS_DIR) ? fs.readdirSync(PROJECT_FONTS_DIR) : [];
    const writableFiles = fs.existsSync(WRITABLE_FONTS_DIR) ? fs.readdirSync(WRITABLE_FONTS_DIR) : [];
    
    let fileToRename = writableFiles.find(f => f.split('.').slice(0, -1).join('.') === oldName || f === oldName);
    if (fileToRename) {
      const ext = path.extname(fileToRename);
      const timestamp = fileToRename.split('-')[0];
      const newFileName = `${timestamp}-${newName}${ext}`;
      fs.renameSync(path.join(WRITABLE_FONTS_DIR, fileToRename), path.join(WRITABLE_FONTS_DIR, newFileName));
      return res.json({ success: true });
    }

    fileToRename = projectFiles.find(f => f.split('.').slice(0, -1).join('.') === oldName || f === oldName);
    if (fileToRename) {
      const ext = path.extname(fileToRename);
      const timestamp = fileToRename.split('-')[0];
      const newFileName = `${timestamp}-${newName}${ext}`;
      try {
        fs.renameSync(path.join(PROJECT_FONTS_DIR, fileToRename), path.join(PROJECT_FONTS_DIR, newFileName));
        return res.json({ success: true });
      } catch (e) {
        console.warn("Could not rename project font:", e);
      }
    }

    res.status(404).json({ success: false, message: "Font not found" });
  } catch (err) {
    console.error("Rename font error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Images Metadata
app.get("/api/images", async (req, res) => {
  try {
    const { username } = req.query;
    
    if (HAS_POSTGRES) {
      await initDb();
      let query = "SELECT id, username, image_url as \"imageUrl\", layers, name, is_locked as \"isLocked\", created_at as \"createdAt\" FROM font_app_images";
      const params = [];
      
      if (username) {
        query += " WHERE username = $1";
        params.push(username);
      }
      
      const result = await pool.query(query, params);
      return res.json(result.rows);
    } else {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      const userImages = username 
        ? data.images.filter((img: any) => img.username === username)
        : data.images;
      res.json(userImages);
    }
  } catch (err) {
    console.error("Fetch images error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/images", async (req, res) => {
  try {
    const project = req.body; 
    
    if (HAS_POSTGRES) {
      await initDb();
      await pool.query(
        `INSERT INTO font_app_images (id, username, image_url, layers, name, is_locked)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         image_url = EXCLUDED.image_url,
         layers = EXCLUDED.layers,
         name = EXCLUDED.name,
         is_locked = EXCLUDED.is_locked`,
        [project.id, project.username, project.imageUrl, JSON.stringify(project.layers), project.name, !!project.isLocked]
      );
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
    res.json({ success: true });
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
    res.json({ success: true });
  } catch (err) {
    console.error("Delete image error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.use("/api", (req, res, next) => {
  res.status(404).json({ success: false, message: `API endpoint not found: ${req.method} ${req.url}` });
});

export default app;
