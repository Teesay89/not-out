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

// Optional Google Sign-In identity check. Guest play always sends just a
// free-text name; a signed-in client ALSO sends a Firebase ID token
// alongside it. If that token verifies, the caller's real Google display
// name and uid are used instead of the free-text name — otherwise a
// signed-in "verified" submission could still spoof a different display
// name than the account that's actually authenticated. If verification
// fails for any reason (expired token, tampering, auth not configured),
// this falls straight back to the guest path rather than rejecting the
// submission — signing in only ever adds a verified identity, it never
// makes guest play stricter.
async function resolveVerifiedIdentity(idToken, rawName) {
  let uid = null, verifiedName = null;
  if (idToken) {
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
      verifiedName = decoded.name || null;
    } catch (e) {
      console.warn("ID token verification failed, falling back to guest submission:", e.message);
    }
  }
  const nameSource = verifiedName || rawName;
  const safeName = String(nameSource).replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || "Anonymous";
  return { uid, safeName };
}

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
    const { format, seed, xi, captainIdx, name, idToken } = req.body || {};

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
    const { uid, safeName } = await resolveVerifiedIdentity(idToken, name);

    await db.collection("leaderboard").add({
      name: safeName,
      score: Number(score),
      record: String(record),
      format: String(format),
      label: String(label),
      date: new Date().toISOString(),
      ...(uid ? { uid } : {})
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
    const { format, country, seed, xi, captainIdx, name, idToken } = req.body || {};

    if (!format || !country || seed === undefined || !xi || !name) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    const result = gamelogic.calculateRepresentResult({ format, country, seed, xi, captainIdx });

    const db = admin.firestore();
    const label = FORMAT_LABELS[format] || format;
    const countryName = (gamelogic.NATIONS.find((n) => n.id === country) || {}).name || country;
    const { uid, safeName } = await resolveVerifiedIdentity(idToken, name);

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
      date: new Date().toISOString(),
      ...(uid ? { uid } : {})
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
    const { seed, xi, captainIdx, name, yourNation, opponentNation, idToken } = req.body || {};

    if (seed === undefined || !xi || !name || !yourNation || !opponentNation) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    const result = gamelogic.calculateSeriesShowdownResult({ seed, xi, captainIdx, yourNation, opponentNation });

    const db = admin.firestore();
    const yourNat = gamelogic.NATIONS.find((n) => n.id === yourNation) || {};
    const oppNat = gamelogic.NATIONS.find((n) => n.id === opponentNation) || {};
    const { uid, safeName } = await resolveVerifiedIdentity(idToken, name);

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
      date: new Date().toISOString(),
      ...(uid ? { uid } : {})
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
    const { format, seed, xi, captainIdx, name, natA, natB, idToken } = req.body || {};

    if (!format || seed === undefined || !xi || !name || !natA || !natB) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    const result = gamelogic.calculateSeriesShowdownCombinedResult({ format, seed, xi, captainIdx, natA, natB });

    const db = admin.firestore();
    const aNat = gamelogic.NATIONS.find((n) => n.id === natA) || {};
    const bNat = gamelogic.NATIONS.find((n) => n.id === natB) || {};
    const { uid, safeName } = await resolveVerifiedIdentity(idToken, name);

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
      date: new Date().toISOString(),
      ...(uid ? { uid } : {})
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

// ============================================================
// Build Your Team -- persistent, signed-in-only collection mode.
// Unlike every mode above, sign-in here is mandatory, not optional: there
// is no guest path, since the whole point is progress that survives across
// sessions. Every endpoint below requires a valid Firebase ID token and
// rejects with 401 if it's missing or doesn't verify -- never falls back
// to a guest-style default the way resolveVerifiedIdentity does elsewhere.
// ============================================================

async function requireAuthedUid(req, res) {
  const { idToken } = req.body || {};
  if (!idToken) {
    res.status(401).json({ ok: false, error: "Sign-in required" });
    return null;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (e) {
    res.status(401).json({ ok: false, error: "Invalid or expired sign-in" });
    return null;
  }
}

// Merges newly-rolled cards into an existing {cards, spareCount} pair.
// Pooled duplicate rule: every copy beyond a card's first adds one spare to
// the running counter -- checked against the running `updated` state as
// each new card is merged in, so this also catches two copies of the same
// player landing in the SAME pack, not just across packs.
function mergeCardsIntoCollection(cards, spareCount, newCardObjs) {
  const updated = { ...cards };
  let spares = spareCount;
  for (const p of newCardObjs) {
    const key = gamelogic.cardKey(p);
    const prevCount = (updated[key] && updated[key].count) || 0;
    if (prevCount >= 1) spares += 1;
    updated[key] = { count: prevCount + 1 };
  }
  return { cards: updated, spareCount: spares };
}

function packDoc(db, uid) {
  return db.collection("packCollections").doc(uid);
}

const PACK_TEAM_NAME_MAX = 30;

exports.openStarterPack = onRequest(async (req, res) => {
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
    const uid = await requireAuthedUid(req, res);
    if (!uid) return;

    const { teamName, fmt } = req.body || {};
    if (!teamName || typeof teamName !== "string") {
      res.status(400).json({ ok: false, error: "Missing team name" });
      return;
    }
    if (!["test", "odi", "t20"].includes(fmt)) {
      res.status(400).json({ ok: false, error: "Missing or bad format" });
      return;
    }

    const db = admin.firestore();
    const docRef = packDoc(db, uid);
    const existing = await docRef.get();
    if (existing.exists) {
      // Idempotent: retrying (e.g. a flaky connection) never re-rolls a
      // free pack or silently renames an existing team.
      res.status(200).json({ ok: true, collection: existing.data() });
      return;
    }

    const safeTeamName = String(teamName).replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, PACK_TEAM_NAME_MAX) || "My Team";

    const starterCards = gamelogic.rollStarterPack();
    const merged = mergeCardsIntoCollection({}, 0, starterCards);

    // The 12 opponents (11 NATIONS + 1 randomly-drawn ALLSTAR_TEAMS tier),
    // shuffled once for this campaign -- same shape as World Tour's own
    // stops shuffle, just persisted instead of recomputed per session.
    const allStarTeam = gamelogic.ALLSTAR_TEAMS[Math.floor(Math.random() * gamelogic.ALLSTAR_TEAMS.length)];
    const order = gamelogic.shuffle(gamelogic.NATIONS.map((n) => n.id));
    order.push(allStarTeam.id);

    const now = new Date().toISOString();
    const doc = {
      teamName: safeTeamName,
      cards: merged.cards,
      spareCount: merged.spareCount,
      campaign: {
        order,
        index: 0,
        wins: 0,
        losses: 0,
        xi: null,
        captainIdx: null,
        fmt: String(fmt),
      },
      createdAt: now,
      updatedAt: now,
    };
    await docRef.set(doc);
    res.status(200).json({ ok: true, collection: doc });
  } catch (err) {
    console.error("openStarterPack error:", err);
    res.status(500).json({ ok: false, error: err.message || "Internal server error" });
  }
});

exports.claimSeriesReward = onRequest(async (req, res) => {
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
    const uid = await requireAuthedUid(req, res);
    if (!uid) return;

    const { seed, xi, captainIdx, opponentId } = req.body || {};
    if (seed === undefined || !Array.isArray(xi) || xi.length !== 11 || !opponentId) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    const db = admin.firestore();
    const docRef = packDoc(db, uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "No collection found -- open a starter pack first" });
      return;
    }
    const data = snap.data();
    const campaign = data.campaign || {};

    // The opponent must be whichever stop this campaign is actually on --
    // otherwise a client could just keep claiming the weakest team over
    // and over instead of working through all 12.
    const expectedOpponent = (campaign.order || [])[campaign.index || 0];
    if (opponentId !== expectedOpponent) {
      res.status(409).json({ ok: false, error: "Not your current opponent", expectedOpponent });
      return;
    }

    // Ownership check: every submitted card must actually be in this
    // user's own collection with at least one copy -- gamelogic's
    // verifySeriesWin only checks that cards are REAL, not that this
    // specific uid owns them, so that has to happen here.
    for (const key of xi) {
      const owned = data.cards && data.cards[key] && data.cards[key].count > 0;
      if (!owned) {
        res.status(403).json({ ok: false, error: "You don't own one of the submitted cards: " + key });
        return;
      }
    }

    const result = gamelogic.verifySeriesWin({ seed, xi, captainIdx, opponentId, fmt: campaign.fmt });

    // Advance to the next stop regardless of the result -- a loss doesn't
    // grant a pack, but the campaign still moves on, same as World Tour
    // never repeating a stop. Wrapping past 12 reshuffles and starts again.
    let nextIndex = (campaign.index || 0) + 1;
    let nextOrder = campaign.order;
    if (nextIndex >= nextOrder.length) {
      const allStarTeam = gamelogic.ALLSTAR_TEAMS[Math.floor(Math.random() * gamelogic.ALLSTAR_TEAMS.length)];
      nextOrder = gamelogic.shuffle(gamelogic.NATIONS.map((n) => n.id));
      nextOrder.push(allStarTeam.id);
      nextIndex = 0;
    }

    let cards = data.cards;
    let spareCount = data.spareCount || 0;
    let newCards = [];
    if (result.won) {
      newCards = gamelogic.rollPack(6);
      const merged = mergeCardsIntoCollection(cards, spareCount, newCards);
      cards = merged.cards;
      spareCount = merged.spareCount;
    }

    const updated = {
      cards,
      spareCount,
      campaign: {
        order: nextOrder,
        index: nextIndex,
        wins: (campaign.wins || 0) + (result.won ? 1 : 0),
        losses: (campaign.losses || 0) + (result.won ? 0 : 1),
        xi,
        captainIdx: Number(captainIdx) || 0,
        fmt: campaign.fmt,
      },
      updatedAt: new Date().toISOString(),
    };
    await docRef.update(updated);

    res.status(200).json({
      ok: true,
      won: result.won,
      record: result.record,
      newCards: newCards.map((p) => ({ n: p.n, c: p.c, d: p.d, r: p.r, cid: p.cid, key: gamelogic.cardKey(p) })),
      spareCount,
    });
  } catch (err) {
    console.error("claimSeriesReward error:", err);
    res.status(500).json({ ok: false, error: err.message || "Internal server error" });
  }
});

exports.redeemDuplicates = onRequest(async (req, res) => {
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
    const uid = await requireAuthedUid(req, res);
    if (!uid) return;

    const db = admin.firestore();
    const docRef = packDoc(db, uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: "No collection found -- open a starter pack first" });
      return;
    }
    const data = snap.data();
    const spareCount = data.spareCount || 0;
    if (spareCount < 5) {
      res.status(400).json({ ok: false, error: "Need at least 5 spares to redeem" });
      return;
    }

    const newCards = gamelogic.rollPack(6);
    const merged = mergeCardsIntoCollection(data.cards, spareCount - 5, newCards);

    await docRef.update({
      cards: merged.cards,
      spareCount: merged.spareCount,
      updatedAt: new Date().toISOString(),
    });

    res.status(200).json({
      ok: true,
      newCards: newCards.map((p) => ({ n: p.n, c: p.c, d: p.d, r: p.r, cid: p.cid, key: gamelogic.cardKey(p) })),
      spareCount: merged.spareCount,
    });
  } catch (err) {
    console.error("redeemDuplicates error:", err);
    res.status(500).json({ ok: false, error: err.message || "Internal server error" });
  }
});