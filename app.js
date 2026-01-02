/* OWM Waterpolo Manager — Fase 3B (Stap 1)
   - Dagtype: rest/training/match
   - Training focus: conditioning/strength/shooting/defense/tactics
   - Dag-simulatie: fitness + blessures + kleine stats progressie
   - History (laatste 30)
   - Export/Import save JSON
*/

const STORAGE_KEY = "owm_mvp_save_v3b1";

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function round1(n){ return Math.round(n * 10) / 10; }
function rand(min, max){ return Math.random() * (max - min) + min; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

function todayISOFromStart(startISO, dayIndex){
  const d = new Date(startISO);
  d.setDate(d.getDate() + dayIndex);
  return d.toISOString().slice(0,10);
}

function formatISO(iso){
  const [y,m,d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function defaultPlayer(name, pos){
  // Stats: 0-100
  // Voor MVP houden we het compact en interpreteerbaar
  const base = () => clamp(Math.round(rand(55, 78)), 30, 92);

  const player = {
    id: crypto.randomUUID(),
    name: name || "Speler",
    pos: pos || "U",
    fitness: clamp(Math.round(rand(70, 92)), 30, 100),
    injury: null, // { type, severity(1-3), daysLeft }
    stats: {
      shooting: base(),
      passing: base(),
      defense: base(),
      speed: base(),
      stamina: base(),
      goalie: pos === "GK" ? clamp(Math.round(rand(60, 85)), 40, 95) : clamp(Math.round(rand(10, 35)), 0, 60),
      iq: base()
    },
    form: clamp(Math.round(rand(45, 70)), 0, 100) // "vorm" voor extra nuance
  };

  // Positie-tilt
  if (player.pos === "GK") {
    player.stats.goalie = clamp(player.stats.goalie + 12, 0, 100);
    player.stats.defense = clamp(player.stats.defense + 6, 0, 100);
    player.stats.shooting = clamp(player.stats.shooting - 10, 0, 100);
  } else if (player.pos === "C") {
    player.stats.shooting = clamp(player.stats.shooting + 8, 0, 100);
    player.stats.iq = clamp(player.stats.iq + 5, 0, 100);
    player.stats.speed = clamp(player.stats.speed - 4, 0, 100);
  } else if (player.pos === "D") {
    player.stats.defense = clamp(player.stats.defense + 10, 0, 100);
    player.stats.speed = clamp(player.stats.speed - 2, 0, 100);
  } else if (player.pos === "W") {
    player.stats.speed = clamp(player.stats.speed + 10, 0, 100);
    player.stats.passing = clamp(player.stats.passing + 4, 0, 100);
  }

  return player;
}

function createInitialState(){
  const startISO = new Date().toISOString().slice(0,10);

  return {
    version: "3B-1",
    day: 0,
    startISO,
    budget: 250000,
    defaults: {
      dayType: "training",
      trainingFocus: "conditioning"
    },
    currentPlan: {
      dayType: "training",
      trainingFocus: "conditioning"
    },
    history: [],
    team: {
      name: "OWM",
      players: [
        defaultPlayer("Keeper 1", "GK"),
        defaultPlayer("Center 1", "C"),
        defaultPlayer("Def 1", "D"),
        defaultPlayer("Wing 1", "W"),
        defaultPlayer("Utility 1", "U"),
        defaultPlayer("Utility 2", "U"),
        defaultPlayer("Def 2", "D"),
        defaultPlayer("Wing 2", "W"),
        defaultPlayer("Center 2", "C"),
        defaultPlayer("Keeper 2", "GK")
      ]
    }
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return createInitialState();
    const parsed = JSON.parse(raw);

    // Minimale migratie-veiligheid
    if(!parsed.team || !Array.isArray(parsed.team.players)) return createInitialState();
    if(!parsed.defaults) parsed.defaults = { dayType:"training", trainingFocus:"conditioning" };
    if(!parsed.currentPlan) parsed.currentPlan = { ...parsed.defaults };
    if(!parsed.history) parsed.history = [];

    return parsed;
  }catch{
    return createInitialState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------- Simulatie logica (3B-1) ---------- */

function playerRating(p){
  const s = p.stats;
  // eenvoudige weging
  const core = (s.shooting + s.passing + s.defense + s.speed + s.stamina + s.iq) / 6;
  const gkBonus = p.pos === "GK" ? (s.goalie * 0.35) : (s.goalie * 0.05);
  const injuryPenalty = p.injury ? (10 + p.injury.severity * 6) : 0;
  const fitnessFactor = (p.fitness - 50) * 0.10; // -5..+5
  const formFactor = (p.form - 50) * 0.08;

  return clamp(Math.round(core + gkBonus + fitnessFactor + formFactor - injuryPenalty), 1, 99);
}

function teamRating(players){
  if(players.length === 0) return 0;
  const avg = players.reduce((a,p)=>a+playerRating(p),0)/players.length;
  return Math.round(avg);
}

function injuryRisk(p, plan){
  // Base risico
  let risk = 0.006; // 0.6% per dag
  // vermoeidheid
  if (p.fitness < 60) risk += (60 - p.fitness) * 0.0006; // tot ~2.4%
  // plan
  if (plan.dayType === "training") risk += 0.004; // +0.4%
  if (plan.dayType === "match") risk += 0.006; // +0.6%
  // focus
  if (plan.dayType === "training"){
    if (plan.trainingFocus === "strength") risk += 0.003;
    if (plan.trainingFocus === "conditioning") risk += 0.002;
  }
  // bestaande blessure: geen nieuwe blessure, maar wel kans op verergering
  if (p.injury) risk *= 0.35;
  return clamp(risk, 0, 0.08);
}

function applyPlanToPlayer(p, plan){
  const log = [];

  // Blessure-afhandeling
  if (p.injury){
    p.injury.daysLeft -= 1;
    if (p.injury.daysLeft <= 0){
      log.push(`${p.name} hersteld van ${p.injury.type}.`);
      p.injury = null;
      // herstelboost
      p.fitness = clamp(p.fitness + 4, 30, 100);
      p.form = clamp(p.form + 2, 0, 100);
    } else {
      // tijdens blessure: fitness langzaam omlaag, behalve bij rust
      const down = plan.dayType === "rest" ? rand(0.1, 0.6) : rand(0.6, 1.6);
      p.fitness = clamp(p.fitness - down, 30, 100);
      p.form = clamp(p.form - rand(0.2, 0.8), 0, 100);
    }
    return log;
  }

  // Nieuwe blessure check
  const risk = injuryRisk(p, plan);
  if (Math.random() < risk){
    const types = ["Schouder", "Lies", "Rug", "Pols", "Enkel"];
    const severity = pick([1,1,1,2,2,3]); // meestal licht
    const daysLeft = severity === 1 ? Math.round(rand(2,4))
                  : severity === 2 ? Math.round(rand(4,8))
                  : Math.round(rand(7,14));
    p.injury = { type: pick(types), severity, daysLeft };
    log.push(`${p.name} raakt geblesseerd (${p.injury.type}, severity ${severity}, ${daysLeft}d).`);
    // directe impact
    p.fitness = clamp(p.fitness - rand(2,6), 30, 100);
    p.form = clamp(p.form - rand(2,6), 0, 100);
    return log;
  }

  // Geen blessure: plan-effecten
  if (plan.dayType === "rest"){
    // herstel + mini regressie in skills, maar niet veel
    p.fitness = clamp(p.fitness + rand(1.8, 3.4), 30, 100);
    p.form = clamp(p.form + rand(0.8, 2.0), 0, 100);

    // kleine skill decay als je te lang alleen rust: hier heel mild
    const decay = rand(0.02, 0.06);
    tweakStats(p, { all: -decay });
    log.push(`${p.name} herstelt (rust).`);
  }

  if (plan.dayType === "training"){
    // training kost fitness, maar geeft skills
    let fatigue = rand(1.0, 2.4);
    if (plan.trainingFocus === "strength") fatigue += rand(0.6, 1.2);
    if (plan.trainingFocus === "conditioning") fatigue += rand(0.3, 0.9);

    p.fitness = clamp(p.fitness - fatigue, 30, 100);
    p.form = clamp(p.form + rand(0.2, 1.0), 0, 100);

    // Gains: afhankelijk van focus + een beetje algemene groei
    const g = rand(0.10, 0.30); // per dag klein
    const focusBoost = rand(0.20, 0.55);

    const delta = { all: g };
    if (plan.trainingFocus === "conditioning"){
      delta.stamina = focusBoost;
      delta.speed = focusBoost * 0.45;
    }
    if (plan.trainingFocus === "strength"){
      delta.defense = focusBoost * 0.55;
      delta.speed = focusBoost * 0.25;
      delta.shooting = focusBoost * 0.15;
    }
    if (plan.trainingFocus === "shooting"){
      delta.shooting = focusBoost;
      delta.passing = focusBoost * 0.35;
    }
    if (plan.trainingFocus === "defense"){
      delta.defense = focusBoost;
      delta.iq = focusBoost * 0.25;
    }
    if (plan.trainingFocus === "tactics"){
      delta.iq = focusBoost;
      delta.passing = focusBoost * 0.35;
      delta.defense = focusBoost * 0.25;
    }

    // Keepers iets andere nadruk
    if (p.pos === "GK"){
      delta.goalie = (delta.goalie ?? 0) + focusBoost * 0.35 + g * 0.5;
      delta.defense = (delta.defense ?? 0) + g * 0.2;
      delta.shooting = (delta.shooting ?? 0) - g * 0.2;
    }

    tweakStats(p, delta);
    log.push(`${p.name} traint (${focusLabel(plan.trainingFocus)}).`);
  }

  if (plan.dayType === "match"){
    // wedstrijd: vorm kan omhoog/omlaag, fitness omlaag, skills mini omhoog (ervaring)
    const fatigue = rand(1.8, 3.8);
    p.fitness = clamp(p.fitness - fatigue, 30, 100);

    const swing = rand(-1.2, 1.8);
    p.form = clamp(p.form + swing, 0, 100);

    tweakStats(p, { all: rand(0.03, 0.10), iq: rand(0.05, 0.18) });
    log.push(`${p.name} speelt wedstrijd.`);
  }

  return log;
}

function tweakStats(p, delta){
  const s = p.stats;

  const apply = (key, amount) => {
    s[key] = clamp(s[key] + amount, 0, 100);
  };

  const all = delta.all ?? 0;
  if (all !== 0){
    for (const k of Object.keys(s)){
      apply(k, all);
    }
  }

  for (const [k,v] of Object.entries(delta)){
    if (k === "all") continue;
    if (typeof s[k] === "number") apply(k, v);
  }
}

function focusLabel(f){
  return ({
    conditioning: "Conditie",
    strength: "Kracht",
    shooting: "Schieten",
    defense: "Verdediging",
    tactics: "Tactiek"
  })[f] || f;
}

function dayTypeLabel(t){
  return ({ rest:"Rust", training:"Training", match:"Wedstrijd" })[t] || t;
}

function simulateDay(){
  const plan = {
    dayType: ui.dayType.value,
    trainingFocus: ui.trainingFocus.value
  };

  state.currentPlan = { ...plan };

  // dag + datum
  const nextDayIndex = state.day + 1;
  const iso = todayISOFromStart(state.startISO, nextDayIndex);

  // Apply voor elke speler
  const dayLogs = [];
  let injuriesToday = 0;

  for (const p of state.team.players){
    const beforeInjury = !!p.injury;
    const logs = applyPlanToPlayer(p, plan);
    dayLogs.push(...logs);

    if (!beforeInjury && p.injury) injuriesToday += 1;
  }

  // Team summary
  const avgFit = averageFitness(state.team.players);
  const tr = teamRating(state.team.players);
  const injCount = state.team.players.filter(p=>p.injury).length;

  const summary = [
    `Dag ${nextDayIndex} (${formatISO(iso)}): ${dayTypeLabel(plan.dayType)}${plan.dayType==="training" ? " — " + focusLabel(plan.trainingFocus) : ""}.`,
    `Gem. fitness: ${round1(avgFit)} | Team rating: ${tr} | Blessures: ${injCount}${injuriesToday>0 ? ` (nieuw: ${injuriesToday})` : ""}.`
  ].join("\n");

  // History item
  state.history.unshift({
    day: nextDayIndex,
    iso,
    plan,
    summary,
    lines: dayLogs.slice(0, 80) // cap
  });
  state.history = state.history.slice(0, 30);

  // commit day
  state.day = nextDayIndex;

  // “default plan” logica: als gebruiker planner default aanpast, blijft UI meestal al goed,
  // maar we zetten dagplanning niet automatisch om na sim; dat doen we in render met defaults.
  saveState();

  renderDaySummary(summary, dayLogs);
  renderAll();
}

function averageFitness(players){
  if(players.length === 0) return 0;
  return players.reduce((a,p)=>a+p.fitness,0)/players.length;
}

/* ---------- UI / Rendering ---------- */

const ui = {
  dayPill: document.getElementById("dayPill"),
  simDate: document.getElementById("simDate"),
  budget: document.getElementById("budget"),
  dayType: document.getElementById("dayType"),
  trainingFocus: document.getElementById("trainingFocus"),
  btnNextDay: document.getElementById("btnNextDay"),
  btnAuto7: document.getElementById("btnAuto7"),
  daySummary: document.getElementById("daySummary"),

  teamMeta: document.getElementById("teamMeta"),
  avgFitness: document.getElementById("avgFitness"),
  injCount: document.getElementById("injCount"),
  teamRating: document.getElementById("teamRating"),
  playersTable: document.getElementById("playersTable").querySelector("tbody"),

  newName: document.getElementById("newName"),
  newPos: document.getElementById("newPos"),
  btnAddPlayer: document.getElementById("btnAddPlayer"),

  defaultDayType: document.getElementById("defaultDayType"),
  defaultTrainingFocus: document.getElementById("defaultTrainingFocus"),

  history: document.getElementById("history"),

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

function renderAll(){
  renderHeader();
  renderTeam();
  renderPlanner();
  renderHistory();
  // Zet UI plan op “currentPlan” of defaults, maar voorkom dat focus actief is bij rest/match
  syncPlanInputs();
}

function renderHeader(){
  ui.dayPill.textContent = `Dag ${state.day}`;
  const iso = todayISOFromStart(state.startISO, state.day);
  ui.simDate.textContent = formatISO(iso);
  ui.budget.textContent = `€ ${Number(state.budget).toLocaleString("nl-NL")}`;
}

function injuryBadge(p){
  if(!p.injury){
    return `<span class="badge"><span class="dot ok"></span> Fit</span>`;
  }
  const cls = p.injury.severity === 1 ? "warn" : "bad";
  return `<span class="badge"><span class="dot ${cls}"></span>${p.injury.type} (${p.injury.daysLeft}d)</span>`;
}

function fitnessBadge(p){
  const f = p.fitness;
  const cls = f >= 80 ? "ok" : f >= 65 ? "warn" : "bad";
  return `<span class="badge"><span class="dot ${cls}"></span>${round1(f)}</span>`;
}

function renderTeam(){
  const players = state.team.players;
  ui.teamMeta.textContent = `${state.team.name} — ${players.length} spelers`;

  ui.avgFitness.textContent = round1(averageFitness(players));
  ui.injCount.textContent = players.filter(p=>p.injury).length;
  ui.teamRating.textContent = teamRating(players);

  ui.playersTable.innerHTML = players.map(p=>{
    const r = playerRating(p);
    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${p.pos}</td>
        <td>${fitnessBadge(p)}</td>
        <td>${injuryBadge(p)}</td>
        <td>${r}</td>
        <td>
          <div class="actions">
            <button class="btn btn-ghost small" data-act="heal" data-id="${p.id}">Herstel</button>
            <button class="btn btn-ghost small" data-act="injure" data-id="${p.id}">Blessure</button>
            <button class="btn btn-danger small" data-act="remove" data-id="${p.id}">Verwijder</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  ui.playersTable.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const p = state.team.players.find(x=>x.id===id);
      if(!p) return;

      if(act === "remove"){
        state.team.players = state.team.players.filter(x=>x.id!==id);
      }
      if(act === "heal"){
        p.injury = null;
        p.fitness = clamp(p.fitness + 6, 30, 100);
        p.form = clamp(p.form + 3, 0, 100);
      }
      if(act === "injure"){
        const types = ["Schouder", "Lies", "Rug", "Pols", "Enkel"];
        const severity = pick([1,2,2,3]);
        const daysLeft = severity === 1 ? 3 : severity === 2 ? 6 : 10;
        p.injury = { type: pick(types), severity, daysLeft };
        p.fitness = clamp(p.fitness - 4, 30, 100);
        p.form = clamp(p.form - 4, 0, 100);
      }

      saveState();
      renderAll();
    });
  });
}

function renderPlanner(){
  ui.defaultDayType.value = state.defaults.dayType;
  ui.defaultTrainingFocus.value = state.defaults.trainingFocus;
}

function renderHistory(){
  const items = state.history;
  if(items.length === 0){
    ui.history.innerHTML = `<div class="note">Nog geen history. Klik op “Volgende dag”.</div>`;
    return;
  }

  ui.history.innerHTML = items.map(h=>{
    const header = `Dag ${h.day} — ${formatISO(h.iso)} — ${dayTypeLabel(h.plan.dayType)}${h.plan.dayType==="training" ? " / " + focusLabel(h.plan.trainingFocus) : ""}`;
    const lines = (h.lines && h.lines.length) ? h.lines.map(x=>`• ${escapeHtml(x)}`).join("<br/>") : "• (geen details)";
    const summary = escapeHtml(h.summary).replace(/\n/g,"<br/>");

    return `
      <div class="hitem">
        <div class="hmeta">
          <div class="left">${escapeHtml(header)}</div>
          <div class="right">${h.plan.dayType==="training" ? "Skills groei + fitness omlaag" : h.plan.dayType==="rest" ? "Herstel" : "Wedstrijd-effecten"}</div>
        </div>
        <div class="htext">${summary}<div class="hr"></div>${lines}</div>
      </div>
    `;
  }).join("");
}

function renderDaySummary(summary, lines){
  const text = escapeHtml(summary).replace(/\n/g, "<br/>");
  const details = (lines && lines.length) ? `<div class="hr"></div>${lines.slice(0, 18).map(l=>`• ${escapeHtml(l)}`).join("<br/>")}` : "";
  ui.daySummary.innerHTML = text + details;
}

function syncPlanInputs(){
  // initial of na render: plan inputs zetten op currentPlan als die bestaat, anders defaults
  const plan = state.currentPlan || state.defaults || { dayType:"training", trainingFocus:"conditioning" };

  ui.dayType.value = plan.dayType || state.defaults.dayType;
  ui.trainingFocus.value = plan.trainingFocus || state.defaults.trainingFocus;

  // Focus dropdown disabled tenzij training
  ui.trainingFocus.disabled = ui.dayType.value !== "training";
  if(ui.dayType.value !== "training"){
    // toch consistent: laat de focus staan, maar hij telt niet mee
  }
}

/* ---------- Events ---------- */

ui.dayType.addEventListener("change", () => {
  ui.trainingFocus.disabled = ui.dayType.value !== "training";
  state.currentPlan.dayType = ui.dayType.value;
  saveState();
});

ui.trainingFocus.addEventListener("change", () => {
  state.currentPlan.trainingFocus = ui.trainingFocus.value;
  saveState();
});

ui.defaultDayType.addEventListener("change", () => {
  state.defaults.dayType = ui.defaultDayType.value;
  // ook huidige plan mee zetten (zodat het direct effect heeft)
  state.currentPlan.dayType = state.defaults.dayType;
  saveState();
  renderAll();
});

ui.defaultTrainingFocus.addEventListener("change", () => {
  state.defaults.trainingFocus = ui.defaultTrainingFocus.value;
  state.currentPlan.trainingFocus = state.defaults.trainingFocus;
  saveState();
  renderAll();
});

ui.btnNextDay.addEventListener("click", () => {
  simulateDay();
});

ui.btnAuto7.addEventListener("click", () => {
  // 7 dagen achter elkaar, met huidig ingestelde UI plan
  for(let i=0;i<7;i++){
    simulateDay();
  }
});

ui.btnAddPlayer.addEventListener("click", () => {
  const name = (ui.newName.value || "").trim();
  const pos = ui.newPos.value;

  if(!name){
    ui.newName.focus();
    return;
  }

  state.team.players.push(defaultPlayer(name, pos));
  ui.newName.value = "";
  saveState();
  renderAll();
});

ui.btnExport.addEventListener("click", async () => {
  const data = JSON.stringify(state, null, 2);
  try{
    await navigator.clipboard.writeText(data);
    ui.daySummary.innerHTML = `Export gekopieerd naar klembord.<div class="hr"></div><span class="muted">Plak het in een notitie of stuur het naar jezelf.</span>`;
  }catch{
    // fallback: prompt
    window.prompt("Kopieer je save JSON:", data);
  }
});

ui.btnImport.addEventListener("click", () => {
  ui.importModal.classList.remove("hidden");
  ui.importModal.setAttribute("aria-hidden","false");
  ui.importNote.textContent = "Let op: import overschrijft je huidige save.";
});

ui.btnCloseImport.addEventListener("click", () => closeImport());
ui.btnClearImport.addEventListener("click", () => ui.importText.value = "");

ui.btnDoImport.addEventListener("click", () => {
  const raw = ui.importText.value.trim();
  if(!raw){
    ui.importNote.textContent = "Plak eerst JSON in het veld.";
    return;
  }
  try{
    const parsed = JSON.parse(raw);
    if(!parsed.team || !Array.isArray(parsed.team.players)){
      ui.importNote.textContent = "Ongeldig bestand: team/players ontbreekt.";
      return;
    }
    // basis checks
    state = parsed;
    // backfill
    if(!state.defaults) state.defaults = { dayType:"training", trainingFocus:"conditioning" };
    if(!state.currentPlan) state.currentPlan = { ...state.defaults };
    if(!state.history) state.history = [];
    if(!state.startISO) state.startISO = new Date().toISOString().slice(0,10);
    if(typeof state.day !== "number") state.day = 0;
    if(typeof state.budget !== "number") state.budget = 250000;

    saveState();
    closeImport();
    renderAll();
    ui.daySummary.innerHTML = `Import gelukt.<div class="hr"></div><span class="muted">Je save is geladen.</span>`;
  }catch(e){
    ui.importNote.textContent = "Kon JSON niet lezen. Controleer of het valide JSON is.";
  }
});

ui.btnReset.addEventListener("click", () => {
  const ok = window.confirm("Weet je zeker dat je alles wilt resetten?");
  if(!ok) return;
  state = createInitialState();
  saveState();
  renderAll();
  ui.daySummary.textContent = "Reset uitgevoerd.";
});

function closeImport(){
  ui.importModal.classList.add("hidden");
  ui.importModal.setAttribute("aria-hidden","true");
}

/* ---------- Helpers ---------- */
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ---------- Boot ---------- */
(function init(){
  // Init plan UI op defaults als currentPlan leeg is
  if(!state.currentPlan) state.currentPlan = { ...state.defaults };
  if(!state.defaults) state.defaults = { dayType:"training", trainingFocus:"conditioning" };

  // Eerste render
  renderAll();

  // Dag-samenvatting bij start
  const iso = todayISOFromStart(state.startISO, state.day);
  ui.daySummary.innerHTML = `Je staat op Dag ${state.day} (${formatISO(iso)}).<div class="hr"></div><span class="muted">Stel dagtype in en klik op “Volgende dag”.</span>`;
})();
