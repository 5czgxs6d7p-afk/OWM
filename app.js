/* OWM Waterpolo Manager — Fase 3B (Stap 2)
   - Dagelijkse match op vaste tijd (1x per kalenderdag)
   - Training: 4 uur, max 1 per dag, 1 speler per positie: GK, CB, CF, LD, LW, RW, RD
   - Growth preview gebaseerd op potential
   - Dashboard met: matchselectie, tactiek, training, ranglijst
   - Import: volledige save of spelerslijst
*/

const STORAGE_KEY = "owm_mvp_save_v3b2";

const POS_MATCH = ["GK","CB","CF","LD","LW","RW","RD"];
const WPTS = 3, DPTS = 1, LPTS = 0;

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function round1(n){ return Math.round(n * 10) / 10; }
function rand(min, max){ return Math.random() * (max - min) + min; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

function isoDate(d=new Date()){ return d.toISOString().slice(0,10); }
function pad2(n){ return String(n).padStart(2,"0"); }
function hhmm(d=new Date()){ return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function formatISO(iso){
  const [y,m,dd] = iso.split("-");
  return `${dd}-${m}-${y}`;
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function ensureUUID(){
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return String(Date.now()) + "-" + Math.round(Math.random()*1e9);
}

function baseStatsForPos(pos){
  // 0-100
  const base = () => clamp(Math.round(rand(50, 78)), 0, 100);
  const s = {
    shooting: base(),
    passing: base(),
    defense: base(),
    speed: base(),
    stamina: base(),
    goalie: clamp(Math.round(rand(10, 35)), 0, 100),
    iq: base()
  };

  if(pos==="GK"){
    s.goalie = clamp(Math.round(rand(65, 88)), 0, 100);
    s.defense = clamp(s.defense + 8, 0, 100);
    s.shooting = clamp(s.shooting - 12, 0, 100);
  }
  if(pos==="CB"){
    s.defense = clamp(s.defense + 10, 0, 100);
    s.iq = clamp(s.iq + 4, 0, 100);
    s.speed = clamp(s.speed - 2, 0, 100);
  }
  if(pos==="CF"){
    s.shooting = clamp(s.shooting + 10, 0, 100);
    s.iq = clamp(s.iq + 4, 0, 100);
    s.speed = clamp(s.speed - 3, 0, 100);
  }
  if(pos==="LD"){
    s.defense = clamp(s.defense + 8, 0, 100);
    s.passing = clamp(s.passing + 3, 0, 100);
  }
  if(pos==="LW" || pos==="RW"){
    s.speed = clamp(s.speed + 10, 0, 100);
    s.passing = clamp(s.passing + 4, 0, 100);
  }
  if(pos==="RD"){
    s.defense = clamp(s.defense + 7, 0, 100);
    s.speed = clamp(s.speed + 3, 0, 100);
  }

  return s;
}

function defaultPlayer(name, pos){
  const p = {
    id: ensureUUID(),
    name: name || "Speler",
    pos: pos || "U",
    potential: clamp(Math.round(rand(55, 92)), 0, 100),
    fitness: clamp(Math.round(rand(75, 95)), 30, 100),
    injury: null, // { type, severity(1-3), daysLeft }
    form: clamp(Math.round(rand(45, 70)), 0, 100),
    stats: baseStatsForPos(pos || "U")
  };
  return p;
}

/* ---------------- League / Standings ---------------- */

function createLeague(){
  // eenvoudige competitie (10 teams), vaste ratings voor tegenstanders
  const teams = [
    { id:"OWM", name:"OWM", rating: 0 }, // rating computed
    { id:"UTR", name:"Utrecht Sharks", rating: 72 },
    { id:"AMS", name:"Amsterdam Waves", rating: 75 },
    { id:"RTD", name:"Rotterdam Storm", rating: 70 },
    { id:"EIN", name:"Eindhoven Jets", rating: 74 },
    { id:"GRO", name:"Groningen North", rating: 68 },
    { id:"HAA", name:"Haarlem Tide", rating: 69 },
    { id:"NIJ", name:"Nijmegen Forge", rating: 71 },
    { id:"BRD", name:"Breda Anchors", rating: 67 },
    { id:"MAA", name:"Maastricht Current", rating: 66 }
  ];

  const standings = {};
  for(const t of teams){
    standings[t.id] = { teamId:t.id, teamName:t.name, P:0, W:0, D:0, L:0, GF:0, GA:0, Pts:0 };
  }

  return {
    teams,
    standings,
    // eenvoudige “opponent of the day” rotatie (OWM speelt dagelijks tegen volgende)
    rotationIndex: 1,
    lastMatchDate: null,
    lastResult: null
  };
}

function nextOpponent(){
  const league = state?.league;
  if(!league?.teams?.length) return null;
  const opponent = league.teams[league.rotationIndex % league.teams.length];
  if(!opponent) return null;
  if(opponent.id === "OWM"){
    return league.teams[(league.rotationIndex + 1) % league.teams.length];
  }
  return opponent;
}

function sortStandings(standingsMap){
  const arr = Object.values(standingsMap).map(r => ({...r, GD: r.GF - r.GA}));
  arr.sort((a,b) => {
    if(b.Pts !== a.Pts) return b.Pts - a.Pts;
    if((b.GF-b.GA) !== (a.GF-a.GA)) return (b.GF-b.GA) - (a.GF-a.GA);
    if(b.GF !== a.GF) return b.GF - a.GF;
    return a.teamName.localeCompare(b.teamName);
  });
  return arr;
}

/* ---------------- Core rating ---------------- */

function playerRating(p){
  const s = p.stats;
  const core = (s.shooting + s.passing + s.defense + s.speed + s.stamina + s.iq) / 6;
  const gkBonus = (p.pos === "GK") ? (s.goalie * 0.35) : (s.goalie * 0.05);
  const injuryPenalty = p.injury ? (10 + p.injury.severity * 6) : 0;
  const fitnessFactor = (p.fitness - 50) * 0.10;
  const formFactor = (p.form - 50) * 0.08;
  return clamp(Math.round(core + gkBonus + fitnessFactor + formFactor - injuryPenalty), 1, 99);
}

function teamRatingFromLineup(lineup, playersById){
  const ids = Object.values(lineup).filter(Boolean);
  if(ids.length === 0) return 0;
  const ratings = ids.map(id => playersById[id]).filter(Boolean).map(p => playerRating(p));
  if(ratings.length === 0) return 0;
  return Math.round(ratings.reduce((a,b)=>a+b,0)/ratings.length);
}

function averageFitness(players){
  if(players.length===0) return 0;
  return players.reduce((a,p)=>a+p.fitness,0)/players.length;
}

/* ---------------- Training ---------------- */

function focusLabel(f){
  return ({
    conditioning:"Conditie",
    strength:"Kracht",
    shooting:"Schieten",
    defense:"Verdediging",
    tactics:"Tactiek",
    goalie:"Keeper"
  })[f] || f;
}

function injuryLabel(p){
  if(!p.injury) return "Fit";
  return `${p.injury.type} (${p.injury.daysLeft}d)`;
}

function injuryRiskForTraining(p){
  // training verhoogt risico, lage fitness ook
  let risk = 0.008;
  if(p.fitness < 65) risk += (65 - p.fitness) * 0.0007;
  if(p.injury) risk *= 0.25;
  return clamp(risk, 0, 0.10);
}

function potentialFactor(p){
  // 0..100 => factor ongeveer 0.65..1.35
  return 0.65 + (p.potential / 100) * 0.70;
}

function trainingDeltaPreview(p, type){
  // preview per 4u training (klein, OSM-achtig)
  // base gain in “skill points” afhankelijk van potential
  const pf = potentialFactor(p);
  const base = rand(0.18, 0.32) * pf; // alle skills mini
  const focus = rand(0.35, 0.70) * pf; // focus skill groter

  const d = { all: base };

  if(type==="conditioning"){
    d.stamina = focus;
    d.speed = focus * 0.45;
  } else if(type==="strength"){
    d.defense = focus * 0.55;
    d.speed = focus * 0.25;
    d.shooting = focus * 0.15;
  } else if(type==="shooting"){
    d.shooting = focus;
    d.passing = focus * 0.35;
  } else if(type==="defense"){
    d.defense = focus;
    d.iq = focus * 0.25;
  } else if(type==="tactics"){
    d.iq = focus;
    d.passing = focus * 0.35;
    d.defense = focus * 0.25;
  } else if(type==="goalie"){
    d.goalie = focus;
    d.defense = focus * 0.20;
  }

  // Positie nuance
  if(p.pos==="GK"){
    d.goalie = (d.goalie ?? 0) + (type==="goalie" ? focus*0.35 : base*0.7);
    d.shooting = (d.shooting ?? 0) - base*0.25;
  }

  // rond preview netjes
  for(const k of Object.keys(d)){
    d[k] = round1(d[k]);
  }
  return d;
}

function applyTrainingToPlayer(p, delta, type){
  const logs = [];

  // Blessure-afwikkeling: als geblesseerd, training niet toegestaan (OSM-achtig)
  if(p.injury){
    logs.push(`${p.name} kan niet trainen (geblesseerd: ${p.injury.type}).`);
    return logs;
  }

  // blessure check door training
  const risk = injuryRiskForTraining(p);
  if(Math.random() < risk){
    const types = ["Schouder","Lies","Rug","Pols","Enkel"];
    const severity = pick([1,1,2,2,3]);
    const daysLeft = severity===1 ? Math.round(rand(2,4))
                  : severity===2 ? Math.round(rand(4,8))
                  : Math.round(rand(7,14));
    p.injury = { type: pick(types), severity, daysLeft };
    p.fitness = clamp(p.fitness - rand(2,6), 30, 100);
    p.form = clamp(p.form - rand(2,6), 0, 100);
    logs.push(`${p.name} raakt geblesseerd tijdens training (${p.injury.type}, sev ${severity}, ${daysLeft}d).`);
    return logs;
  }

  // fitness kost (4 uur)
  const fatigue = type==="strength" ? rand(2.2,3.4) : type==="conditioning" ? rand(2.0,3.0) : rand(1.6,2.6);
  p.fitness = clamp(p.fitness - fatigue, 30, 100);
  p.form = clamp(p.form + rand(0.2, 0.9), 0, 100);

  // apply stats
  const s = p.stats;
  const all = delta.all ?? 0;
  if(all){
    for(const k of Object.keys(s)){
      s[k] = clamp(s[k] + all, 0, 100);
    }
  }
  for(const [k,v] of Object.entries(delta)){
    if(k==="all") continue;
    if(typeof s[k] === "number") s[k] = clamp(s[k] + v, 0, 100);
  }

  logs.push(`${p.name} traint 4u (${focusLabel(type)}), growth gebaseerd op potential ${p.potential}.`);
  return logs;
}

/* ---------------- Match engine ---------------- */

function tacticsModifier(tactics){
  // kleine modifiers (MVP) op basis van keuzes
  let off = 0, def = 0, tempo = 0, risk = 0;

  if(tactics.defense==="press"){ def += 1.2; risk += 0.8; }
  if(tactics.defense==="mzone"){ def += 0.6; off += 0.3; }
  if(tactics.offense==="center"){ off += 1.0; }
  if(tactics.offense==="perimeter"){ off += 0.8; }
  if(tactics.offense==="counter"){ tempo += 1.1; risk += 0.6; }

  if(tactics.tempo==="low"){ def += 0.7; off -= 0.2; }
  if(tactics.tempo==="high"){ off += 0.7; def -= 0.2; risk += 0.5; }

  if(tactics.risk==="safe"){ def += 0.4; off -= 0.2; }
  if(tactics.risk==="aggressive"){ off += 0.6; def -= 0.2; risk += 0.6; }

  return { off, def, tempo, risk };
}

function simulateMatch(){
  const today = isoDate(new Date());

  // voorkomen: meerdere matches op dezelfde kalenderdag
  if(state.league.lastMatchDate === today){
    pushHistory("Match", `Wedstrijd is vandaag (${formatISO(today)}) al gesimuleerd.`);
    return { ok:false, msg:"al gesimuleerd" };
  }

  const playersById = indexPlayers(state.team.players);
  const lineup = state.matchLineup;

  const missing = POS_MATCH.filter(pos => !lineup[pos]);
  if(missing.length){
    pushHistory("Match", `Wedstrijd niet gesimuleerd: matchselectie mist ${missing.join(", ")}.`);
    return { ok:false, msg:"lineup incompleet" };
  }

  // compute OWM rating
  const baseTeam = teamRatingFromLineup(lineup, playersById);

  const tmods = tacticsModifier(state.tactics);
  const owmRating = clamp(Math.round(baseTeam + tmods.off + tmods.def), 1, 99);

  // opponent
  const league = state.league;
  const opponent = league.teams[league.rotationIndex % league.teams.length];
  // skip self
  const opp = (opponent.id === "OWM") ? league.teams[(league.rotationIndex+1)%league.teams.length] : opponent;

  const oppRating = opp.rating;

  // Goals model (waterpolo-ish): 6-16, beïnvloed door rating gap + tempo/risk
  const gap = owmRating - oppRating;
  const tempo = (state.tactics.tempo==="high") ? 0.9 : (state.tactics.tempo==="low") ? -0.6 : 0.0;
  const risk = (state.tactics.risk==="aggressive") ? 0.6 : (state.tactics.risk==="safe") ? -0.4 : 0.0;

  const oBase = 10.2 + (gap * 0.10) + tempo + risk;
  const aBase = 10.0 - (gap * 0.10) + tempo + (risk*0.2);

  let gf = Math.round(clamp(rand(oBase-2.2, oBase+2.2), 5, 18));
  let ga = Math.round(clamp(rand(aBase-2.2, aBase+2.2), 5, 18));

  // kleine random swing
  gf = clamp(gf + Math.round(rand(-1,1)), 0, 25);
  ga = clamp(ga + Math.round(rand(-1,1)), 0, 25);

  const resultText = `OWM ${gf} - ${ga} ${opp.name} (Team ${owmRating} vs ${oppRating})`;

  // standings update
  updateStandingsAfterMatch("OWM", opp.id, gf, ga);

  // fitness/form impact op matchlineup
  applyMatchImpact(playersById, lineup);

  // record
  state.league.lastMatchDate = today;
  state.league.lastResult = { date: today, opponentId: opp.id, opponentName: opp.name, gf, ga, owmRating, oppRating };
  state.league.rotationIndex = (league.rotationIndex + 1) % league.teams.length;

  pushHistory("Match", resultText);
  saveState();
  renderAll();
  return { ok:true, resultText };
}

function applyMatchImpact(playersById, lineup){
  const ids = Object.values(lineup).filter(Boolean);
  for(const id of ids){
    const p = playersById[id];
    if(!p) continue;

    // blessure tick-down / new risk
    if(p.injury){
      p.injury.daysLeft -= 1;
      if(p.injury.daysLeft <= 0) p.injury = null;
      continue;
    }

    // fatigue
    p.fitness = clamp(p.fitness - rand(2.0, 4.0), 30, 100);
    // form swing
    p.form = clamp(p.form + rand(-1.1, 1.8), 0, 100);

    // small injury chance on match
    const risk = clamp(0.010 + (p.fitness < 60 ? (60-p.fitness)*0.0008 : 0), 0, 0.08);
    if(Math.random() < risk){
      const types = ["Schouder","Lies","Rug","Pols","Enkel"];
      const severity = pick([1,2,2,3]);
      const daysLeft = severity===1 ? 3 : severity===2 ? 6 : 10;
      p.injury = { type: pick(types), severity, daysLeft };
      p.fitness = clamp(p.fitness - rand(2,6), 30, 100);
      p.form = clamp(p.form - rand(2,6), 0, 100);
    }
  }

  // spelers die geblesseerd zijn maar niet in lineup, tik ook 1 dag
  for(const p of Object.values(playersById)){
    if(p.injury){
      p.injury.daysLeft -= 1;
      if(p.injury.daysLeft <= 0) p.injury = null;
    }
  }
}

function updateStandingsAfterMatch(homeId, awayId, gf, ga){
  const st = state.league.standings;
  const h = st[homeId], a = st[awayId];
  if(!h || !a) return;

  h.P += 1; a.P += 1;
  h.GF += gf; h.GA += ga;
  a.GF += ga; a.GA += gf;

  if(gf > ga){
    h.W += 1; a.L += 1;
    h.Pts += WPTS;
  } else if(gf < ga){
    a.W += 1; h.L += 1;
    a.Pts += WPTS;
  } else {
    h.D += 1; a.D += 1;
    h.Pts += DPTS; a.Pts += DPTS;
  }
}

/* ---------------- Daily match scheduler ---------------- */

function parseMatchTimeHHMM(str){
  const m = String(str||"").trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if(h<0 || h>23 || mm<0 || mm>59) return null;
  return { h, m: mm };
}

function nextMatchDateTime(){
  // volgende match moment op basis van HH:MM (local)
  const mt = parseMatchTimeHHMM(state.matchTimeHHMM);
  const now = new Date();
  if(!mt){
    return null;
  }
  const d = new Date(now);
  d.setHours(mt.h, mt.m, 0, 0);
  if(d.getTime() <= now.getTime()){
    // vandaag al voorbij -> morgen
    d.setDate(d.getDate()+1);
  }
  return d;
}

function shouldAutoSimMatch(){
  const mt = parseMatchTimeHHMM(state.matchTimeHHMM);
  if(!mt) return false;

  const now = new Date();
  const today = isoDate(now);

  if(state.league.lastMatchDate === today) return false;

  // is het huidige tijdstip voorbij matchtijd?
  const matchMoment = new Date(now);
  matchMoment.setHours(mt.h, mt.m, 0, 0);
  return now.getTime() >= matchMoment.getTime();
}

function tickScheduler(){
  // update klok UI, en simuleer als nodig
  ui.kpiNow.textContent = `${formatISO(isoDate())} ${hhmm()}`;

  const nm = nextMatchDateTime();
  ui.kpiNextMatch.textContent = nm ? `${formatISO(isoDate(nm))} ${pad2(nm.getHours())}:${pad2(nm.getMinutes())}` : "—";

  if(shouldAutoSimMatch()){
    simulateMatch();
  }
}

/* ---------------- State ---------------- */

function createInitialState(){
  const players = [
    defaultPlayer("Keeper 1","GK"),
    defaultPlayer("Center Back 1","CB"),
    defaultPlayer("Center Forward 1","CF"),
    defaultPlayer("Left Defender 1","LD"),
    defaultPlayer("Left Wing 1","LW"),
    defaultPlayer("Right Wing 1","RW"),
    defaultPlayer("Right Defender 1","RD"),
    defaultPlayer("Utility 1","U"),
    defaultPlayer("Utility 2","U")
  ];

  const matchLineup = {
    GK: players.find(p=>p.pos==="GK")?.id || null,
    CB: players.find(p=>p.pos==="CB")?.id || null,
    CF: players.find(p=>p.pos==="CF")?.id || null,
    LD: players.find(p=>p.pos==="LD")?.id || null,
    LW: players.find(p=>p.pos==="LW")?.id || null,
    RW: players.find(p=>p.pos==="RW")?.id || null,
    RD: players.find(p=>p.pos==="RD")?.id || null
  };

  const trainingSelection = { ...matchLineup };

  return {
    version: "3B-2",
    team: { name:"OWM", players },
    tactics: { defense:"zone", offense:"balanced", tempo:"mid", risk:"normal" },

    matchTimeHHMM: "20:00",
    trainingType: "conditioning",
    trainingSelection,
    matchLineup,

    // training cap: 1 per dag
    lastTrainingDate: null,

    league: createLeague(),
    history: []
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return createInitialState();
    const s = JSON.parse(raw);

    // backfill
    if(!s.team?.players) return createInitialState();
    if(!s.tactics) s.tactics = { defense:"zone", offense:"balanced", tempo:"mid", risk:"normal" };
    if(!s.matchTimeHHMM) s.matchTimeHHMM = "20:00";
    if(!s.trainingType) s.trainingType = "conditioning";
    if(!s.trainingSelection) s.trainingSelection = { GK:null, CB:null, CF:null, LD:null, LW:null, RW:null, RD:null };
    if(!s.matchLineup) s.matchLineup = { GK:null, CB:null, CF:null, LD:null, LW:null, RW:null, RD:null };
    if(!s.league) s.league = createLeague();
    if(!s.history) s.history = [];
    if(!("lastTrainingDate" in s)) s.lastTrainingDate = null;

    // ensure players have potential + stats
    for(const p of s.team.players){
      if(typeof p.potential !== "number") p.potential = clamp(Math.round(rand(55,92)), 0, 100);
      if(!p.stats) p.stats = baseStatsForPos(p.pos||"U");
      if(typeof p.fitness !== "number") p.fitness = clamp(Math.round(rand(75,95)), 30, 100);
      if(typeof p.form !== "number") p.form = clamp(Math.round(rand(45,70)), 0, 100);
    }

    return s;
  }catch{
    return createInitialState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function indexPlayers(players){
  const map = {};
  for(const p of players) map[p.id] = p;
  return map;
}

function pushHistory(kind, text){
  state.history.unshift({
    t: new Date().toISOString(),
    kind,
    text
  });
  state.history = state.history.slice(0,30);
}

/* ---------------- UI ---------------- */

const ui = {
  tabs: Array.from(document.querySelectorAll(".tab")),
  panels: {
    dashboard: document.getElementById("tab-dashboard"),
    match: document.getElementById("tab-match"),
    squad: document.getElementById("tab-squad"),
    training: document.getElementById("tab-training"),
    standings: document.getElementById("tab-standings"),
    history: document.getElementById("tab-history")
  },

  pillDay: document.getElementById("pillDay"),
  kpiNow: document.getElementById("kpiNow"),
  kpiMatchTime: document.getElementById("kpiMatchTime"),
  kpiNextMatch: document.getElementById("kpiNextMatch"),
  matchNote: document.getElementById("matchNote"),
  trainingNote: document.getElementById("trainingNote"),
  btnSimulateMatchNow: document.getElementById("btnSimulateMatchNow"),
  btnSimulateDayNow: document.getElementById("btnSimulateDayNow"),
  lastResult: document.getElementById("lastResult"),

  navTrainingMeta: document.getElementById("navTrainingMeta"),
  navMatchMeta: document.getElementById("navMatchMeta"),
  navSquadMeta: document.getElementById("navSquadMeta"),

  pillNextOpponent: document.getElementById("pillNextOpponent"),
  nextMatchSummary: document.getElementById("nextMatchSummary"),
  nextMatchTime: document.getElementById("nextMatchTime"),
  nextMatchStatus: document.getElementById("nextMatchStatus"),

  // dashboard lineup
  selMatch: {
    GK: document.getElementById("selMatchGK"),
    CB: document.getElementById("selMatchCB"),
    CF: document.getElementById("selMatchCF"),
    LD: document.getElementById("selMatchLD"),
    LW: document.getElementById("selMatchLW"),
    RW: document.getElementById("selMatchRW"),
    RD: document.getElementById("selMatchRD")
  },

  tacDefense: document.getElementById("tacDefense"),
  tacOffense: document.getElementById("tacOffense"),
  tacTempo: document.getElementById("tacTempo"),
  tacRisk: document.getElementById("tacRisk"),

  teamMeta: document.getElementById("teamMeta"),
  kpiFitness: document.getElementById("kpiFitness"),
  kpiInj: document.getElementById("kpiInj"),
  kpiRating: document.getElementById("kpiRating"),
  kpiStanding: document.getElementById("kpiStanding"),

  tableTop8: document.getElementById("tableTop8").querySelector("tbody"),

  // squad
  playersTable: document.getElementById("playersTable").querySelector("tbody"),
  newName: document.getElementById("newName"),
  newPos: document.getElementById("newPos"),
  newPotential: document.getElementById("newPotential"),
  btnAddPlayer: document.getElementById("btnAddPlayer"),

  // training
  pillTrainingStatus: document.getElementById("pillTrainingStatus"),
  trainingType: document.getElementById("trainingType"),
  selTrain: {
    GK: document.getElementById("selTrainGK"),
    CB: document.getElementById("selTrainCB"),
    CF: document.getElementById("selTrainCF"),
    LD: document.getElementById("selTrainLD"),
    LW: document.getElementById("selTrainLW"),
    RW: document.getElementById("selTrainRW"),
    RD: document.getElementById("selTrainRD")
  },
  btnPreviewTraining: document.getElementById("btnPreviewTraining"),
  btnDoTraining: document.getElementById("btnDoTraining"),
  trainingPreview: document.getElementById("trainingPreview"),

  matchTime: document.getElementById("matchTime"),
  btnSaveMatchTime: document.getElementById("btnSaveMatchTime"),
  leagueInfo: document.getElementById("leagueInfo"),

  // standings
  tableStandings: document.getElementById("tableStandings").querySelector("tbody"),

  // history
  history: document.getElementById("history"),

  // export/import/reset
  btnExport: document.getElementById("btnExport"),
  btnImport: document.getElementById("btnImport"),
  btnReset: document.getElementById("btnReset"),

  importModal: document.getElementById("importModal"),
  importText: document.getElementById("importText"),
  btnCloseImport: document.getElementById("btnCloseImport"),
  btnDoImport: document.getElementById("btnDoImport"),
  btnClearImport: document.getElementById("btnClearImport"),
  importNote: document.getElementById("importNote")
};

let state = loadState();

/* ---------------- Render helpers ---------------- */

function badgeFitness(p){
  const f = p.fitness;
  const cls = f >= 80 ? "ok" : f >= 65 ? "warn" : "bad";
  return `<span class="badge"><span class="dot ${cls}"></span>${round1(f)}</span>`;
}

function badgeInjury(p){
  if(!p.injury) return `<span class="badge"><span class="dot ok"></span>Fit</span>`;
  const cls = p.injury.severity === 1 ? "warn" : "bad";
  return `<span class="badge"><span class="dot ${cls}"></span>${escapeHtml(p.injury.type)} (${p.injury.daysLeft}d)</span>`;
}

function fillPlayerSelect(selectEl, players, selectedId, posHint){
  // OSM-stijl: toon alle spelers, maar zet matching positie bovenaan
  const sorted = [...players].sort((a,b)=>{
    const aMatch = (a.pos===posHint) ? 0 : 1;
    const bMatch = (b.pos===posHint) ? 0 : 1;
    if(aMatch!==bMatch) return aMatch-bMatch;
    return a.name.localeCompare(b.name);
  });

  const opts = [`<option value="">— kies —</option>`]
    .concat(sorted.map(p=>{
      const tag = `${p.pos} | Pot ${p.potential} | Fit ${round1(p.fitness)} | R ${playerRating(p)}`;
      const sel = (p.id===selectedId) ? "selected" : "";
      return `<option value="${p.id}" ${sel}>${escapeHtml(p.name)} (${tag})</option>`;
    }));

  selectEl.innerHTML = opts.join("");
}

function renderTabs(active){
  ui.tabs.forEach(t=>{
    const isActive = t.dataset.tab === active;
    t.classList.toggle("active", isActive);
  });
  Object.entries(ui.panels).forEach(([k,el])=>{
    el.classList.toggle("hidden", k!==active);
  });
}

/* ---------------- Render main ---------------- */

function renderDashboard(){
  ui.pillDay.textContent = `Vandaag: ${formatISO(isoDate())}`;
  ui.kpiMatchTime.textContent = state.matchTimeHHMM || "—";

  const players = state.team.players;
  const playersById = indexPlayers(players);

  // Fill match selects
  for(const pos of POS_MATCH){
    fillPlayerSelect(ui.selMatch[pos], players, state.matchLineup[pos], pos);
  }

  // tactics
  ui.tacDefense.value = state.tactics.defense;
  ui.tacOffense.value = state.tactics.offense;
  ui.tacTempo.value = state.tactics.tempo;
  ui.tacRisk.value = state.tactics.risk;

  // KPI
  ui.teamMeta.textContent = `${state.team.name} — ${players.length} spelers`;
  ui.kpiFitness.textContent = round1(averageFitness(players));
  ui.kpiInj.textContent = players.filter(p=>p.injury).length;

  // lineup rating
  const tr = teamRatingFromLineup(state.matchLineup, playersById);
  ui.kpiRating.textContent = tr;

  // standings snippet
  const sorted = sortStandings(state.league.standings);
  const idx = sorted.findIndex(r=>r.teamId==="OWM");
  const row = sorted[idx];
  ui.kpiStanding.textContent = row
    ? `#${idx+1} — ${row.teamName}: ${row.Pts} pts (P ${row.P}, GD ${row.GF-row.GA})`
    : "—";

  // top8 table
  ui.tableTop8.innerHTML = sorted.slice(0,8).map((r,i)=>{
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${escapeHtml(r.teamName)}</strong></td>
      <td>${r.P}</td>
      <td>${r.W}</td>
      <td>${r.D}</td>
      <td>${r.L}</td>
      <td>${r.GF}</td>
      <td>${r.GA}</td>
      <td>${r.GF-r.GA}</td>
      <td><strong>${r.Pts}</strong></td>
    </tr>`;
  }).join("");

  // Notes
  const today = isoDate();
  const already = (state.league.lastMatchDate === today);
  ui.matchNote.innerHTML = already
    ? `Wedstrijd vandaag is al gesimuleerd.<br/><strong>Laatste match-datum:</strong> ${formatISO(state.league.lastMatchDate)}`
    : `Wedstrijd wacht op simulatie.<br/>Zodra de tijd <strong>${state.matchTimeHHMM}</strong> is gepasseerd, simuleert hij automatisch.`;

  const trained = (state.lastTrainingDate === today);
  ui.trainingNote.innerHTML = trained
    ? `Training vandaag al gedaan.<br/><strong>Datum:</strong> ${formatISO(state.lastTrainingDate)}`
    : `Je kunt vandaag nog 1 training (4u) doen.`;

  // last result
  if(state.league.lastResult){
    const lr = state.league.lastResult;
    ui.lastResult.innerHTML = `${formatISO(lr.date)} — <strong>OWM ${lr.gf} - ${lr.ga} ${escapeHtml(lr.opponentName)}</strong><br/>
      <span class="muted">Rating: OWM ${lr.owmRating} vs Opp ${lr.oppRating}</span>`;
  } else {
    ui.lastResult.textContent = "Nog geen wedstrijden gespeeld.";
  }

  const nextOpp = nextOpponent();
  const trained = (state.lastTrainingDate === today);
  const missingLineup = POS_MATCH.filter(pos => !state.matchLineup[pos]);
  ui.navTrainingMeta.textContent = trained ? "Vandaag getraind" : "Training beschikbaar";
  ui.navMatchMeta.textContent = nextOpp ? `${nextOpp.name} • ${state.matchTimeHHMM || "tijd?"}` : "Geen wedstrijd gepland";
  ui.navSquadMeta.textContent = `${players.length} spelers in team`;
}

function renderMatch(){
  const nextOpp = nextOpponent();
  const nm = nextMatchDateTime();
  const today = isoDate();
  const already = (state.league.lastMatchDate === today);

  ui.pillNextOpponent.textContent = nextOpp ? `vs ${nextOpp.name}` : "—";
  ui.nextMatchSummary.textContent = nextOpp
    ? `Eerstvolgende tegenstander: ${nextOpp.name}.`
    : "Geen tegenstander gevonden.";
  ui.nextMatchTime.textContent = nm ? `${formatISO(isoDate(nm))} ${pad2(nm.getHours())}:${pad2(nm.getMinutes())}` : "Niet ingesteld";
  ui.nextMatchStatus.textContent = already ? "Vandaag al gespeeld" : "In afwachting";
}

function renderSquad(){
  const players = state.team.players;

  ui.playersTable.innerHTML = players.map(p=>{
    return `<tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.pos||"")}</td>
      <td>${p.potential}</td>
      <td>${badgeFitness(p)}</td>
      <td>${badgeInjury(p)}</td>
      <td>${playerRating(p)}</td>
      <td>
        <div class="actions">
          <button class="btn btn-ghost small" data-act="heal" data-id="${p.id}">Herstel</button>
          <button class="btn btn-ghost small" data-act="injure" data-id="${p.id}">Blessure</button>
          <button class="btn btn-danger small" data-act="remove" data-id="${p.id}">Verwijder</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  ui.playersTable.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const p = state.team.players.find(x=>x.id===id);
      if(!p) return;

      if(act==="remove"){
        state.team.players = state.team.players.filter(x=>x.id!==id);
        // cleanup lineup selections
        for(const pos of POS_MATCH){
          if(state.matchLineup[pos]===id) state.matchLineup[pos]=null;
          if(state.trainingSelection[pos]===id) state.trainingSelection[pos]=null;
        }
      }
      if(act==="heal"){
        p.injury = null;
        p.fitness = clamp(p.fitness + 6, 30, 100);
        p.form = clamp(p.form + 3, 0, 100);
      }
      if(act==="injure"){
        const types = ["Schouder","Lies","Rug","Pols","Enkel"];
        const severity = pick([1,2,2,3]);
        const daysLeft = severity===1 ? 3 : severity===2 ? 6 : 10;
        p.injury = { type: pick(types), severity, daysLeft };
        p.fitness = clamp(p.fitness - 4, 30, 100);
        p.form = clamp(p.form - 4, 0, 100);
      }

      saveState();
      renderAll();
    });
  });
}

function renderTraining(){
  const today = isoDate();
  const trained = (state.lastTrainingDate === today);
  ui.pillTrainingStatus.textContent = trained ? "Training: gedaan" : "Training: beschikbaar";

  ui.trainingType.value = state.trainingType;
  ui.matchTime.value = state.matchTimeHHMM || "";
  ui.leagueInfo.textContent = `${state.league.teams.length} teams — dagelijks 1 match`;

  const players = state.team.players;

  for(const pos of POS_MATCH){
    fillPlayerSelect(ui.selTrain[pos], players, state.trainingSelection[pos], pos);
  }

  ui.btnDoTraining.disabled = trained;
  ui.btnPreviewTraining.disabled = false;

  if(trained){
    ui.trainingPreview.innerHTML = `Training is vandaag al gedaan.<br/><span class="muted">Wacht tot morgen om opnieuw 4u te trainen.</span>`;
  }
}

function renderStandings(){
  const sorted = sortStandings(state.league.standings);
  ui.tableStandings.innerHTML = sorted.map((r,i)=>{
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${escapeHtml(r.teamName)}</strong></td>
      <td>${r.P}</td>
      <td>${r.W}</td>
      <td>${r.D}</td>
      <td>${r.L}</td>
      <td>${r.GF}</td>
      <td>${r.GA}</td>
      <td>${r.GF-r.GA}</td>
      <td><strong>${r.Pts}</strong></td>
    </tr>`;
  }).join("");
}

function renderHistory(){
  if(!state.history.length){
    ui.history.innerHTML = `<div class="note">Nog geen events. Wacht op matchtijd of start een training.</div>`;
    return;
  }
  ui.history.innerHTML = state.history.map(h=>{
    const dt = new Date(h.t);
    const stamp = `${formatISO(isoDate(dt))} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
    return `<div class="hitem">
      <div class="hmeta">
        <div class="left">${escapeHtml(h.kind)} — ${stamp}</div>
        <div class="right">${escapeHtml(state.team.name)}</div>
      </div>
      <div class="htext">${escapeHtml(h.text)}</div>
    </div>`;
  }).join("");
}

function renderAll(){
  // update OWM rating in league teams[0]
  const playersById = indexPlayers(state.team.players);
  const owmLineupRating = teamRatingFromLineup(state.matchLineup, playersById);
  const owmTeam = state.league.teams.find(t=>t.id==="OWM");
  if(owmTeam) owmTeam.rating = owmLineupRating;

  renderDashboard();
  renderMatch();
  renderSquad();
  renderTraining();
  renderStandings();
  renderHistory();
}

/* ---------------- Events ---------------- */

ui.tabs.forEach(btn=>{
  btn.addEventListener("click", ()=>{
    renderTabs(btn.dataset.tab);
  });
});

document.querySelectorAll(".nav-card").forEach(card=>{
  card.addEventListener("click", ()=>{
    const tab = card.dataset.tab;
    if(tab){
      renderTabs(tab);
    }
  });
});

function bindSelectGroup(selectMap, getStateMap, setStateMap){
  for(const pos of POS_MATCH){
    selectMap[pos].addEventListener("change", ()=>{
      setStateMap(pos, selectMap[pos].value || null);
      saveState();
      renderAll();
    });
  }
}

bindSelectGroup(
  ui.selMatch,
  ()=>state.matchLineup,
  (pos,val)=>{ state.matchLineup[pos]=val; }
);

bindSelectGroup(
  ui.selTrain,
  ()=>state.trainingSelection,
  (pos,val)=>{ state.trainingSelection[pos]=val; }
);

ui.tacDefense.addEventListener("change", ()=>{ state.tactics.defense = ui.tacDefense.value; saveState(); renderAll(); });
ui.tacOffense.addEventListener("change", ()=>{ state.tactics.offense = ui.tacOffense.value; saveState(); renderAll(); });
ui.tacTempo.addEventListener("change", ()=>{ state.tactics.tempo = ui.tacTempo.value; saveState(); renderAll(); });
ui.tacRisk.addEventListener("change", ()=>{ state.tactics.risk = ui.tacRisk.value; saveState(); renderAll(); });

ui.trainingType.addEventListener("change", ()=>{
  state.trainingType = ui.trainingType.value;
  saveState();
});

ui.btnPreviewTraining.addEventListener("click", ()=>{
  const playersById = indexPlayers(state.team.players);
  const missing = POS_MATCH.filter(pos => !state.trainingSelection[pos]);
  if(missing.length){
    ui.trainingPreview.innerHTML = `Selecteer eerst voor: <strong>${missing.join(", ")}</strong>.`;
    return;
  }

  const type = state.trainingType;
  const lines = [];
  lines.push(`<strong>Preview — Training 4u (${escapeHtml(focusLabel(type))})</strong>`);
  lines.push(`<span class="muted">Growth = functie(potential). Dit is een preview; echte gain is vrijwel gelijk (kleine random).</span>`);
  lines.push(`<div class="hr"></div>`);

  for(const pos of POS_MATCH){
    const p = playersById[state.trainingSelection[pos]];
    if(!p) continue;

    const d = trainingDeltaPreview(p, type);
    const main = Object.entries(d).filter(([k])=>k!=="all").slice(0,3).map(([k,v])=>`${k}+${v}`).join(", ");
    lines.push(`• <strong>${escapeHtml(pos)}:</strong> ${escapeHtml(p.name)} (Pot ${p.potential}) — verwacht: <strong>${escapeHtml(main || ("all+"+d.all))}</strong>`);
  }

  ui.trainingPreview.innerHTML = lines.join("<br/>");
});

ui.btnDoTraining.addEventListener("click", ()=>{
  const today = isoDate();
  if(state.lastTrainingDate === today){
    ui.trainingPreview.innerHTML = `Training is vandaag al gedaan.`;
    return;
  }

  const playersById = indexPlayers(state.team.players);
  const missing = POS_MATCH.filter(pos => !state.trainingSelection[pos]);
  if(missing.length){
    ui.trainingPreview.innerHTML = `Selecteer eerst voor: <strong>${missing.join(", ")}</strong>.`;
    return;
  }

  const type = state.trainingType;
  const logs = [];
  logs.push(`Training gestart (4u) — ${focusLabel(type)}.`);

  for(const pos of POS_MATCH){
    const p = playersById[state.trainingSelection[pos]];
    if(!p) continue;

    const delta = trainingDeltaPreview(p, type);
    // kleine random jitter zodat het niet exact “copy preview” is
    for(const k of Object.keys(delta)){
      if(k==="all") continue;
      delta[k] = round1(delta[k] * rand(0.92, 1.08));
    }
    if(delta.all) delta.all = round1(delta.all * rand(0.92, 1.08));

    const l = applyTrainingToPlayer(p, delta, type);
    logs.push(...l);
  }

  state.lastTrainingDate = today;
  pushHistory("Training", logs.join(" "));
  saveState();
  renderAll();
  ui.trainingPreview.innerHTML = `<strong>Training uitgevoerd.</strong><br/><span class="muted">Bekijk je history of spelerslijst voor effect.</span>`;
});

ui.btnSimulateMatchNow.addEventListener("click", ()=>{
  const r = simulateMatch();
  if(!r.ok){
    ui.matchNote.innerHTML = `Kon match niet simuleren: <strong>${escapeHtml(r.msg)}</strong>`;
  }
});

ui.btnSimulateDayNow.addEventListener("click", ()=>{
  // test: force “auto” triggers
  tickScheduler();
  pushHistory("System", "Dag check uitgevoerd (test).");
  saveState();
  renderAll();
});

ui.btnSaveMatchTime.addEventListener("click", ()=>{
  const v = ui.matchTime.value.trim();
  const mt = parseMatchTimeHHMM(v);
  if(!mt){
    ui.trainingPreview.innerHTML = `Ongeldige tijd. Gebruik HH:MM (bijv. 20:00).`;
    return;
  }
  state.matchTimeHHMM = `${pad2(mt.h)}:${pad2(mt.m)}`;
  pushHistory("System", `Match tijd aangepast naar ${state.matchTimeHHMM}.`);
  saveState();
  renderAll();
});

/* Add player */
ui.btnAddPlayer.addEventListener("click", ()=>{
  const name = (ui.newName.value || "").trim();
  if(!name){ ui.newName.focus(); return; }

  const pos = ui.newPos.value;
  const potential = clamp(Number(ui.newPotential.value || 70), 0, 100);

  const p = defaultPlayer(name, pos);
  p.potential = potential;

  state.team.players.push(p);
  ui.newName.value = "";
  saveState();
  renderAll();
});

/* Export / Import / Reset */
ui.btnExport.addEventListener("click", async ()=>{
  const data = JSON.stringify(state, null, 2);
  try{
    await navigator.clipboard.writeText(data);
    pushHistory("System", "Export gekopieerd naar klembord.");
    saveState();
    renderAll();
  }catch{
    window.prompt("Kopieer je save JSON:", data);
  }
});

ui.btnImport.addEventListener("click", ()=>{
  ui.importModal.classList.remove("hidden");
  ui.importModal.setAttribute("aria-hidden","false");
  ui.importNote.textContent = "Plak volledige save of spelerslijst (JSON).";
});

ui.btnCloseImport.addEventListener("click", closeImport);
ui.btnClearImport.addEventListener("click", ()=> ui.importText.value = "");

ui.btnDoImport.addEventListener("click", ()=>{
  const raw = ui.importText.value.trim();
  if(!raw){ ui.importNote.textContent = "Plak eerst JSON."; return; }

  try{
    const parsed = JSON.parse(raw);

    // Case A: volledige save
    if(parsed && parsed.team && Array.isArray(parsed.team.players)){
      state = parsed;
      // backfill
      if(!state.league) state.league = createLeague();
      if(!state.history) state.history = [];
      if(!state.tactics) state.tactics = { defense:"zone", offense:"balanced", tempo:"mid", risk:"normal" };
      if(!state.matchTimeHHMM) state.matchTimeHHMM = "20:00";
      if(!state.trainingSelection) state.trainingSelection = { GK:null, CB:null, CF:null, LD:null, LW:null, RW:null, RD:null };
      if(!state.matchLineup) state.matchLineup = { GK:null, CB:null, CF:null, LD:null, LW:null, RW:null, RD:null };
      if(!("lastTrainingDate" in state)) state.lastTrainingDate = null;

      // ensure players minimal schema
      for(const p of state.team.players){
        if(!p.id) p.id = ensureUUID();
        if(typeof p.potential !== "number") p.potential = clamp(Math.round(rand(55,92)), 0, 100);
        if(!p.stats) p.stats = baseStatsForPos(p.pos||"U");
        if(typeof p.fitness !== "number") p.fitness = clamp(Math.round(rand(75,95)), 30, 100);
        if(typeof p.form !== "number") p.form = clamp(Math.round(rand(45,70)), 0, 100);
      }

      saveState();
      closeImport();
      renderAll();
      pushHistory("System", "Import (save) gelukt.");
      saveState();
      renderAll();
      return;
    }

    // Case B: spelerslijst
    if(Array.isArray(parsed)){
      const importedPlayers = parsed.map(x => normalizeImportedPlayer(x)).filter(Boolean);
      if(!importedPlayers.length){
        ui.importNote.textContent = "Geen geldige spelers gevonden in lijst.";
        return;
      }
      state.team.players = importedPlayers;

      // reset selections (probeer auto-match pos)
      for(const pos of POS_MATCH){
        const best = state.team.players.find(p=>p.pos===pos) || state.team.players[0] || null;
        state.matchLineup[pos] = best ? best.id : null;
        state.trainingSelection[pos] = best ? best.id : null;
      }

      pushHistory("System", `Spelerslijst geïmporteerd (${importedPlayers.length} spelers).`);
      saveState();
      closeImport();
      renderAll();
      return;
    }

    ui.importNote.textContent = "Onbekend JSON-format. Gebruik save-object of spelers-array.";
  }catch{
    ui.importNote.textContent = "Kon JSON niet lezen. Controleer syntax.";
  }
});

ui.btnReset.addEventListener("click", ()=>{
  const ok = window.confirm("Weet je zeker dat je alles wilt resetten?");
  if(!ok) return;
  state = createInitialState();
  saveState();
  renderAll();
});

/* Import normalize (belangrijk voor jouw spelersbestand) */
function normalizeImportedPlayer(x){
  if(!x || typeof x !== "object") return null;

  // accepteer meerdere veldnamen:
  const name = x.name ?? x.naam ?? x.playerName ?? "Speler";
  const pos = (x.pos ?? x.position ?? x.positie ?? "U");
  const potential = Number(x.potential ?? x.pot ?? x.potentie ?? x.POT ?? 70);

  // stats: accepteer x.stats of losse velden
  let stats = x.stats;
  if(!stats){
    stats = {
      shooting: Number(x.shooting ?? x.shot ?? x.schieten ?? rand(50,75)),
      passing: Number(x.passing ?? x.pass ?? x.passen ?? rand(50,75)),
      defense: Number(x.defense ?? x.def ?? x.verdedigen ?? rand(50,75)),
      speed: Number(x.speed ?? x.snelheid ?? rand(50,75)),
      stamina: Number(x.stamina ?? x.conditie ?? rand(50,75)),
      goalie: Number(x.goalie ?? x.keep ?? x.keeper ?? rand(10,35)),
      iq: Number(x.iq ?? x.gameiq ?? x.tactics ?? rand(50,75))
    };
  }

  const p = {
    id: String(x.id ?? ensureUUID()),
    name: String(name),
    pos: String(pos),
    potential: clamp(Number.isFinite(potential) ? potential : 70, 0, 100),
    fitness: clamp(Number.isFinite(Number(x.fitness)) ? Number(x.fitness) : clamp(Math.round(rand(75,95)), 30, 100), 30, 100),
    injury: x.injury ?? null,
    form: clamp(Number.isFinite(Number(x.form)) ? Number(x.form) : clamp(Math.round(rand(45,70)), 0, 100), 0, 100),
    stats: {
      shooting: clamp(Number(stats.shooting)||0, 0, 100),
      passing: clamp(Number(stats.passing)||0, 0, 100),
      defense: clamp(Number(stats.defense)||0, 0, 100),
      speed: clamp(Number(stats.speed)||0, 0, 100),
      stamina: clamp(Number(stats.stamina)||0, 0, 100),
      goalie: clamp(Number(stats.goalie)||0, 0, 100),
      iq: clamp(Number(stats.iq)||0, 0, 100)
    }
  };

  return p;
}

function closeImport(){
  ui.importModal.classList.add("hidden");
  ui.importModal.setAttribute("aria-hidden","true");
}

/* ---------------- Boot ---------------- */

(function init(){
  // default tab
  renderTabs("dashboard");
  renderAll();

  // scheduler tick elke 10 seconden
  tickScheduler();
  setInterval(tickScheduler, 10_000);

  pushHistory("System", `App gestart. Dagelijkse matchtijd: ${state.matchTimeHHMM}.`);
  saveState();
})();
