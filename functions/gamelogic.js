/**
 * NOT OUT — server-side score verification.
 *
 * The client sends only: {format, seed, xi (11 x {n,d} name+decade pairs),
 * captainIdx, name}. Nothing about the score itself is trusted from the
 * client. This function looks up the REAL players from the same data
 * files the game ships with, re-simulates the exact same deterministic
 * tour (seeded so it's bit-for-bit reproducible — including flavour-text
 * generation like Player of the Match, which consumes random draws too
 * and must stay in lockstep with the client or the whole sequence
 * desyncs), computes the score itself, and only THEN writes it to
 * Firestore — using the Admin SDK, which bypasses security rules
 * entirely. Firestore rules should block all direct client writes to
 * `leaderboard`; this function is the only path in.
 *
 * Deploy: firebase deploy --only functions
 */
const {onRequest} = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/* ---------- real player data, bundled with the function ---------- */
const DB = {};
for (const key of ['test','odi','t20','best']) {
  DB[key] = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', key + '.json'), 'utf8'));
}
/* 'hundred' was this same all-time/format-agnostic dataset's old filename,
   left over from a decommissioned "Hundred" format mode. The legacy
   calculateScore(format:'hundred') branch below still reads DB['hundred']
   via PLAYERS/__setFMTKEY — alias it so that dead-but-intact code path
   keeps working unchanged after the rename. */
DB.hundred = DB.best;

/* ---------- seeded RNG, used in place of Math.random for the whole
   re-simulation so it reproduces the client's exact run ---------- */
