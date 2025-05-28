const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

// Import the refresh helper
const { getNewAccessToken } = require("./refresh-token");

const app = express();

// Wir erlauben nur das eine File-Feld namens "file"
const upload = multer();
const uploadFields = upload.fields([{ name: "file", maxCount: 1 }]);

// Read configuration exclusively from environment variables
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
if (!N8N_WEBHOOK_URL) throw new Error("Missing env var N8N_WEBHOOK_URL");

const SECURE_TOKEN = process.env.SECURE_TOKEN;
if (!SECURE_TOKEN) throw new Error("Missing env var SECURE_TOKEN");

const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
if (!DROPBOX_REFRESH_TOKEN) throw new Error("Missing env var DROPBOX_REFRESH_TOKEN");

const DROPBOX_CLIENT_ID = process.env.DROPBOX_CLIENT_ID;
if (!DROPBOX_CLIENT_ID) throw new Error("Missing env var DROPBOX_CLIENT_ID");

const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET;
if (!DROPBOX_CLIENT_SECRET) throw new Error("Missing env var DROPBOX_CLIENT_SECRET");

const CURSOR_FILE = path.join(__dirname, "cursor.json");

app.use(express.json());

function loadCursor() {
  if (fs.existsSync(CURSOR_FILE)) {
    const raw = fs.readFileSync(CURSOR_FILE, "utf-8");
    return JSON.parse(raw).cursor;
  }
  return null;
}

function saveCursor(cursor) {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor }), "utf-8");
}

async function fetchDeltaAndNotify() {
  const accessToken = await getNewAccessToken({
    refresh_token: DROPBOX_REFRESH_TOKEN,
    client_id: DROPBOX_CLIENT_ID,
    client_secret: DROPBOX_CLIENT_SECRET
  });

  const cursor = loadCursor();
  const endpoint = cursor
    ? "https://api.dropboxapi.com/2/files/list_folder/continue"
    : "https://api.dropboxapi.com/2/files/list_folder";

  const body = cursor
    ? { cursor }
    : { path: "/Rechnungen", recursive: true, include_media_info: false, include_deleted: false };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  console.log("🔍 Dropbox API Antwort:", JSON.stringify(data, null, 2));

  if (data?.cursor) {
    saveCursor(data.cursor);
  }

  let sentCount = 0;
  if (Array.isArray(data.entries)) {
    for (const entry of data.entries) {
      if (entry[".tag"] === "file" && entry.path_display) {
        console.log("📤 Sende Datei:", entry.path_display);
        await fetch(N8N_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: { path: entry.path_display, dropbox_type: entry[".tag"] }, raw: entry })
        });
        sentCount++;
      }
    }
  }
  return sentCount;
}

app.all("/", uploadFields, async (req, res, next) => {
  try {
    const action = req.query.action;
    const token  = req.query.token;

    if (token !== SECURE_TOKEN) {
      return res.status(403).send("Zugriff verweigert – ungültiger Token");
    }

    if (req.method === "GET" && (action === "challenge" || action === "webhook")) {
      return res.status(200).send(req.query.challenge || "No challenge provided");
    }

    if (req.method === "POST" && action === "webhook") {
      // Hier greifen wir auf die hochgeladene Datei zu:
      const files = req.files?.file;
      if (!files || files.length === 0) {
        throw new Error("Datei fehlt im Feld 'file'");
      }
      const uploadedFile = files[0];
      console.log("📝 Empfangen:", uploadedFile.originalname, uploadedFile.mimetype, uploadedFile.size);

      // TODO: Datei an deinen Parser senden (via fetch mit multipart/form-data)

      // Anschließend weiter mit dem Delta-Polling
      const count = await fetchDeltaAndNotify();
      return res.status(200).send(`Webhook verarbeitet: ${count} Dateien`);
    }

    res.status(400).send("Ungültige Anfrage");
  } catch (err) {
    next(err);
  }
});

app.get("/fetch-delta", async (req, res, next) => {
  try {
    const count = await fetchDeltaAndNotify();
    return res.status(200).json({ sent: count });
  } catch (err) {
    next(err);
  }
});

// ─────────────── Globaler Error‐Handler ───────────────
app.use((err, req, res, next) => {
  console.error("🔥 Uncaught error in parser:", err.stack || err);
  res.status(500).send("Internal Server Error");
});
// ────────────────────────────────────────────────────────

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Sicherer Webhook + Parser Service läuft");
});
