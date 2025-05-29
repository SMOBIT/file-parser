const express    = require("express");
const fetch      = require("node-fetch");
const fs         = require("fs");
const path       = require("path");
const FormData   = require("form-data");               // Für den Aufruf Deines externen Parsers
const { getNewAccessToken } = require("./refresh-token");

const app = express();

// ─── Body-Size Limits ──────────────────────────────────────────
// JSON-Payloads bis 50 MB erlauben (Base64 braucht Platz)
app.use(express.json({ limit: "50mb" }));

// ─── Umgebungsvariablen prüfen ─────────────────────────────────
const N8N_WEBHOOK_URL       = process.env.N8N_WEBHOOK_URL       || "";
const SECURE_TOKEN          = process.env.SECURE_TOKEN          || "";
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || "";
const DROPBOX_CLIENT_ID     = process.env.DROPBOX_CLIENT_ID     || "";
const DROPBOX_CLIENT_SECRET = process.env.DROPBOX_CLIENT_SECRET || "";

if (!N8N_WEBHOOK_URL)       throw new Error("Missing N8N_WEBHOOK_URL");
if (!SECURE_TOKEN)          throw new Error("Missing SECURE_TOKEN");
if (!DROPBOX_REFRESH_TOKEN) throw new Error("Missing DROPBOX_REFRESH_TOKEN");
if (!DROPBOX_CLIENT_ID)     throw new Error("Missing DROPBOX_CLIENT_ID");
if (!DROPBOX_CLIENT_SECRET) throw new Error("Missing DROPBOX_CLIENT_SECRET");

// ─── Cursor‐Handling für Dropbox‐Polling ────────────────────────
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

// ─── Dropbox Delta Polling ─────────────────────────────────────
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
    method:  "POST",
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
        console.log("📤 Sende Datei an n8n-Webhook:", entry.path_display);
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

// ─── Haupt-Route: Nur POST action=parse und GET challenge ─────
app.all("/", async (req, res, next) => {
  try {
    const { action, token, challenge } = req.query;

    // Token‐Check
    if (token !== SECURE_TOKEN) {
      return res.status(403).send("Ungültiger Token");
    }

    // Challenge-Response (nur GET & action=challenge)
    if (req.method === "GET" && action === "challenge") {
      return res.status(200).send(challenge || "No challenge provided");
    }

    // Datei-Parsing (POST & action=parse)
    if (req.method === "POST" && action === "parse") {
      // Body muss JSON sein: { fileName, mimeType, fileBase64 }
      const { fileName, mimeType, fileBase64 } = req.body;
      if (typeof fileBase64 !== "string" || !fileName || !mimeType) {
        return res.status(400).send("Body muss { fileName, mimeType, fileBase64 } enthalten");
      }

      // Base64 → Buffer
      const buffer = Buffer.from(fileBase64, "base64");
      console.log("📝 Empfangen:", fileName, mimeType, buffer.length, "Bytes");

      // An externen Parser schicken
      const form = new FormData();
      form.append("file", buffer, { filename: fileName, contentType: mimeType });

      const parserUrl = `https://file-parser-8dhp.onrender.com/?action=parse&token=${SECURE_TOKEN}`;
      const parserRes = await fetch(parserUrl, {
        method: "POST",
        body:   form,
      });

      if (!parserRes.ok) {
        const txt = await parserRes.text();
        console.error("❌ Parser-Error:", parserRes.status, txt);
        return res.status(502).send(`Parser antwortete ${parserRes.status}`);
      }

      const parsed = await parserRes.json();
      console.log("✅ Parser-Result:", parsed);

      // Anschließend Dropbox‐Delta pollen
      const deltaCount = await fetchDeltaAndNotify();

      // Antwort an n8n
      return res.status(200).json({
        parsed,
        deltaFilesSent: deltaCount,
      });
    }

    // Alles andere ist unbekannt
    return res.status(400).send("Unknown action");
  } catch (err) {
    next(err);
  }
});

// ─── Optional: Manuelles Triggern der Delta-Abfrage ───────────
app.get("/fetch-delta", async (req, res, next) => {
  try {
    const count = await fetchDeltaAndNotify();
    return res.status(200).json({ sent: count });
  } catch (err) {
    next(err);
  }
});

// ─── Globaler Error‐Handler ────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("🔥 Uncaught error:", err.stack || err);
  res.status(500).send("Internal Server Error");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Parser-Service läuft auf Port", process.env.PORT || 3000);
});
