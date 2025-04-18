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
      const entries = req.body?.delta?.entries || [];
      const firstFile = entries[0]?.[1];
      const payload = {
        path: firstFile?.path_display || null,
        raw: req.body
      };

      const response = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      return res.status(200).send(text);
    } catch (err) {
      console.error("Fehler beim Webhook-Forwarding:", err);
      return res.status(500).send("Fehler beim Weiterleiten");
    }
  }

  if (req.method === "POST" && action === "parse") {
    try {
      if (!req.file) {
        return res.status(400).send("No file uploaded");
      }

      const file = req.file;
      const name = file.originalname;

      if (name.endsWith(".docx")) {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        return res.status(200).json({ type: "docx", text: result.value });
      } else if (name.endsWith(".pdf")) {
        const result = await pdfParse(file.buffer);
        return res.status(200).json({ type: "pdf", text: result.text });
      } else if (name.endsWith(".txt")) {
        return res.status(200).json({ type: "txt", text: file.buffer.toString("utf-8") });
      } else if (name.endsWith(".csv") || name.endsWith(".xlsx")) {
        const workbook = xlsx.read(file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet, { defval: "" });
        return res.status(200).json({ type: "spreadsheet", sheet: sheetName, rows: data });
      } else {
        return res.status(400).send("Unsupported file type");
      }
    } catch (err) {
      console.error("Fehler beim Parsen:", err);
      return res.status(500).send("Fehler beim Parsen");
    }
  }

  res.status(400).send("Ungültige Anfrage");
});

app.get("/fetch-delta", async (req, res) => {
  try {
    let cursor = loadCursor();
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

    if (Array.isArray(data.entries)) {
      for (const entry of data.entries) {
        await fetch(N8N_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: entry.path_display,
            dropbox_type: entry[".tag"]
          })
        });
      }
    }

    return res.status(200).json({ sent: data.entries?.length || 0 });
  } catch (err) {
    console.error("Fehler beim Delta-Abruf:", err);
    return res.status(500).send("Fehler beim Delta-Abruf");
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Sicherer Webhook + Parser Service läuft");
});