function mulberry32(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ================= game logic, copied verbatim from the client ================= */

let FMTKEY = 'test';
let FMT = null;
let xi = [];
let PLAYERS = [];
let draftedNames = new Set();
let captainIdx = -1;

function __setFMTKEY(k){ FMTKEY = k; FMT = FORMATS[k]; PLAYERS = DB[k]; }
function __setXI(v){ xi = v; draftedNames = new Set(v.map(p => p.n)); }
function __setCaptainIdx(v){ captainIdx = v; }
const DECADE_LABEL = {'1870s':'The 1870s', '1880s':'The 1880s', '1890s':'The 1890s', '1900s':'The 1900s', '1910s':'The 1910s', '1920s':'The 1920s', '1930s':'The 1930s', '1940s':'The 1940s', '1950s':'The 1950s', '1960s':'The 1960s', '1970s':'The 1970s', '1980s':'The 1980s', '1990s':'The 1990s', '2000s':'The 2000s', '2010s':'The 2010s', '2020s':'The 2020s'};

const NATIONS = [
  {id:'AUS', name:'Australia',    flag:'🇦🇺', opp:100, venues:['the MCG','the SCG','the Gabba','Adelaide Oval','Perth Stadium']},
  {id:'SA',  name:'South Africa', flag:'🇿🇦', opp:98,  venues:['the Wanderers','Newlands','Kingsmead','SuperSport Park','St George\u2019s Park']},
  {id:'NZ',  name:'New Zealand',  flag:'🇳🇿', opp:96,  venues:['the Basin Reserve','Eden Park','Hagley Oval','Seddon Park','University Oval']},
  {id:'IND', name:'India',        flag:'🇮🇳', opp:95,  venues:['Eden Gardens','Wankhede Stadium','M. Chinnaswamy Stadium','Narendra Modi Stadium','Arun Jaitley Stadium']},
  {id:'ENG', name:'England',      flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', opp:94,  venues:['Lord\u2019s','the Oval','Old Trafford','Edgbaston','Headingley']},
  {id:'PAK', name:'Pakistan',     flag:'🇵🇰', opp:92,  venues:['Gaddafi Stadium','National Stadium Karachi','Rawalpindi Cricket Stadium','Multan Cricket Stadium']},
  {id:'SL',  name:'Sri Lanka',    flag:'🇱🇰', opp:90,  venues:['Galle International Stadium','R. Premadasa Stadium','Pallekele International Stadium','Sinhalese Sports Club']},
  {id:'WI',  name:'West Indies',  flag:'🏝️', opp:88,  venues:['Kensington Oval','Sabina Park','Queen\u2019s Park Oval','Sir Vivian Richards Stadium','Warner Park']},
  {id:'BAN', name:'Bangladesh',   flag:'🇧🇩', opp:86,  venues:['Sher-e-Bangla National Stadium','Zahur Ahmed Chowdhury Stadium','Sylhet International Stadium']},
  {id:'ZIM', name:'Zimbabwe',     flag:'🇿🇼', opp:84,  venues:['Harare Sports Club','Queens Sports Club']},
  {id:'IRE', name:'Ireland',      flag:'🇮🇪', opp:83,  venues:['Malahide','the Village','Civil Service Cricket Club']},
];

const HUNDRED_TEAMS = [
  {id:'MIL', name:'MI London',              flag:'🟣', opp:97, ground:'the Kia Oval'},
  {id:'SUN', name:'Sunrisers Leeds',        flag:'🟠', opp:95, ground:'Headingley'},
  {id:'MSG', name:'Manchester Super Giants',flag:'🔷', opp:94, ground:'Emirates Old Trafford'},
  {id:'BRV', name:'Southern Brave',         flag:'🔴', opp:93, ground:'the Utilita Bowl'},
  {id:'PHX', name:'Birmingham Phoenix',     flag:'🟠', opp:92, ground:'Edgbaston'},
  {id:'ROC', name:'Trent Rockets',          flag:'🟡', opp:91, ground:'Trent Bridge'},
  {id:'SPI', name:'London Spirit',          flag:'🔵', opp:90, ground:'Lord’s'},
  {id:'FIR', name:'Welsh Fire',             flag:'🔥', opp:89, ground:'Sophia Gardens'},
];

const HUNDRED_SQUADS = {
  MIL: [{n:'Sam Curran',roles:['ar'],rt:94}, {n:'Will Jacks',roles:['ar'],rt:89}, {n:'Rashid Khan',roles:['bowl'],rt:97}, {n:'Nicholas Pooran',roles:['wk'],rt:92}, {n:'James Vince',roles:['bat'],rt:88}, {n:'Tom Curran',roles:['bowl'],rt:86}, {n:'Trent Boult',roles:['bowl'],rt:93}, {n:'Nathan Sowter',roles:['bowl'],rt:81}, {n:'Sherfane Rutherford',roles:['bat'],rt:85}, {n:'Richard Gleeson',roles:['bowl'],rt:84}, {n:'Ollie Pope',roles:['bat'],rt:87}, {n:'Olly Stone',roles:['bowl'],rt:83}, {n:'Ollie Sykes',roles:['bowl'],rt:80}, {n:'Callum Parkinson',roles:['bowl'],rt:82}, {n:'Jason Roy',roles:['bat'],rt:88}, {n:'Eddie Jack',roles:['bat'],rt:78}, {n:'Sebastian Morgan',roles:['bat'],rt:78}],
  SUN: [{n:'Harry Brook',roles:['bat'],rt:97}, {n:'Mitchell Marsh',roles:['ar'],rt:91}, {n:'Ryan Rickelton',roles:['wk'],rt:87}, {n:'Nathan Ellis',roles:['bowl'],rt:88}, {n:'Brydon Carse',roles:['bowl'],rt:89}, {n:'Matthew Potts',roles:['bowl'],rt:86}, {n:'Dan Lawrence',roles:['bat'],rt:85}, {n:'Abrar Ahmed',roles:['bowl'],rt:87}, {n:'Benny Howell',roles:['ar'],rt:82}, {n:'Tom Lawes',roles:['ar'],rt:81}, {n:'Tom Alsop',roles:['wk'],rt:80}, {n:'Liam Patterson-White',roles:['bowl'],rt:81}, {n:'Reece Topley',roles:['bowl'],rt:85}, {n:'Edward Barnard',roles:['ar'],rt:80}, {n:'Charlie Allison',roles:['bat'],rt:78}, {n:'Matt Revis',roles:['ar'],rt:79}],
  MSG: [{n:'Jos Buttler',roles:['wk'],rt:96}, {n:'Noor Ahmad',roles:['bowl'],rt:91}, {n:'Heinrich Klaasen',roles:['wk'],rt:93}, {n:'Liam Dawson',roles:['ar'],rt:84}, {n:'Aiden Markram',roles:['bat'],rt:90}, {n:'Josh Tongue',roles:['bowl'],rt:85}, {n:'Sonny Baker',roles:['bowl'],rt:86}, {n:'Gus Atkinson',roles:['bowl'],rt:90}, {n:'Leus du Plooy',roles:['bat'],rt:80}, {n:'Tom Hartley',roles:['bowl'],rt:82}, {n:'Tim Seifert',roles:['wk'],rt:83}, {n:'Tom Moores',roles:['wk'],rt:80}, {n:'Max Holden',roles:['bat'],rt:79}, {n:'Tawanda Muyeye',roles:['bat'],rt:79}, {n:'George Scrimshaw',roles:['bowl'],rt:80}, {n:'Paul Walter',roles:['ar'],rt:82}, {n:'Adam Finch',roles:['bowl'],rt:78}, {n:'James Sales',roles:['ar'],rt:78}],
  SPI: [{n:'Zak Crawley',roles:['bat'],rt:88}, {n:'James Coles',roles:['bowl'],rt:83}, {n:'Liam Livingstone',roles:['ar'],rt:92}, {n:'Jamie Overton',roles:['ar'],rt:86}, {n:'Adam Zampa',roles:['bowl'],rt:89}, {n:'Dewald Brevis',roles:['bat'],rt:86}, {n:'Jonny Bairstow',roles:['wk'],rt:88}, {n:'David Willey',roles:['bowl'],rt:86}, {n:'Mason Crane',roles:['bowl'],rt:81}, {n:'Adam Milne',roles:['bowl'],rt:83}, {n:'Adam Hose',roles:['bat'],rt:79}, {n:'Tymal Mills',roles:['bowl'],rt:87}, {n:'James Rew',roles:['wk'],rt:81}, {n:'Lhuan-dre Pretorius',roles:['wk'],rt:82}, {n:'Matthew Fisher',roles:['bowl'],rt:82}, {n:'Kiran Carlson',roles:['bat'],rt:78}, {n:'Henry Crocombe',roles:['bowl'],rt:79}],
  ROC: [{n:'Tim David',roles:['bat'],rt:91}, {n:'Tom Banton',roles:['wk'],rt:86}, {n:'Ben Duckett',roles:['bat'],rt:88}, {n:'Mitchell Santner',roles:['ar'],rt:87}, {n:'Finn Allen',roles:['bat'],rt:85}, {n:'David Payne',roles:['bowl'],rt:82}, {n:'Lewis Gregory',roles:['ar'],rt:84}, {n:'Craig Overton',roles:['ar'],rt:83}, {n:'Daniel Mousley',roles:['ar'],rt:80}, {n:'Matt Henry',roles:['bowl'],rt:88}, {n:'Sam Billings',roles:['wk'],rt:84}, {n:'Aneurin Donald',roles:['bat'],rt:79}, {n:'Ben Mayes',roles:['bowl'],rt:78}, {n:'Danny Briggs',roles:['bowl'],rt:80}, {n:'Bradley Currie',roles:['bowl'],rt:79}, {n:'Louis Kimber',roles:['bat'],rt:78}, {n:'Ben Raine',roles:['ar'],rt:80}, {n:'Ben Sanderson',roles:['bowl'],rt:79}],
  PHX: [{n:'Jacob Bethell',roles:['ar'],rt:92}, {n:'Rehan Ahmed',roles:['bowl'],rt:86}, {n:'Mitch Owen',roles:['ar'],rt:83}, {n:'Donovan Ferreira',roles:['wk'],rt:82}, {n:'Saqib Mahmood',roles:['bowl'],rt:85}, {n:'Usman Tariq',roles:['bowl'],rt:79}, {n:'Joe Clarke',roles:['wk'],rt:83}, {n:'Will Smeed',roles:['bat'],rt:82}, {n:'Jordan Thompson',roles:['ar'],rt:82}, {n:'Scott Currie',roles:['bowl'],rt:79}, {n:'Laurie Evans',roles:['bat'],rt:80}, {n:'Chris Wood',roles:['bowl'],rt:82}, {n:'Ethan Brookes',roles:['ar'],rt:79}, {n:'Mustafizur Rahman',roles:['bowl'],rt:87}, {n:'Sean Dickson',roles:['bat'],rt:78}, {n:'Tom Helm',roles:['bowl'],rt:79}],
  BRV: [{n:'Jofra Archer',roles:['bowl'],rt:95}, {n:'Jamie Smith',roles:['wk'],rt:89}, {n:'Marcus Stoinis',roles:['ar'],rt:88}, {n:'Tristan Stubbs',roles:['bat'],rt:87}, {n:'Adil Rashid',roles:['bowl'],rt:89}, {n:'David Miller',roles:['bat'],rt:88}, {n:'Luke Wood',roles:['bowl'],rt:83}, {n:'Chris Jordan',roles:['bowl'],rt:85}, {n:'Ben McKinney',roles:['bat'],rt:79}, {n:'Thomas Rew',roles:['wk'],rt:78}, {n:'Michael Pepper',roles:['wk'],rt:80}, {n:'Tom Abell',roles:['bat'],rt:80}, {n:'Dan Worrall',roles:['bowl'],rt:81}, {n:'Caleb Falconer',roles:['bowl'],rt:78}, {n:'Nikhil Chaudhary',roles:['bat'],rt:78}, {n:'Manny Lumsden',roles:['bowl'],rt:78}, {n:'Saif Zaib',roles:['ar'],rt:79}],
  FIR: [{n:'Phil Salt',roles:['wk'],rt:92}, {n:'Marco Jansen',roles:['ar'],rt:91}, {n:'Rachin Ravindra',roles:['ar'],rt:88}, {n:'Chris Woakes',roles:['ar'],rt:86}, {n:'Joe Root',roles:['bat'],rt:94}, {n:'Jordan Cox',roles:['wk'],rt:84}, {n:'Tom Kohler-Cadmore',roles:['bat'],rt:82}, {n:'Ben Kellaway',roles:['bat'],rt:78}, {n:'Lockie Ferguson',roles:['bowl'],rt:87}, {n:'Asa Tribe',roles:['bat'],rt:78}, {n:'Tom Aspinwall',roles:['bat'],rt:78}, {n:'Matthew Short',roles:['ar'],rt:83}, {n:'Sam Cook',roles:['bowl'],rt:81}, {n:'Jafer Chohan',roles:['bowl'],rt:79}, {n:'Jordan Clark',roles:['ar'],rt:82}, {n:'Dillon Pennington',roles:['bowl'],rt:80}],
};

const FORMATS = {
  test:{label:'Test Match', noun:'Test',  decades:['1870s','1880s','1890s','1900s','1910s','1920s','1930s','1940s','1950s','1960s','1970s','1980s','1990s','2000s','2010s','2020s']},
  odi: {label:'ODI',        noun:'ODI',   decades:['1970s','1980s','1990s','2000s','2010s','2020s']},
  t20: {label:'T20',        noun:'T20',   decades:['2000s','2010s','2020s']},
  hundred:{label:'The Hundred', noun:'game', decades:['70s','80s','90s','00s','10s','20s']},
};

const SLOTS = [
 {no:1, title:'Opener',        short:'OP', desc:'Faces the new ball first. A batter, keeper, or an all-rounder who opens.', fits:p=>p.roles.includes('bat')||p.roles.includes('wk')||(p.roles.includes('ar')&&arOpens(p))},
 {no:2, title:'Opener',        short:'OP', desc:'The other half of the opening stand. Same eligibility as slot 1.', fits:p=>p.roles.includes('bat')||p.roles.includes('wk')||(p.roles.includes('ar')&&arOpens(p))},
 {no:3, title:'No.3',          short:'3',  desc:'First drop. A batter — or a batting/true all-rounder who bats big.',  fits:p=>p.roles.includes('bat')||p.roles.includes('wk')||(p.roles.includes('ar')&&arFitsSlot(p,3))},
 {no:4, title:'No.4',          short:'4',  desc:'The engine room. Batter or batting/true all-rounder.',    fits:p=>p.roles.includes('bat')||p.roles.includes('wk')||(p.roles.includes('ar')&&arFitsSlot(p,4))},
 {no:5, title:'No.5',          short:'5',  desc:'Builds or rebuilds. Batter, or a true/batting all-rounder.', fits:p=>p.roles.includes('bat')||p.roles.includes('wk')||(p.roles.includes('ar')&&arFitsSlot(p,5))},
 {no:6, title:'No.6',          short:'6',  desc:'Any player can bat here — the side still needs a keeper somewhere, just not necessarily here.', fits:p=>true},
 {no:7, title:'Flex Pick',     short:'7',  desc:'Your call: extra batter, extra bowler, or any all-rounder.', fits:p=>p.roles.includes('bat')||p.roles.includes('bowl')||p.roles.includes('wk')||(p.roles.includes('ar')&&arFitsSlot(p,7))},
 {no:8, title:'Bowler',        short:'B',  desc:'Strike bowler, or a true/bowling all-rounder.',           fits:p=>p.roles.includes('bowl')||(p.roles.includes('ar')&&arFitsSlot(p,8))},
 {no:9, title:'Bowler',        short:'B',  desc:'Partner at the other end. Bowler or true/bowling all-rounder.', fits:p=>p.roles.includes('bowl')||(p.roles.includes('ar')&&arFitsSlot(p,9))},
 {no:10,title:'Bowler',        short:'B',  desc:'First change, no easy overs.',                            fits:p=>p.roles.includes('bowl')},
 {no:11,title:'Bowler',        short:'B',  desc:'Last name on the card, first to the second new ball.',    fits:p=>p.roles.includes('bowl')},
];

const AR_RANGE = { true:[3,9], batting:[3,7], bowling:[6,9] };

function arSubtype(p){
  if(!p.roles.includes('ar')) return null;
  return p.arsub || 'true';
}

function arFitsSlot(p, slotNo){
  const sub = arSubtype(p);
  if(!sub) return false;
  const [lo,hi] = AR_RANGE[sub];
  return slotNo>=lo && slotNo<=hi;
}
/* opener eligibility (slots 1-2) for all-rounders: does this player's real
   batting-position window reach into the top of the order? */
function arOpens(p){
  if(p.minBp!=null) return p.minBp<=2;
  return p.bp==='O';
}

const BP_NATURAL = { O:[1,2], T:[1,2,3,4], M:[3,4,5,6,7], L:[6,7,8,9], X:[8,9,10,11], TM:[1,2,3,4,5,6,7], ML:[3,4,5,6,7,8,9], LX:[6,7,8,9,10,11] };

/* Extra flat penalty on top of the distance-based one, once a player is out
   of position at all -- makes sloppy placement cost real strength instead
   of being nearly free, so "draft the highest rating, place wherever"
   stops being a dominant strategy. Tuned per format since each format's
   real-data pool responds very differently to the same penalty size. */
const POSITION_PENALTY_ADD = {test:0.9, odi:4, t20:4.5};
function positionPenalty(p, slotNo){
  if(p.minBp!=null && p.maxBp!=null){
    if(slotNo>=p.minBp && slotNo<=p.maxBp) return 0;
    const dist = slotNo<p.minBp ? p.minBp-slotNo : slotNo-p.maxBp;
    return Math.min(8, dist*1.5) + (POSITION_PENALTY_ADD[FMTKEY] || 0);
  }
  const range = BP_NATURAL[p.bp];
  if(!range || !range.length) return 0;
  if(range.includes(slotNo)) return 0;
  const dist = Math.min(...range.map(s=>Math.abs(s-slotNo)));
  return Math.min(8, dist*1.5) + (POSITION_PENALTY_ADD[FMTKEY] || 0);
}

/* Hidden "Immortal XI" difficulty mechanics — extracted verbatim from the
   client so the server's independent recomputation stays in lockstep. Only
   materially affects strength for a near-ceiling, well-composed XI -- an
   average team's strength never gets near the thresholds where these kick
   in, so this doesn't change ordinary gameplay:

   1. Regional bowling conditions -- touring Asia without a genuine spinner,
      or West Indies/Australia without a genuine pace bowler, costs you.
   2. Batting/bowling stats bonus -- real career numbers (runs, average,
      strike rate, high score / wickets, average, economy, strike rate),
      ranked against same-format same-decade peers so eras stay comparable,
      reward players who were statistically exceptional even if that's not
      fully captured by their single overall rating.
   3. Streak-conditional boost -- an extra strength bump that only applies
      while you're still undefeated this tour/league (including the Lord's
      final for Represent Your Nation). One loss or draw and it's off for
      the rest of the run. This is what makes a genuine unbeaten run
      rare-but-achievable without inflating an otherwise-average run. */
const ASIA_NATIONS = new Set(['IND','PAK','SL','BAN','AFG','ASIA']);
const PACE_NATIONS = new Set(['AUS','SA','WI']);
const WORLDCLASS_THRESHOLD = {test:75, odi:85, t20:78};
const CONDITIONS_PENALTY = {test:0, odi:15, t20:9};
const STATS_BONUS_WEIGHT = {test:1.75, odi:0.1, t20:0.1};
/* Format-specific, not a single global value -- ODI's much deeper player
   pool (3,422 players across 6 decades vs Test's 4,734/16 and T20's
   1,744/3) lets a near-ceiling draft shrug off the same boost far more
   easily, so it needs a noticeably smaller number to land on the same
   rarity target as Test/T20. */
const IMMORTAL_STREAK_BOOST = {test:8, odi:8, t20:8};
/* Unconditional per-match malus -- unlike CONDITIONS_PENALTY/
   POSITION_PENALTY_ADD (both avoidable by a good-enough draft, which is
   exactly why they plateau against ODI's deep pool), this always applies
   regardless of team composition. Needed only for ODI: its baseline
   strength (before any boost) is already strong enough that the boost had
   to be cut well below Test/T20's to keep P(50+) on target, which then
   made the 55+/58+/60-0 tail collapse far below target since those
   thresholds depend on the boost surviving a near-full unbeaten run. This
   malus lets the boost sit back at Test/T20's level (restoring the tail)
   while still holding the baseline win rate in place. */
const BASE_DIFFICULTY_PENALTY = {test:0, odi:1.2, t20:0};

function computeConditionsPenalty(nat, hasSpin, hasPace){
  const pen = CONDITIONS_PENALTY[FMTKEY] || 0;
  if(!pen) return 0;
  // Build Your Team's decade-opponent objects carry the real nation code
  // separately as `natId` (their own `id` is a composite like "IND_1990s");
  // every other mode's plain NATIONS objects have no `natId`, so this falls
  // back to `nat.id` for them exactly as before.
  const realNatId = nat.natId || nat.id;
  let total = 0;
  if(ASIA_NATIONS.has(realNatId) && !hasSpin) total += pen;
  if(PACE_NATIONS.has(realNatId) && !hasPace) total += pen;
  return total;
}
function hasWorldClassBowlingType(xiList, kind){
  const threshold = WORLDCLASS_THRESHOLD[FMTKEY] || 999;
  const types = kind==='spin' ? ['Right-arm spin','Left-arm spin'] : ['Right-arm pace','Left-arm pace'];
  return xiList.some(p => types.includes(p.bt) && p.r>=threshold && (p.roles.includes('bowl')||p.roles.includes('ar')));
}
/* battingBonus/bowlingBonus are precomputed per-player data fields (real
   career stats ranked against same-format same-decade peers) -- default to
   0 for any player/format where that data hasn't been generated yet, so
   this degrades gracefully rather than breaking. */
function computeStatsBonus(xiList){
  const weight = STATS_BONUS_WEIGHT[FMTKEY] || 0;
  if(!weight) return 0;
  const batters = xiList.filter(p=>p.roles.includes('bat')||p.roles.includes('wk')||p.roles.includes('ar'));
  const bowlers = xiList.filter(p=>p.roles.includes('bowl')||p.roles.includes('ar'));
  const battingAvg = batters.length ? batters.reduce((a,p)=>a+(p.battingBonus||0),0)/batters.length : 0;
  const bowlingAvg = bowlers.length ? bowlers.reduce((a,p)=>a+(p.bowlingBonus||0),0)/bowlers.length : 0;
  return (battingAvg + bowlingAvg) * weight;
}

function getBowlingUnit(xi){
  const core = xi.filter(p=>p.roles.includes('bowl')||p.roles.includes('ar'));
  if(FMTKEY==='test' || core.length>=5) return {unit:core, partTimer:null};
  const candidates = xi.filter(p=>p.roles.includes('bat') && !p.roles.includes('bowl') && !p.roles.includes('ar') && !p.roles.includes('wk'))
                        .sort((a,b)=>a.r-b.r);
  const partTimer = candidates[0];
  if(!partTimer) return {unit:core, partTimer:null};
  return {unit:[...core, partTimer], partTimer};
}

/* 200 of history's best captaincy records — extracted verbatim
   from the client, same as NATIONS/HUNDRED_TEAMS, so server-side
   verification applies the identical captain boost. */
const CAPTAINS_DB = [{"n":"Ricky Ponting","c":"AUS","fmt":"odi","d":"2000s","rt":99,"cid":"2230"},{"n":"Clive Lloyd","c":"WI","fmt":"odi","d":"1980s","rt":99,"cid":"1286"},{"n":"Rohit Sharma","c":"IND","fmt":"t20","d":"2020s","rt":99,"cid":"48405"},{"n":"Hansie Cronje","c":"SA","fmt":"odi","d":"1990s","rt":99,"cid":"2010"},{"n":"Virat Kohli","c":"IND","fmt":"odi","d":"2010s","rt":99,"cid":"49752"},{"n":"Ricky Ponting","c":"AUS","fmt":"test","d":"2000s","rt":99,"cid":"2230"},{"n":"Michael Clarke","c":"AUS","fmt":"odi","d":"2010s","rt":99,"cid":"8876"},{"n":"Steve Waugh","c":"AUS","fmt":"test","d":"2000s","rt":99,"cid":"1795"},{"n":"Rohit Sharma","c":"IND","fmt":"odi","d":"2020s","rt":99,"cid":"48405"},{"n":"Viv Richards","c":"WI","fmt":"odi","d":"1980s","rt":99,"cid":"1435"},{"n":"Eoin Morgan","c":"ENG","fmt":"odi","d":"2010s","rt":99,"cid":"47055"},{"n":"Graeme Smith","c":"SA","fmt":"odi","d":"2000s","rt":99,"cid":"10406"},{"n":"Warwick Armstrong","c":"AUS","fmt":"test","d":"1920s","rt":99,"cid":"254"},{"n":"Shaun Pollock","c":"SA","fmt":"odi","d":"2000s","rt":99,"cid":"2228"},{"n":"Allan Border","c":"AUS","fmt":"odi","d":"1990s","rt":98,"cid":"1572"},{"n":"Wasim Akram","c":"PAK","fmt":"odi","d":"1990s","rt":98,"cid":"1775"},{"n":"Tom Latham","c":"NZ","fmt":"odi","d":"2020s","rt":98,"cid":"59148"},{"n":"Virat Kohli","c":"IND","fmt":"test","d":"2010s","rt":98,"cid":"49752"},{"n":"Lord Hawke","c":"ENG","fmt":"test","d":"1890s","rt":98,"cid":"189"},{"n":"Allan Border","c":"AUS","fmt":"odi","d":"1980s","rt":98,"cid":"1572"},{"n":"Mahela Jayawardene","c":"SL","fmt":"odi","d":"2000s","rt":98,"cid":"6315"},{"n":"Faf du Plessis","c":"SA","fmt":"t20","d":"2010s","rt":98,"cid":"46933"},{"n":"Inzamam-ul-Haq","c":"PAK","fmt":"odi","d":"2000s","rt":98,"cid":"2034"},{"n":"Waqar Younis","c":"PAK","fmt":"odi","d":"2000s","rt":98,"cid":"1935"},{"n":"Imran Khan","c":"PAK","fmt":"odi","d":"1980s","rt":98,"cid":"1383"},{"n":"AB de Villiers","c":"SA","fmt":"odi","d":"2010s","rt":98,"cid":"46533"},{"n":"George Bailey","c":"AUS","fmt":"odi","d":"2010s","rt":98,"cid":"35384"},{"n":"Harry Trott","c":"AUS","fmt":"test","d":"1890s","rt":98,"cid":"109"},{"n":"MS Dhoni","c":"IND","fmt":"odi","d":"2000s","rt":98,"cid":"7593"},{"n":"Babar Azam","c":"PAK","fmt":"odi","d":"2020s","rt":98,"cid":"56880"},{"n":"Babar Azam","c":"PAK","fmt":"t20","d":"2020s","rt":98,"cid":"56880"},{"n":"Brendon McCullum","c":"NZ","fmt":"odi","d":"2010s","rt":98,"cid":"10384"},{"n":"Mashrafe Mortaza","c":"BAN","fmt":"odi","d":"2010s","rt":96,"cid":"24672"},{"n":"Vic Richardson","c":"AUS","fmt":"test","d":"1930s","rt":96,"cid":"446"},{"n":"Lindsay Hassett","c":"AUS","fmt":"test","d":"1940s","rt":96,"cid":"706"},{"n":"MS Dhoni","c":"IND","fmt":"t20","d":"2010s","rt":96,"cid":"7593"},{"n":"Daren Sammy","c":"WI","fmt":"t20","d":"2010s","rt":96,"cid":"44829"},{"n":"Sanath Jayasuriya","c":"SL","fmt":"odi","d":"2000s","rt":96,"cid":"1988"},{"n":"MS Dhoni","c":"IND","fmt":"odi","d":"2010s","rt":96,"cid":"7593"},{"n":"Arthur Shrewsbury","c":"ENG","fmt":"test","d":"1880s","rt":96,"cid":"62"},{"n":"W.G. Grace","c":"ENG","fmt":"test","d":"1880s","rt":96,"cid":"43"},{"n":"Marvan Atapattu","c":"SL","fmt":"odi","d":"2000s","rt":96,"cid":"1979"},{"n":"Mohammad Azharuddin","c":"IND","fmt":"odi","d":"1990s","rt":96,"cid":"1774"},{"n":"Sourav Ganguly","c":"IND","fmt":"odi","d":"2000s","rt":96,"cid":"2024"},{"n":"Sarfaraz Ahmed","c":"PAK","fmt":"odi","d":"2010s","rt":96,"cid":"48983"},{"n":"Donald Bradman","c":"AUS","fmt":"test","d":"1930s","rt":96,"cid":"492"},{"n":"Viv Richards","c":"WI","fmt":"test","d":"1980s","rt":96,"cid":"1435"},{"n":"Dasun Shanaka","c":"SL","fmt":"odi","d":"2020s","rt":96,"cid":"61690"},{"n":"Richie Richardson","c":"WI","fmt":"odi","d":"1990s","rt":96,"cid":"1744"},{"n":"Rahul Dravid","c":"IND","fmt":"odi","d":"2000s","rt":96,"cid":"2281"},{"n":"Percy Chapman","c":"ENG","fmt":"test","d":"1920s","rt":96,"cid":"431"},{"n":"Kane Williamson","c":"NZ","fmt":"odi","d":"2010s","rt":96,"cid":"51088"},{"n":"Mark Taylor","c":"AUS","fmt":"odi","d":"1990s","rt":96,"cid":"1922"},{"n":"Arjuna Ranatunga","c":"SL","fmt":"odi","d":"1990s","rt":96,"cid":"1666"},{"n":"Peter May","c":"ENG","fmt":"test","d":"1950s","rt":96,"cid":"900"},{"n":"Kapil Dev","c":"IND","fmt":"odi","d":"1980s","rt":94,"cid":"1568"},{"n":"Graeme Smith","c":"SA","fmt":"test","d":"2000s","rt":94,"cid":"10406"},{"n":"Jos Buttler","c":"ENG","fmt":"t20","d":"2020s","rt":94,"cid":"53271"},{"n":"Michael Vaughan","c":"ENG","fmt":"odi","d":"2000s","rt":94,"cid":"4709"},{"n":"Douglas Jardine","c":"ENG","fmt":"test","d":"1930s","rt":94,"cid":"480"},{"n":"Donald Bradman","c":"AUS","fmt":"test","d":"1940s","rt":94,"cid":"492"},{"n":"Frank Worrell","c":"WI","fmt":"test","d":"1960s","rt":94,"cid":"821"},{"n":"Misbah-ul-Haq","c":"PAK","fmt":"odi","d":"2010s","rt":94,"cid":"19596"},{"n":"Allan Steel","c":"ENG","fmt":"test","d":"1880s","rt":94,"cid":"52"},{"n":"Alastair Cook","c":"ENG","fmt":"odi","d":"2010s","rt":94,"cid":"45788"},{"n":"Bill Woodfull","c":"AUS","fmt":"test","d":"1930s","rt":94,"cid":"452"},{"n":"Eoin Morgan","c":"ENG","fmt":"t20","d":"2010s","rt":94,"cid":"47055"},{"n":"C.B. Fry","c":"ENG","fmt":"test","d":"1910s","rt":94,"cid":"187"},{"n":"Arthur Carr","c":"ENG","fmt":"test","d":"1920s","rt":94,"cid":"417"},{"n":"Geoff Howarth","c":"NZ","fmt":"odi","d":"1980s","rt":94,"cid":"1444"},{"n":"Percy Sherwell","c":"SA","fmt":"test","d":"1900s","rt":94,"cid":"290"},{"n":"Mark Taylor","c":"AUS","fmt":"test","d":"1990s","rt":94,"cid":"1922"},{"n":"Hansie Cronje","c":"SA","fmt":"test","d":"1990s","rt":94,"cid":"2010"},{"n":"Michael Vaughan","c":"ENG","fmt":"test","d":"2000s","rt":94,"cid":"4709"},{"n":"Michael Clarke","c":"AUS","fmt":"test","d":"2010s","rt":94,"cid":"8876"},{"n":"Courtney Walsh","c":"WI","fmt":"odi","d":"1990s","rt":94,"cid":"1765"},{"n":"Daniel Vettori","c":"NZ","fmt":"odi","d":"2000s","rt":94,"cid":"4380"},{"n":"Graham Gooch","c":"ENG","fmt":"odi","d":"1990s","rt":94,"cid":"1446"},{"n":"Steven Smith","c":"AUS","fmt":"odi","d":"2010s","rt":94,"cid":"50281"},{"n":"Lindsay Hassett","c":"AUS","fmt":"test","d":"1950s","rt":94,"cid":"706"},{"n":"Nasser Hussain","c":"ENG","fmt":"odi","d":"2000s","rt":94,"cid":"1952"},{"n":"Angelo Mathews","c":"SL","fmt":"odi","d":"2010s","rt":94,"cid":"47023"},{"n":"Monty Noble","c":"AUS","fmt":"test","d":"1900s","rt":94,"cid":"219"},{"n":"Aaron Finch","c":"AUS","fmt":"t20","d":"2020s","rt":92,"cid":"35812"},{"n":"Stephen Fleming","c":"NZ","fmt":"odi","d":"1990s","rt":92,"cid":"2121"},{"n":"Brian Lara","c":"WI","fmt":"odi","d":"2000s","rt":92,"cid":"1982"},{"n":"Brian Lara","c":"WI","fmt":"odi","d":"1990s","rt":92,"cid":"1982"},{"n":"Martin Crowe","c":"NZ","fmt":"odi","d":"1990s","rt":92,"cid":"1669"},{"n":"William Porterfield","c":"IRE","fmt":"odi","d":"2010s","rt":92,"cid":"47403"},{"n":"Stephen Fleming","c":"NZ","fmt":"odi","d":"2000s","rt":92,"cid":"2121"},{"n":"Carl Hooper","c":"WI","fmt":"odi","d":"2000s","rt":92,"cid":"1873"},{"n":"Allan Border","c":"AUS","fmt":"test","d":"1990s","rt":92,"cid":"1572"},{"n":"Misbah-ul-Haq","c":"PAK","fmt":"test","d":"2010s","rt":92,"cid":"19596"},{"n":"William Porterfield","c":"IRE","fmt":"t20","d":"2010s","rt":92,"cid":"47403"},{"n":"Bill Lawry","c":"AUS","fmt":"test","d":"1960s","rt":92,"cid":"1150"},{"n":"Johnny Douglas","c":"ENG","fmt":"test","d":"1910s","rt":92,"cid":"334"},{"n":"Leonard Hutton","c":"ENG","fmt":"test","d":"1950s","rt":92,"cid":"694"},{"n":"Clem Hill","c":"AUS","fmt":"test","d":"1910s","rt":92,"cid":"210"},{"n":"Imran Khan","c":"PAK","fmt":"odi","d":"1990s","rt":92,"cid":"1383"},{"n":"MD Shanaka","c":"SL","fmt":"t20","d":"2020s","rt":92,"cid":"114674"},{"n":"Gubby Allen","c":"ENG","fmt":"test","d":"1930s","rt":92,"cid":"559"},{"n":"Jack Cheetham","c":"SA","fmt":"test","d":"1950s","rt":92,"cid":"852"},{"n":"Kim Hughes","c":"AUS","fmt":"odi","d":"1980s","rt":92,"cid":"1530"},{"n":"W.G. Grace","c":"ENG","fmt":"test","d":"1890s","rt":92,"cid":"43"},{"n":"Habibul Bashar","c":"BAN","fmt":"odi","d":"2000s","rt":92,"cid":"2204"},{"n":"Javed Miandad","c":"PAK","fmt":"odi","d":"1980s","rt":92,"cid":"1504"},{"n":"Sourav Ganguly","c":"IND","fmt":"test","d":"2000s","rt":92,"cid":"2024"},{"n":"Joe Darling","c":"AUS","fmt":"test","d":"1900s","rt":92,"cid":"172"},{"n":"Alastair Cook","c":"ENG","fmt":"test","d":"2010s","rt":92,"cid":"45788"},{"n":"MS Dhoni","c":"IND","fmt":"test","d":"2010s","rt":92,"cid":"7593"},{"n":"Ivo Bligh","c":"ENG","fmt":"test","d":"1880s","rt":92,"cid":"67"},{"n":"Herbie Collins","c":"AUS","fmt":"test","d":"1920s","rt":92,"cid":"373"},{"n":"James Lillywhite (jnr)","c":"ENG","fmt":"test","d":"1870s","rt":90,"cid":"16"},{"n":"Arthur Gilligan","c":"ENG","fmt":"test","d":"1920s","rt":90,"cid":"420"},{"n":"John Goddard","c":"WI","fmt":"test","d":"1940s","rt":90,"cid":"805"},{"n":"Bob Simpson","c":"AUS","fmt":"test","d":"1960s","rt":90,"cid":"1060"},{"n":"Stephen Fleming","c":"NZ","fmt":"test","d":"2000s","rt":90,"cid":"2121"},{"n":"Ian Johnson","c":"AUS","fmt":"test","d":"1950s","rt":90,"cid":"736"},{"n":"Kepler Wessels","c":"SA","fmt":"odi","d":"1990s","rt":90,"cid":"1693"},{"n":"Andy Balbirnie","c":"IRE","fmt":"t20","d":"2020s","rt":90,"cid":"52628"},{"n":"Jeff Crowe","c":"NZ","fmt":"odi","d":"1980s","rt":90,"cid":"1698"},{"n":"Stanley Jackson","c":"ENG","fmt":"test","d":"1890s","rt":90,"cid":"164"},{"n":"Hugh Trumble","c":"AUS","fmt":"test","d":"1900s","rt":90,"cid":"140"},{"n":"Stanley Jackson","c":"ENG","fmt":"test","d":"1900s","rt":90,"cid":"164"},{"n":"Frederick Fane","c":"ENG","fmt":"test","d":"1900s","rt":90,"cid":"285"},{"n":"Percy Sherwell","c":"SA","fmt":"test","d":"1910s","rt":90,"cid":"290"},{"n":"Frank Mann","c":"ENG","fmt":"test","d":"1920s","rt":90,"cid":"423"},{"n":"Daren Sammy","c":"WI","fmt":"odi","d":"2010s","rt":90,"cid":"44829"},{"n":"Clive Lloyd","c":"WI","fmt":"test","d":"1970s","rt":90,"cid":"1286"},{"n":"Gerry Alexander","c":"WI","fmt":"test","d":"1950s","rt":90,"cid":"1056"},{"n":"Alec Stewart","c":"ENG","fmt":"odi","d":"1990s","rt":90,"cid":"1953"},{"n":"Alistair Campbell","c":"ZIM","fmt":"odi","d":"1990s","rt":90,"cid":"2045"},{"n":"Jack Blackham","c":"AUS","fmt":"test","d":"1890s","rt":90,"cid":"3"},{"n":"Andrew Stoddart","c":"ENG","fmt":"test","d":"1890s","rt":90,"cid":"106"},{"n":"Dave Gregory","c":"AUS","fmt":"test","d":"1870s","rt":90,"cid":"9"},{"n":"Syd Gregory","c":"AUS","fmt":"test","d":"1910s","rt":90,"cid":"138"},{"n":"Percy Chapman","c":"ENG","fmt":"test","d":"1930s","rt":90,"cid":"431"},{"n":"Pelham Warner","c":"ENG","fmt":"test","d":"1900s","rt":90,"cid":"233"},{"n":"Billy Murdoch","c":"AUS","fmt":"test","d":"1880s","rt":90,"cid":"24"},{"n":"Andy Balbirnie","c":"IRE","fmt":"odi","d":"2020s","rt":90,"cid":"52628"},{"n":"Sachin Tendulkar","c":"IND","fmt":"odi","d":"1990s","rt":85,"cid":"1934"},{"n":"Chris Gayle","c":"WI","fmt":"odi","d":"2000s","rt":85,"cid":"7568"},{"n":"Mike Smith","c":"ENG","fmt":"test","d":"1960s","rt":85,"cid":"1077"},{"n":"Imran Khan","c":"PAK","fmt":"test","d":"1980s","rt":85,"cid":"1383"},{"n":"John Goddard","c":"WI","fmt":"test","d":"1950s","rt":85,"cid":"805"},{"n":"Trevor Goddard","c":"SA","fmt":"test","d":"1960s","rt":85,"cid":"1018"},{"n":"George Giffen","c":"AUS","fmt":"test","d":"1890s","rt":85,"cid":"57"},{"n":"George Mann","c":"ENG","fmt":"test","d":"1940s","rt":85,"cid":"841"},{"n":"Mohammad Azharuddin","c":"IND","fmt":"test","d":"1990s","rt":85,"cid":"1774"},{"n":"Ted Dexter","c":"ENG","fmt":"test","d":"1960s","rt":85,"cid":"1080"},{"n":"Elton Chigumbura","c":"ZIM","fmt":"odi","d":"2010s","rt":85,"cid":"45252"},{"n":"Norman Yardley","c":"ENG","fmt":"test","d":"1940s","rt":85,"cid":"720"},{"n":"Jason Holder","c":"WI","fmt":"odi","d":"2010s","rt":85,"cid":"59339"},{"n":"Colin Cowdrey","c":"ENG","fmt":"test","d":"1960s","rt":85,"cid":"998"},{"n":"Joe Darling","c":"AUS","fmt":"test","d":"1890s","rt":85,"cid":"172"},{"n":"Jack Ryder","c":"AUS","fmt":"test","d":"1920s","rt":85,"cid":"381"},{"n":"Herby Wade","c":"SA","fmt":"test","d":"1930s","rt":85,"cid":"662"},{"n":"Heath Streak","c":"ZIM","fmt":"odi","d":"2000s","rt":85,"cid":"2108"},{"n":"Richie Benaud","c":"AUS","fmt":"test","d":"1960s","rt":85,"cid":"919"},{"n":"Nummy Deane","c":"SA","fmt":"test","d":"1920s","rt":85,"cid":"432"},{"n":"Jackie Grant","c":"WI","fmt":"test","d":"1930s","rt":85,"cid":"562"},{"n":"Abdul Kardar","c":"PAK","fmt":"test","d":"1950s","rt":85,"cid":"750"},{"n":"Wally Hammond","c":"ENG","fmt":"test","d":"1930s","rt":85,"cid":"458"},{"n":"Graham Dowling","c":"NZ","fmt":"test","d":"1960s","rt":85,"cid":"1176"},{"n":"Arjuna Ranatunga","c":"SL","fmt":"test","d":"1990s","rt":85,"cid":"1666"},{"n":"Allan Border","c":"AUS","fmt":"test","d":"1980s","rt":80,"cid":"1572"},{"n":"Archie MacLaren","c":"ENG","fmt":"test","d":"1900s","rt":80,"cid":"177"},{"n":"Mike Atherton","c":"ENG","fmt":"test","d":"1990s","rt":80,"cid":"1928"},{"n":"Percy McDonnell","c":"AUS","fmt":"test","d":"1880s","rt":80,"cid":"46"},{"n":"Garry Sobers","c":"WI","fmt":"test","d":"1960s","rt":80,"cid":"985"},{"n":"Dudley Nourse","c":"SA","fmt":"test","d":"1940s","rt":80,"cid":"659"},{"n":"Mansur Ali Khan Pataudi","c":"IND","fmt":"test","d":"1960s","rt":80,"cid":"1175"},{"n":"Freddie Brown","c":"ENG","fmt":"test","d":"1950s","rt":80,"cid":"576"},{"n":"Jock Cameron","c":"SA","fmt":"test","d":"1930s","rt":80,"cid":"455"},{"n":"Bob Wyatt","c":"ENG","fmt":"test","d":"1930s","rt":80,"cid":"465"},{"n":"Nari Contractor","c":"IND","fmt":"test","d":"1960s","rt":80,"cid":"1032"},{"n":"Walter Hadlee","c":"NZ","fmt":"test","d":"1940s","rt":80,"cid":"693"},{"n":"Jeffrey Stollmeyer","c":"WI","fmt":"test","d":"1950s","rt":80,"cid":"726"},{"n":"Duleep Mendis","c":"SL","fmt":"odi","d":"1980s","rt":75,"cid":"1665"},{"n":"Lala Amarnath","c":"IND","fmt":"test","d":"1940s","rt":75,"cid":"623"},{"n":"Herbie Taylor","c":"SA","fmt":"test","d":"1910s","rt":75,"cid":"350"},{"n":"Alan Melville","c":"SA","fmt":"test","d":"1930s","rt":75,"cid":"716"},{"n":"Alan Melville","c":"SA","fmt":"test","d":"1940s","rt":75,"cid":"716"},{"n":"Herbie Taylor","c":"SA","fmt":"test","d":"1920s","rt":75,"cid":"350"},{"n":"Tom Lowry","c":"NZ","fmt":"test","d":"1930s","rt":75,"cid":"528"},{"n":"Curly Page","c":"NZ","fmt":"test","d":"1930s","rt":75,"cid":"531"},{"n":"Vijay Hazare","c":"IND","fmt":"test","d":"1950s","rt":75,"cid":"748"},{"n":"John Reid","c":"NZ","fmt":"test","d":"1960s","rt":75,"cid":"860"}];
function isEliteCaptain(p, fmtKey){
  if(!p) return null;
  return CAPTAINS_DB.find(c=>c.cid===p.cid && c.c===p.c && c.fmt===fmtKey && c.d===p.d) || null;
}

function teamStrengths(){
  const contrib = [];
  let misplaced = 0;
  xi.forEach((p,i)=>{
    const slotNo = i+1;
    const canBat = p.roles.includes('bat')||p.roles.includes('wk')||p.roles.includes('ar');
    const pen = positionPenalty(p, slotNo);
    const posLift = pen===0 ? 0.1 : 0;
    if(pen>0) misplaced++;
    if(canBat) contrib.push((p.r+posLift-pen) * (i>=7 ? 0.97 : 1));
    else if(i<7) contrib.push((p.r+posLift-pen) * 0.65);
  });
  contrib.sort((a,b)=>b-a);
  const batTop = contrib.slice(0,7);
  const depth = xi.slice(7).filter(p=>p.roles.includes('ar')||p.roles.includes('bat')||p.roles.includes('wk'))
                  .reduce((a,p)=>a+Math.max(0,(p.r-75)*0.12), 0);
  const bat = batTop.reduce((a,b)=>a+b,0)/batTop.length + Math.min(4, depth);

  const {unit:bowlUnit, partTimer} = getBowlingUnit(xi);
  const top5 = bowlUnit.map(p=>{
    const idx = xi.indexOf(p);
    const posLift = idx>=0 && positionPenalty(p, idx+1)===0 ? 0.1 : 0;
    const base = p.r + posLift;
    return partTimer && p.n===partTimer.n ? base*0.82 : base;
  }).sort((a,b)=>b-a).slice(0,5);
  const bowl = top5.reduce((a,b)=>a+b,0)/Math.max(top5.length,1);

  const decadesUsed = new Set(xi.map(p=>p.d)).size;
  const nationsUsed = new Set(xi.map(p=>p.c)).size;
  let bonus = 0, notes=[];
  const arDeep = xi.slice(7).some(p=>p.roles.includes('ar'));
  const arTop = xi.slice(0,5).some(p=>p.roles.includes('ar'));
  if(arDeep) notes.push('An all-rounder gives the lower order extra batting depth.');
  if(arTop) notes.push('An all-rounder in the top five adds a bowling option up front.');
  if(partTimer) notes.push(`${partTimer.n} rounds out the bowling as a part-timer.`);
  else notes.push(`${bowlUnit.length} bowling option${bowlUnit.length===1?'':'s'} in the XI.`);
  if(misplaced>0) notes.push(`${misplaced} player${misplaced===1?' is':'s are'} batting out of their natural position.`);
  if(decadesUsed>=4){bonus+=3; notes.push(`Time-travelling XI: ${decadesUsed} decades represented.`);}
  if(nationsUsed>=6){bonus+=3; notes.push(`World XI: ${nationsUsed} nations in one dressing room.`);}
  const capMatch = FMTKEY!=='hundred' ? isEliteCaptain(xi[captainIdx], FMTKEY) : null;
  if(capMatch){ bonus += 0.25; notes.push(`🎖️ ${capMatch.n} captains, with a genuine ${DECADE_LABEL[capMatch.d]} ${FMT.label} leadership record.`); }
  const inPositionCount = xi.filter((p,i)=>positionPenalty(p, i+1)===0).length;
  if(inPositionCount>0) notes.push(`${inPositionCount} player${inPositionCount===1?'':'s'} in ${inPositionCount===1?'its':'their'} natural position.`);
  const strength = bat*0.5 + bowl*0.5 + bonus;
  // Display cap only — individual player ratings top out at 99, so the
  // shown team number should too. strength (used for match odds) is
  // computed above from the uncapped bat/bowl and is unaffected.
  return {bat:Math.min(99, Math.round(bat)), bowl:Math.min(99, Math.round(bowl)), strength, notes};
}

function decideMatch(strength, oppRating){
  const diff = strength - oppRating;
  const pW = clamp(0.50 + diff*0.02, 0.06, 0.85);
  if(FMTKEY==='test'){
    const pD = clamp(0.13 - diff*0.004, 0.04, 0.18);
    const roll = Math.random();
    return { code: roll<pW ? 'W' : roll<pW+pD ? 'D' : 'L', superOver:false };
  }
  const pTie = clamp(0.08 - Math.abs(diff)*0.0015, 0.02, 0.08);
  if(Math.random() < pTie){
    const pWsuper = clamp(0.5 + diff*0.05, 0.18, 0.82);
    return { code: Math.random()<pWsuper ? 'W' : 'L', superOver:true };
  }
  const rescaled = clamp(pW/(1-pTie), 0.06, 0.85);
  return { code: Math.random()<rescaled ? 'W' : 'L', superOver:false };
}

function decideNeutral(oppA, oppB){
  const diff = oppA - oppB;
  const pTie = clamp(0.08 - Math.abs(diff)*0.0015, 0.02, 0.08);
  if(Math.random() < pTie) return Math.random() < clamp(0.5+diff*0.05,0.18,0.82);
  return Math.random() < clamp(clamp(0.5+diff*0.04,0.06,0.95)/(1-pTie), 0.06, 0.95);
}

function genTestMatch(code, nat){
  const oppLabel = nat.isAllStar ? 'All-Stars' : (nat.natId || nat.id);
  let score, margin, pts, yourInningsList, oppInningsList;
  if(code==='D'){
    const a1=rand(300,540), b1=rand(280,520), a2=rand(150,330), a2w=rand(4,8), b2=rand(90,260), b2w=rand(4,9);
    score=`You ${b1} & ${b2}/${b2w} \u00b7 ${oppLabel} ${a1} & ${a2}/${a2w}d`;
    margin=pickOne(['drawn \u2014 last pair survive','drawn \u2014 flat pitch wins','drawn \u2014 nine down at stumps']);
    pts = 35;
    yourInningsList = [{total:b1, wkts:10}, {total:b2, wkts:b2w}];
    oppInningsList = [{total:a1, wkts:10}, {total:a2, wkts:a2w}];
  } else {
    const weWin = code==='W';
    const style = Math.random()<0.18?'inn':(Math.random()<0.5?'runs':'wkts');
    if(style==='inn'){
      const big=rand(440,660), x1=rand(120,300), x2=rand(80,Math.max(90,big-x1-15));
      const gap=Math.max(5,big-x1-x2);
      score = weWin ? `You ${big}d \u00b7 ${oppLabel} ${x1} & ${x2}` : `${oppLabel} ${big}d \u00b7 You ${x1} & ${x2}`;
      margin = `${weWin?'won':'lost'} by an innings & ${gap} runs`;
      pts = weWin ? 190 : -160;
      const winnerList = [{total:big, wkts:9}], loserList = [{total:x1, wkts:10}, {total:x2, wkts:10}];
      if(weWin){ yourInningsList=winnerList; oppInningsList=loserList; }
      else { oppInningsList=winnerList; yourInningsList=loserList; }
    } else if(style==='runs'){
      const f1=rand(260,500), f2=rand(140,330), R=rand(25,260);
      const c1=rand(120,Math.max(140,Math.min(360,f1+f2-R-60))), c2=Math.max(40,f1+f2-c1-R);
      score = weWin ? `You ${f1} & ${f2}d \u00b7 ${oppLabel} ${c1} & ${c2}`
                    : `${oppLabel} ${f1} & ${f2}d \u00b7 You ${c1} & ${c2}`;
      margin = `${weWin?'won':'lost'} by ${R} runs`;
      pts = weWin ? 100 + clamp(R/3, 5, 85) : -(70 + clamp(R/4, 5, 60));
      const winnerList = [{total:f1, wkts:10}, {total:f2, wkts:9}], loserList = [{total:c1, wkts:10}, {total:c2, wkts:10}];
      if(weWin){ yourInningsList=winnerList; oppInningsList=loserList; }
      else { oppInningsList=winnerList; yourInningsList=loserList; }
    } else {
      const a1=rand(180,400), b1=rand(150,420), a2=rand(140,360);
      const chase=Math.max(30,a1+a2-b1+1), w=rand(2,8);
      score = weWin ? `${oppLabel} ${a1} & ${a2} \u00b7 You ${b1} & ${chase}/${10-w}`
                    : `You ${a1} & ${a2} \u00b7 ${oppLabel} ${b1} & ${chase}/${10-w}`;
      margin = `${weWin?'won':'lost'} by ${w} wickets`;
      pts = weWin ? 100 + clamp(w*10, 20, 80) : -(70 + clamp(w*8, 15, 60));
      const fullList = [{total:a1, wkts:10}, {total:a2, wkts:10}], chaseList = [{total:b1, wkts:10}, {total:chase, wkts:10-w}];
      if(weWin){ yourInningsList=chaseList; oppInningsList=fullList; }
      else { oppInningsList=chaseList; yourInningsList=fullList; }
    }
  }
  const sum = (list)=>list.reduce((a,e)=>a+e.total,0);
  const yourTotal = sum(yourInningsList), oppTotal = sum(oppInningsList);
  const yourWkts = yourInningsList[yourInningsList.length-1].wkts, oppWkts = oppInningsList[oppInningsList.length-1].wkts;
  return {score, margin, pts: Math.round(pts), yourTotal, yourWkts, oppTotal, oppWkts, yourInningsList, oppInningsList};
}

function genWhiteBallMatch(code, nat, superOver){
  const oppLabel = nat.isAllStar ? 'All-Stars' : (nat.natId || nat.id);
  const t20 = FMTKEY==='t20';
  const lo=t20?130:220, hi=t20?225:380, ov=t20?'20 ov':'50 ov';
  const weWin = code==='W';
  const runMult = t20 ? 1.4 : 0.65;
  if(superOver){
    const x=rand(lo+20,hi-10), w1=rand(4,9), w2=rand(4,9);
    const mine=rand(9, t20?24:20), theirs= weWin? rand(Math.max(3,mine-9),mine-1) : rand(mine+1,mine+9);
    const line = weWin ? `Super Over: You ${mine}/${rand(0,2)} beat ${oppLabel} ${theirs}/${rand(0,2)}`
                        : `Super Over: ${oppLabel} ${mine}/${rand(0,2)} beat You ${theirs}/${rand(0,2)}`;
    return {score:`You ${x}/${w1} (${ov}) \u00b7 ${oppLabel} ${x}/${w2} (${ov})`, margin:line, pts: weWin?115:-75,
            yourTotal:x, yourWkts:w1, oppTotal:x, oppWkts:w2};
  }
  if(Math.random()<0.5){
    const first=rand(lo+30,hi), R=rand(t20?4:8, t20?60:130), chase=Math.max(40,first-R);
    const bonus = clamp(R*runMult, 5, 85);
    const firstWkts = rand(3,8);
    const fielded = weWin ? {yourTotal:first, yourWkts:firstWkts, oppTotal:chase, oppWkts:10}
                          : {oppTotal:first, oppWkts:firstWkts, yourTotal:chase, yourWkts:10};
    return {score: weWin?`You ${first}/${firstWkts} (${ov}) \u00b7 ${oppLabel} ${chase} all out`
                        :`${oppLabel} ${first}/${firstWkts} (${ov}) \u00b7 You ${chase} all out`,
            margin:`${weWin?'won':'lost'} by ${first-chase} runs`,
            pts: Math.round(weWin ? 100+bonus : -(65+bonus*0.7)), ...fielded};
  } else {
    const first=rand(lo,hi-25), w=rand(1,8);
    const bonus = clamp(w*11, 15, 85);
    const firstWkts = rand(5,10), chase=first+rand(1,6);
    const fielded = weWin ? {oppTotal:first, oppWkts:firstWkts, yourTotal:chase, yourWkts:10-w}
                          : {yourTotal:first, yourWkts:firstWkts, oppTotal:chase, oppWkts:10-w};
    return {score: weWin?`${oppLabel} ${first}/${firstWkts} (${ov}) \u00b7 You ${chase}/${10-w}`
                        :`You ${first}/${firstWkts} (${ov}) \u00b7 ${oppLabel} ${chase}/${10-w}`,
            margin:`${weWin?'won':'lost'} by ${w} wickets`,
            pts: Math.round(weWin ? 100+bonus : -(65+bonus*0.6)), ...fielded};
  }
}

/* Mirrors index.html's buildOppositionXI exactly -- pure/deterministic
   (no RNG), so client and server always compute the identical XI for a
   given (nation, format) with zero lockstep risk. */
function buildOppositionXI(natId, poolKey){
  poolKey = poolKey || FMTKEY;
  const src = DB[poolKey];
  const pool0 = src.filter(p=>p.c===natId && p.d==='2020s' && !p.retired);
  const keeperOk = pool0.some(p=>p.roles.includes('wk'));
  const bowlArOk = pool0.filter(p=>p.roles.includes('bowl')||p.roles.includes('ar')).length>=5;
  const pool = (pool0.length>=11 && keeperOk && bowlArOk) ? pool0
    : src.filter(p=>p.c===natId && p.d==='2020s'); // fallback: drop the retired filter

  const byMat = pool.slice().sort((a,b)=>b.mat-a.mat);
  const drafted = [], used = new Set();
  const keeper = byMat.find(p=>p.roles.includes('wk'));
  if(keeper){ drafted.push(keeper); used.add(keeper.n); }
  const bowlArCandidates = byMat.filter(p=>!used.has(p.n) && (p.roles.includes('bowl')||p.roles.includes('ar')));
  // A player can appear more than once in the pool under the same name
  // (e.g. the all-time "best" dataset rates one legendary career across
  // multiple decade-peaks) -- bowlArCandidates is computed once up front,
  // so `used` must be re-checked INSIDE this loop, not just at filter
  // time, or the same real person can be drafted twice.
  let bowlArTaken = 0;
  for(const p of bowlArCandidates){
    if(bowlArTaken>=5) break;
    if(used.has(p.n)) continue;
    drafted.push(p); used.add(p.n); bowlArTaken++;
  }
  for(const p of byMat){
    if(drafted.length>=11) break;
    if(used.has(p.n)) continue;
    drafted.push(p); used.add(p.n);
  }

  const xiSlots = new Array(11).fill(null);
  drafted.forEach(p=>{
    let bestSlot=-1, bestPen=Infinity;
    for(let i=0;i<11;i++){
      if(xiSlots[i] || !SLOTS[i].fits(p)) continue;
      const pen = positionPenalty(p, i+1);
      if(pen<bestPen){ bestPen=pen; bestSlot=i; }
    }
    if(bestSlot===-1) bestSlot = xiSlots.findIndex(s=>!s);
    if(bestSlot>=0) xiSlots[bestSlot] = p;
  });
  return xiSlots.filter(Boolean);
}
const oppositionXICache = new Map();
function getOppositionXI(natId, poolKey){
  poolKey = poolKey || FMTKEY;
  const key = poolKey+'|'+natId;
  if(!oppositionXICache.has(key)) oppositionXICache.set(key, buildOppositionXI(natId, poolKey));
  return oppositionXICache.get(key);
}

/* ---- World Tour finale: World All-Star XI --------------------------
   Ten pseudo-nations spanning a 90-99 difficulty band replace
   Afghanistan's old slot as the tour's 12th/final stop -- one is drawn
   at random each tour, always a 5-match series at Lord's (venues has
   just the one entry, so the existing m%venues.length rotation already
   lands on it every match with no special-casing). Like every real
   NATIONS entry, `opp` alone drives match difficulty; the roster below
   exists purely for the scorecard. */
const ALLSTAR_TEAMS = [
  {id:'WXI99', name:'World All-Stars (99 Rated)', flag:'🌍', opp:99, venues:["Lord's"], isAllStar:true},
  {id:'WXI98', name:'World All-Stars (98 Rated)', flag:'🌍', opp:98, venues:["Lord's"], isAllStar:true},
  {id:'WXI97', name:'World All-Stars (97 Rated)', flag:'🌍', opp:97, venues:["Lord's"], isAllStar:true},
  {id:'WXI96', name:'World All-Stars (96 Rated)', flag:'🌍', opp:96, venues:["Lord's"], isAllStar:true},
  {id:'WXI95', name:'World All-Stars (95 Rated)', flag:'🌍', opp:95, venues:["Lord's"], isAllStar:true},
  {id:'WXI94', name:'World All-Stars (94 Rated)', flag:'🌍', opp:94, venues:["Lord's"], isAllStar:true},
  {id:'WXI93', name:'World All-Stars (93 Rated)', flag:'🌍', opp:93, venues:["Lord's"], isAllStar:true},
  {id:'WXI92', name:'World All-Stars (92 Rated)', flag:'🌍', opp:92, venues:["Lord's"], isAllStar:true},
  {id:'WXI91', name:'World All-Stars (91 Rated)', flag:'🌍', opp:91, venues:["Lord's"], isAllStar:true},
  {id:'WXI90', name:'World All-Stars (90 Rated)', flag:'🌍', opp:90, venues:["Lord's"], isAllStar:true},
];
/* Shared keeper/5-bowlAr/fill/slot-fit shape used by buildOppositionXI
   and buildAllStarXI too, factored out here since this is the first
   spot that needs to run it more than once in a row (all ten tiers,
   see buildAllWorldAllStarXIs below). */
function draftXIFromPool(candidates){
  const drafted = [], used = new Set();
  const keeper = candidates.find(p=>p.roles.includes('wk'));
  if(keeper){ drafted.push(keeper); used.add(keeper.n); }
  const bowlArCandidates = candidates.filter(p=>!used.has(p.n) && (p.roles.includes('bowl')||p.roles.includes('ar')));
  let bowlArTaken = 0;
  for(const p of bowlArCandidates){
    if(bowlArTaken>=5) break;
    if(used.has(p.n)) continue;
    drafted.push(p); used.add(p.n); bowlArTaken++;
  }
  for(const p of candidates){
    if(drafted.length>=11) break;
    if(used.has(p.n)) continue;
    drafted.push(p); used.add(p.n);
  }
  const xiSlots = new Array(11).fill(null);
  drafted.forEach(p=>{
    let bestSlot=-1, bestPen=Infinity;
    for(let i=0;i<11;i++){
      if(xiSlots[i] || !SLOTS[i].fits(p)) continue;
      const pen = positionPenalty(p, i+1);
      if(pen<bestPen){ bestPen=pen; bestSlot=i; }
    }
    if(bestSlot===-1) bestSlot = xiSlots.findIndex(s=>!s);
    if(bestSlot>=0) xiSlots[bestSlot] = p;
  });
  return xiSlots.filter(Boolean);
}
/* All ten tiers are drafted together in ONE pass, strongest (99) first,
   each subsequent tier excluding every player already taken by a
   stronger tier -- so the ten rosters are genuinely distinct XIs
   drawing from progressively deeper talent, not overlapping slices of
   the same short list of legends. Sourced globally across every
   nation in DB[FMTKEY] (not one country), matching the format the
   whole tour is being played in. Deterministic, no RNG. */
function buildAllWorldAllStarXIs(){
  const pool = DB[FMTKEY];
  const byName = new Map();
  for(const p of pool) if(!byName.has(p.n) || p.r > byName.get(p.n).r) byName.set(p.n, p);
  const ranked = [...byName.values()].sort((a,b)=>b.r-a.r);
  const globallyUsed = new Set();
  const tiers = [];
  for(let i=0;i<ALLSTAR_TEAMS.length;i++){
    const candidates = ranked.filter(p=>!globallyUsed.has(p.n));
    const xi = draftXIFromPool(candidates);
    xi.forEach(p=>globallyUsed.add(p.n));
    tiers.push(xi);
  }
  return tiers;
}
const worldAllStarXICache = new Map();
function getWorldAllStarXI(teamId){
  if(!worldAllStarXICache.has(FMTKEY)) worldAllStarXICache.set(FMTKEY, buildAllWorldAllStarXIs());
  const tiers = worldAllStarXICache.get(FMTKEY);
  return tiers[ALLSTAR_TEAMS.findIndex(t=>t.id===teamId)];
}

function buildAllStarXI(natId, poolKey){
  poolKey = poolKey || FMTKEY;
  const pool = DB[poolKey].filter(p=>p.c===natId);

  const byRating = pool.slice().sort((a,b)=>b.r-a.r);
  const drafted = [], used = new Set();
  const keeper = byRating.find(p=>p.roles.includes('wk'));
  if(keeper){ drafted.push(keeper); used.add(keeper.n); }
  const bowlArCandidates = byRating.filter(p=>!used.has(p.n) && (p.roles.includes('bowl')||p.roles.includes('ar')));
  // A player can appear more than once in the pool under the same name
  // (e.g. the all-time "best" dataset rates one legendary career across
  // multiple decade-peaks) -- bowlArCandidates is computed once up front,
  // so `used` must be re-checked INSIDE this loop, not just at filter
  // time, or the same real person can be drafted twice.
  let bowlArTaken = 0;
  for(const p of bowlArCandidates){
    if(bowlArTaken>=5) break;
    if(used.has(p.n)) continue;
    drafted.push(p); used.add(p.n); bowlArTaken++;
  }
  for(const p of byRating){
    if(drafted.length>=11) break;
    if(used.has(p.n)) continue;
    drafted.push(p); used.add(p.n);
  }

  const xiSlots = new Array(11).fill(null);
  drafted.forEach(p=>{
    let bestSlot=-1, bestPen=Infinity;
    for(let i=0;i<11;i++){
      if(xiSlots[i] || !SLOTS[i].fits(p)) continue;
      const pen = positionPenalty(p, i+1);
      if(pen<bestPen){ bestPen=pen; bestSlot=i; }
    }
    if(bestSlot===-1) bestSlot = xiSlots.findIndex(s=>!s);
    if(bestSlot>=0) xiSlots[bestSlot] = p;
  });
  return xiSlots.filter(Boolean);
}
const allStarXICache = new Map();
function getAllStarXI(natId, poolKey){
  poolKey = poolKey || FMTKEY;
  const key = poolKey+'|'+natId;
  if(!allStarXICache.has(key)) allStarXICache.set(key, buildAllStarXI(natId, poolKey));
  return allStarXICache.get(key);
}

/* Batting and bowling for one innings are built TOGETHER, not
   independently, so that "who dismissed this batter" and "how many
   wickets that bowler shows in the bowling card" can never disagree.
   Run outs are excluded from bowler credit (matching real scorecards --
   a run out is a fielding dismissal, not a bowling one), so the
   bowling card's wicket tally can be a little less than the innings'
   total wickets whenever a run out occurred. */
const DISMISSAL_TYPES = ['b','c','lbw','st','run out','c&b'];
function buildInningsPair(battingXi, bowlingXi, total, wkts){
  const test = FMTKEY==='test', t20 = FMTKEY==='t20';
  const battersUsed = Math.min(battingXi.length, wkts+1);

  const weights = [];
  for(let i=0;i<battersUsed;i++){
    const p = battingXi[i], pos = i+1;
    const pureBowler = p.roles.includes('bowl') && !p.roles.includes('ar');
    let w;
    if(pureBowler) w = 0.15 + Math.random()*0.15;
    else {
      const effR = Math.max(1, p.r - positionPenalty(p, pos));
      const posMult = pos<=3?1.15:pos<=6?1.0:pos<=8?0.55:0.3;
      w = Math.max(0.05, (effR/90)*posMult) * (0.5+Math.random());
    }
    weights.push(w);
  }
  const wsum = weights.reduce((a,b)=>a+b,0) || 1;
  const scores = weights.map(w=>Math.max(0, Math.round(total*w/wsum)));
  let drift = total - scores.reduce((a,b)=>a+b,0);
  if(scores.length){ scores[0] = Math.max(0, scores[0]+drift); drift = total - scores.reduce((a,b)=>a+b,0); if(drift) scores[scores.length-1] = Math.max(0, scores[scores.length-1]+drift); }

  const outIdx = [];
  const types = new Array(battersUsed).fill(null);
  for(let i=0;i<battersUsed;i++){
    const isLast = i===battersUsed-1;
    const notOut = isLast && wkts<10;
    if(notOut) continue;
    types[i] = pickOne(DISMISSAL_TYPES);
    outIdx.push(i);
  }
  const creditableIdx = outIdx.filter(i=>types[i]!=='run out');

  const {unit:bowlUnit, partTimer} = getBowlingUnit(bowlingXi);
  const bowlWeights = bowlUnit.map(p=>{
    const isAR = p.roles.includes('ar') && !p.roles.includes('bowl');
    const partTime = !!(partTimer && p.n===partTimer.n);
    const base = Math.max(0.1, (p.r-70)/30) * (isAR?0.6:1) * (partTime?0.3:1);
    return base * (0.5+Math.random());
  });
  const bwsum = bowlWeights.reduce((a,b)=>a+b,0) || 1;
  const creditableWkts = creditableIdx.length;
  const wktsDist = bowlWeights.map(w=>Math.max(0, Math.round(creditableWkts*w/bwsum)));
  let wDrift = creditableWkts - wktsDist.reduce((a,b)=>a+b,0);
  let guard = 0;
  while(wDrift!==0 && wktsDist.length && guard<200){
    const i = guard % wktsDist.length;
    if(wDrift>0){ wktsDist[i]++; wDrift--; }
    else if(wktsDist[i]>0){ wktsDist[i]--; wDrift++; }
    guard++;
  }

  let creditPool = [];
  bowlUnit.forEach((p,i)=>{ for(let k=0;k<wktsDist[i];k++) creditPool.push(p); });
  creditPool = shuffle(creditPool);
  const bowlerFor = new Map();
  creditableIdx.forEach((idx,k)=>{ bowlerFor.set(idx, creditPool[k]); });

  const keeper = bowlingXi.find(p=>p.roles.includes('wk'));
  const fielderFor = new Map();
  outIdx.forEach(idx=>{
    const t = types[idx];
    if(t==='c') fielderFor.set(idx, pickOne(bowlingXi));
    else if(t==='st' && keeper) fielderFor.set(idx, keeper);
    else if(t==='run out') fielderFor.set(idx, pickOne(bowlingXi));
    else if(t==='c&b') fielderFor.set(idx, bowlerFor.get(idx));
  });

  const battingCard = battingXi.map((p,i)=>{
    if(i>=battersUsed) return {n:p.n, runs:null, out:null, bowler:null, fielder:null, notOut:false, dnb:true};
    const isLast = i===battersUsed-1;
    const notOut = isLast && wkts<10;
    if(notOut) return {n:p.n, runs:scores[i], out:null, bowler:null, fielder:null, notOut:true, dnb:false};
    const t = types[i];
    const bowler = t==='run out' ? null : (bowlerFor.get(i) || null);
    const fielder = fielderFor.get(i) || null;
    return {n:p.n, runs:scores[i], out:t, bowler: bowler?bowler.n:null, fielder: fielder?fielder.n:null, notOut:false, dnb:false};
  });

  const runsDist = bowlWeights.map(w=>Math.max(0, Math.round(total*w/bwsum)));
  let rDrift = total - runsDist.reduce((a,b)=>a+b,0);
  if(runsDist.length) runsDist[0] = Math.max(0, runsDist[0]+rDrift);
  const totalOvers = t20?20:50;
  const oversDist = bowlUnit.map(p=>{
    const partTime = !!(partTimer && p.n===partTimer.n);
    if(test) return Math.max(2, Math.round(3+Math.random()*20));
    const cap = t20?4:10;
    return Math.min(cap, Math.max(1, Math.round((totalOvers/bowlUnit.length)*(partTime?0.4:1)*(0.7+Math.random()*0.6))));
  });
  const bowlingCard = bowlUnit.map((p,i)=>({n:p.n, overs:oversDist[i], runs:runsDist[i], wkts:wktsDist[i]}));

  return { battingCard, bowlingCard };
}
function buildMatchScorecard(xiList, oppXi, yourInningsList, oppInningsList, oppLabel){
  const innings = [];
  const n = Math.max(yourInningsList.length, oppInningsList.length);
  for(let i=0;i<n;i++){
    if(yourInningsList[i]){
      const {total, wkts} = yourInningsList[i];
      const {battingCard, bowlingCard} = buildInningsPair(xiList, oppXi, total, wkts);
      innings.push({ battingTeam:'you', battingCard, bowlingTeam: oppLabel, bowlingCard, total, wkts });
    }
    if(oppInningsList[i]){
      const {total, wkts} = oppInningsList[i];
      const {battingCard, bowlingCard} = buildInningsPair(oppXi, xiList, total, wkts);
      innings.push({ battingTeam: oppLabel, battingCard, bowlingTeam:'you', bowlingCard, total, wkts });
    }
  }
  return { innings, oppLabel };
}
function toInningsLists(gen){
  if(gen.yourInningsList) return {yourInningsList: gen.yourInningsList, oppInningsList: gen.oppInningsList};
  return {
    yourInningsList: [{total:gen.yourTotal, wkts:gen.yourWkts}],
    oppInningsList: [{total:gen.oppTotal, wkts:gen.oppWkts}],
  };
}

function genHundredMatch(code, team, superOver){
  const lo=100, hi=195;
  const weWin = code==='W';
  if(superOver){
    const x=rand(lo+15,hi-10), w1=rand(4,9), w2=rand(4,9);
    const mine=rand(6,17), theirs= weWin? rand(Math.max(2,mine-7),mine-1) : rand(mine+1,mine+7);
    const line = weWin ? `Super Five: You ${mine}/${rand(0,2)} beat ${team.id} ${theirs}/${rand(0,2)}`
                        : `Super Five: ${team.id} ${mine}/${rand(0,2)} beat You ${theirs}/${rand(0,2)}`;
    return {score:`You ${x}/${w1} (100b) \u00b7 ${team.id} ${x}/${w2} (100b)`, margin:line, pts: weWin?115:-75};
  }
  if(Math.random()<0.5){
    const first=rand(lo+20,hi), R=rand(4,45), chase=Math.max(35,first-R);
    const bonus = clamp(R*1.9, 5, 85);
    return {score: weWin?`You ${first}/${rand(3,8)} (100b) \u00b7 ${team.id} ${chase} all out`
                        :`${team.id} ${first}/${rand(3,8)} (100b) \u00b7 You ${chase} all out`,
            margin:`${weWin?'won':'lost'} by ${first-chase} runs`,
            pts: Math.round(weWin ? 100+bonus : -(65+bonus*0.7))};
  } else {
    const first=rand(lo,hi-20), w=rand(1,8);
    const bonus = clamp(w*11, 15, 85);
    return {score: weWin?`${team.id} ${first}/${rand(5,10)} (100b) \u00b7 You ${first+rand(1,5)}/${10-w}`
                        :`You ${first}/${rand(5,10)} (100b) \u00b7 ${team.id} ${first+rand(1,5)}/${10-w}`,
            margin:`${weWin?'won':'lost'} by ${w} wickets`,
            pts: Math.round(weWin ? 100+bonus : -(65+bonus*0.6))};
  }
}

function potmStat(p){
  const short=FMTKEY==='t20'||FMTKEY==='hundred', odi=FMTKEY==='odi';
  const role = p.roles[0];
  const bat = ()=> FMTKEY==='test' ? (Math.random()<0.3?`${rand(90,190)} & ${rand(40,110)}`:`${rand(85,224)}`)
              : odi ? `${rand(72,168)} (${rand(60,140)})` : `${rand(40,102)} (${rand(24,58)})`;
  const bowl= ()=> FMTKEY==='test' ? `${rand(5,9)}-${rand(34,130)} in the match` : `${rand(3,short?5:6)}-${rand(short?8:18,short?26:52)}`;
  if(role==='bowl') return bowl();
  if(role==='bat'||role==='wk') return bat();
  return Math.random()<0.5 ? bat() : bowl();
}

function pickPOTM(code, nat){
  if(code!=='L'){
    const pool=[...xi].sort((a,b)=>b.r-a.r);
    const p=pool[Math.min(pool.length-1, Math.floor(Math.pow(Math.random(),2)*7))];
    return `${p.n} \u2014 ${potmStat(p)}`;
  }
  if(FMTKEY==='hundred' && HUNDRED_SQUADS[nat.id]){
    const squad=[...HUNDRED_SQUADS[nat.id]].sort((a,b)=>b.rt-a.rt);
    const real=squad[Math.min(squad.length-1, Math.floor(Math.random()*4))];
    const stub={roles:real.roles, r:real.rt};
    return `${real.n} (${nat.name}) \u2014 ${potmStat(stub)}`;
  }
  const realNatId = nat.natId || nat.id;
  let opp=PLAYERS.filter(x=>x.c===realNatId && x.d===(FMTKEY==='hundred' ? '20s' : '2020s') && !draftedNames.has(x.n));
  if(!opp.length) opp=PLAYERS.filter(x=>x.c===realNatId && !draftedNames.has(x.n));
  if(!opp.length) return `their captain \u2014 match-winning knock`;
  const p=opp.sort((a,b)=>b.r-a.r)[Math.min(opp.length-1,Math.floor(Math.random()*3))];
  return `${p.n} (${realNatId}) \u2014 ${potmStat(p)}`;
}

function buildHundredTable(opponents, yourMatches){
  const mirror = {};
  opponents.forEach((team,i)=>{
    mirror[team.id] = yourMatches[i].code==='W' ? {w:0,l:1} : {w:1,l:0};
  });
  const recs = {}; opponents.forEach(t=>recs[t.id]={w:0,l:0});
  for(let i=0;i<opponents.length;i++){
    for(let j=i+1;j<opponents.length;j++){
      const A=opponents[i], B=opponents[j];
      if(decideNeutral(A.opp,B.opp)){ recs[A.id].w++; recs[B.id].l++; } else { recs[B.id].w++; recs[A.id].l++; }
    }
  }
  const rows = opponents.map(t=>{
    const w=recs[t.id].w+mirror[t.id].w, l=recs[t.id].l+mirror[t.id].l;
    return {id:t.id, name:t.name, flag:t.flag, team:t, wins:w, losses:l, pts:w*2, isYou:false, jitter:Math.random()};
  });
  const yourW=yourMatches.filter(m=>m.code==='W').length, yourL=yourMatches.filter(m=>m.code==='L').length;
  rows.push({id:'YOU', name:'Your Legends XI', flag:'\u2b50', team:null, wins:yourW, losses:yourL, pts:yourW*2, isYou:true, jitter:Math.random()});
  rows.sort((a,b)=> b.pts-a.pts || b.wins-a.wins || b.jitter-a.jitter);
  return rows;
}

function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function rand(a,b){return a+Math.floor(Math.random()*(b-a+1));}
function pickOne(a){return a[Math.floor(Math.random()*a.length)];}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}

/* ================= SERVER SIMULATION DRIVER ================= */

/* ===================== REPRESENT YOUR NATION — server verification =====================
   Extracted verbatim from the client's decideRepresentMatch / decideRepresentNeutral /
   genTieMatch / buildRepresentTable. Random-number consumption must match the client
   call-for-call: shuffle(11 opponents) -> for each of your 11 matches
   [decideRepresentMatch, then genTestMatch/genWhiteBallMatch/genTieMatch, then pickPOTM]
   -> the 55 background matches [decideRepresentNeutral] -> 12 jitter rolls (one per
   table row, used for stable tie-break sorting). Any deviation from this exact order
   desyncs the seeded sequence and produces a different table than the client saw. */
// Small ratings bump for whichever side is hosting a leg of the home-and-away
// league, and the score/leaderboard-points bonus for reaching/winning the
// Lord's final (§ decideRepresentFinal below) — never written into the table's
// own pts, which must stay pure league points.
const HOME_BONUS = 3;
const REPRESENT_FINAL_BONUS = {win:60, draw:45, loss:25};

function decideRepresentMatch(strength, oppRating, homeBonus=0){
  const diff = strength - oppRating + homeBonus;
  const pW = clamp(0.50 + diff*0.02, 0.06, 0.85);
  if(FMTKEY==='test'){
    const pD = clamp(0.13 - diff*0.004, 0.04, 0.18);
    const roll = Math.random();
    return roll<pW ? 'W' : roll<pW+pD ? 'D' : 'L';
  }
  const pTie = clamp(0.08 - Math.abs(diff)*0.0015, 0.02, 0.08);
  const roll = Math.random();
  if(roll<pTie) return 'T';
  const rescaled = clamp(pW/(1-pTie), 0.06, 0.85);
  return Math.random()<rescaled ? 'W' : 'L';
}
function decideRepresentNeutral(oppA, oppB, homeBonus=0){
  const diff = oppA - oppB + homeBonus;
  const pW = clamp(0.50 + diff*0.02, 0.06, 0.85);
  if(FMTKEY==='test'){
    const pD = clamp(0.13 - diff*0.004, 0.04, 0.18);
    const roll = Math.random();
    return roll<pW ? 'A' : roll<pW+pD ? 'D' : 'B';
  }
  const pTie = clamp(0.08 - Math.abs(diff)*0.0015, 0.02, 0.08);
  const roll = Math.random();
  if(roll<pTie) return 'T';
  const rescaled = clamp(pW/(1-pTie), 0.06, 0.85);
  return Math.random()<rescaled ? 'A' : 'B';
}
// Reuses decideMatch's existing win-probability shape (draw possible in Test,
// white-ball ties auto-resolved via one extra Super-Over-style roll) so the
// Lord's final always produces a decisive result except for a genuine Test
// draw — no new RNG-consuming logic needed to keep client/server in lockstep.
// Lord's is neutral: no home bonus applies here.
function decideRepresentFinal(strength, oppRating){ return decideMatch(strength, oppRating); }
function genTieMatch(){
  // Display text is never used server-side, but rand() must be called the
  // identical number of times (3: score, w1, w2), in the same order, as
  // the client's version to keep the seeded sequence in sync -- and the
  // totals ARE now used server-side, to feed buildMatchScorecard.
  const t20 = FMTKEY==='t20';
  const lo = t20?130:220, hi = t20?225:380;
  const score = rand(lo+20, hi-10);
  const w1 = rand(4,9), w2 = rand(4,9);
  return { yourTotal:score, yourWkts:w1, oppTotal:score, oppWkts:w2 };
}
function buildRepresentTable(yourNat, opponents, yourMatches){
  const recs = {};
  const allNats = [yourNat, ...opponents];
  allNats.forEach(n=>recs[n.id]={w:0,d:0,t:0,l:0,pts:0});

  yourMatches.forEach(m=>{
    const oppId = m.opp.id;
    if(m.code==='W'){ recs[yourNat.id].w++; recs[yourNat.id].pts+=12; recs[oppId].l++; }
    else if(m.code==='D'){ recs[yourNat.id].d++; recs[yourNat.id].pts+=4; recs[oppId].d++; recs[oppId].pts+=4; }
    else if(m.code==='T'){ recs[yourNat.id].t++; recs[yourNat.id].pts+=6; recs[oppId].t++; recs[oppId].pts+=6; }
    else { recs[yourNat.id].l++; recs[oppId].w++; recs[oppId].pts+=12; }
  });

  function applyResult(A, B, result){
    if(result==='A'){ recs[A.id].w++; recs[A.id].pts+=12; recs[B.id].l++; }
    else if(result==='B'){ recs[B.id].w++; recs[B.id].pts+=12; recs[A.id].l++; }
    else if(result==='D'){ recs[A.id].d++; recs[A.id].pts+=4; recs[B.id].d++; recs[B.id].pts+=4; }
    else if(result==='T'){ recs[A.id].t++; recs[A.id].pts+=6; recs[B.id].t++; recs[B.id].pts+=6; }
  }

  for(let i=0;i<opponents.length;i++){
    for(let j=i+1;j<opponents.length;j++){
      const A=opponents[i], B=opponents[j];
      for(let leg=0; leg<5; leg++){   // 5-match series, alternating: A hosts 3, B hosts 2
        const homeBonus = leg%2===0 ? HOME_BONUS : -HOME_BONUS;
        applyResult(A, B, decideRepresentNeutral(A.opp, B.opp, homeBonus));
      }
    }
  }

  const rows = allNats.map(n=>({
    id:n.id, name:n.name, flag:n.flag, isYou:n.id===yourNat.id,
    w:recs[n.id].w, d:recs[n.id].d, t:recs[n.id].t, l:recs[n.id].l, pts:recs[n.id].pts,
    jitter:Math.random()
  }));
  rows.sort((a,b)=> b.pts-a.pts || b.w-a.w || b.jitter-a.jitter);
  return rows;
}

function calculateRepresentResult({ format, country, seed, xi: clientXi, captainIdx }) {
  if (!['test','odi','t20'].includes(format)) throw new Error('bad format');
  if (!NATIONS.some(n => n.id === country)) throw new Error('bad country');
  if (!Number.isInteger(seed)) throw new Error('bad seed');

  const nativeRandom = Math.random;
  Math.random = mulberry32(seed);

  try {
    __setFMTKEY(format);

    if (!Array.isArray(clientXi) || clientXi.length !== 11) throw new Error('XI must have exactly 11 players');
    const pool = DB[format];
    const seen = new Set();
    const fullXi = clientXi.map((p) => {
      if (!p || typeof p.n !== 'string' || typeof p.d !== 'string' || typeof p.c !== 'string') throw new Error('bad player entry');
      const found = pool.find((x) => x.n === p.n && x.d === p.d && x.c === p.c);
      if (!found) throw new Error('player not found: ' + p.n + ' (' + p.c + ', ' + p.d + ')');
      if (seen.has(found.n)) throw new Error('duplicate player: ' + found.n);
      seen.add(found.n);
      return found;
    });
    // Represent Your Nation's core rule: every player must genuinely
    // be from the declared country — this is what the client-side
    // draft restriction enforces, and the server re-checks it rather
    // than trusting the client did.
    if (fullXi.some((p) => p.c !== country)) throw new Error('every player must be from ' + country + ' to represent that nation');
    for (let i = 0; i < 11; i++) {
      if (!SLOTS[i].fits(fullXi[i])) throw new Error(`player at slot ${i + 1} (${fullXi[i].n}) is not eligible for that slot`);
    }
    if (!fullXi.some((p) => p.roles.includes('wk'))) throw new Error('XI has no wicketkeeper');

    __setXI(fullXi);
    __setCaptainIdx(captainIdx);

    const st = teamStrengths();
    const yourNat = NATIONS.find((n) => n.id === country);
    const opponents = shuffle(NATIONS.filter((n) => n.id !== country));

    const hasSpin = hasWorldClassBowlingType(fullXi, 'spin');
    const hasPace = hasWorldClassBowlingType(fullXi, 'pace');
    const statsBonus = computeStatsBonus(fullXi);
    let streakAlive = true; // Immortal-XI boost: on while still undefeated (league + final), off for good after any non-win

    const yourMatches = [];
    opponents.forEach((opp) => {
      const conditionsPenalty = computeConditionsPenalty(opp, hasSpin, hasPace);
      for (let leg = 0; leg < 5; leg++) {   // 5-match series, alternating: 3 home, 2 away
        const homeBonus = leg % 2 === 0 ? HOME_BONUS : -HOME_BONUS;
        const effStrength = st.strength + statsBonus - conditionsPenalty - (BASE_DIFFICULTY_PENALTY[format]||0) + (streakAlive ? IMMORTAL_STREAK_BOOST[format] : 0);
        const code = decideRepresentMatch(effStrength, opp.opp, homeBonus);
        const gen = code === 'T' ? genTieMatch()
          : format === 'test' ? genTestMatch(code, opp)
          : genWhiteBallMatch(code, opp, false);
        const genLists = toInningsLists(gen);
        buildMatchScorecard(fullXi, getOppositionXI(opp.id), genLists.yourInningsList, genLists.oppInningsList, opp.id); // consumes RNG in lockstep with client; output unused server-side
        pickPOTM(code, opp); // consumes RNG in lockstep with client; output unused server-side
        if (code !== 'W') streakAlive = false;
        yourMatches.push({ opp, code });
      }
    });

    const table = buildRepresentTable(yourNat, opponents, yourMatches);
    const rank = table.findIndex((r) => r.isYou) + 1;
    const yourRow = table[rank - 1];

    // Lord's Championship Final — the top 2 in the table play a decisive
    // match at a neutral venue, in whatever format the league was played in.
    // Must run immediately after buildRepresentTable with nothing else
    // consuming Math.random in between, to stay in lockstep with the client.
    const finalistA = table[0], finalistB = table[1];
    const aNat = NATIONS.find((n) => n.id === finalistA.id);
    const bNat = NATIONS.find((n) => n.id === finalistB.id);
    const youAreFinalist = finalistA.isYou || finalistB.isYou;
    let finalCode;
    if (youAreFinalist) {
      const finalOppNat = finalistA.isYou ? bNat : aNat;
      const finalConditionsPenalty = computeConditionsPenalty(finalOppNat, hasSpin, hasPace);
      const finalEffStrength = st.strength + statsBonus - finalConditionsPenalty - (BASE_DIFFICULTY_PENALTY[format]||0) + (streakAlive ? IMMORTAL_STREAK_BOOST[format] : 0);
      const res = decideRepresentFinal(finalEffStrength, finalOppNat.opp);
      finalCode = res.code;
      const finalGen = format === 'test' ? genTestMatch(finalCode, finalOppNat) : genWhiteBallMatch(finalCode, finalOppNat, res.superOver);
      const finalLists = toInningsLists(finalGen);
      buildMatchScorecard(fullXi, getOppositionXI(finalOppNat.id), finalLists.yourInningsList, finalLists.oppInningsList, finalOppNat.id); // consumes RNG in lockstep with client; output unused server-side
      pickPOTM(finalCode, finalOppNat); // consumes RNG in lockstep with client; output unused server-side
    } else {
      finalCode = decideRepresentFinal(aNat.opp, bNat.opp).code; // relative to A; no gen/potm — you're not involved
    }

    let finalBonus = 0, finalSuffix = '';
    if (youAreFinalist) {
      if (finalCode === 'D') { finalBonus = REPRESENT_FINAL_BONUS.draw; finalSuffix = ', Final D'; }
      else if (finalCode === 'W') { finalBonus = REPRESENT_FINAL_BONUS.win; finalSuffix = ', Final W'; }
      else { finalBonus = REPRESENT_FINAL_BONUS.loss; finalSuffix = ', Final L'; }
    }

    const points = yourRow.pts + finalBonus;
    const record = `${yourRow.w}-${yourRow.d}-${yourRow.t}-${yourRow.l}${finalSuffix}`;

    return { rank, points, record, country };
  } finally {
    Math.random = nativeRandom;
  }
}

/* ===================== SERIES SHOWDOWN =====================
   Mirrors index.html's startSeriesShowdown()/SS_STOPS_DEF exactly. Six
   fixed stops: a 5-match series per format against the opponent's
   current real squad, then a second 5-match series per format against
   their all-time All-Star XI (DB.best-sourced, format-agnostic single
   draft). Unlike calculateScore/calculateRepresentResult (one fixed
   format for the whole run), FMTKEY changes mid-campaign here, so
   teamStrengths()/hasWorldClassBowlingType/computeStatsBonus (all
   FMTKEY-dependent) are recomputed fresh at the start of every stop via
   __setFMTKEY, exactly matching the client. */
const SS_STOPS_DEF = [
  {fmtkey:'test', tier:'real'},    {fmtkey:'odi', tier:'real'},    {fmtkey:'t20', tier:'real'},
  {fmtkey:'test', tier:'allstar'}, {fmtkey:'odi', tier:'allstar'}, {fmtkey:'t20', tier:'allstar'},
];
// Monte-Carlo calibrated so a genuinely optimal draft's flawless 30-0 run
// averages 1-in-10,000 across England v Pakistan / Pakistan v England (the
// real-squad tier plays at the nation's plain rating, no added difficulty —
// this is the ONLY bonus in the whole mode, deliberately small).
const ALLSTAR_OPP_BONUS = 6.05;

function calculateSeriesShowdownResult({ seed, xi: clientXi, captainIdx, yourNation, opponentNation }) {
  if (!NATIONS.some((n) => n.id === yourNation)) throw new Error('bad yourNation');
  if (!NATIONS.some((n) => n.id === opponentNation)) throw new Error('bad opponentNation');
  if (yourNation === opponentNation) throw new Error('yourNation and opponentNation must differ');
  if (!Number.isInteger(seed)) throw new Error('bad seed');

  const nativeRandom = Math.random;
  Math.random = mulberry32(seed);

  try {
    if (!Array.isArray(clientXi) || clientXi.length !== 11) throw new Error('XI must have exactly 11 players');
    const pool = DB.best;
    const seen = new Set();
    const fullXi = clientXi.map((p) => {
      if (!p || typeof p.n !== 'string' || typeof p.d !== 'string' || typeof p.c !== 'string') throw new Error('bad player entry');
      const found = pool.find((x) => x.n === p.n && x.d === p.d && x.c === p.c);
      if (!found) throw new Error('player not found: ' + p.n + ' (' + p.c + ', ' + p.d + ')');
      if (seen.has(found.n)) throw new Error('duplicate player: ' + found.n);
      seen.add(found.n);
      return found;
    });
    if (fullXi.some((p) => p.c !== yourNation)) throw new Error('every player must be from ' + yourNation + ' to play as that nation');
    for (let i = 0; i < 11; i++) {
      if (!SLOTS[i].fits(fullXi[i])) throw new Error(`player at slot ${i + 1} (${fullXi[i].n}) is not eligible for that slot`);
    }
    if (!fullXi.some((p) => p.roles.includes('wk'))) throw new Error('XI has no wicketkeeper');

    __setXI(fullXi);
    __setCaptainIdx(captainIdx);

    const oppNat = NATIONS.find((n) => n.id === opponentNation);
    const realOppXI = getOppositionXI(opponentNation, 'best');
    const allStarOppXI = getAllStarXI(opponentNation, 'best');

    let streakAlive = true; // Immortal-XI boost: on while undefeated across the WHOLE 30-match campaign
    let w = 0, d = 0, l = 0;
    let totalSeriesWon = 0, totalSweeps = 0, marginSum = 0, marginCount = 0;

    SS_STOPS_DEF.forEach((def) => {
      __setFMTKEY(def.fmtkey);
      const oppXi = def.tier === 'real' ? realOppXI : allStarOppXI;
      const oppRating = oppNat.opp + (def.tier === 'allstar' ? ALLSTAR_OPP_BONUS : 0);

      const st = teamStrengths();
      const hasSpin = hasWorldClassBowlingType(fullXi, 'spin');
      const hasPace = hasWorldClassBowlingType(fullXi, 'pace');
      const statsBonus = computeStatsBonus(fullXi);

      const stopCodes = [];
      for (let m = 0; m < 5; m++) {
        const conditionsPenalty = computeConditionsPenalty(oppNat, hasSpin, hasPace);
        const effStrength = st.strength + statsBonus - conditionsPenalty - (BASE_DIFFICULTY_PENALTY[def.fmtkey]||0) + (streakAlive ? IMMORTAL_STREAK_BOOST[def.fmtkey] : 0);
        const res = decideMatch(effStrength, oppRating);
        const code = res.code;
        if (code !== 'W') streakAlive = false;
        const gen = def.fmtkey === 'test' ? genTestMatch(code, oppNat) : genWhiteBallMatch(code, oppNat, res.superOver);
        const genLists = toInningsLists(gen);
        buildMatchScorecard(fullXi, oppXi, genLists.yourInningsList, genLists.oppInningsList, oppNat.id); // consumes RNG in lockstep with client; output unused server-side
        pickPOTM(code, oppNat); // consumes RNG in lockstep with client; output unused server-side
        if (code === 'W') { w++; marginSum += clamp((gen.pts-100)/(190-100), 0, 1); marginCount++; }
        else if (code === 'D') d++; else l++;
        stopCodes.push(code);
      }
      const sw = stopCodes.filter((c) => c==='W').length, sl = stopCodes.filter((c) => c==='L').length;
      if (sw > sl) totalSeriesWon++;
      if (sw === 5) totalSweeps++;
    });

    const SCORE_POOL = 10000;
    const winsComponent   = (w/30) * SCORE_POOL * 0.50;
    const seriesComponent = (totalSeriesWon/6) * SCORE_POOL * 0.20;
    const sweepComponent  = (totalSweeps/6) * SCORE_POOL * 0.20;
    const marginComponent = (marginCount>0 ? marginSum/marginCount : 0) * SCORE_POOL * 0.10;
    const score = Math.round(winsComponent + seriesComponent + sweepComponent + marginComponent);
    const record = `${w}-${d}-${l}`;

    return { score, record, yourNation, opponentNation };
  } finally {
    Math.random = nativeRandom;
  }
}

/* Mode 3: combined XI from both series nations vs the other 10. This is
   World Tour's exact engine and difficulty (same decideMatch/nat.opp+4,
   same composite scoring formula) with the two series nations excluded
   from the opponent pool -- mirrors calculateScore's Test/ODI/T20 branch,
   just with a restricted, dynamically-sized nation list instead of the
   fixed 60-match/12-nation constants. No separate difficulty calibration
   needed since nothing about the per-match math changes. */
function calculateSeriesShowdownCombinedResult({ format, seed, xi: clientXi, captainIdx, natA, natB }) {
  if (!['test','odi','t20'].includes(format)) throw new Error('bad format');
  if (!NATIONS.some((n) => n.id === natA)) throw new Error('bad natA');
  if (!NATIONS.some((n) => n.id === natB)) throw new Error('bad natB');
  if (natA === natB) throw new Error('natA and natB must differ');
  if (!Number.isInteger(seed)) throw new Error('bad seed');

  const nativeRandom = Math.random;
  Math.random = mulberry32(seed);

  try {
    __setFMTKEY(format);

    if (!Array.isArray(clientXi) || clientXi.length !== 11) throw new Error('XI must have exactly 11 players');
    const pool = DB[format];
    const seen = new Set();
    const fullXi = clientXi.map((p) => {
      if (!p || typeof p.n !== 'string' || typeof p.d !== 'string' || typeof p.c !== 'string') throw new Error('bad player entry');
      const found = pool.find((x) => x.n === p.n && x.d === p.d && x.c === p.c);
      if (!found) throw new Error('player not found: ' + p.n + ' (' + p.c + ', ' + p.d + ')');
      if (seen.has(found.n)) throw new Error('duplicate player: ' + found.n);
      seen.add(found.n);
      return found;
    });
    // Every player must be from one of the two series nations -- the
    // client-side draft restriction enforces this, the server re-checks it.
    if (fullXi.some((p) => p.c !== natA && p.c !== natB)) throw new Error('every player must be from ' + natA + ' or ' + natB);
    for (let i = 0; i < 11; i++) {
      if (!SLOTS[i].fits(fullXi[i])) throw new Error(`player at slot ${i + 1} (${fullXi[i].n}) is not eligible for that slot`);
    }
    if (!fullXi.some((p) => p.roles.includes('wk'))) throw new Error('XI has no wicketkeeper');

    __setXI(fullXi);
    __setCaptainIdx(captainIdx);

    const st = teamStrengths();
    const opponents = shuffle(NATIONS.filter((n) => n.id !== natA && n.id !== natB));
    const N_OPP = opponents.length;

    const hasSpin = hasWorldClassBowlingType(fullXi, 'spin');
    const hasPace = hasWorldClassBowlingType(fullXi, 'pace');
    const statsBonus = computeStatsBonus(fullXi);
    let streakAlive = true;

    let w = 0, d = 0, l = 0;
    let totalSeriesWon = 0, totalSweeps = 0, marginSum = 0, marginCount = 0;

    opponents.forEach((nat) => {
      const seriesCodes = [];
      const conditionsPenalty = computeConditionsPenalty(nat, hasSpin, hasPace);
      for (let m = 0; m < 5; m++) {
        const effStrength = st.strength + statsBonus - conditionsPenalty - (BASE_DIFFICULTY_PENALTY[format]||0) + (streakAlive ? IMMORTAL_STREAK_BOOST[format] : 0);
        const res = decideMatch(effStrength, nat.opp + 4);
        const code = res.code;
        const gen = format === 'test' ? genTestMatch(code, nat) : genWhiteBallMatch(code, nat, res.superOver);
        const genLists = toInningsLists(gen);
        buildMatchScorecard(fullXi, getOppositionXI(nat.id), genLists.yourInningsList, genLists.oppInningsList, nat.id); // consumes RNG in lockstep with client; output unused server-side
        pickPOTM(code, nat); // consumes RNG in lockstep with client; output unused server-side
        seriesCodes.push(code);
        if (code !== 'W') streakAlive = false;
        if (code === 'W') { w++; marginSum += clamp((gen.pts-100)/(190-100), 0, 1); marginCount++; }
        else if (code === 'D') d++; else l++;
      }
      const sw = seriesCodes.filter((c) => c === 'W').length, sl = seriesCodes.filter((c) => c === 'L').length;
      if (sw > sl) totalSeriesWon++;
      if (sw === 5) totalSweeps++;
    });

    const SCORE_POOL = 10000;
    const winsComponent   = (w/(N_OPP*5)) * SCORE_POOL * 0.50;
    const seriesComponent = (totalSeriesWon/N_OPP) * SCORE_POOL * 0.20;
    const sweepComponent  = (totalSweeps/N_OPP) * SCORE_POOL * 0.20;
    const marginComponent = (marginCount>0 ? marginSum/marginCount : 0) * SCORE_POOL * 0.10;
    const score = Math.round(winsComponent + seriesComponent + sweepComponent + marginComponent);
    const record = `${w}-${d}-${l}`;

    return { score, record, natA, natB };
  } finally {
    Math.random = nativeRandom;
  }
}

function calculateScore({ format, seed, xi: clientXi, captainIdx }) {
  if (!['test','odi','t20','hundred'].includes(format)) throw new Error('bad format');
  if (!Number.isInteger(seed)) throw new Error('bad seed');

  const nativeRandom = Math.random;
  Math.random = mulberry32(seed);

  try {
    __setFMTKEY(format);

    // Hydrate against the REAL database only — never fall back to an
    // unvalidated client-supplied player object. A missing match, a
    // duplicate, an illegal slot placement, or a team with no keeper
    // all reject the submission outright rather than silently scoring
    // whatever was sent.
    if (!Array.isArray(clientXi) || clientXi.length !== 11) throw new Error('XI must have exactly 11 players');
    const pool = DB[format];
    const seen = new Set();
    const fullXi = clientXi.map((p) => {
      if (!p || typeof p.n !== 'string' || typeof p.d !== 'string' || typeof p.c !== 'string') throw new Error('bad player entry');
      // Matched on name + decade + country. A handful of real players
      // (Eoin Morgan, Boyd Rankin, and others who switched allegiances
      // or predate today's national boundaries) share the exact same
      // name and decade across two different countries — without
      // country in the key, this could silently resolve the wrong one.
      const found = pool.find((x) => x.n === p.n && x.d === p.d && x.c === p.c);
      if (!found) throw new Error('player not found: ' + p.n + ' (' + p.c + ', ' + p.d + ')');
      if (seen.has(found.n)) throw new Error('duplicate player: ' + found.n);
      seen.add(found.n);
      return found;
    });
    for (let i = 0; i < 11; i++) {
      if (!SLOTS[i].fits(fullXi[i])) throw new Error(`player at slot ${i + 1} (${fullXi[i].n}) is not eligible for that slot`);
    }
    if (!fullXi.some((p) => p.roles.includes('wk'))) throw new Error('XI has no wicketkeeper');

    __setXI(fullXi);
    __setCaptainIdx(captainIdx);

    const st = teamStrengths();
    let scoreTotal = 0;
    let record = "0-0-0";

    if (format === 'hundred') {
    // --- HUNDRED LEAGUE SIMULATION ---
    const opponents = shuffle(HUNDRED_TEAMS.slice());
    const hundredMatches = [];
    let w = 0, l = 0;

    opponents.forEach((team) => {
      const res = decideMatch(st.strength, team.opp + 3);
      const code = res.code;
      const gen = genHundredMatch(code, team, res.superOver);
      pickPOTM(code, team); // Consumes RNG state in lockstep with client
      if (code === 'W') w++; else l++;
      scoreTotal += gen.pts;
      hundredMatches.push({ stage: 'league', opp: team, code, ...gen });
    });

    const hundredTable = buildHundredTable(opponents, hundredMatches);
    const yourIdx = hundredTable.findIndex(r => r.isYou);
    const rank = yourIdx + 1;

    let reachedEliminator = false;
    let reachedFinal = false;
    let wonFinal = false;

    if (rank <= 3) {
      const first = hundredTable[0];
      const second = hundredTable[1];
      const third = hundredTable[2];

      if (rank === 1) {
        const aWins = decideNeutral(second.team.opp, third.team.opp);
        const winner = aWins ? second : third;
        const res = decideMatch(st.strength, winner.team.opp + 3);
        const finGen = genHundredMatch(res.code, winner.team, res.superOver);
        pickPOTM(res.code, winner.team);
        scoreTotal += finGen.pts;   // the final's points were being silently dropped
        reachedFinal = true;
        if (res.code === 'W') { wonFinal = true; w++; } else { l++; }
      } else {
        reachedEliminator = true;
        const oppRow = rank === 2 ? third : second;
        const res = decideMatch(st.strength, oppRow.team.opp + 2);
        const elimGen = genHundredMatch(res.code, oppRow.team, res.superOver);
        pickPOTM(res.code, oppRow.team);
        scoreTotal += elimGen.pts;   // the eliminator's points were being silently dropped

        if (res.code === 'W') {
          w++;
          reachedFinal = true;
          const resFin = decideMatch(st.strength, first.team.opp + 3);
          const finGen = genHundredMatch(resFin.code, first.team, resFin.superOver);
          pickPOTM(resFin.code, first.team);
          scoreTotal += finGen.pts;   // ...and the final's points here too
          if (resFin.code === 'W') { wonFinal = true; w++; } else { l++; }
        } else {
          l++;
        }
      }
    }

    const champion = wonFinal === true;
    const undefeated = l === 0;

    if (champion) scoreTotal += 400;
    if (champion && undefeated) scoreTotal += 200;
    else if (reachedFinal) scoreTotal += 100;
    else if (reachedEliminator) scoreTotal += 40;

    record = `${w}-${l}, P${rank}`;

  } else {
    // --- TEST / ODI / T20 WORLD TOUR SIMULATION ---
    // 11 real nations, shuffled, plus one randomly-drawn World All-Star
    // team ALWAYS appended last -- the tour's finale at Lord's. Must be
    // positioned right after the nations shuffle, same as the client, to
    // stay in lockstep.
    const stops = shuffle(NATIONS.slice());
    const allStarTeam = ALLSTAR_TEAMS[Math.floor(Math.random() * ALLSTAR_TEAMS.length)];
    stops.push(allStarTeam);
    let w = 0, d = 0, l = 0;
    let totalSeriesWon = 0, totalSweeps = 0, marginSum = 0, marginCount = 0;

    const hasSpin = hasWorldClassBowlingType(fullXi, 'spin');
    const hasPace = hasWorldClassBowlingType(fullXi, 'pace');
    const statsBonus = computeStatsBonus(fullXi);
    let streakAlive = true; // Immortal-XI boost: on while still undefeated, off for good after any non-win

    stops.forEach((nat) => {
      const seriesCodes = [];
      const conditionsPenalty = computeConditionsPenalty(nat, hasSpin, hasPace);
      for (let m = 0; m < 5; m++) {
        const effStrength = st.strength + statsBonus - conditionsPenalty - (BASE_DIFFICULTY_PENALTY[format]||0) + (streakAlive ? IMMORTAL_STREAK_BOOST[format] : 0);
        const res = decideMatch(effStrength, nat.opp + 4);
        const code = res.code;
        const gen = format === 'test'
          ? genTestMatch(code, nat)
          : genWhiteBallMatch(code, nat, res.superOver);

        const genLists = toInningsLists(gen);
        const oppXi = nat.isAllStar ? getWorldAllStarXI(nat.id) : getOppositionXI(nat.id);
        buildMatchScorecard(fullXi, oppXi, genLists.yourInningsList, genLists.oppInningsList, nat.isAllStar ? 'All-Stars' : nat.id); // Consumes RNG state in lockstep with client; output unused server-side
        pickPOTM(code, nat); // Consumes RNG state in lockstep with client
        seriesCodes.push(code);
        if (code !== 'W') streakAlive = false;
        if (code === 'W') {
          w++;
          marginSum += Math.max(0, Math.min(1, (gen.pts - 100) / (190 - 100)));
          marginCount++;
        }
        else if (code === 'D') d++;
        else l++;
      }
      const sw = seriesCodes.filter(c => c === 'W').length;
      const sl = seriesCodes.filter(c => c === 'L').length;
      if (sw > sl) totalSeriesWon++;
      if (sw === 5) totalSweeps++;
    });

    // Weighted composite: 50% matches won, 20% series won, 20% clean
    // sweeps (5-0), 10% average margin-of-victory quality — must
    // match the client's formula exactly for verification to hold.
    const SCORE_POOL = 10000;
    const winsComponent   = (w / 60) * SCORE_POOL * 0.50;
    const seriesComponent = (totalSeriesWon / 12) * SCORE_POOL * 0.20;
    const sweepComponent  = (totalSweeps / 12) * SCORE_POOL * 0.20;
    const marginComponent = (marginCount > 0 ? marginSum / marginCount : 0) * SCORE_POOL * 0.10;
    scoreTotal = winsComponent + seriesComponent + sweepComponent + marginComponent;
    record = `${w}-${d}-${l}`;
  }

    return {
      score: Math.round(scoreTotal),
      record: record
    };
  } finally {
    // Always restore native randomness, even if validation or the
    // simulation itself throws — otherwise a failed request could
    // leave this warm function instance permanently seeded for
    // whichever request happens to reuse it next.
    Math.random = nativeRandom;
  }
}

/* ================= BUILD YOUR TEAM: pack rolling + series verification =================
   A persistent, signed-in-only collection mode. Pack contents are rolled with
   plain Math.random(), NOT seeded/mirrored -- unlike match simulation, the
   client never computes or predicts a pack's contents, only receives the
   server's authoritative result, so there's no lockstep requirement here. */

// Authored so 45-59 is genuinely the most common tier and every tier is rarer
// than the one below it -- deliberately NOT proportional to best.json's real
// (bell-shaped) rating distribution, which would make 60-79 the most common
// tier instead of 45-59.
const PACK_RARITY_TABLE = [
  { min: 99, max: 99, weight: 0.0010 },
  { min: 98, max: 98, weight: 0.0030 },
  { min: 90, max: 97, weight: 0.0200 },
  { min: 80, max: 89, weight: 0.1200 },
  { min: 60, max: 79, weight: 0.3500 },
  { min: 45, max: 59, weight: 0.5060 },
];

function rollRarityTier(){
  const roll = Math.random();
  let acc = 0;
  for(const tier of PACK_RARITY_TABLE){
    acc += tier.weight;
    if(roll < acc) return tier;
  }
  return PACK_RARITY_TABLE[PACK_RARITY_TABLE.length - 1];
}

function rollCard(pool){
  const tier = rollRarityTier();
  const candidates = pool.filter(p => p.r >= tier.min && p.r <= tier.max);
  // A tier with zero real players in this specific pool (shouldn't happen
  // against the full best.json range, but defends against a narrower pool
  // later) falls back to the whole pool rather than throwing.
  const usable = candidates.length ? candidates : pool;
  return usable[Math.floor(Math.random() * usable.length)];
}

// The stable identity for an owned card: cid alone isn't enough since the
// game already treats each decade-version of a real player as a distinct
// entity everywhere else (e.g. two separate Ricky Ponting rows, 1990s and
// 2000s, in best.json).
function cardKey(p){ return `${p.cid}_${p.d}`; }

// 2 keepers, 10 bowling-capable (bowler or all-rounder), 10 batting-capable
// (batter or all-rounder) -- an all-rounder can land in either of the
// latter two buckets, which is intentional (they're eligible for both).
function rollStarterPack(){
  const pool = DB.best;
  const wkPool = pool.filter(p => p.roles.includes('wk'));
  const bowlPool = pool.filter(p => p.roles.includes('bowl') || p.roles.includes('ar'));
  const batPool = pool.filter(p => p.roles.includes('bat') || p.roles.includes('ar'));
  const cards = [];
  for(let i = 0; i < 2; i++) cards.push(rollCard(wkPool));
  for(let i = 0; i < 10; i++) cards.push(rollCard(bowlPool));
  for(let i = 0; i < 10; i++) cards.push(rollCard(batPool));
  return cards;
}

function rollPack(n){
  const cards = [];
  for(let i = 0; i < n; i++) cards.push(rollCard(DB.best));
  return cards;
}

// Build Your Team's opponent pool: every (nation, decade) combination with
// enough real players to field a legal XI (1 keeper, up to 5 bowl/ar, the
// rest batters) becomes its own opponent, instead of a fixed 11 nations +
// 1 all-star tier. Strength (`opp`) is derived directly from the drafted
// XI's own average rating, so thin eras/nations naturally play weaker and
// stacked ones naturally play stronger -- no hand-tuned per-team number.
// Two more opponent kinds round out the pool: the same 10 World All-Star
// tiers (90-99 rated) used elsewhere, and two REGIONAL per-decade sides --
// Asia (India/Pakistan/Sri Lanka/Bangladesh combined) and Rest of World
// (every other nation combined) -- for eras too early for some nations to
// field their own XI but where a regional composite still can.
const ASIA_TEAM_NATIONS = ['IND', 'PAK', 'SL', 'BAN'];
const ROW_TEAM_NATIONS = NATIONS.filter(n => !ASIA_TEAM_NATIONS.includes(n.id)).map(n => n.id);
function buildDecadeOpponentXI(natId, decade){
  const pool = DB.best.filter(p => p.c === natId && p.d === decade).sort((a, b) => b.r - a.r);
  return draftXIFromPool(pool);
}
const decadeOpponentXICache = new Map();
function getDecadeOpponentXI(natId, decade){
  const key = natId + '|' + decade;
  if(!decadeOpponentXICache.has(key)) decadeOpponentXICache.set(key, buildDecadeOpponentXI(natId, decade));
  return decadeOpponentXICache.get(key);
}
function buildRegionalOpponentXI(natIds, decade){
  const pool = DB.best.filter(p => natIds.includes(p.c) && p.d === decade).sort((a, b) => b.r - a.r);
  return draftXIFromPool(pool);
}
const regionalOpponentXICache = new Map();
function getRegionalOpponentXI(regionId, decade){
  const key = regionId + '|' + decade;
  if(!regionalOpponentXICache.has(key)){
    const natIds = regionId === 'ASIA' ? ASIA_TEAM_NATIONS : ROW_TEAM_NATIONS;
    regionalOpponentXICache.set(key, buildRegionalOpponentXI(natIds, decade));
  }
  return regionalOpponentXICache.get(key);
}
let decadeOpponentsCache = null;
function getDecadeOpponents(){
  if(decadeOpponentsCache) return decadeOpponentsCache;
  const list = [];
  const allDecades = [...new Set(DB.best.map(p => p.d))];
  for(const nat of NATIONS){
    const decades = allDecades.filter(d => DB.best.some(p => p.c === nat.id && p.d === d));
    for(const d of decades){
      const xi = getDecadeOpponentXI(nat.id, d);
      // Some eras/nations simply don't have 11 real, role-legal players in
      // this dataset (e.g. no keeper at all) -- skip those rather than
      // fielding an illegal or under-strength side.
      if(xi.length !== 11 || !xi.some(p => p.roles.includes('wk'))) continue;
      const opp = Math.round(xi.reduce((s, p) => s + p.r, 0) / 11);
      list.push({ id: nat.id + '_' + d, natId: nat.id, decade: d, name: `${nat.name} (${d})`, flag: nat.flag, opp, venues: nat.venues, isAllStar: false });
    }
  }
  const REGIONS = [
    { id: 'ASIA', natIds: ASIA_TEAM_NATIONS, name: 'Asia XI', flag: '🌏', venues: ['Dubai International Stadium'] },
    { id: 'ROW', natIds: ROW_TEAM_NATIONS, name: 'Rest of World XI', flag: '🌍', venues: ["Lord's"] },
  ];
  for(const region of REGIONS){
    for(const d of allDecades){
      const xi = getRegionalOpponentXI(region.id, d);
      if(xi.length !== 11 || !xi.some(p => p.roles.includes('wk'))) continue;
      const opp = Math.round(xi.reduce((s, p) => s + p.r, 0) / 11);
      list.push({ id: region.id + '_' + d, natId: region.id, decade: d, name: `${region.name} (${d})`, flag: region.flag, opp, venues: region.venues, isAllStar: false, isRegional: true });
    }
  }
  for(const team of ALLSTAR_TEAMS){
    list.push({ id: team.id, natId: team.id, name: team.name, flag: team.flag, opp: team.opp, venues: team.venues, isAllStar: true });
  }
  decadeOpponentsCache = list;
  return list;
}
// Single dispatcher for "the real 11 players this opponent puts on the
// field" -- branches by opponent kind so verifySeriesWin/the client don't
// need to know which of the three opponent shapes they're facing.
function getBYTOpponentXI(nat){
  if(nat.isAllStar) return getWorldAllStarXI(nat.id);
  if(nat.isRegional) return getRegionalOpponentXI(nat.natId, nat.decade);
  return getDecadeOpponentXI(nat.natId, nat.decade);
}
function resolvePackOpponent(opponentId){
  const found = getDecadeOpponents().find(o => o.id === opponentId);
  if(!found) throw new Error('unknown opponent: ' + opponentId);
  return found;
}

/* Hydrates a Build Your Team XI from card keys against DB.best. Ownership --
   does this uid actually own each of these cards? -- is checked by the
   caller in functions/index.js BEFORE this runs (against the Firestore
   collection doc); this only checks that the cards are real and legally
   slotted, exactly like calculateScore's own hydration step checks the
   player is real. */
function hydratePackXI(cardKeys){
  if(!Array.isArray(cardKeys) || cardKeys.length !== 11) throw new Error('XI must have exactly 11 players');
  const pool = DB.best;
  const seen = new Set();
  return cardKeys.map((key) => {
    const found = pool.find(p => cardKey(p) === key);
    if(!found) throw new Error('unknown card: ' + key);
    if(seen.has(key)) throw new Error('duplicate card: ' + key);
    seen.add(key);
    return found;
  });
}

/* One 5-match series against a single Build Your Team opponent, verified
   entirely server-side -- mirrors calculateScore's World Tour branch, but
   for one opponent per call instead of a 12-stop tour, and with hasSpin/
   hasPace/conditionsPenalty computed fresh from THIS call's xi every time
   (never cached across series) -- that's what makes a lineup change between
   series actually change the odds against the next opponent. No streak/
   Immortal-XI bonus here: that's a whole-tour concept that doesn't map onto
   independently-verified, revisable-lineup series. */
function verifySeriesWin({ seed, xi: cardKeys, captainIdx, opponentId, fmt }){
  if(!['test','odi','t20'].includes(fmt)) throw new Error('bad format');
  if(!Number.isInteger(seed)) throw new Error('bad seed');

  const nativeRandom = Math.random;
  Math.random = mulberry32(seed);

  try{
    __setFMTKEY(fmt);
    const fullXi = hydratePackXI(cardKeys);
    for(let i = 0; i < 11; i++){
      if(!SLOTS[i].fits(fullXi[i])) throw new Error(`player at slot ${i + 1} (${fullXi[i].n}) is not eligible for that slot`);
    }
    if(!fullXi.some(p => p.roles.includes('wk'))) throw new Error('XI has no wicketkeeper');
    __setXI(fullXi);
    __setCaptainIdx(captainIdx);

    const nat = resolvePackOpponent(opponentId);
    const st = teamStrengths();
    const hasSpin = hasWorldClassBowlingType(fullXi, 'spin');
    const hasPace = hasWorldClassBowlingType(fullXi, 'pace');
    const statsBonus = computeStatsBonus(fullXi);
    const conditionsPenalty = computeConditionsPenalty(nat, hasSpin, hasPace);

    let w = 0, d = 0, l = 0;
    for(let m = 0; m < 5; m++){
      const effStrength = st.strength + statsBonus - conditionsPenalty - (BASE_DIFFICULTY_PENALTY[fmt] || 0);
      const res = decideMatch(effStrength, nat.opp + 4);
      const code = res.code;
      const gen = fmt === 'test' ? genTestMatch(code, nat) : genWhiteBallMatch(code, nat, res.superOver);
      const genLists = toInningsLists(gen);
      const oppXi = getBYTOpponentXI(nat);
      buildMatchScorecard(fullXi, oppXi, genLists.yourInningsList, genLists.oppInningsList, nat.isAllStar ? 'All-Stars' : nat.natId); // Consumes RNG state in lockstep with client
      pickPOTM(code, nat); // Consumes RNG state in lockstep with client
      if(code === 'W') w++; else if(code === 'D') d++; else l++;
    }
    return { won: w > l, drawn: w === l, record: `${w}-${d}-${l}`, matchWins: w, matchDraws: d, matchLosses: l };
  } finally {
    Math.random = nativeRandom;
  }
}

module.exports = { calculateScore, calculateRepresentResult, calculateSeriesShowdownResult, calculateSeriesShowdownCombinedResult, DB, mulberry32, NATIONS, ALLSTAR_TEAMS, HUNDRED_TEAMS, FORMATS, SLOTS, teamStrengths, decideMatch, decideNeutral, genTestMatch, genWhiteBallMatch, genHundredMatch, pickPOTM, buildHundredTable, getBowlingUnit, shuffle, admin, db, __setFMTKEY, __setXI, rollStarterPack, rollPack, verifySeriesWin, cardKey, getDecadeOpponents };