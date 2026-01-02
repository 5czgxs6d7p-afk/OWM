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
  importT
