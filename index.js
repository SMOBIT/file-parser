const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");
const fetch = require("node-fetch");

const app = express();
const upload = multer();

const MAKE_WEBHOOK_URL = "https://hook.eu2.make.com/c8y2uy4d2aox7fpvgy9nwpr1mb98b8wl";

app.all("/", upload.single("file"), async (req, res) => {
  const action = req.query.action;

  // Challenge-Verifizierung
  if (req.method === "GET" && action === "challenge") {
    const challenge = req.query.challenge;
    return res.status(200).send(challenge || "No challenge provided");
  }

  // Webhook-Weiterleitung an Make.com
  if (req.method === "POST" && action === "webhook") {
    try {
      const response = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const text = await response.text();
      return res.status(200).send(text);
    } catch (err) {
      console.error("Fehler beim Webhook-Forwarding:", err);
      return res.status(500).send("Fehler beim Weiterleiten");
    }
  }

  // Datei-Parsing
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

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Webhook + Parser Service läuft");
});
