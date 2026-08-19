const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
admin.initializeApp();

// Set region to us-central1 (matching your active URL)
setGlobalOptions({ region: "us-central1" });

// Map format keys to display labels expected by Firestore
const FORMAT_LABELS = {
  test: "Test Match",
  odi: "ODI",
  t20: "T20",
  hundred: "The Hundred"
};

// Fail loudly if this doesn't load — a silently-missing gamelogic
// module must never let a request fall through to trusting a
// client-supplied score instead.
const gamelogic = require("./gamelogic");

exports.submitScore = onRequest(async (req, res) => {
  // 1. Enable CORS for website requests
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
    // 2. Parse payload sent from index.html
    const { format, seed, xi, captainIdx, name } = req.body || {};

    if (!format || seed === undefined || !xi || !name) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    // 3. Compute score and record using gamelogic.js — no fallback:
    //    if this throws (bad format, fabricated player, illegal slot,
    //    no keeper, etc.) the request is rejected, full stop.
    const result = gamelogic.calculateScore({ format, seed, xi, captainIdx });
    const score = result.score;
    const record = result.record;

    // 4. Save verified record directly to Firestore leaderboard
    const db = admin.firestore();
    const label = FORMAT_LABELS[format] || format;
    const safeName = String(name).replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || "Anonymous";

    await db.collection("leaderboard").add({
      name: safeName,
      score: Number(score),
      record: String(record),
      format: String(format),
      label: String(label),
      date: new Date().toISOString()
    });

    // 5. Return expected response payload to frontend
    res.status(200).json({
      ok: true,
      score: Number(score),
      record: String(record)
    });

  } catch (err) {
    console.error("Score submission error:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Internal server error"
    });
  }
});

// Represent Your Nation — same trust model as submitScore: the client
// only supplies the seed, XI, and which country it claims to be
// representing. The server re-simulates the entire league (your 11
// matches AND the 55 background matches between the other nations)
// from scratch and computes its own rank/points, never trusting
// whatever the client displayed.
exports.submitRepresentScore = onRequest(async (req, res) => {
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
    const { format, country, seed, xi, captainIdx, name } = req.body || {};

    if (!format || !country || seed === undefined || !xi || !name) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    const result = gamelogic.calculateRepresentResult({ format, country, seed, xi, captainIdx });

    const db = admin.firestore();
    const label = FORMAT_LABELS[format] || format;
    const countryName = (gamelogic.NATIONS.find((n) => n.id === country) || {}).name || country;
    const safeName = String(name).replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || "Anonymous";

    await db.collection("leaderboard").add({
      name: safeName,
      score: Number(result.points),   // shared 'score' field so the existing orderBy('score','desc') pattern keeps working
      record: String(result.record),
      label: String(label),
      mode: "represent",
      country: String(country),
      countryName: String(countryName),
      rank: Number(result.rank),
      points: Number(result.points),
      date: new Date().toISOString()
      // Deliberately no 'format' field: normal leaderboard queries filter
      // with where('format','==','test'|'odi'|'t20'), and Firestore's
      // equality filter never matches a document missing that field —
      // so leaving it out is what keeps Represent Your Nation entries
      // from doubling up under the regular Test/ODI/T20 tabs.
    });

    res.status(200).json({
      ok: true,
      rank: Number(result.rank),
      points: Number(result.points),
      record: String(result.record)
    });

  } catch (err) {
    console.error("Represent Your Nation submission error:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Internal server error"
    });
  }
});

// Series Showdown — same trust model as submitScore/submitRepresentScore.
// The client supplies only the seed, the drafted XI (from the
// format-agnostic DB.best pool), and which two nations are involved. The
// server re-simulates the entire 30-match campaign (5 Test/5 ODI/5 T20
// against the opponent's current real squad, then the same again against
// their all-time All-Star XI) from scratch and computes its own score,
// never trusting whatever the client displayed.
exports.submitSeriesShowdownScore = onRequest(async (req, res) => {
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
    const { seed, xi, captainIdx, name, yourNation, opponentNation } = req.body || {};

    if (seed === undefined || !xi || !name || !yourNation || !opponentNation) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    const result = gamelogic.calculateSeriesShowdownResult({ seed, xi, captainIdx, yourNation, opponentNation });

    const db = admin.firestore();
    const yourNat = gamelogic.NATIONS.find((n) => n.id === yourNation) || {};
    const oppNat = gamelogic.NATIONS.find((n) => n.id === opponentNation) || {};
    const safeName = String(name).replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || "Anonymous";

    await db.collection("leaderboard").add({
      name: safeName,
      score: Number(result.score),
      record: String(result.record),
      label: "Series Showdown",
      mode: "showdown",
      yourNation: String(yourNation),
      yourNationName: String(yourNat.name || yourNation),
      opponentNation: String(opponentNation),
      opponentNationName: String(oppNat.name || opponentNation),
      date: new Date().toISOString()
      // Deliberately no 'format' field, same reasoning as Represent Your
      // Nation — a single draft spans Test/ODI/T20, so no single format
      // value applies, and this keeps Series Showdown out of the
      // format-specific tabs.
    });

    res.status(200).json({
      ok: true,
      score: Number(result.score),
      record: String(result.record)
    });

  } catch (err) {
    console.error("Series Showdown submission error:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Internal server error"
    });
  }
});

// Series Showdown — Mode 3 (Combined XI vs the rest of the world). Same
// trust model as the other endpoints. The client supplies the seed, the
// drafted XI (from a single format's regular player pool, combining both
// series nations), and which two nations were combined; the server
// re-simulates the whole 10-opponent World-Tour-shaped campaign from
// scratch and computes its own score.
exports.submitSeriesShowdownCombinedScore = onRequest(async (req, res) => {
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
    const { format, seed, xi, captainIdx, name, natA, natB } = req.body || {};

    if (!format || seed === undefined || !xi || !name || !natA || !natB) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    const result = gamelogic.calculateSeriesShowdownCombinedResult({ format, seed, xi, captainIdx, natA, natB });

    const db = admin.firestore();
    const aNat = gamelogic.NATIONS.find((n) => n.id === natA) || {};
    const bNat = gamelogic.NATIONS.find((n) => n.id === natB) || {};
    const safeName = String(name).replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || "Anonymous";

    await db.collection("leaderboard").add({
      name: safeName,
      score: Number(result.score),
      record: String(result.record),
      label: "Series Showdown",
      mode: "showdown",
      natA: String(natA),
      natAName: String(aNat.name || natA),
      natB: String(natB),
      natBName: String(bNat.name || natB),
      showdownFormat: String(format),
      date: new Date().toISOString()
      // Deliberately no 'format' field (note the distinct 'showdownFormat'
      // name) -- Firestore's where('format','==',...) equality filter would
      // otherwise pull these into the regular Test/ODI/T20 tabs alongside
      // World Tour scores, same reasoning as Represent Your Nation and
      // Series Showdown Mode 1/2.
    });

    res.status(200).json({
      ok: true,
      score: Number(result.score),
      record: String(result.record)
    });

  } catch (err) {
    console.error("Series Showdown (Combined) submission error:", err);
    res.status(500).json({
      ok: false,
      error: err.message || "Internal server error"
    });
  }
});