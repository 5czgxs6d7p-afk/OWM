// OWM Waterpolo Manager (MVP)
// Fase 3A: Manager club + selectie (14) + opstelling (7 starters + bank) + training
// Training growth uses hidden potential. Stats + dyn state are persisted in localStorage.

const SEED_URL = "seed.json";
const PROGRESS_KEY = "owm_progress_v4"; // bump key to start clean for this phase

const TRAINING = {
  intensity: {
    LOW: { tp: 6, cost: 4 },
    NORMAL: { tp: 10, cost: 7 },
    HIGH: { tp: 14, cost: 11 }
  }
};

function clamp(min, max, v) { return Math.max(min, Math.min(max, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function overallFromAttackDefense(attack, defense) {
  return round1(0.55 * attack + 0.45 * defense);
}

function potMult(potential) {
  const map = { 1: 0.75, 2: 0.90, 3: 1.00, 4: 1.12, 5: 1.25 };
  return map[potential] ?? 1.0;
}
function capStat(potential) { return 62 + 8 * (potential ?? 3); }
function capMult(stat, potential) {
  const cap = capStat(potential);
  const d = Math.max(0, stat - cap);
  return 1 / (1 + 0.14 * d);
}
function fatigueMult(fitness) { return clamp(0.55, 1.0, (fitness ?? 92) / 100); }

function repeatMult(lastFocusStreak, newFocus) {
  if (!lastFocusStreak || lastFocusStreak.focus !== newFocus) return 1.0;
  if (lastFocusStreak.days === 1) return 0.85;
  return 0.70;
}

function injuryChance(loadSum3) {
  if (loadSum3 <= 18) return 0.0;
  if (loadSum3 <= 25) return 0.01;
  if (loadSum3 <= 33) return 0.03;
  return 0.06;
}
function injuryDurationDays(intensityKey) {
  const r = Math.random();
  if (intensityKey === "HIGH") return r < 0.30 ? 5 : r < 0.65 ? 3 : 2;
  if (intensityKey === "NORMAL") return r < 0.20 ? 4 : r < 0.60 ? 2 : 1;
  return r < 0.15 ? 3 : 1;
}

function initRuntimeState(seedPlayers, existing = {}) {
  const state = { ...existing };
  for (const p of seedPlayers) {
    if (!state[p.id]) {
      state[p.id] = {
        fitness: 92,
        form: 50,
        injuredDays: 0,
        trainingLoad3: [0, 0, 0],
        lastFocusStreak: { focus: null, days: 0 }
      };
    }
  }
  return state;
}

// Core training step; returns nextAttack/nextDefense and updated dyn
function applyTrainingDay(p, dyn, plan) {
  const d = { ...dyn };

  const attack = toNum(p.attack, 0);
  const defense = toNum(p.defense, 0);
  const potential = toNum(p.potential, 3);

  // Injury tick
  if (d.injuredDays > 0) {
    d.injuredDays -= 1;
    d.fitness = clamp(0, 100, d.fitness + 8);
    return { nextAttack: attack, nextDefense: defense, dynPatch: d, log: `Blessure: nog ${d.injuredDays} dag(en).` };
  }

  const focus = plan?.focus ?? "REST";
  const intensityKey = plan?.intensity ?? "NORMAL";
  const intensity = TRAINING.intensity[intensityKey] ?? TRAINING.intensity.NORMAL;

  const TP = intensity.tp;
  const cost = focus === "REST" ? 0 : intensity.cost;

  const rep = repeatMult(d.lastFocusStreak, focus);
  if (d.lastFocusStreak.focus === focus) d.lastFocusStreak.days += 1;
  else d.lastFocusStreak = { focus, days: 1 };

  // Fitness update
  let fitnessDelta = 6 - cost;
  if (focus === "REST") fitnessDelta = 14;
  if (focus === "CONDITIONING") fitnessDelta = 6 - cost + 4;
  d.fitness = clamp(0, 100, d.fitness + fitnessDelta);

  // Rolling 3-day load
  const newLoad3 = [...(d.trainingLoad3 || [0, 0, 0]).slice(1), cost];
  d.trainingLoad3 = newLoad3;
  const loadSum3 = newLoad3.reduce((s, x) => s + x, 0);

  // Multipliers
  const pm = potMult(potential);
  const fm = fatigueMult(d.fitness);
  const cmA = capMult(attack, potential);
  const cmD = capMult(defense, potential);

  // Gains
  let dA = 0, dD = 0;
  if (focus === "ATTACK") {
    dA = TP * 0.020 * pm * cmA * fm * rep;
    dD = TP * 0.006 * pm * cmD * fm * rep;
  } else if (focus === "DEFENSE") {
    dD = TP * 0.020 * pm * cmD * fm * rep;
    dA = TP * 0.006 * pm * cmA * fm * rep;
  } else if (focus === "BALANCED") {
    dA = TP * 0.013 * pm * cmA * fm * rep;
    dD = TP * 0.013 * pm * cmD * fm * rep;
  } else if (focus === "CONDITIONING") {
    dA = TP * 0.004 * pm * cmA * fm;
    dD = TP * 0.004 * pm * cmD * fm;
  } // REST => 0

  const nextAttack = round1(clamp(0, 100, attack + dA));
  const nextDefense = round1(clamp(0, 100, defense + dD));

  // Form
  if (focus !== "REST" && d.fitness > 60) d.form = clamp(0, 100, d.form + (intensityKey === "HIGH" ? 2 : 1));
  if (d.fitness < 50) d.form = clamp(0, 100, d.form - 1);

  // Injury roll
  if (focus !== "REST" && cost > 0) {
    const chance = injuryChance(loadSum3);
    if (Math.random() < chance) d.injuredDays = injuryDurationDays(intensityKey);
  }

  return { nextAttack, nextDefense, dynPatch: d, log: `+A ${dA.toFixed(2)} +D ${dD.toFixed(2)} (fit ${fitnessDelta >= 0 ? "+" : ""}${fitnessDelta})` };
}

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null"); }
  catch { return null; }
}
function saveProgress(p) { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); }
function el(id) { return document.getElementById(id); }

function downgradeIntensity(intKey) {
  if (intKey === "HIGH") return "NORMAL";
  if (intKey === "NORMAL") return "LOW";
  return "LOW";
}

async function main() {
  // Core UI
  const dataStatus = el("dataStatus");
  const trainFocus = el("trainFocus");
  const trainIntensity = el("trainIntensity");
  const btnNextDay = el("btnNextDay");
  const btnResetProgress = el("btnResetProgress");
  const trainSummary = el("trainSummary");
  const trainTableBody = el("trainTableBody");

  // Manager/Squad UI
  const managerClubSelect = el("managerClubSelect");
  const btnSaveManagerClub = el("btnSaveManagerClub");
  const managerClubHint = el("managerClubHint");
  const squadHint = el("squadHint");
  const squadTableBody = el("squadTableBody");

  // Lineup UI
  const lineupHint = el("lineupHint");
  const starterSelect = el("starterSelect");
  const btnAddStarter = el("btnAddStarter");
  const btnAutoLineup = el("btnAutoLineup");
  const startersTableBody = el("startersTableBody");
  const benchTableBody = el("benchTableBody");

  // Load seed
  const seedRes = await fetch(SEED_URL, { cache: "no-store" });
  if (!seedRes.ok) throw new Error(`seed.json niet gevonden (${seedRes.status}). Staat seed.json in de root?`);
  const seed = await seedRes.json();

  const clubsById = Object.fromEntries(seed.clubs.map(c => [c.id, c.name]));
  dataStatus.textContent = `Seed geladen: ${seed.clubs.length} clubs, ${seed.players.length} spelers.`;

  // Progress (includes persistent stat growth + lineup)
  let progress = loadProgress() || {
    day: 1,
    managerClubId: seed.clubs[0]?.id ?? null,
    squadPlayerIds: [],
    lineupStarterIds: [],
    dynByPlayerId: {},
    playerStatsById: {}
  };
  if (!Array.isArray(progress.squadPlayerIds)) progress.squadPlayerIds = [];
  if (!Array.isArray(progress.lineupStarterIds)) progress.lineupStarterIds = [];
  if (!progress.playerStatsById) progress.playerStatsById = {};
  if (!progress.dynByPlayerId) progress.dynByPlayerId = {};

  progress.dynByPlayerId = initRuntimeState(seed.players, progress.dynByPlayerId);

  // Apply saved stats to seed players
  for (const p of seed.players) {
    const saved = progress.playerStatsById[p.id];
    if (saved) {
      p.attack = saved.attack;
      p.defense = saved.defense;
    } else {
      p.attack = round1(toNum(p.attack, 0));
      p.defense = round1(toNum(p.defense, 0));
    }
    p.overall = overallFromAttackDefense(toNum(p.attack), toNum(p.defense));
  }

  function getSquadPlayers() {
    const set = new Set(progress.squadPlayerIds);
    return seed.players.filter(p => set.has(p.id));
  }

  function setDefaultSquadForClub(clubId) {
    const clubPlayers = seed.players
      .filter(p => p.clubId === clubId)
      .sort((a, b) => toNum(b.overall) - toNum(a.overall));
    progress.squadPlayerIds = clubPlayers.slice(0, 14).map(p => p.id);
  }

  function hasGK(starterIds) {
    const set = new Set(starterIds);
    return seed.players.some(p => set.has(p.id) && p.position === "GK");
  }

  function autoPickStarters() {
    const squad = getSquadPlayers();

    const gks = squad.filter(p => p.position === "GK").sort((a, b) => toNum(b.overall) - toNum(a.overall));
    const nonGks = squad.filter(p => p.position !== "GK").sort((a, b) => toNum(b.overall) - toNum(a.overall));

    const picked = [];
    if (gks.length > 0) picked.push(gks[0].id);

    for (const p of nonGks) {
      if (picked.length >= 7) break;
      if (!picked.includes(p.id)) picked.push(p.id);
    }

    // fallback if no GK or still short
    if (picked.length < 7) {
      const allSorted = [...squad].sort((a, b) => toNum(b.overall) - toNum(a.overall));
      for (const p of allSorted) {
        if (picked.length >= 7) break;
        if (!picked.includes(p.id)) picked.push(p.id);
      }
    }

    progress.lineupStarterIds = picked.slice(0, 7);
  }

  // Ensure defaults
  if (!progress.managerClubId) progress.managerClubId = seed.clubs[0]?.id ?? null;
  if (progress.squadPlayerIds.length === 0) setDefaultSquadForClub(progress.managerClubId);
  if (progress.lineupStarterIds.length === 0) autoPickStarters();

  saveProgress(progress);

  function renderManagerClub() {
    managerClubSelect.innerHTML = "";
    for (const c of seed.clubs) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      managerClubSelect.appendChild(opt);
    }
    managerClubSelect.value = progress.managerClubId;
    managerClubHint.textContent = `Jij managet: ${clubsById[progress.managerClubId]}`;
  }

  function renderSquadTable() {
    const clubId = progress.managerClubId;
    const clubPlayers = seed.players
      .filter(p => p.clubId === clubId)
      .sort((a, b) => toNum(b.overall) - toNum(a.overall));

    const squadSet = new Set(progress.squadPlayerIds);
    squadHint.textContent = `Selectie: ${squadSet.size}/14 (${clubsById[clubId]})`;

    squadTableBody.innerHTML = "";
    for (const p of clubPlayers) {
      const dyn = progress.dynByPlayerId[p.id];
      const isIn = squadSet.has(p.id);

      const tr = document.createElement("tr");

      const td0 = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = isIn;

      cb.addEventListener("change", () => {
        const set = new Set(progress.squadPlayerIds);
        if (cb.checked) {
          if (set.size >= 14) { cb.checked = false; alert("Selectie is vol (14)."); return; }
          set.add(p.id);
        } else {
          set.delete(p.id);
        }
        progress.squadPlayerIds = Array.from(set);

        // keep starters subset of squad
        const squadNow = new Set(progress.squadPlayerIds);
        progress.lineupStarterIds = (progress.lineupStarterIds || []).filter(id => squadNow.has(id));
        if (progress.lineupStarterIds.length === 0 && progress.squadPlayerIds.length > 0) autoPickStarters();

        saveProgress(progress);
        renderSquadTable();
        renderLineup();
        renderTrainingTable();
      });

      td0.appendChild(cb);
      tr.appendChild(td0);

      tr.insertAdjacentHTML("beforeend", `
        <td>${p.name}</td>
        <td>${p.position}</td>
        <td>${toNum(p.attack).toFixed(1)}</td>
        <td>${toNum(p.defense).toFixed(1)}</td>
        <td>${toNum(p.overall).toFixed(1)}</td>
        <td>${dyn.fitness}</td>
        <td>${dyn.form}</td>
        <td>${dyn.injuredDays > 0 ? dyn.injuredDays + "d" : "-"}</td>
      `);

      squadTableBody.appendChild(tr);
    }
  }

  function renderStarterSelect() {
    const squad = getSquadPlayers();
    const starterSet = new Set(progress.lineupStarterIds);

    starterSelect.innerHTML = "";
    const available = squad.filter(p => !starterSet.has(p.id));

    for (const p of available) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.position})`;
      starterSelect.appendChild(opt);
    }

    if (available.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Geen spelers beschikbaar";
      starterSelect.appendChild(opt);
    }
  }

  function renderLineup() {
    const squad = getSquadPlayers();
    const starterSet = new Set(progress.lineupStarterIds);

    const startersList = squad.filter(p => starterSet.has(p.id));
    const benchList = squad.filter(p => !starterSet.has(p.id));

    const starterIds = progress.lineupStarterIds;
    const countOk = starterIds.length === 7;
    const gkOk = hasGK(starterIds);

    lineupHint.textContent = `Starters: ${starterIds.length}/7 — GK: ${gkOk ? "OK" : "ONTBREEKT"}${countOk ? "" : " — (vul aan tot 7)"}`;

    startersTableBody.innerHTML = "";
    for (const p of startersList) {
      const dyn = progress.dynByPlayerId[p.id];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>✓</td>
        <td>${p.name}</td>
        <td>${p.position}</td>
        <td>${toNum(p.attack).toFixed(1)}</td>
        <td>${toNum(p.defense).toFixed(1)}</td>
        <td>${toNum(p.overall).toFixed(1)}</td>
        <td>${dyn.fitness}</td>
        <td>${dyn.form}</td>
        <td>${dyn.injuredDays > 0 ? dyn.injuredDays + "d" : "-"}</td>
        <td><button data-remove-starter="${p.id}">Verwijder</button></td>
      `;
      startersTableBody.appendChild(tr);
    }

    benchTableBody.innerHTML = "";
    for (const p of benchList) {
      const dyn = progress.dynByPlayerId[p.id];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${p.position}</td>
        <td>${toNum(p.attack).toFixed(1)}</td>
        <td>${toNum(p.defense).toFixed(1)}</td>
        <td>${toNum(p.overall).toFixed(1)}</td>
        <td>${dyn.fitness}</td>
        <td>${dyn.form}</td>
        <td>${dyn.injuredDays > 0 ? dyn.injuredDays + "d" : "-"}</td>
      `;
      benchTableBody.appendChild(tr);
    }

    startersTableBody.querySelectorAll("button[data-remove-starter]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-remove-starter");
        progress.lineupStarterIds = (progress.lineupStarterIds || []).filter(x => x !== id);
        saveProgress(progress);
        renderStarterSelect();
        renderLineup();
        renderTrainingTable();
      });
    });

    renderStarterSelect();
  }

  function renderTrainingTable() {
    const squadSet = new Set(progress.squadPlayerIds);
    trainTableBody.innerHTML = "";

    const squadPlayers = seed.players.filter(p => squadSet.has(p.id));
    for (const p of squadPlayers) {
      const dyn = progress.dynByPlayerId[p.id];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${clubsById[p.clubId] ?? p.clubId}</td>
        <td>${p.position}</td>
        <td>${toNum(p.attack).toFixed(1)}</td>
        <td>${toNum(p.defense).toFixed(1)}</td>
        <td>${toNum(p.overall).toFixed(1)}</td>
        <td>${dyn.fitness}</td>
        <td>${dyn.form}</td>
        <td>${dyn.injuredDays > 0 ? dyn.injuredDays + "d" : "-"}</td>
      `;
      trainTableBody.appendChild(tr);
    }

    const startersOk = progress.lineupStarterIds.length === 7 && hasGK(progress.lineupStarterIds);
    trainSummary.textContent = `Dag ${progress.day} — training: starters 100%, bank 50% (via intensiteit). Opstelling ${startersOk ? "OK" : "niet compleet"}.`;
  }

  // ===== Events =====
  btnSaveManagerClub.addEventListener("click", () => {
    progress.managerClubId = managerClubSelect.value || null;
    setDefaultSquadForClub(progress.managerClubId);
    progress.lineupStarterIds = [];
    autoPickStarters();
    saveProgress(progress);
    renderManagerClub();
    renderSquadTable();
    renderLineup();
    renderTrainingTable();
  });

  btnAddStarter.addEventListener("click", () => {
    const id = starterSelect.value;
    if (!id) return;

    const set = new Set(progress.lineupStarterIds);
    if (set.size >= 7) { alert("Je hebt al 7 starters."); return; }

    const squadSet = new Set(progress.squadPlayerIds);
    if (!squadSet.has(id)) { alert("Speler zit niet in je selectie."); return; }

    set.add(id);
    progress.lineupStarterIds = Array.from(set);
    saveProgress(progress);
    renderStarterSelect();
    renderLineup();
    renderTrainingTable();
  });

  btnAutoLineup.addEventListener("click", () => {
    autoPickStarters();
    saveProgress(progress);
    renderLineup();
    renderTrainingTable();
  });

  btnNextDay.addEventListener("click", () => {
    const startersOk = progress.lineupStarterIds.length === 7 && hasGK(progress.lineupStarterIds);

    const plan = { focus: trainFocus.value, intensity: trainIntensity.value };
    const squadSet = new Set(progress.squadPlayerIds);
    const starterSet = new Set(progress.lineupStarterIds);

    let last = "";

    for (const p of seed.players) {
      if (!squadSet.has(p.id)) continue;

      const dyn = progress.dynByPlayerId[p.id];

      const isStarter = starterSet.has(p.id);
      const usedPlan = isStarter
        ? plan
        : { focus: plan.focus, intensity: downgradeIntensity(plan.intensity) };

      const out = applyTrainingDay(p, dyn, usedPlan);

      p.attack = out.nextAttack;
      p.defense = out.nextDefense;
      p.overall = overallFromAttackDefense(toNum(p.attack), toNum(p.defense));

      progress.playerStatsById[p.id] = { attack: p.attack, defense: p.defense };
      progress.dynByPlayerId[p.id] = out.dynPatch;

      last = out.log;
    }

    progress.day += 1;
    saveProgress(progress);

    renderSquadTable();
    renderLineup();
    renderTrainingTable();

    trainSummary.textContent = `Dag ${progress.day - 1} verwerkt (${plan.focus}/${plan.intensity}) — starters 100%, bank 50%. ${startersOk ? "" : "Let op: opstelling niet compleet."} Laatste: ${last}`;
  });

  btnResetProgress.addEventListener("click", () => {
    if (!confirm("Voortgang resetten op dit apparaat?")) return;
    localStorage.removeItem(PROGRESS_KEY);
    location.reload();
  });

  // Initial render
  renderManagerClub();
  renderSquadTable();
  renderLineup();
  renderTrainingTable();
}

main().catch(err => {
  console.error(err);
  const s = document.getElementById("dataStatus");
  if (s) s.textContent = `Fout: ${err.message}`;
});
