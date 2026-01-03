/* OWM — Dashboard-first v3b3
   - Dashboard met tegels -> views
   - Match: elke dag om 19:00 (local NL), auto-sim max 1x per kalenderdag
   - Training: 4 uur countdown, selectie locked tijdens training, apply gains bij einde
   - Import: save-object of spelers-array
*/

const STORAGE_KEY = "owm_mvp_save_v3b3";

// vaste matchtijd: 19:00
const MATCH_TIME = { h: 19, m: 0 };

const POS7 = ["GK","CB","CF","LD","LW","RW","RD"];
const WPTS = 3, DPTS = 1, LPTS = 0;

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function round1(n){ return Math.round(n * 10) / 10; }
function rand(min, max){ return Math.random() * (max - min) + min; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

function pad2(n){ return String(n).padStart(2,"0"); }
function isoDate(d=new Date()){ return d.toISOString().slice(0,10); }
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
function ensureId(){
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return String(Date.now()) + "-" + Math.round(Math.random()*1e9);
}

function indexPlayers(players){
  const map = {};
  for(const p of players) map[p.id] = p;
  return map;
}

/* ---------------- League / Standings ---------------- */

function createLeague(){
  const teams = [
    { id:"OWM", name:"OWM", rating: 0 },
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

/* ---------------- Player model ---------------- */

function baseStatsForPos(pos){
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
  return {
    id: ensureId(),
    name: name || "Speler",
    pos: pos || "U",
    potential: clamp(Math.round(rand(55, 92)), 0, 100),
    fitness: clamp(Math.round(rand(75, 95)), 30, 100),
    form: clamp(Math.round(rand(45, 70)), 0, 100),
    injury: null,
    meta: {},
    stats: baseStatsForPos(pos || "U")
  };
}

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

function potentialFactor(p){
  // 0..100 => ~0.65..1.35
  return 0.65 + (p.potential / 100) * 0.70;
}

function trainingDeltaPreview(p, type){
  const pf = potentialFactor(p);
  const base = rand(0.18, 0.32) * pf;
  const focus = rand(0.35, 0.70) * pf;

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

  if(p.pos==="GK"){
    d.goalie = (d.goalie ?? 0) + (type==="goalie" ? focus*0.35 : base*0.7);
    d.shooting = (d.shooting ?? 0) - base*0.25;
  }

  for(const k of Object.keys(d)){
    d[k] = round1(d[k]);
  }
  return d;
}

function applyTraining(p, delta, type){
  const logs = [];
  if(p.injury){
    logs.push(`${p.name} kan niet trainen (geblesseerd).`);
    return logs;
  }

  // kleine blessurekans door training
  let risk = 0.008;
  if(p.fitness < 65) risk += (65 - p.fitness) * 0.0007;
  risk = clamp(risk, 0, 0.10);

  if(Math.random() < risk){
    const types = ["Schouder","Lies","Rug","Pols","Enkel"];
    const severity = pick([1,1,2,2,3]);
    const daysLeft = severity===1 ? Math.round(rand(2,4))
                  : severity===2 ? Math.round(rand(4,8))
                  : Math.round(rand(7,14));
    p.injury = { type: pick(types), severity, daysLeft };
    p.fitness = clamp(p.fitness - rand(2,6), 30, 100);
    p.form = clamp(p.form - rand(2,6), 0, 100);
    logs.push(`${p.name} raakt geblesseerd tijdens training (${p.injury.type}).`);
    return logs;
  }

  // fatigue + form
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

  logs.push(`${p.name} traint 4u (${focusLabel(type)}), potential ${p.potential}.`);
  return logs;
}

/* ---------------- Match engine ---------------- */

function tacticsModifier(t){
  let off = 0, def = 0, tempo = 0, risk = 0;

  if(t.defense==="press"){ def += 1.2; risk += 0.8; }
  if(t.defense==="mzone"){ def += 0.6; off += 0.3; }
  if(t.offense==="center"){ off += 1.0; }
  if(t.offense==="perimeter"){ off += 0.8; }
  if(t.offense==="counter"){ tempo += 1.1; risk += 0.6; }

  if(t.tempo==="low"){ def += 0.7; off -= 0.2; }
  if(t.tempo==="high"){ off += 0.7; def -= 0.2; risk += 0.5; }

  if(t.risk==="safe"){ def += 0.4; off -= 0.2; }
  if(t.risk==="aggressive"){ off += 0.6; def -= 0.2; risk += 0.6; }

  return { off, def, tempo, risk };
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

function applyMatchImpact(playersById, lineup){
  const ids = Object.values(lineup).filter(Boolean);

  for(const id of ids){
    const p = playersById[id];
    if(!p) continue;

    if(p.injury){
      p.injury.daysLeft -= 1;
      if(p.injury.daysLeft <= 0) p.injury = null;
      continue;
    }

    p.fitness = clamp(p.fitness - rand(2.0, 4.0), 30, 100);
    p.form = clamp(p.form + rand(-1.1, 1.8), 0, 100);

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

  for(const p of Object.values(playersById)){
    if(p.injury){
      p.injury.daysLeft -= 1;
      if(p.injury.daysLeft <= 0) p.injury = null;
    }
  }
}

function simulateMatch(force=false){
  const today = isoDate(new Date());
  if(!force && state.league.lastMatchDate === today){
    pushHistory("Match", `Wedstrijd vandaag (${formatISO(today)}) is al gesimuleerd.`);
    return { ok:false, msg:"al gesimuleerd" };
  }

  const playersById = indexPlayers(state.team.players);

  const missing = POS7.filter(pos => !state.matchLineup[pos]);
  if(missing.length){
    pushHistory("Match", `Wedstrijd niet gesimuleerd: matchselectie mist ${missing.join(", ")}.`);
    return { ok:false, msg:"lineup incompleet" };
  }

  const baseTeam = teamRatingFromLineup(state.matchLineup, playersById);
  const mod = tacticsModifier(state.tactics);
  const owmRating = clamp(Math.round(baseTeam + mod.off + mod.def), 1, 99);

  const league = state.league;
  const candidate = league.teams[league.rotationIndex % league.teams.length];
  const opp = (candidate.id === "OWM") ? league.teams[(league.rotationIndex+1)%league.teams.length] : candidate;
  const oppRating = opp.rating;

  const gap = owmRating - oppRating;
  const tempo = (state.tactics.tempo==="high") ? 0.9 : (state.tactics.tempo==="low") ? -0.6 : 0.0;
  const risk = (state.tactics.risk==="aggressive") ? 0.6 : (state.tactics.risk==="safe") ? -0.4 : 0.0;

  const oBase = 10.2 + (gap * 0.10) + tempo + risk;
  const aBase = 10.0 - (gap * 0.10) + tempo + (risk*0.2);

  let gf = Math.round(clamp(rand(oBase-2.2, oBase+2.2), 5, 18));
  let ga = Math.round(clamp(rand(aBase-2.2, aBase+2.2), 5, 18));
  gf = clamp(gf + Math.round(rand(-1,1)), 0, 25);
  ga = clamp(ga + Math.round(rand(-1,1)), 0, 25);

  updateStandingsAfterMatch("OWM", opp.id, gf, ga);
  applyMatchImpact(playersById, state.matchLineup);

  state.league.lastMatchDate = today;
  state.league.lastResult = { date: today, opponentId: opp.id, opponentName: opp.name, gf, ga, owmRating, oppRating };
  state.league.rotationIndex = (league.rotationIndex + 1) % league.teams.length;

  const txt = `OWM ${gf} - ${ga} ${opp.name} (Team ${owmRating} vs ${oppRating})`;
  pushHistory("Match", txt);

  saveState();
  renderAll();
  return { ok:true, resultText: txt };
}

/* ---------------- Scheduler: match at 19:00 ---------------- */

function nextMatchDateTime(){
  const now = new Date();
  const d = new Date(now);
  d.setHours(MATCH_TIME.h, MATCH_TIME.m, 0, 0);
  if(d.getTime() <= now.getTime()){
    d.setDate(d.getDate()+1);
  }
  return d;
}

function shouldAutoSimMatch(){
  const now = new Date();
  const today = isoDate(now);
  if(state.league.lastMatchDate === today) return false;

  const matchMoment = new Date(now);
  matchMoment.setHours(MATCH_TIME.h, MATCH_TIME.m, 0, 0);
  return now.getTime() >= matchMoment.getTime();
}

/* ---------------- Training timer (4h) ---------------- */

function isTrainingActive(){
  return typeof state.trainingEndsAt === "number" && state.trainingEndsAt > Date.now();
}
function trainingRemainingMs(){
  if(!isTrainingActive()) return 0;
  return Math.max(0, state.trainingEndsAt - Date.now());
}
function formatDuration(ms){
  const total = Math.ceil(ms/1000);
  const h = Math.floor(total/3600);
  const m = Math.floor((total%3600)/60);
  const s = total%60;
  return `${h}u ${pad2(m)}m ${pad2(s)}s`;
}

function lockTrainingUI(locked){
  // training selection + start/preview lock
  for(const pos of POS7){
    ui.selTrain[pos].disabled = locked;
  }
  ui.trainingType.disabled = locked;
  ui.btnStartTraining.disabled = locked;
  ui.btnPreviewTraining.disabled = locked;
}

/* ---------------- State ---------------- */

function createInitialState(){
  const players = [
    defaultPlayer("Keeper 1","GK"),
    defaultPlayer("CB 1","CB"),
    defaultPlayer("CF 1","CF"),
    defaultPlayer("LD 1","LD"),
    defaultPlayer("LW 1","LW"),
    defaultPlayer("RW 1","RW"),
    defaultPlayer("RD 1","RD"),
    defaultPlayer("Utility 1","U")
  ];

  const best = (pos) => players.find(p=>p.pos===pos)?.id || players[0]?.id || null;

  return {
    version: "3B-3",
    team: { name:"OWM", players },
    tactics: { defense:"zone", offense:"balanced", tempo:"mid", risk:"normal" },

    matchLineup: {
      GK: best("GK"), CB: best("CB"), CF: best("CF"), LD: best("LD"), LW: best("LW"), RW: best("RW"), RD: best("RD")
    },

    trainingType: "conditioning",
    trainingSelection: {
      GK: best("GK"), CB: best("CB"), CF: best("CF"), LD: best("LD"), LW: best("LW"), RW: best("RW"), RD: best("RD")
    },

    trainingEndsAt: null,
    trainingPending: null, // { type, selection, createdAt }

    league: createLeague(),
    history: []
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return createInitialState();
    const s = JSON.parse(raw);

    if(!s.team?.players) return createInitialState();
    if(!s.tactics) s.tactics = { defense:"zone", offense:"balanced", tempo:"mid", risk:"normal" };
    if(!s.league) s.league = createLeague();
    if(!s.history) s.history = [];
    if(!s.matchLineup) s.matchLineup = { GK:null, CB:null, CF:null, LD:null, LW:null, RW:null, RD:null };
    if(!s.trainingSelection) s.trainingSelection = { GK:null, CB:null, CF:null, LD:null, LW:null, RW:null, RD:null };
    if(!s.trainingType) s.trainingType = "conditioning";
    if(!("trainingEndsAt" in s)) s.trainingEndsAt = null;
    if(!("trainingPending" in s)) s.trainingPending = null;

    for(const p of s.team.players){
      if(!p.id) p.id = ensureId();
      if(typeof p.potential !== "number") p.potential = clamp(Math.round(rand(55,92)), 0, 100);
      if(!p.stats) p.stats = baseStatsForPos(p.pos||"U");
      if(typeof p.fitness !== "number") p.fitness = clamp(Math.round(rand(75,95)), 30, 100);
      if(typeof p.form !== "number") p.form = clamp(Math.round(rand(45,70)), 0, 100);
      if(!p.meta) p.meta = {};
    }

    return s;
  }catch{
    return createInitialState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function pushHistory(kind, text){
  state.history.unshift({ t: new Date().toISOString(), kind, text });
  state.history = state.history.slice(0,30);
}

/* ---------------- Import normalize (accepts your players JSON) ---------------- */

function normalizeImportedPlayer(x){
  if(!x || typeof x !== "object") return null;

  const name = x.name ?? x.naam ?? x.playerName ?? "Speler";
  const pos = String(x.pos ?? x.position ?? x.positie ?? "U");
  const potential = Number(x.potential ?? x.pot ?? x.potentie ?? x.POT ?? 70);

  let stats = x.stats;
  if(!stats){
    stats = {
      shooting: Number(x.shooting ?? x.schieten ?? rand(50,75)),
      passing: Number(x.passing ?? x.passen ?? rand(50,75)),
      defense: Number(x.defense ?? x.verdediging ?? rand(50,75)),
      speed: Number(x.speed ?? x.snelheid ?? rand(50,75)),
      stamina: Number(x.stamina ?? x.conditie ?? rand(50,75)),
      goalie: Number(x.goalie ?? x.keeper ?? rand(10,35)),
      iq: Number(x.iq ?? x.gameiq ?? rand(50,75))
    };
  }

  return {
    id: String(x.id ?? ensureId()),
    name: String(name),
    pos,
    potential: clamp(Number.isFinite(potential) ? potential : 70, 0, 100),
    fitness: clamp(Number.isFinite(Number(x.fitness)) ? Number(x.fitness) : 90, 30, 100),
    form: clamp(Number.isFinite(Number(x.form)) ? Number(x.form) : 60, 0, 100),
    injury: x.injury ?? null,
    meta: x.meta ?? {},
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
}

/* ---------------- UI ---------------- */

const ui = {
  // views
  views: {
    dashboard: document.getElementById("view-dashboard"),
    training: document.getElementById("view-training"),
    match: document.getElementById("view-match"),
    tactics: document.getElementById("view-tactics"),
    squad: document.getElementById("view-squad"),
    standings: document.getElementById("view-standings"),
    history: document.getElementById("view-history")
  },

  // dashboard
  pillToday: document.getElementById("pillToday"),
  kpiNow: document.getElementById("kpiNow"),
  kpiNextMatch: document.getElementById("kpiNextMatch"),
  noteMatch: document.getElementById("noteMatch"),
  noteTraining: document.getElementById("noteTraining"),
  btnSimMatchNow: document.getElementById("btnSimMatchNow"),
  btnTickNow: document.getElementById("btnTickNow"),
  lastResult: document.getElementById("lastResult"),
  teamMeta: document.getElementById("teamMeta"),
  kpiFitness: document.getElementById("kpiFitness"),
  kpiInj: document.getElementById("kpiInj"),
  kpiRating: document.getElementById("kpiRating"),
  kpiStanding: document.getElementById("kpiStanding"),
  tableTop8: document.getElementById("tableTop8").querySelector("tbody"),
  tileTrainingSub: document.getElementById("tileTrainingSub"),

  // training
  pillTraining: document.getElementById("pillTraining"),
  trainingType: document.getElementById("trainingType"),
  trainingTimer: document.getElementById("trainingTimer"),
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
  btnStartTraining: document.getElementById("btnStartTraining"),
  trainingPreview: document.getElementById("trainingPreview"),

  // match selection
  selMatch: {
    GK: document.getElementById("selMatchGK"),
    CB: document.getElementById("selMatchCB"),
    CF: document.getElementById("selMatchCF"),
    LD: document.getElementById("selMatchLD"),
    LW: document.getElementById("selMatchLW"),
    RW: document.getElementById("selMatchRW"),
    RD: document.getElementById("selMatchRD")
  },
  matchLineupNote: document.getElementById("matchLineupNote"),

  // tactics
  tacDefense: document.getElementById("tacDefense"),
  tacOffense: document.getElementById("tacOffense"),
  tacTempo: document.getElementById("tacTempo"),
  tacRisk: document.getElementById("tacRisk"),
  tacticsNote: document.getElementById("tacticsNote"),

  // squad
  playersTable: document.getElementById("playersTable").querySelector("tbody"),

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

/* ---------------- Navigation (dashboard tiles -> views) ---------------- */

function showView(key){
  for(const [k,el] of Object.entries(ui.views)){
    el.classList.toggle("hidden", k !== key);
  }
}

document.querySelectorAll(".tile[data-go]").forEach(tile=>{
  tile.addEventListener("click", ()=>{
    showView(tile.dataset.go);
    renderAll();
  });
});

document.querySelectorAll("[data-back]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    showView("dashboard");
    renderAll();
  });
});

/* ---------------- Select helper ---------------- */

function fillPlayerSelect(selectEl, players, selectedId, posHint){
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

/* ---------------- Render ---------------- */

function renderDashboard(){
  ui.pillToday.textContent = `Vandaag: ${formatISO(isoDate())}`;
  ui.kpiNow.textContent = `${formatISO(isoDate())} ${hhmm()}`;

  const nm = nextMatchDateTime();
  ui.kpiNextMatch.textContent = `${formatISO(isoDate(nm))} ${pad2(nm.getHours())}:${pad2(nm.getMinutes())}`;

  const players = state.team.players;
  const playersById = indexPlayers(players);

  // update OWM rating in league table
  const owmLineupRating = teamRatingFromLineup(state.matchLineup, playersById);
  const owmTeam = state.league.teams.find(t=>t.id==="OWM");
  if(owmTeam) owmTeam.rating = owmLineupRating;

  ui.teamMeta.textContent = `${state.team.name} — ${players.length} spelers`;
  ui.kpiFitness.textContent = round1(averageFitness(players));
  ui.kpiInj.textContent = players.filter(p=>p.injury).length;
  ui.kpiRating.textContent = owmLineupRating;

  const sorted = sortStandings(state.league.standings);
  const idx = sorted.findIndex(r=>r.teamId==="OWM");
  const row = sorted[idx];
  ui.kpiStanding.textContent = row
    ? `#${idx+1} — ${row.teamName}: ${row.Pts} pts (P ${row.P}, GD ${row.GF-row.GA})`
    : "—";

  ui.tableTop8.innerHTML = sorted.slice(0,8).map((r,i)=>{
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${escapeHtml(r.teamName)}</strong></td>
      <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
      <td>${r.GF}</td><td>${r.GA}</td><td>${r.GF-r.GA}</td>
      <td><strong>${r.Pts}</strong></td>
    </tr>`;
  }).join("");

  const today = isoDate();
  const already = (state.league.lastMatchDate === today);
  ui.noteMatch.innerHTML = already
    ? `Wedstrijd vandaag is al gesimuleerd.<br/><strong>Datum:</strong> ${formatISO(today)}`
    : `Wedstrijd wordt automatisch gesimuleerd zodra de tijd <strong>19:00</strong> is gepasseerd.`;

  // training tile + dashboard note
  if(isTrainingActive()){
    ui.tileTrainingSub.textContent = `Actief — nog ${formatDuration(trainingRemainingMs())}`;
    ui.noteTraining.innerHTML = `Training loopt.<br/><strong>Resterend:</strong> ${formatDuration(trainingRemainingMs())}`;
  } else {
    ui.tileTrainingSub.textContent = `Beschikbaar — 4 uur`;
    ui.noteTraining.innerHTML = `Je kunt een training starten (4 uur).`;
  }

  if(state.league.lastResult){
    const lr = state.league.lastResult;
    ui.lastResult.innerHTML = `${formatISO(lr.date)} — <strong>OWM ${lr.gf} - ${lr.ga} ${escapeHtml(lr.opponentName)}</strong><br/>
      <span class="muted">Rating: OWM ${lr.owmRating} vs Opp ${lr.oppRating}</span>`;
  } else {
    ui.lastResult.textContent = "Nog geen wedstrijden gespeeld.";
  }
}

function renderTraining(){
  const players = state.team.players;

  ui.trainingType.value = state.trainingType;

  for(const pos of POS7){
    fillPlayerSelect(ui.selTrain[pos], players, state.trainingSelection[pos], pos);
  }

  if(isTrainingActive()){
    ui.pillTraining.textContent = "Training: actief";
    ui.trainingTimer.textContent = `Resterend: ${formatDuration(trainingRemainingMs())}`;
    lockTrainingUI(true);
  } else {
    ui.pillTraining.textContent = "Training: beschikbaar";
    ui.trainingTimer.textContent = "Niet actief";
    lockTrainingUI(false);
  }
}

function renderMatchSelection(){
  const players = state.team.players;
  for(const pos of POS7){
    fillPlayerSelect(ui.selMatch[pos], players, state.matchLineup[pos], pos);
  }

  const missing = POS7.filter(p => !state.matchLineup[p]);
  ui.matchLineupNote.innerHTML = missing.length
    ? `Let op: ontbreekt: <strong>${missing.join(", ")}</strong>.`
    : `Opstelling compleet. Klaar voor 19:00.`;
}

function renderTactics(){
  ui.tacDefense.value = state.tactics.defense;
  ui.tacOffense.value = state.tactics.offense;
  ui.tacTempo.value = state.tactics.tempo;
  ui.tacRisk.value = state.tactics.risk;

  ui.tacticsNote.innerHTML = `Instellingen opgeslagen. Kleine impact op match (MVP).`;
}

function renderSquad(){
  const players = state.team.players;
  ui.playersTable.innerHTML = players.map(p=>{
    const inj = p.injury ? `${escapeHtml(p.injury.type)} (${p.injury.daysLeft}d)` : "Fit";
    return `<tr>
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${escapeHtml(p.pos||"")}</td>
      <td>${p.potential}</td>
      <td>${round1(p.fitness)}</td>
      <td>${inj}</td>
      <td>${playerRating(p)}</td>
    </tr>`;
  }).join("");
}

function renderStandings(){
  const sorted = sortStandings(state.league.standings);
  ui.tableStandings.innerHTML = sorted.map((r,i)=>{
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${escapeHtml(r.teamName)}</strong></td>
      <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
      <td>${r.GF}</td><td>${r.GA}</td><td>${r.GF-r.GA}</td>
      <td><strong>${r.Pts}</strong></td>
    </tr>`;
  }).join("");
}

function renderHistory(){
  if(!state.history.length){
    ui.history.innerHTML = `<div class="note">Nog geen events.</div>`;
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
  renderDashboard();
  renderTraining();
  renderMatchSelection();
  renderTactics();
  renderSquad();
  renderStandings();
  renderHistory();
}

/* ---------------- Events: selection & tactics ---------------- */

function bindSelection(selectMap, stateMap){
  for(const pos of POS7){
    selectMap[pos].addEventListener("change", ()=>{
      if(isTrainingActive() && selectMap === ui.selTrain) return; // safety
      stateMap[pos] = selectMap[pos].value || null;
      saveState();
      renderAll();
    });
  }
}

bindSelection(ui.selTrain, state.trainingSelection);
bindSelection(ui.selMatch, state.matchLineup);

ui.trainingType.addEventListener("change", ()=>{
  if(isTrainingActive()) return;
  state.trainingType = ui.trainingType.value;
  saveState();
});

ui.tacDefense.addEventListener("change", ()=>{ state.tactics.defense = ui.tacDefense.value; saveState(); renderAll(); });
ui.tacOffense.addEventListener("change", ()=>{ state.tactics.offense = ui.tacOffense.value; saveState(); renderAll(); });
ui.tacTempo.addEventListener("change", ()=>{ state.tactics.tempo = ui.tacTempo.value; saveState(); renderAll(); });
ui.tacRisk.addEventListener("change", ()=>{ state.tactics.risk = ui.tacRisk.value; saveState(); renderAll(); });

/* ---------------- Training controls ---------------- */

ui.btnPreviewTraining.addEventListener("click", ()=>{
  if(isTrainingActive()){
    ui.trainingPreview.innerHTML = `Training loopt. Preview is geblokkeerd.`;
    return;
  }

  const playersById = indexPlayers(state.team.players);
  const missing = POS7.filter(pos => !state.trainingSelection[pos]);
  if(missing.length){
    ui.trainingPreview.innerHTML = `Selecteer eerst voor: <strong>${missing.join(", ")}</strong>.`;
    return;
  }

  const type = state.trainingType;
  const lines = [];
  lines.push(`<strong>Preview — Training 4u (${escapeHtml(focusLabel(type))})</strong>`);
  lines.push(`<span class="muted">Growth is gebaseerd op potential. Preview ≈ gain.</span>`);
  lines.push(`<div class="hr"></div>`);

  for(const pos of POS7){
    const p = playersById[state.trainingSelection[pos]];
    const d = trainingDeltaPreview(p, type);
    const main = Object.entries(d).filter(([k])=>k!=="all").slice(0,3).map(([k,v])=>`${k}+${v}`).join(", ");
    lines.push(`• <strong>${escapeHtml(pos)}:</strong> ${escapeHtml(p.name)} (Pot ${p.potential}) — verwacht: <strong>${escapeHtml(main || ("all+"+d.all))}</strong>`);
  }

  ui.trainingPreview.innerHTML = lines.join("<br/>");
});

ui.btnStartTraining.addEventListener("click", ()=>{
  if(isTrainingActive()){
    ui.trainingPreview.innerHTML = `Training loopt al.`;
    return;
  }

  const missing = POS7.filter(pos => !state.trainingSelection[pos]);
  if(missing.length){
    ui.trainingPreview.innerHTML = `Selecteer eerst voor: <strong>${missing.join(", ")}</strong>.`;
    return;
  }

  // Start training: lock en zet eindtijd + pending payload
  const now = Date.now();
  state.trainingEndsAt = now + 4*60*60*1000; // 4 uur
  state.trainingPending = {
    type: state.trainingType,
    selection: { ...state.trainingSelection },
    createdAt: now
  };

  pushHistory("Training", `Training gestart (4u) — ${focusLabel(state.trainingType)}.`);
  saveState();
  renderAll();
});

/* ---------------- Match controls + scheduler tick ---------------- */

ui.btnSimMatchNow.addEventListener("click", ()=>{
  const r = simulateMatch(true); // force
  if(!r.ok){
    // no-op, history already logged
  }
});

ui.btnTickNow.addEventListener("click", ()=>{
  tick();
});

function completeTrainingIfDone(){
  if(!state.trainingEndsAt || !state.trainingPending) return;
  if(Date.now() < state.trainingEndsAt) return;

  // apply training now
  const playersById = indexPlayers(state.team.players);
  const type = state.trainingPending.type;
  const selection = state.trainingPending.selection;

  const logs = [];
  logs.push(`Training afgerond — ${focusLabel(type)}.`);

  for(const pos of POS7){
    const id = selection[pos];
    const p = playersById[id];
    if(!p) continue;

    const delta = trainingDeltaPreview(p, type);
    // kleine jitter
    for(const k of Object.keys(delta)){
      if(k==="all") continue;
      delta[k] = round1(delta[k] * rand(0.92, 1.08));
    }
    if(delta.all) delta.all = round1(delta.all * rand(0.92, 1.08));

    const l = applyTraining(p, delta, type);
    logs.push(...l);
  }

  state.trainingEndsAt = null;
  state.trainingPending = null;

  pushHistory("Training", logs.join(" "));
  saveState();
}

function tick(){
  // 1) training completion
  completeTrainingIfDone();

  // 2) match auto-sim after 19:00 if not yet played
  if(shouldAutoSimMatch()){
    simulateMatch(false);
  }

  // 3) refresh UI (timer / next match)
  renderAll();
}

/* ---------------- Export / Import / Reset ---------------- */

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
  ui.importNote.textContent = "Plak save-object of spelers-array (JSON).";
});

ui.btnCloseImport.addEventListener("click", closeImport);
ui.btnClearImport.addEventListener("click", ()=> ui.importText.value = "");

ui.btnDoImport.addEventListener("click", ()=>{
  const raw = ui.importText.value.trim();
  if(!raw){ ui.importNote.textContent = "Plak eerst JSON."; return; }

  try{
    const parsed = JSON.parse(raw);

    // save object
    if(parsed && parsed.team && Array.isArray(parsed.team.players)){
      state = parsed;

      // backfill essentials
      if(!state.team?.players) throw new Error("Invalid save");
      if(!state.tactics) state.tactics = { defense:"zone", offense:"balanced", tempo:"mid", risk:"normal" };
      if(!state.league) state.league = createLeague();
      if(!state.history) state.history = [];
      if(!state.matchLineup) state.matchLineup = { GK:null, CB:null, CF:null, LD:null, LW:null, RW:null, RD:null };
      if(!state.trainingSelection) state.trainingSelection = { GK:null, CB:null, CF:null, LD:null, LW:null, RW:null, RD:null };
      if(!state.trainingType) state.trainingType = "conditioning";
      if(!("trainingEndsAt" in state)) state.trainingEndsAt = null;
      if(!("trainingPending" in state)) state.trainingPending = null;

      // normalize players minimal schema
      state.team.players = state.team.players.map(p => normalizeImportedPlayer(p)).filter(Boolean);

      saveState();
      closeImport();
      pushHistory("System", "Import (save) gelukt.");
      saveState();
      renderAll();
      return;
    }

    // players array
    if(Array.isArray(parsed)){
      const roster = parsed.map(x => normalizeImportedPlayer(x)).filter(Boolean);
      if(!roster.length){
        ui.importNote.textContent = "Geen geldige spelers gevonden.";
        return;
      }
      state.team.players = roster;

      // auto-fill selections
      const byPos = (pos) => state.team.players.find(p=>p.pos===pos)?.id || state.team.players[0]?.id || null;
      for(const pos of POS7){
        state.matchLineup[pos] = byPos(pos);
        state.trainingSelection[pos] = byPos(pos);
      }

      pushHistory("System", `Spelerslijst geïmporteerd (${roster.length} spelers).`);
      saveState();
      closeImport();
      renderAll();
      return;
    }

    ui.importNote.textContent = "Onbekend JSON-format.";
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

function closeImport(){
  ui.importModal.classList.add("hidden");
  ui.importModal.setAttribute("aria-hidden","true");
}

/* ---------------- Boot ---------------- */

(function init(){
  showView("dashboard");
  renderAll();

  // tick: elke 1 seconde voor timer, match-check en training finish
  tick();
  setInterval(tick, 1000);

  pushHistory("System", "App gestart. Match dagelijks om 19:00.");
  saveState();
})();
