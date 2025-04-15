const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");

const app = express();
const upload = multer();

app.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    const file = req.file;
    const mimetype = file.mimetype;
    const originalName = file.originalname;

    if (originalName.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return res.status(200).json({ type: "docx", text: result.value });

    } else if (originalName.endsWith(".pdf")) {
      const result = await pdfParse(file.buffer);
      return res.status(200).json({ type: "pdf", text: result.text });

    } else if (originalName.endsWith(".txt")) {
      return res.status(200).json({ type: "txt", text: file.buffer.toString("utf-8") });

    } else if (originalName.endsWith(".csv") || originalName.endsWith(".xlsx")) {
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
    res.status(500).send("Fehler beim Parsen");
  }
});

app.get("/", (req, res) => {
  res.send("Multiformat File Parser API läuft");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 File Parser läuft auf Port ${PORT}`);
});
