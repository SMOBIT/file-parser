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

// **Wichtig**: n8n liefert das PDF-Binary im Feld "data"
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

app.use(express.json());

function loadCursor() { /* … unverändert … */ }
function saveCursor(cur) { /* … unverändert … */ }

async function fetchDeltaAndNotify() { /* … unverändert … */ }

// Haupt-Route: hier landen die Webhook-Aufrufe von n8n
app.all("/", uploadSingleData, async (req, res, next) => {
  try {
    // Auth-Check
    const action = req.query.action;
    const token  = req.query.token;
    if (token !== SECURE_TOKEN) {
      return res.status(403).send("Zugriff verweigert – ungültiger Token");
    }

    // Challenge/GET
    if (req.method === "GET" && (action === "challenge" || action === "webhook")) {
      return res.status(200).send(req.query.challenge || "No challenge provided");
    }

    // Webhook-POST mit Datei
    if (req.method === "POST" && action === "webhook") {
      // In req.file liegt jetzt das hochgeladene PDF unter "data"
      if (!req.file) {
        throw new Error("Kein File im Feld 'data' erhalten");
      }
      console.log("📝 Empfangenes File:", {
        name:     req.file.originalname,
        mimetype: req.file.mimetype,
        size:     req.file.size,
      });

      // *** HIER DEIN PARSER-CALL ***
      // z.B. via fetch Multipart/Form-Data an file-parser senden:
      /*
      const form = new FormData();
      form.append("file", req.file.buffer, req.file.originalname);
      const parserRes = await fetch("https://file-parser-8dhp.onrender.com/?action=parse&token=…", {
        method: "POST",
        body: form,
      });
      const parsed = await parserRes.json();
      console.log("Parser-Antwort:", parsed);
      */

      // Dann weiter mit Dropbox-Delta-Polling
      const count = await fetchDeltaAndNotify();
      return res.status(200).send(`Webhook verarbeitet: ${count} Dateien`);
    }

    // Sonstige Anfragen
    res.status(400).send("Ungültige Anfrage");
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
