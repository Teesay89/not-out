const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();

setGlobalOptions({ region: "us-central1" });

const FORMAT_LABELS = {
  test: "Test Match",
  odi: "ODI",
  t20: "T20",
  hundred: "The Hundred"
};

let gamelogic;
try {
  gamelogic = require("./gamelogic");
} catch (e) {
  console.error("Critical error loading gamelogic.js:", e.message);
}

exports.submitScore = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST");
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const { format, seed, xi, captainIdx, name } = req.body || {};

    if (!format || seed === undefined || !xi || !name) {
      res.status(400).json({ ok: false, error: "Missing required payload fields" });
      return;
    }

    // STRICT FAIL CLOSED: If gamelogic is unavailable, throw error (do not fallback)
    if (!gamelogic || typeof gamelogic.calculateScore !== "function") {
      res.status(500).json({ ok: false, error: "Server scoring engine unavailable" });
      return;
    }

    // Execute server-side verification and simulation
    const result = gamelogic.calculateScore({ format, seed, xi, captainIdx });
    const score = Number(result.score);
    const record = String(result.record);

    // Sanitize display name
    const cleanName = String(name).replace(/[<>&"'`]/g, "").replace(/\s+/g, " ").slice(0, 20).trim() || "Anonymous";

    // Write verified record to Firestore using Admin SDK
    const db = admin.firestore();
    const label = FORMAT_LABELS[format] || format;

    await db.collection("leaderboard").add({
      name: cleanName,
      score: score,
      record: record,
      format: String(format),
      label: String(label),
      date: new Date().toISOString()
    });

    res.status(200).json({
      ok: true,
      score: score,
      record: record
    });

  } catch (err) {
    console.error("Score submission verification failed:", err.message);
    res.status(400).json({
      ok: false,
      error: err.message || "Score verification failed"
    });
  }
});