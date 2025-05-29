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

// ───────────── Body-Size Limits ─────────────
// Erlaube JSON-Bodies bis 50 MB (für Base64-Strings)
app.use(express.json({ limit: "50mb" }));
// Erlaube URL-encoded Bodies bis 50 MB (falls benötigt)
app.use(express.urlencoded({ limit: "50mb", extended: true }));
// ─────────────────────────────────────────────

const upload = multer();
const uploadSingleData = upload.single("data");

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
    client_secret: DROPBOX_CLIENT_SECRET,
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
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  console.log("🔍 Dropbox API Antwort:", JSON.stringify(data, null, 2));
  if (data?.cursor) saveCursor(data.cursor);

  let sentCount = 0;
  if (Array.isArray(data.entries)) {
    for (const entry of data.entries) {
      if (entry[".tag"] === "file" && entry.path_display) {
        console.log("📤 Sende Datei:", entry.path_display);
        await fetch(N8N_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: { path: entry.path_display, dropbox_type: entry[".tag"] }, raw: entry }),
        });
        sentCount++;
      }
    }
  }
  return sentCount;
}

// Haupt-Route: Webhook-Aufrufe von n8n
app.all("/", uploadSingleData, async (req, res, next) => {
  try {
    const action = req.query.action;
    const token = req.query.token;
    if (token !== SECURE_TOKEN) {
      return res.status(403).send("Zugriff verweigert – ungültiger Token");
    }

    // Challenge/GET
    if (req.method === "GET" && (action === "challenge" || action === "webhook")) {
      return res.status(200).send(req.query.challenge || "No challenge provided");
    }

    // POST Webhook mit PDF im Binary-Feld "data"
    if (req.method === "POST" && action === "webhook") {
      if (!req.file) {
        throw new Error("Kein File im Feld 'data' erhalten");
      }
      console.log("📝 Empfangenes File:", {
        name: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      // Beispiel: sende per fetch multipart/form-data an Deinen Parser
      /*
      const form = new FormData();
      form.append("file", req.file.buffer, req.file.originalname);
      const parserRes = await fetch(
        "https://file-parser-8dhp.onrender.com/?action=parse&token=DEIN_TOKEN",
        { method: "POST", body: form }
      );
      const parsed = await parserRes.json();
      console.log("Parser-Antwort:", parsed);
      */

      // Dann Dropbox-Delta-Polling
      const count = await fetchDeltaAndNotify();
      return res.status(200).send(`Webhook verarbeitet: ${count} Dateien`);
    }

    return res.status(400).send("Ungültige Anfrage");
  } catch (err) {
    next(err);
  }
});

// Manuelles Triggern der Delta-Abfrage
app.get("/fetch-delta", async (req, res, next) => {
  try {
    const count = await fetchDeltaAndNotify();
    return res.status(200).json({ sent: count });
  } catch (err) {
    next(err);
  }
});

// Globaler Error-Handler
app.use((err, req, res, next) => {
  console.error("🔥 Uncaught error in parser:", err.stack || err);
  res.status(500).send("Internal Server Error");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Sicherer Webhook + Parser Service läuft");
});
