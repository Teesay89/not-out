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
  {id:'AFG', name:'Afghanistan',  flag:'🇦🇫', opp:85,  venues:['Sharjah Cricket Stadium','Zayed Cricket Stadium','Greater Noida Sports Complex']},
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
 {no:1, title:'Opener',        short:'OP', desc:'Faces the new ball first. A batter, keeper, or an all-rounder who opens.', fits:p=>p.roles.includes('bat')||p.roles.includes('wk')||(p.roles.includes('ar')&&p.bp==='O')},
 {no:2, title:'Opener',        short:'OP', desc:'The other half of the opening stand. Same eligibility as slot 1.', fits:p=>p.roles.includes('bat')||p.roles.includes('wk')||(p.roles.includes('ar')&&p.bp==='O')},
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

const BP_NATURAL = { O:[1,2], T:[1,2,3,4], M:[3,4,5,6,7], L:[6,7,8,9], X:[8,9,10,11], TM:[1,2,3,4,5,6,7], ML:[3,4,5,6,7,8,9], LX:[6,7,8,9,10,11] };

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

/* 200 of history's best captaincy records — extracted verbatim
   from the client, same as NATIONS/HUNDRED_TEAMS, so server-side
   verification applies the identical captain boost. */
const CAPTAINS_DB = [{"n":"Steve Waugh","c":"AUS","fmt":"test","d":"1990s","rt":92,"cid":"CRK0573"},{"n":"Mitchell Santner","c":"NZ","fmt":"odi","d":"2020s","rt":91,"cid":"CRK2336"},{"n":"Asghar Afghan","c":"AFG","fmt":"t20","d":"2020s","rt":91,"cid":"CRK0011"},{"n":"Asghar Afghan","c":"AFG","fmt":"t20","d":"2010s","rt":94,"cid":"CRK0011"},{"n":"Dhananjaya de Silva","c":"SL","fmt":"test","d":"2020s","rt":90,"cid":"CRK3318"},{"n":"Rohit Sharma","c":"IND","fmt":"t20","d":"2020s","rt":93,"cid":"CRK1867"},{"n":"Pat Cummins","c":"AUS","fmt":"odi","d":"2020s","rt":91,"cid":"CRK0490"},{"n":"Rohit Sharma","c":"IND","fmt":"t20","d":"2010s","rt":91,"cid":"CRK1867"},{"n":"Mike Brearley","c":"ENG","fmt":"odi","d":"1970s","rt":91,"cid":"CRK1235"},{"n":"Sarfaraz Ahmed","c":"PAK","fmt":"t20","d":"2010s","rt":93,"cid":"CRK2738"},{"n":"Ricky Ponting","c":"AUS","fmt":"odi","d":"2000s","rt":93,"cid":"CRK0538"},{"n":"Clive Lloyd","c":"WI","fmt":"odi","d":"1980s","rt":93,"cid":"CRK3594"},{"n":"Clive Lloyd","c":"WI","fmt":"odi","d":"1970s","rt":90,"cid":"CRK3594"},{"n":"Kane Williamson","c":"NZ","fmt":"test","d":"2020s","rt":89,"cid":"CRK2296"},{"n":"Mitchell Marsh","c":"AUS","fmt":"odi","d":"2020s","rt":89,"cid":"CRK0455"},{"n":"MS Dhoni","c":"IND","fmt":"test","d":"2000s","rt":89,"cid":"CRK1795"},{"n":"Ian Chappell","c":"AUS","fmt":"odi","d":"1970s","rt":89,"cid":"CRK0315"},{"n":"Tim Southee","c":"NZ","fmt":"t20","d":"2020s","rt":89,"cid":"CRK2430"},{"n":"Faf du Plessis","c":"SA","fmt":"odi","d":"2010s","rt":91,"cid":"CRK2968"},{"n":"Hansie Cronje","c":"SA","fmt":"odi","d":"1990s","rt":92,"cid":"CRK3258"},{"n":"Keshav Maharaj","c":"SA","fmt":"odi","d":"2020s","rt":88,"cid":"CRK3077"},{"n":"Steve Waugh","c":"AUS","fmt":"odi","d":"1990s","rt":92,"cid":"CRK0573"},{"n":"Rohit Sharma","c":"IND","fmt":"odi","d":"2020s","rt":92,"cid":"CRK1867"},{"n":"Shoaib Malik","c":"PAK","fmt":"t20","d":"2000s","rt":89,"cid":"CRK2765"},{"n":"Mitchell Marsh","c":"AUS","fmt":"t20","d":"2020s","rt":89,"cid":"CRK0455"},{"n":"Mike Gatting","c":"ENG","fmt":"odi","d":"1980s","rt":91,"cid":"CRK1357"},{"n":"Virat Kohli","c":"IND","fmt":"odi","d":"2010s","rt":92,"cid":"CRK1969"},{"n":"Kumar Sangakkara","c":"SL","fmt":"t20","d":"2000s","rt":88,"cid":"CRK3365"},{"n":"Paul Collingwood","c":"ENG","fmt":"t20","d":"2010s","rt":88,"cid":"CRK1396"},{"n":"Suryakumar Yadav","c":"IND","fmt":"t20","d":"2020s","rt":88,"cid":"CRK1917"},{"n":"Ricky Ponting","c":"AUS","fmt":"test","d":"2000s","rt":91,"cid":"CRK0538"},{"n":"Steve Waugh","c":"AUS","fmt":"test","d":"2000s","rt":91,"cid":"CRK0573"},{"n":"Allan Border","c":"AUS","fmt":"odi","d":"1990s","rt":91,"cid":"CRK0130"},{"n":"Michael Clarke","c":"AUS","fmt":"odi","d":"2010s","rt":91,"cid":"CRK0440"},{"n":"Shoaib Malik","c":"PAK","fmt":"odi","d":"2000s","rt":90,"cid":"CRK2765"},{"n":"Graeme Smith","c":"SA","fmt":"t20","d":"2000s","rt":89,"cid":"CRK2983"},{"n":"Rovman Powell","c":"WI","fmt":"t20","d":"2020s","rt":88,"cid":"CRK3834"},{"n":"KL Rahul","c":"IND","fmt":"odi","d":"2020s","rt":88,"cid":"CRK1749"},{"n":"Mahela Jayawardene","c":"SL","fmt":"t20","d":"2000s","rt":87,"cid":"CRK3322"},{"n":"Charith Asalanka","c":"SL","fmt":"odi","d":"2020s","rt":87,"cid":"CRK3370"},{"n":"Eoin Morgan","c":"ENG","fmt":"t20","d":"2020s","rt":89,"cid":"CRK1027"},{"n":"Viv Richards","c":"WI","fmt":"odi","d":"1980s","rt":90,"cid":"CRK3699"},{"n":"Kane Williamson","c":"NZ","fmt":"odi","d":"2020s","rt":87,"cid":"CRK2296"},{"n":"Shaun Pollock","c":"SA","fmt":"odi","d":"2000s","rt":90,"cid":"CRK3227"},{"n":"Rashid Khan","c":"AFG","fmt":"t20","d":"2020s","rt":88,"cid":"CRK0064"},{"n":"Waqar Younis","c":"PAK","fmt":"test","d":"1990s","rt":87,"cid":"CRK2797"},{"n":"AB de Villiers","c":"SA","fmt":"odi","d":"2010s","rt":90,"cid":"CRK2831"},{"n":"Ben Stokes","c":"ENG","fmt":"test","d":"2020s","rt":88,"cid":"CRK0902"},{"n":"Graeme Smith","c":"SA","fmt":"odi","d":"2000s","rt":90,"cid":"CRK2983"},{"n":"Rohit Sharma","c":"IND","fmt":"test","d":"2020s","rt":87,"cid":"CRK1867"},{"n":"Hardik Pandya","c":"IND","fmt":"t20","d":"2020s","rt":87,"cid":"CRK1707"},{"n":"Temba Bavuma","c":"SA","fmt":"test","d":"2020s","rt":86,"cid":"CRK3231"},{"n":"Younis Khan","c":"PAK","fmt":"t20","d":"2000s","rt":86,"cid":"CRK2809"},{"n":"Virat Kohli","c":"IND","fmt":"test","d":"2010s","rt":90,"cid":"CRK1969"},{"n":"Faf du Plessis","c":"SA","fmt":"t20","d":"2010s","rt":89,"cid":"CRK2968"},{"n":"Mohammad Hafeez","c":"PAK","fmt":"t20","d":"2010s","rt":88,"cid":"CRK2639"},{"n":"Eoin Morgan","c":"ENG","fmt":"odi","d":"2010s","rt":90,"cid":"CRK1027"},{"n":"Mitchell Santner","c":"NZ","fmt":"t20","d":"2020s","rt":87,"cid":"CRK2336"},{"n":"Mike Brearley","c":"ENG","fmt":"test","d":"1970s","rt":87,"cid":"CRK1235"},{"n":"Virat Kohli","c":"IND","fmt":"t20","d":"2020s","rt":87,"cid":"CRK1969"},{"n":"Pat Cummins","c":"AUS","fmt":"test","d":"2020s","rt":87,"cid":"CRK0490"},{"n":"Wasim Akram","c":"PAK","fmt":"odi","d":"1990s","rt":89,"cid":"CRK2799"},{"n":"Tom Latham","c":"NZ","fmt":"odi","d":"2020s","rt":88,"cid":"CRK2436"},{"n":"Babar Azam","c":"PAK","fmt":"odi","d":"2020s","rt":89,"cid":"CRK2525"},{"n":"MS Dhoni","c":"IND","fmt":"odi","d":"2000s","rt":89,"cid":"CRK1795"},{"n":"Jeremy Coney","c":"NZ","fmt":"odi","d":"1980s","rt":87,"cid":"CRK2283"},{"n":"Temba Bavuma","c":"SA","fmt":"t20","d":"2020s","rt":87,"cid":"CRK3231"},{"n":"MS Dhoni","c":"IND","fmt":"t20","d":"2000s","rt":87,"cid":"CRK1795"},{"n":"Greg Chappell","c":"AUS","fmt":"odi","d":"1970s","rt":86,"cid":"CRK0287"},{"n":"Virat Kohli","c":"IND","fmt":"odi","d":"2020s","rt":86,"cid":"CRK1969"},{"n":"Dimuth Karunaratne","c":"SL","fmt":"test","d":"2010s","rt":86,"cid":"CRK3332"},{"n":"Michael Clarke","c":"AUS","fmt":"t20","d":"2000s","rt":86,"cid":"CRK0440"},{"n":"Wanindu Hasaranga","c":"SL","fmt":"t20","d":"2020s","rt":86,"cid":"CRK3450"},{"n":"Litton Das","c":"BAN","fmt":"odi","d":"2020s","rt":85,"cid":"CRK0698"},{"n":"Waqar Younis","c":"PAK","fmt":"odi","d":"2000s","rt":89,"cid":"CRK2797"},{"n":"Mahela Jayawardene","c":"SL","fmt":"odi","d":"2000s","rt":89,"cid":"CRK3322"},{"n":"Virat Kohli","c":"IND","fmt":"t20","d":"2010s","rt":87,"cid":"CRK1969"},{"n":"Waqar Younis","c":"PAK","fmt":"test","d":"2000s","rt":86,"cid":"CRK2797"},{"n":"Inzamam-ul-Haq","c":"PAK","fmt":"odi","d":"2000s","rt":89,"cid":"CRK2582"},{"n":"Shikhar Dhawan","c":"IND","fmt":"odi","d":"2020s","rt":86,"cid":"CRK1896"},{"n":"Brendon McCullum","c":"NZ","fmt":"odi","d":"2010s","rt":89,"cid":"CRK2122"},{"n":"Aaron Finch","c":"AUS","fmt":"odi","d":"2020s","rt":87,"cid":"CRK0113"},{"n":"Mashrafe Mortaza","c":"BAN","fmt":"odi","d":"2010s","rt":88,"cid":"CRK0709"},{"n":"Darren Sammy","c":"WI","fmt":"t20","d":"2010s","rt":88,"cid":"CRK3623"},{"n":"Temba Bavuma","c":"SA","fmt":"odi","d":"2020s","rt":87,"cid":"CRK3231"},{"n":"Tamim Iqbal","c":"BAN","fmt":"odi","d":"2020s","rt":87,"cid":"CRK0796"},{"n":"Babar Azam","c":"PAK","fmt":"t20","d":"2020s","rt":88,"cid":"CRK2525"},{"n":"Imran Khan","c":"PAK","fmt":"odi","d":"1980s","rt":88,"cid":"CRK2577"},{"n":"Dasun Shanaka","c":"SL","fmt":"odi","d":"2020s","rt":87,"cid":"CRK3406"},{"n":"Sarfaraz Ahmed","c":"PAK","fmt":"odi","d":"2010s","rt":88,"cid":"CRK2738"},{"n":"Sanath Jayasuriya","c":"SL","fmt":"odi","d":"2000s","rt":88,"cid":"CRK3499"},{"n":"MS Dhoni","c":"IND","fmt":"t20","d":"2010s","rt":88,"cid":"CRK1795"},{"n":"Marvan Atapattu","c":"SL","fmt":"odi","d":"2000s","rt":88,"cid":"CRK3420"},{"n":"Viv Richards","c":"WI","fmt":"test","d":"1980s","rt":87,"cid":"CRK3699"},{"n":"Kane Williamson","c":"NZ","fmt":"t20","d":"2020s","rt":87,"cid":"CRK2296"},{"n":"Andrew Strauss","c":"ENG","fmt":"test","d":"2000s","rt":85,"cid":"CRK0868"},{"n":"Kusal Mendis","c":"SL","fmt":"odi","d":"2020s","rt":85,"cid":"CRK3291"},{"n":"Asghar Afghan","c":"AFG","fmt":"odi","d":"2010s","rt":88,"cid":"CRK0011"},{"n":"Allan Border","c":"AUS","fmt":"odi","d":"1980s","rt":88,"cid":"CRK0130"},{"n":"Steve Waugh","c":"AUS","fmt":"odi","d":"2000s","rt":88,"cid":"CRK0573"},{"n":"JP Duminy","c":"SA","fmt":"t20","d":"2010s","rt":85,"cid":"CRK3066"},{"n":"Brian Lara","c":"WI","fmt":"odi","d":"1990s","rt":87,"cid":"CRK3559"},{"n":"Graeme Smith","c":"SA","fmt":"odi","d":"2010s","rt":85,"cid":"CRK2983"},{"n":"Kieron Pollard","c":"WI","fmt":"odi","d":"2020s","rt":85,"cid":"CRK3742"},{"n":"Daniel Vettori","c":"NZ","fmt":"t20","d":"2000s","rt":85,"cid":"CRK2185"},{"n":"Shaun Pollock","c":"SA","fmt":"test","d":"2000s","rt":86,"cid":"CRK3227"},{"n":"Mark Taylor","c":"AUS","fmt":"odi","d":"1990s","rt":87,"cid":"CRK0427"},{"n":"Jos Buttler","c":"ENG","fmt":"t20","d":"2020s","rt":87,"cid":"CRK1194"},{"n":"Mahela Jayawardene","c":"SL","fmt":"test","d":"2000s","rt":86,"cid":"CRK3322"},{"n":"Eoin Morgan","c":"ENG","fmt":"t20","d":"2010s","rt":87,"cid":"CRK1027"},{"n":"Aaron Finch","c":"AUS","fmt":"t20","d":"2020s","rt":87,"cid":"CRK0113"},{"n":"Rahul Dravid","c":"IND","fmt":"odi","d":"2000s","rt":87,"cid":"CRK1847"},{"n":"Kane Williamson","c":"NZ","fmt":"odi","d":"2010s","rt":87,"cid":"CRK2296"},{"n":"Ricky Ponting","c":"AUS","fmt":"odi","d":"2010s","rt":87,"cid":"CRK0538"},{"n":"Faf du Plessis","c":"SA","fmt":"test","d":"2010s","rt":86,"cid":"CRK2968"},{"n":"Richie Richardson","c":"WI","fmt":"odi","d":"1990s","rt":87,"cid":"CRK3842"},{"n":"Steve Smith","c":"AUS","fmt":"test","d":"2010s","rt":86,"cid":"CRK0570"},{"n":"Dean Elgar","c":"SA","fmt":"test","d":"2020s","rt":85,"cid":"CRK2913"},{"n":"Kapil Dev","c":"IND","fmt":"odi","d":"1980s","rt":87,"cid":"CRK1806"},{"n":"MS Dhoni","c":"IND","fmt":"odi","d":"2010s","rt":87,"cid":"CRK1795"},{"n":"Greg Chappell","c":"AUS","fmt":"test","d":"1970s","rt":85,"cid":"CRK0287"},{"n":"Tim Paine","c":"AUS","fmt":"test","d":"2010s","rt":85,"cid":"CRK0580"},{"n":"Najmul Hossain Shanto","c":"BAN","fmt":"t20","d":"2020s","rt":85,"cid":"CRK0739"},{"n":"Alastair Cook","c":"ENG","fmt":"odi","d":"2010s","rt":87,"cid":"CRK0876"},{"n":"Aiden Markram","c":"SA","fmt":"t20","d":"2020s","rt":85,"cid":"CRK2850"},{"n":"Sourav Ganguly","c":"IND","fmt":"odi","d":"2000s","rt":87,"cid":"CRK1920"},{"n":"Mark Taylor","c":"AUS","fmt":"test","d":"1990s","rt":87,"cid":"CRK0427"},{"n":"Mohammad Azharuddin","c":"IND","fmt":"odi","d":"1990s","rt":87,"cid":"CRK1769"},{"n":"Misbah-ul-Haq","c":"PAK","fmt":"odi","d":"2010s","rt":87,"cid":"CRK2630"},{"n":"Geoff Howarth","c":"NZ","fmt":"odi","d":"1980s","rt":87,"cid":"CRK2223"},{"n":"Aaron Finch","c":"AUS","fmt":"t20","d":"2010s","rt":85,"cid":"CRK0113"},{"n":"Clive Lloyd","c":"WI","fmt":"test","d":"1970s","rt":86,"cid":"CRK3594"},{"n":"Courtney Walsh","c":"WI","fmt":"odi","d":"1990s","rt":86,"cid":"CRK3574"},{"n":"Michael Clarke","c":"AUS","fmt":"test","d":"2010s","rt":87,"cid":"CRK0440"},{"n":"Daniel Vettori","c":"NZ","fmt":"odi","d":"2000s","rt":87,"cid":"CRK2185"},{"n":"Michael Vaughan","c":"ENG","fmt":"test","d":"2000s","rt":87,"cid":"CRK1348"},{"n":"Hansie Cronje","c":"SA","fmt":"test","d":"1990s","rt":87,"cid":"CRK3258"},{"n":"Nasser Hussain","c":"ENG","fmt":"odi","d":"2000s","rt":86,"cid":"CRK1362"},{"n":"Shahid Afridi","c":"PAK","fmt":"odi","d":"2010s","rt":86,"cid":"CRK2747"},{"n":"Kane Williamson","c":"NZ","fmt":"test","d":"2010s","rt":85,"cid":"CRK2296"},{"n":"Hashmatullah Shahidi","c":"AFG","fmt":"odi","d":"2020s","rt":85,"cid":"CRK0025"},{"n":"Ian Chappell","c":"AUS","fmt":"test","d":"1970s","rt":85,"cid":"CRK0315"},{"n":"George Bailey","c":"AUS","fmt":"t20","d":"2010s","rt":85,"cid":"CRK0271"},{"n":"Dinesh Chandimal","c":"SL","fmt":"t20","d":"2010s","rt":85,"cid":"CRK3387"},{"n":"Shai Hope","c":"WI","fmt":"odi","d":"2020s","rt":84,"cid":"CRK3886"},{"n":"Babar Azam","c":"PAK","fmt":"test","d":"2020s","rt":84,"cid":"CRK2525"},{"n":"Paul Collingwood","c":"ENG","fmt":"t20","d":"2000s","rt":84,"cid":"CRK1396"},{"n":"Eoin Morgan","c":"ENG","fmt":"odi","d":"2020s","rt":84,"cid":"CRK1027"},{"n":"Shakib Al Hasan","c":"BAN","fmt":"t20","d":"2020s","rt":84,"cid":"CRK0779"},{"n":"Mohammad Nabi","c":"AFG","fmt":"t20","d":"2010s","rt":83,"cid":"CRK0043"},{"n":"Mahmudullah","c":"BAN","fmt":"t20","d":"2010s","rt":83,"cid":"CRK0705"},{"n":"Steve Smith","c":"AUS","fmt":"t20","d":"2010s","rt":83,"cid":"CRK0570"},{"n":"Najmul Hossain Shanto","c":"BAN","fmt":"test","d":"2020s","rt":83,"cid":"CRK0739"},{"n":"Steve Smith","c":"AUS","fmt":"odi","d":"2010s","rt":86,"cid":"CRK0570"},{"n":"Imran Khan","c":"PAK","fmt":"odi","d":"1990s","rt":85,"cid":"CRK2577"},{"n":"Graeme Smith","c":"SA","fmt":"test","d":"2010s","rt":85,"cid":"CRK2983"},{"n":"Kane Williamson","c":"NZ","fmt":"t20","d":"2010s","rt":85,"cid":"CRK2296"},{"n":"Graeme Smith","c":"SA","fmt":"test","d":"2000s","rt":86,"cid":"CRK2983"},{"n":"Daniel Vettori","c":"NZ","fmt":"odi","d":"2010s","rt":85,"cid":"CRK2185"},{"n":"Andrew Strauss","c":"ENG","fmt":"odi","d":"2000s","rt":85,"cid":"CRK0868"},{"n":"Graham Gooch","c":"ENG","fmt":"odi","d":"1990s","rt":86,"cid":"CRK1079"},{"n":"Wasim Akram","c":"PAK","fmt":"test","d":"1990s","rt":84,"cid":"CRK2799"},{"n":"Martin Crowe","c":"NZ","fmt":"odi","d":"1990s","rt":85,"cid":"CRK2318"},{"n":"Sanath Jayasuriya","c":"SL","fmt":"test","d":"2000s","rt":85,"cid":"CRK3499"},{"n":"Jos Buttler","c":"ENG","fmt":"odi","d":"2020s","rt":85,"cid":"CRK1194"},{"n":"Dinesh Chandimal","c":"SL","fmt":"test","d":"2010s","rt":83,"cid":"CRK3387"},{"n":"Sikandar Raza","c":"ZIM","fmt":"t20","d":"2020s","rt":83,"cid":"CRK4071"},{"n":"Stephen Fleming","c":"NZ","fmt":"odi","d":"2000s","rt":86,"cid":"CRK2416"},{"n":"Carl Hooper","c":"WI","fmt":"odi","d":"2000s","rt":86,"cid":"CRK3597"},{"n":"Arjuna Ranatunga","c":"SL","fmt":"odi","d":"1990s","rt":86,"cid":"CRK3270"},{"n":"Virat Kohli","c":"IND","fmt":"test","d":"2020s","rt":83,"cid":"CRK1969"},{"n":"Michael Atherton","c":"ENG","fmt":"odi","d":"1990s","rt":85,"cid":"CRK1311"},{"n":"Misbah-ul-Haq","c":"PAK","fmt":"test","d":"2010s","rt":86,"cid":"CRK2630"},{"n":"Shakib Al Hasan","c":"BAN","fmt":"odi","d":"2010s","rt":85,"cid":"CRK0779"},{"n":"Angelo Mathews","c":"SL","fmt":"odi","d":"2010s","rt":86,"cid":"CRK3272"},{"n":"Clive Lloyd","c":"WI","fmt":"test","d":"1980s","rt":85,"cid":"CRK3594"},{"n":"Gary Wilson","c":"IRE","fmt":"t20","d":"2010s","rt":84,"cid":"CRK2032"},{"n":"Craig Ervine","c":"ZIM","fmt":"t20","d":"2020s","rt":84,"cid":"CRK3968"},{"n":"Steve Smith","c":"AUS","fmt":"odi","d":"2020s","rt":83,"cid":"CRK0570"},{"n":"Ross Taylor","c":"NZ","fmt":"t20","d":"2010s","rt":83,"cid":"CRK2307"},{"n":"Dasun Shanaka","c":"SL","fmt":"t20","d":"2020s","rt":85,"cid":"CRK3406"},{"n":"Richie Richardson","c":"WI","fmt":"test","d":"1990s","rt":83,"cid":"CRK3842"},{"n":"Brendon McCullum","c":"NZ","fmt":"t20","d":"2010s","rt":83,"cid":"CRK2122"},{"n":"Ricky Ponting","c":"AUS","fmt":"test","d":"2010s","rt":83,"cid":"CRK0538"},{"n":"Dilip Vengsarkar","c":"IND","fmt":"odi","d":"1980s","rt":83,"cid":"CRK1668"},{"n":"AB de Villiers","c":"SA","fmt":"t20","d":"2010s","rt":83,"cid":"CRK2831"},{"n":"Younis Khan","c":"PAK","fmt":"test","d":"2000s","rt":82,"cid":"CRK2809"},{"n":"Tom Latham","c":"NZ","fmt":"test","d":"2020s","rt":82,"cid":"CRK2436"},{"n":"William Porterfield","c":"IRE","fmt":"odi","d":"2010s","rt":85,"cid":"CRK2093"},{"n":"Paul Collingwood","c":"ENG","fmt":"odi","d":"2000s","rt":83,"cid":"CRK1396"},{"n":"Andrew Strauss","c":"ENG","fmt":"test","d":"2010s","rt":84,"cid":"CRK0868"},{"n":"Joe Root","c":"ENG","fmt":"test","d":"2010s","rt":84,"cid":"CRK1209"},{"n":"Kumar Sangakkara","c":"SL","fmt":"odi","d":"2010s","rt":85,"cid":"CRK3365"},{"n":"Mohammad Nabi","c":"AFG","fmt":"t20","d":"2020s","rt":83,"cid":"CRK0043"},{"n":"Michael Vaughan","c":"ENG","fmt":"odi","d":"2000s","rt":85,"cid":"CRK1348"},{"n":"Brian Lara","c":"WI","fmt":"odi","d":"2000s","rt":85,"cid":"CRK3559"},{"n":"Sourav Ganguly","c":"IND","fmt":"test","d":"2000s","rt":85,"cid":"CRK1920"},{"n":"Javed Miandad","c":"PAK","fmt":"odi","d":"1980s","rt":84,"cid":"CRK2593"},{"n":"Tim Southee","c":"NZ","fmt":"test","d":"2020s","rt":82,"cid":"CRK2430"},{"n":"Shahid Afridi","c":"PAK","fmt":"t20","d":"2010s","rt":84,"cid":"CRK2747"}];
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
  if(arDeep) notes.push('All-rounder in the lower order — the batting runs deep.');
  if(arTop) notes.push('All-rounder in the top five — an extra bowling option up front.');
  if(partTimer) notes.push(`Only 4 frontline bowlers — ${partTimer.n} (Bat) makes up the legal fifth option.`);
  else notes.push(`${bowlUnit.length} bowling option${bowlUnit.length===1?'':'s'} in the XI.`);
  if(misplaced>0) notes.push(`${misplaced} player${misplaced===1?' is':'s are'} batting out of position — a small hit to the batting number.`);
  if(decadesUsed>=4){bonus+=3; notes.push(`Time-travelling XI: ${decadesUsed} decades represented.`);}
  if(nationsUsed>=6){bonus+=3; notes.push(`World XI: ${nationsUsed} nations in one dressing room.`);}
  const capMatch = FMTKEY!=='hundred' ? isEliteCaptain(xi[captainIdx], FMTKEY) : null;
  if(capMatch){ bonus += 0.25; notes.push(`🎖️ ${capMatch.n} led with a real ${DECADE_LABEL[capMatch.d]} ${FMT.label} captaincy record — +0.25 team boost.`); }
  const inPositionCount = xi.filter((p,i)=>positionPenalty(p, i+1)===0).length;
  if(inPositionCount>0) notes.push(`${inPositionCount} player${inPositionCount===1?'':'s'} in their correct position — each gets a small individual rating boost.`);
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
  if(FMTKEY==='hundred' && HUNDRED_SQUADS[nat.id]){
    const squad=[...HUNDRED_SQUADS[nat.id]].sort((a,b)=>b.rt-a.rt);
    const real=squad[Math.min(squad.length-1, Math.floor(Math.random()*4))];
    const stub={roles:real.roles, r:real.rt};
    return `${real.n} (${nat.name}) \u2014 ${potmStat(stub)}`;
  }
  let opp=PLAYERS.filter(x=>x.c===nat.id && x.d===(FMTKEY==='hundred' ? '20s' : '2020s') && !draftedNames.has(x.n));
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
  // Output text is never used server-side, but rand() must be called
  // the identical number of times (3: score, w1, w2) as the client's
  // version to keep the seeded sequence in sync.
  const t20 = FMTKEY==='t20';
  const lo = t20?130:220, hi = t20?225:380;
  rand(lo+20, hi-10); rand(4,9); rand(4,9);
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
      applyResult(A, B, decideRepresentNeutral(A.opp, B.opp, HOME_BONUS));   // leg 1: A hosts
      applyResult(A, B, decideRepresentNeutral(A.opp, B.opp, -HOME_BONUS));  // leg 2: B hosts
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

    const yourMatches = [];
    opponents.forEach((opp) => {
      for (let leg = 0; leg < 2; leg++) {
        const homeBonus = leg === 0 ? HOME_BONUS : -HOME_BONUS;
        const code = decideRepresentMatch(st.strength, opp.opp, homeBonus);
        if (code === 'T') genTieMatch();
        else if (format === 'test') genTestMatch(code, opp);
        else genWhiteBallMatch(code, opp, false);
        pickPOTM(code, opp); // consumes RNG in lockstep with client; output unused server-side
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
      const res = decideRepresentFinal(st.strength, finalOppNat.opp);
      finalCode = res.code;
      if (format === 'test') genTestMatch(finalCode, finalOppNat);
      else genWhiteBallMatch(finalCode, finalOppNat, res.superOver);
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
    const stops = shuffle(NATIONS.slice());
    let w = 0, d = 0, l = 0;
    let totalSeriesWon = 0, totalSweeps = 0, marginSum = 0, marginCount = 0;

    stops.forEach((nat) => {
      const seriesCodes = [];
      for (let m = 0; m < 5; m++) {
        const res = decideMatch(st.strength, nat.opp + 4);
        const code = res.code;
        const gen = format === 'test' 
          ? genTestMatch(code, nat) 
          : genWhiteBallMatch(code, nat, res.superOver);
        
        pickPOTM(code, nat); // Consumes RNG state in lockstep with client
        seriesCodes.push(code);
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

module.exports = { calculateScore, calculateRepresentResult, DB, mulberry32, NATIONS, HUNDRED_TEAMS, FORMATS, SLOTS, teamStrengths, decideMatch, decideNeutral, genTestMatch, genWhiteBallMatch, genHundredMatch, pickPOTM, buildHundredTable, getBowlingUnit, shuffle, admin, db, __setFMTKEY, __setXI };