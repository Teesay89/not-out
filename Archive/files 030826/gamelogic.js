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

admin.initializeApp();
const db = admin.firestore();

/* ---------- real player data, bundled with the function ---------- */
const DB = {};
for (const key of ['test','odi','t20','hundred']) {
  DB[key] = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', key + '.json'), 'utf8'));
}

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

/* ================= game logic, copied verbatim from the client =================
   (extracted directly from the shipped game file, not hand re-typed,
   specifically to avoid any risk of the two versions drifting apart) */

let FMTKEY = 'test';
let FMT = null;
let xi = [];
let PLAYERS = [];
let draftedNames = new Set();

function __setFMTKEY(k){ FMTKEY = k; FMT = FORMATS[k]; PLAYERS = DB[k]; }
function __setXI(v){ xi = v; draftedNames = new Set(v.map(p => p.n)); }
const NATIONS = [
  {id:'AUS', name:'Australia',    flag:'🇦🇺', opp:100, venue:'the MCG'},
  {id:'SA',  name:'South Africa', flag:'🇿🇦', opp:98,  venue:'the Wanderers'},
  {id:'NZ',  name:'New Zealand',  flag:'🇳🇿', opp:96,  venue:'the Basin Reserve'},
  {id:'IND', name:'India',        flag:'🇮🇳', opp:95,  venue:'Eden Gardens'},
  {id:'ENG', name:'England',      flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', opp:94,  venue:'Lord’s'},
  {id:'PAK', name:'Pakistan',     flag:'🇵🇰', opp:92,  venue:'Gaddafi Stadium'},
  {id:'SL',  name:'Sri Lanka',    flag:'🇱🇰', opp:90,  venue:'Galle'},
  {id:'WI',  name:'West Indies',  flag:'🏝️', opp:88,  venue:'Kensington Oval'},
  {id:'BAN', name:'Bangladesh',   flag:'🇧🇩', opp:86,  venue:'Mirpur'},
  {id:'AFG', name:'Afghanistan',  flag:'🇦🇫', opp:85,  venue:'Sharjah'},
  {id:'ZIM', name:'Zimbabwe',     flag:'🇿🇼', opp:84,  venue:'Harare Sports Club'},
  {id:'IRE', name:'Ireland',      flag:'🇮🇪', opp:83,  venue:'Malahide'},
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

const HUNDRED_SQUADS = {  // 2026 franchise rosters — verified current squads
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
  test:{label:'Test Match', noun:'Test',  decades:['70s','80s','90s','00s','10s','20s']},
  odi: {label:'ODI',        noun:'ODI',   decades:['90s','00s','10s','20s']},
  t20: {label:'T20',        noun:'T20',   decades:['00s','10s','20s']},
  hundred:{label:'The Hundred', noun:'game', decades:['70s','80s','90s','00s','10s','20s']},
};

const SLOTS = [
 {no:1, title:'Opener',        short:'OP', desc:'Faces the new ball first.',                              fits:p=>p.roles.includes('bat')||p.roles.includes('wk')},
 {no:2, title:'Opener',        short:'OP', desc:'The other half of the opening stand.',                    fits:p=>p.roles.includes('bat')||p.roles.includes('wk')},
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

const BP_NATURAL = { O:[1,2], T:[1,2,3,4], M:[3,4,5,6,7], L:[6,7,8,9], X:[8,9,10,11] };

function positionPenalty(p, slotNo){
  const range = BP_NATURAL[p.bp];
  if(!range || !range.length) return 0;
  if(range.includes(slotNo)) return 0;
  const dist = Math.min(...range.map(s=>Math.abs(s-slotNo)));
  return Math.min(8, dist*1.5);
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

function teamStrengths(){
  /* Batting: every batting-capable player counts, wherever he bats.
     An all-rounder at 8 or 9 adds nearly full batting value; a pure
     bowler forced up into the top seven bats at a heavy discount.
     Anyone out of his natural batting position takes a small hit.
     The best seven contributions make the batting number. */
  const contrib = [];
  let misplaced = 0;
  xi.forEach((p,i)=>{
    const slotNo = i+1;
    const canBat = p.roles.includes('bat')||p.roles.includes('wk')||p.roles.includes('ar');
    const pen = positionPenalty(p, slotNo);
    if(pen>0) misplaced++;
    if(canBat) contrib.push((p.r-pen) * (i>=7 ? 0.97 : 1));
    else if(i<7) contrib.push((p.r-pen) * 0.65);
  });
  contrib.sort((a,b)=>b-a);
  const batTop = contrib.slice(0,7);
  /* batting depth: every batting-capable player at 8–11 lifts the number */
  const depth = xi.slice(7).filter(p=>p.roles.includes('ar')||p.roles.includes('bat')||p.roles.includes('wk'))
                  .reduce((a,p)=>a+Math.max(0,(p.r-75)*0.12), 0);
  const bat = batTop.reduce((a,b)=>a+b,0)/batTop.length + Math.min(4, depth);

  /* Bowling: anyone who can bowl, wherever he bats in the order.
     Best five spells form the attack. */
  const {unit:bowlUnit, partTimer} = getBowlingUnit(xi);
  const top5 = bowlUnit.map(p=>partTimer && p.n===partTimer.n ? p.r*0.82 : p.r).sort((a,b)=>b-a).slice(0,5);
  const bowl = top5.reduce((a,b)=>a+b,0)/Math.max(top5.length,1);

  const decadesUsed = new Set(xi.map(p=>p.d)).size;
  const nationsUsed = new Set(xi.map(p=>p.c)).size;
  let bonus = 0, notes=[];
  const arDeep = xi.slice(7).some(p=>p.roles.includes('ar'));
  const arTop = xi.slice(0,5).some(p=>p.roles.includes('ar'));
  if(arDeep) notes.push('All-rounder in the lower order — the batting runs deep.');
  if(arTop) notes.push('All-rounder in the top five — an extra bowling option up front.');
  if(partTimer) notes.push(`Only 4 frontline bowlers — ${partTimer.n} (Bat) makes up the legal fifth option.`);
  else notes.push(`${bowlUnit.length} bowling option${bowlUnit.length===1?'':'s'} in the XI.`);
  if(misplaced>0) notes.push(`${misplaced} player${misplaced===1?' is':'s are'} batting out of position — a small hit to the batting number.`);
  if(decadesUsed>=4){bonus+=3; notes.push(`Time-travelling XI: ${decadesUsed} decades represented.`);}
  if(nationsUsed>=6){bonus+=3; notes.push(`World XI: ${nationsUsed} nations in one dressing room.`);}
  const strength = bat*0.5 + bowl*0.5 + bonus;
  return {bat:Math.round(bat), bowl:Math.round(bowl), strength, notes};
}

function decideMatch(strength, oppRating){
  const diff = strength - oppRating;
  const pW = clamp(0.50 + diff*0.04, 0.06, 0.95);
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
  const rescaled = clamp(pW/(1-pTie), 0.06, 0.95);
  return { code: Math.random()<rescaled ? 'W' : 'L', superOver:false };
}

function decideNeutral(oppA, oppB){
  const diff = oppA - oppB;
  const pTie = clamp(0.08 - Math.abs(diff)*0.0015, 0.02, 0.08);
  if(Math.random() < pTie) return Math.random() < clamp(0.5+diff*0.05,0.18,0.82);
  return Math.random() < clamp(clamp(0.5+diff*0.04,0.06,0.95)/(1-pTie), 0.06, 0.95);
}

function genTestMatch(code, nat){
  let score, margin, pts;
  if(code==='D'){
    const a1=rand(300,540), b1=rand(280,520), a2=rand(150,330), a2w=rand(4,8), b2=rand(90,260), b2w=rand(4,9);
    score=`You ${b1} & ${b2}/${b2w} \u00b7 ${nat.id} ${a1} & ${a2}/${a2w}d`;
    margin=pickOne(['drawn \u2014 last pair survive','drawn \u2014 flat pitch wins','drawn \u2014 nine down at stumps']);
    pts = 35;
  } else {
    const weWin = code==='W';
    const style = Math.random()<0.18?'inn':(Math.random()<0.5?'runs':'wkts');
    if(style==='inn'){
      const big=rand(440,660), x1=rand(120,300), x2=rand(80,Math.max(90,big-x1-15));
      const gap=Math.max(5,big-x1-x2);
      score = weWin ? `You ${big}d \u00b7 ${nat.id} ${x1} & ${x2}` : `${nat.id} ${big}d \u00b7 You ${x1} & ${x2}`;
      margin = `${weWin?'won':'lost'} by an innings & ${gap} runs`;
      pts = weWin ? 190 : -160;
    } else if(style==='runs'){
      const f1=rand(260,500), f2=rand(140,330), R=rand(25,260);
      const c1=rand(120,Math.max(140,Math.min(360,f1+f2-R-60))), c2=Math.max(40,f1+f2-c1-R);
      score = weWin ? `You ${f1} & ${f2}d \u00b7 ${nat.id} ${c1} & ${c2}`
                    : `${nat.id} ${f1} & ${f2}d \u00b7 You ${c1} & ${c2}`;
      margin = `${weWin?'won':'lost'} by ${R} runs`;
      pts = weWin ? 100 + clamp(R/3, 5, 85) : -(70 + clamp(R/4, 5, 60));
    } else {
      const a1=rand(180,400), b1=rand(150,420), a2=rand(140,360);
      const chase=Math.max(30,a1+a2-b1+1), w=rand(2,8);
      score = weWin ? `${nat.id} ${a1} & ${a2} \u00b7 You ${b1} & ${chase}/${10-w}`
                    : `You ${a1} & ${a2} \u00b7 ${nat.id} ${b1} & ${chase}/${10-w}`;
      margin = `${weWin?'won':'lost'} by ${w} wickets`;
      pts = weWin ? 100 + clamp(w*10, 20, 80) : -(70 + clamp(w*8, 15, 60));
    }
  }
  return {score, margin, pts: Math.round(pts)};
}

function genWhiteBallMatch(code, nat, superOver){
  const t20 = FMTKEY==='t20';
  const lo=t20?130:220, hi=t20?225:380, ov=t20?'20 ov':'50 ov';
  const weWin = code==='W';
  const runMult = t20 ? 1.4 : 0.65;
  if(superOver){
    const x=rand(lo+20,hi-10), w1=rand(4,9), w2=rand(4,9);
    const mine=rand(9, t20?24:20), theirs= weWin? rand(Math.max(3,mine-9),mine-1) : rand(mine+1,mine+9);
    const line = weWin ? `Super Over: You ${mine}/${rand(0,2)} beat ${nat.id} ${theirs}/${rand(0,2)}`
                        : `Super Over: ${nat.id} ${mine}/${rand(0,2)} beat You ${theirs}/${rand(0,2)}`;
    return {score:`You ${x}/${w1} (${ov}) \u00b7 ${nat.id} ${x}/${w2} (${ov})`, margin:line, pts: weWin?115:-75};
  }
  if(Math.random()<0.5){
    const first=rand(lo+30,hi), R=rand(t20?4:8, t20?60:130), chase=Math.max(40,first-R);
    const bonus = clamp(R*runMult, 5, 85);
    return {score: weWin?`You ${first}/${rand(3,8)} (${ov}) \u00b7 ${nat.id} ${chase} all out`
                        :`${nat.id} ${first}/${rand(3,8)} (${ov}) \u00b7 You ${chase} all out`,
            margin:`${weWin?'won':'lost'} by ${first-chase} runs`,
            pts: Math.round(weWin ? 100+bonus : -(65+bonus*0.7))};
  } else {
    const first=rand(lo,hi-25), w=rand(1,8);
    const bonus = clamp(w*11, 15, 85);
    return {score: weWin?`${nat.id} ${first}/${rand(5,10)} (${ov}) \u00b7 You ${first+rand(1,6)}/${10-w}`
                        :`You ${first}/${rand(5,10)} (${ov}) \u00b7 ${nat.id} ${first+rand(1,6)}/${10-w}`,
            margin:`${weWin?'won':'lost'} by ${w} wickets`,
            pts: Math.round(weWin ? 100+bonus : -(65+bonus*0.6))};
  }
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
  /* opposition win: The Hundred uses real, verified 2026 franchise squads;
     nation-tour opponents draw from a same-decade player of that country */
  if(FMTKEY==='hundred' && HUNDRED_SQUADS[nat.id]){
    const squad=[...HUNDRED_SQUADS[nat.id]].sort((a,b)=>b.rt-a.rt);
    const real=squad[Math.min(squad.length-1, Math.floor(Math.random()*4))];
    const stub={roles:real.roles, r:real.rt};
    return `${real.n} (${nat.name}) \u2014 ${potmStat(stub)}`;
  }
  let opp=PLAYERS.filter(x=>x.c===nat.id && x.d==='20s' && !draftedNames.has(x.n));
  if(!opp.length) opp=PLAYERS.filter(x=>x.c===nat.id && !draftedNames.has(x.n));
  if(!opp.length) return `their captain \u2014 match-winning knock`;
  const p=opp.sort((a,b)=>b.r-a.r)[Math.min(opp.length-1,Math.floor(Math.random()*3))];
  return `${p.n} (${nat.id}) \u2014 ${potmStat(p)}`;
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

module.exports = { DB, mulberry32, NATIONS, HUNDRED_TEAMS, FORMATS, SLOTS, teamStrengths, decideMatch, decideNeutral, genTestMatch, genWhiteBallMatch, genHundredMatch, pickPOTM, buildHundredTable, getBowlingUnit, shuffle, admin, db, __setFMTKEY, __setXI };
