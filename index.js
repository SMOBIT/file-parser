const express = require("express");
const fetch   = require("node-fetch");
const fs      = require("fs");
const path    = require("path");
// Wenn Du FormData brauchst, ist das nur für Deinen externen Parser-Call:
const FormData = require("form-data");

const { getNewAccessToken } = require("./refresh-token");

const app = express();

// ─── JSON-Body bis 50 MB erlauben (für Base64) ─────────
app.use(express.json({ limit: "50mb" }));
// ───────────────────────────────────────────────────────

const N8N_WEBHOOK_URL       = process.env.N8N_WEBHOOK_URL;       if (!N8N_WEBHOOK_URL)        throw new Error("Missing N8N_WEBHOOK_URL");
const SECURE_TOKEN          = process.env.SECURE_TOKEN;          if (!SECURE_TOKEN)           throw new Error("Missing SECURE_TOKEN");
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN; if (!DROPBOX_REFRESH_TOKEN)  throw new Error("Missing DROPBOX_REFRESH_TOKEN");
const DROPBOX_CLIENT_ID     = process.env.DROPBOX_CLIENT_ID;     if (!DROPBOX_CLIENT_ID)      throw new Error("Missing DROPBOX_CLIENT_ID");
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET; if (!DROPBOX_CLIENT_SECRET)  throw new Error("Missing DROPBOX_CLIENT_SECRET");

const CURSOR_FILE = path.join(__dirname, "cursor.json");
function loadCursor() {
  if (fs.existsSync(CURSOR_FILE)) {
    return JSON.parse(fs.readFileSync(CURSOR_FILE, "utf-8")).cursor;
  }
  return null;
}
function saveCursor(cursor) {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor }), "utf-8");
}

async function fetchDeltaAndNotify() {
  const accessToken = await getNewAccessToken({
    refresh_token: DROPBOX_REFRESH_TOKEN,
    client_id:     DROPBOX_CLIENT_ID,
    client_secret: DROPBOX_CLIENT_SECRET,
  });

  const cursor   = loadCursor();
  const endpoint = cursor
    ? "https://api.dropboxapi.com/2/files/list_folder/continue"
    : "https://api.dropboxapi.com/2/files/list_folder";
  const body = cursor
    ? { cursor }
    : { path: "/Rechnungen", recursive: true, include_media_info: false, include_deleted: false };

  const rsp  = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await rsp.json();
  console.log("🔍 Dropbox API Antwort:", JSON.stringify(data, null, 2));
  if (data.cursor) saveCursor(data.cursor);

  let sentCount = 0;
  if (Array.isArray(data.entries)) {
    for (const entry of data.entries) {
      if (entry[".tag"] === "file" && entry.path_display) {
        console.log("📤 Sende Datei:", entry.path_display);
        await fetch(N8N_WEBHOOK_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ body: { path: entry.path_display, dropbox_type: entry[".tag"] }, raw: entry }),
        });
        sentCount++;
      }
    }
  }
  return sentCount;
}

// ─── Die einzige Route: JSON mit Base64 ─────────────────
app.post("/", async (req, res, next) => {
  try {
    const { action, token } = req.query;
    if (token !== SECURE_TOKEN) {
      return res.status(403).send("Ungültiger Token");
    }
    if (!action) {
      return res.status(400).send("Missing action");
    }
    if (action === "challenge") {
      return res.status(200).send(req.query.challenge || "No challenge");
    }
    if (action === "webhook") {
      // Erwarte JSON: { fileName, mimeType, fileBase64 }
      const { fileName, mimeType, fileBase64 } = req.body;
      if (typeof fileBase64 !== "string") {
        return res.status(400).send("Missing body.fileBase64");
      }
      const buffer = Buffer.from(fileBase64, "base64");
      console.log("📝 Empfangen:", fileName, mimeType, buffer.length, "bytes");

      // Beispiel: sende an externen Parser
      const form = new FormData();
      form.append("file", buffer, { filename: fileName, contentType: mimeType });
      const parserRes = await fetch(
        `https://file-parser-8dhp.onrender.com/?action=parse&token=${SECURE_TOKEN}`,
        { method: "POST", body: form }
      );
      if (!parserRes.ok) {
        const txt = await parserRes.text();
        console.error("❌ Parser antwortete:", parserRes.status, txt);
        throw new Error(`Parser-Fehler ${parserRes.status}`);
      }
      const parsed = await parserRes.json();
      console.log("✅ Parser Result:", parsed);

      // Dann Dropbox-Delta
      const count = await fetchDeltaAndNotify();

      return res.json({ parsed, deltaFilesSent: count });
    }
    return res.status(400).send("Unknown action");
  } catch (e) {
    next(e);
  }
});

// Optional: manuelles Delta-Triggern
app.get("/fetch-delta", async (req, res, next) => {
  try {
    const count = await fetchDeltaAndNotify();
    res.json({ sent: count });
  } catch (e) {
    next(e);
  }
});

// Globaler Error-Handler
app.use((err, req, res, next) => {
  console.error("🔥 Uncaught error:", err.stack || err);
  res.status(500).send("Internal Server Error");
});

app.listen(process.env.PORT||3000, () => {
  console.log("🚀 Parser-Service läuft");
});
