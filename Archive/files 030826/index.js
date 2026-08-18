const {onRequest} = require('firebase-functions/v2/https');
const {
  DB, mulberry32, NATIONS, HUNDRED_TEAMS, FORMATS, SLOTS,
  teamStrengths, decideMatch, decideNeutral,
  genTestMatch, genWhiteBallMatch, genHundredMatch, pickPOTM,
  buildHundredTable, getBowlingUnit, shuffle, db,
} = require('./gamelogic');

const gl = require('./gamelogic'); // used to set gl.FMTKEY / gl.xi (mutable module state)

const ALLOWED_ORIGIN = '*'; // tighten to your real domain once deployed, e.g. 'https://www.not-out.co.uk'

function setCors(res) {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

function sanitizeName(raw) {
  return String(raw || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').slice(0, 20).trim() || 'Anonymous';
}

/* Rebuild the real XI from {n,d} pairs against the actual database —
   the client never gets to invent a player or a rating. */
function resolveXI(format, xiInput) {
  if (!Array.isArray(xiInput) || xiInput.length !== 11) throw new Error('XI must have exactly 11 players');
  const pool = DB[format];
  if (!pool) throw new Error('unknown format');
  const seen = new Set();
  const resolved = xiInput.map((entry) => {
    if (!entry || typeof entry.n !== 'string' || typeof entry.d !== 'string') throw new Error('bad player entry');
    const p = pool.find((x) => x.n === entry.n && x.d === entry.d);
    if (!p) throw new Error('player not found: ' + entry.n + ' (' + entry.d + ')');
    if (seen.has(p.n)) throw new Error('duplicate player: ' + p.n);
    seen.add(p.n);
    return p;
  });
  return resolved;
}

/* Every slot must actually accept the player placed there, and the team
   must include at least one wicketkeeper somewhere \u2014 the same two
   invariants the client enforces during drafting, re-checked here so a
   forged team can't be submitted by calling this endpoint directly. */
function validateXI(resolvedXI) {
  for (let i = 0; i < 11; i++) {
    if (!SLOTS[i].fits(resolvedXI[i])) {
      throw new Error(`player at slot ${i + 1} (${resolvedXI[i].n}) is not eligible for that slot`);
    }
  }
  if (!resolvedXI.some((p) => p.roles.includes('wk'))) {
    throw new Error('XI has no wicketkeeper');
  }
}

function runNationTour(format, resolvedXI) {
  gl.__setFMTKEY(format);
  gl.__setXI(resolvedXI);
  const st = teamStrengths();
  const stops = shuffle(NATIONS.slice());
  let w = 0, d = 0, l = 0, scoreTotal = 0;
  stops.forEach((nat) => {
    for (let m = 0; m < 5; m++) {
      const res = decideMatch(st.strength, nat.opp + 4);
      const code = res.code;
      const gen = format === 'test' ? genTestMatch(code, nat) : genWhiteBallMatch(code, nat, res.superOver);
      pickPOTM(code, nat); // discarded — called only to consume the same random draws the client makes
      if (code === 'W') w++; else if (code === 'D') d++; else l++;
      scoreTotal += gen.pts;
    }
  });
  if (w === 60) scoreTotal += 400;
  return { record: `${w}\u2013${d}\u2013${l}`, score: Math.round(scoreTotal), label: FORMATS[format].label };
}

function runHundred(resolvedXI) {
  gl.__setFMTKEY('hundred');
  gl.__setXI(resolvedXI);
  const st = teamStrengths();
  const opponents = shuffle(HUNDRED_TEAMS.slice());
  const matches = [];
  let w = 0, l = 0;
  opponents.forEach((team) => {
    const res = decideMatch(st.strength, team.opp + 3);
    const code = res.code;
    const gen = genHundredMatch(code, team, res.superOver);
    pickPOTM(code, team); // discarded — consumes the same random draws as the client
    if (code === 'W') w++; else l++;
    matches.push({ code, pts: gen.pts });
  });
  const table = buildHundredTable(opponents, matches.map((m) => ({ code: m.code })));
  const yourIdx = table.findIndex((r) => r.isYou);
  const rank = yourIdx + 1;

  let reachedEliminator = false, reachedFinal = false, wonFinal = false;
  const finish = (extra) => {
    const total = w + l;
    let scoreTotal = matches.reduce((a, m) => a + m.pts, 0);
    const champion = extra.wonFinal === true;
    const undefeated = l === 0;
    if (champion) scoreTotal += 400;
    if (champion && undefeated) scoreTotal += 200;
    else if (extra.reachedFinal) scoreTotal += 100;
    else if (extra.reachedEliminator) scoreTotal += 40;
    return {
      record: `${w}\u2013${l}, P${rank}`,
      score: Math.round(scoreTotal),
      label: FORMATS.hundred.label,
    };
  };

  if (rank > 3) return finish({ reachedEliminator: false, reachedFinal: false, wonFinal: false });

  const first = table[0], second = table[1], third = table[2];
  let finalOpponent;
  if (rank === 1) {
    const aWins = decideNeutral(second.team.opp, third.team.opp);
    finalOpponent = aWins ? second.team : third.team;
  } else {
    reachedEliminator = true;
    const oppRow = rank === 2 ? third : second;
    const res = decideMatch(st.strength, oppRow.team.opp + 2);
    const code = res.code;
    const gen = genHundredMatch(code, oppRow.team, res.superOver);
    pickPOTM(code, oppRow.team);
    if (code === 'W') w++; else l++;
    matches.push({ code, pts: gen.pts });
    if (code === 'L') return finish({ reachedEliminator: true, reachedFinal: false, wonFinal: false });
    finalOpponent = first.team;
  }

  reachedFinal = true;
  const res = decideMatch(st.strength, finalOpponent.opp + 3);
  const code = res.code;
  const gen = genHundredMatch(code, finalOpponent, res.superOver);
  pickPOTM(code, finalOpponent);
  if (code === 'W') w++; else l++;
  matches.push({ code, pts: gen.pts });
  wonFinal = code === 'W';
  return finish({ reachedEliminator, reachedFinal: true, wonFinal });
}

exports.submitScore = onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  try {
    const { format, seed, xi: xiInput, name } = req.body || {};
    if (!['test', 'odi', 't20', 'hundred'].includes(format)) throw new Error('bad format');
    if (!Number.isInteger(seed)) throw new Error('bad seed');

    const resolvedXI = resolveXI(format, xiInput);
    validateXI(resolvedXI);

    const nativeRandom = Math.random;
    Math.random = mulberry32(seed);
    let result;
    try {
      result = format === 'hundred' ? runHundred(resolvedXI) : runNationTour(format, resolvedXI);
    } finally {
      Math.random = nativeRandom; // always restore, even if the run throws
    }

    const entry = {
      name: sanitizeName(name),
      score: result.score,
      label: result.label,
      record: result.record,
      date: new Date().toISOString(),
    };
    await db.collection('leaderboard').add(entry);

    res.status(200).json({ ok: true, score: result.score, record: result.record });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});
