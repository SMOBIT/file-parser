const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
const upload = multer();

const N8N_WEBHOOK_URL = "https://n8n-mq6c.onrender.com/webhook/df7a5bfd-b19e-4014-b377-11054d06cb43";
const SECURE_TOKEN = "d6B33qYhZEj2TymKZAQg1A";
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
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
  const cursor = loadCursor();
  const endpoint = cursor
    ? "https://api.dropboxapi.com/2/files/list_folder/continue"
    : "https://api.dropboxapi.com/2/files/list_folder";

  const body = cursor
    ? { cursor }
    : { path: "", recursive: true, include_media_info: false, include_deleted: false };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DROPBOX_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

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
          body: JSON.stringify({
            body: {
              path: entry.path_display,
              dropbox_type: entry[".tag"]
            },
            raw: entry
          })
        });

        sentCount++;
      }
    }
  }

  return sentCount;
}

app.all("/", upload.single("file"), async (req, res) => {
  const action = req.query.action;
  const token = req.query.token;

  if (token !== SECURE_TOKEN) {
    return res.status(403).send("Zugriff verweigert – ungültiger Token");
  }

  if (req.method === "GET" && (action === "challenge" || action === "webhook")) {
    const challenge = req.query.challenge;
    return res.status(200).send(challenge || "No challenge provided");
  }

  if (req.method === "POST" && action === "webhook") {
    try {
      const count = await fetchDeltaAndNotify();
      return res.status(200).send(`Webhook verarbeitet: ${count} Dateien`);
    } catch (err) {
      console.error("Fehler im Webhook:", err);
      return res.status(500).send("Fehler im Webhook");
    }
  }

  res.status(400).send("Ungültige Anfrage");
});

app.get("/fetch-delta", async (req, res) => {
  try {
    const count = await fetchDeltaAndNotify();
    return res.status(200).json({ sent: count });
  } catch (err) {
    console.error("Fehler beim Delta-Abruf:", err);
    return res.status(500).send("Fehler beim Delta-Abruf");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Sicherer Webhook + Parser Service läuft");
});
