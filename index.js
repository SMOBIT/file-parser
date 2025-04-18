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

      let path = null;
      let dropbox_type = null;

      if (entries[0]?.[1]) {
        path = entries[0][1].path_display;
        dropbox_type = entries[0][1][".tag"];
      } else if (entries[0]?.[0]) {
        path = entries[0][0];
        dropbox_type = "deleted";
      }

      const payload = {
        body: {
          path,
          dropbox_type
        },
        raw: req.body
      };

      const response = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const text = await response.text();
      return res.status(200).send(text);
    } catch (err) {
      console.error("Fehler beim Webhook-Forwarding:", err);
      return res.status(500).send("Fehler beim Weiterleiten");
    }
  }

  res.status(400).send("Ungültige Anfrage");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Sicherer Webhook + Parser Service läuft");
});
