// OWM Waterpolo Manager (MVP)
// Training + growth engine (no age, only potential)
// Stores progress in localStorage

const SEED_URL = "seed.json";
const PROGRESS_KEY = "owm_progress_v1";

const TRAINING = {
  intensity: {
    LOW:    { tp: 6,  cost: 4 },
    NORMAL: { tp: 10, cost: 7 },
    HIGH:   { tp: 14, cost: 11 }
  }
};

function clamp(min, max, v) {
  return Math.max(min, Math.min(max, v));
}

function overallFromAttackDefense(attack, defense) {
  return Math.round((0.55 * attack + 0.45 * defense) * 10) / 10;
}

function potMult(potential) {
  const map = { 1: 0.75, 2: 0.90, 3: 1.00, 4: 1.12, 5: 1.25 };
  return map[potential] ?? 1.0;
}

function capStat(potential) {
  return 62 + 8 * (potential ?? 3); // pot1=70 ... pot5=100
}

function capMult(stat, potential) {
  const cap = capStat(potential);
  const d = Math.max(0, stat - cap);
  return 1 / (1 + 0.14 * d);
}

function fatigueMult(fitness) {
  return clamp(0.55, 1.0, (fitness ?? 92) / 100);
}

function repeatMult(lastFocusStreak, newFocus) {
  if (!lastFocusStreak || lastFocusStreak.focus !== newFocus) return 1.0;
  if (lastFocusStreak.days === 1) return 0.85;
  if (lastFocusStreak.days >= 2) return 0.70;
  return 1.0;
}

function injuryChance(loadSum3) {
  if (loadSum3 <= 18) return 0.00;
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

function applyTrainingDay(player, dyn, plan) {
  const log = [];
  const p = player; // mutate ok in MVP
  const d = { ...dyn };

  // injury tick
  if (d.injuredDays > 0) {
    d.injuredDays -= 1;
    d.fitness = clamp(0, 100, d.fitness + 8);
    return { playerPatch: {}, dynPatch: d, log: [`Blessure: nog ${d.injuredDays} dag(en). Fitness +8.`] };
  }

  const focus = plan?.focus ?? "REST";
  const intensityKey = plan?.intensity ?? "NORMAL";
  const intensity = TRAINING.intensity[intensityKey] ?? TRAINING.intensity.NORMAL;

  const TP = intensity.tp;
  const cost = focus === "REST" ? 0 : intensity.cost;

  const rep = repeatMult(d.lastFocusStreak, focus);
  if (d.lastFocusStreak.focus === focus) d.lastFocusStreak.days += 1;
  else d.lastFocusStreak = { focus, days: 1 };

  // fitness
  let fitnessDelta = 6 - cost;      // baseline +6
  if (focus === "REST") fitnessDelta = 14;          // 6 + 8
  if (focus === "CONDITIONING") fitnessDelta = 6 - cost + 4;
  d.fitness = clamp(0, 100, d.fitness + fitnessDelta);

  // rolling 3-day load
  const newLoad3 = [...(d.trainingLoad3 || [0,0,0]).slice(1), cost];
  d.trainingLoad3 = newLoad3;
  const loadSum3 = newLoad3.reduce((s, x) => s + x, 0);

  // multipliers
  const pm = potMult(p.potential);
  const fm = fatigueMult(d.fitness);
  const cmA = capMult(p.attack ?? 0, p.potential);
  const cmD = capMult(p.defense ?? 0, p.potential);

  // gains
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
  }

  const newAttack = clamp(0, 100, (p.attack ?? 0) + dA);
  const newDefense = clamp(0, 100, (p.defense ?? 0) + dD);

  const playerPatch = {
    attack: Math.round(newAttack),
    defense: Math.round(newDefense),
    overall: overallFromAttackDefense(Math.round(newAttack), Math.round(newDefense))
  };

  // form
  if (focus !== "REST" && d.fitness > 60) d.form = clamp(0, 100, d.form + (intensityKey === "HIGH" ? 2 : 1));
  if (d.fitness < 50) d.form = clamp(0, 100, d.form - 1);

  // injury roll
  if (focus !== "REST" && cost > 0) {
    const chance = injuryChance(loadSum3);
    if (Math.random() < chance) {
      d.injuredDays = injuryDurationDays(intensityKey);
    }
  }

  log.push(`Training ${focus}/${intensityKey}: +A ${dA.toFixed(2)} +D ${dD.toFixed(2)} fitness ${fitnessDelta >= 0 ? "+" : ""}${fitnessDelta}`);
  return { playerPatch, dynPatch: d, log };
}

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null"); }
  catch { return null; }
}
function saveProgress(p) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
}

function el(id) { return document.getElementById(id); }

async function main() {
  const dataStatus = el("dataStatus");
  const trainFocus = el("trainFocus");
  const trainIntensity = el("trainIntensity");
  const btnNextDay = el("btnNextDay");
  const btnResetProgress = el("btnResetProgress");
  const trainSummary = el("trainSummary");
  const trainTableBody = el("trainTableBody");

  // Load seed
  const seedRes = await fetch(SEED_URL, { cache: "no-store" });
  const seed = await seedRes.json();

  const clubsById = Object.fromEntries(seed.clubs.map(c => [c.id, c.name]));
  dataStatus.textContent = `Seed geladen: ${seed.clubs.length} clubs, ${seed.players.length} spelers.`;

  // ===== Manager club UI =====
const managerClubSelect = el("managerClubSelect");
const btnSaveManagerClub = el("btnSaveManagerClub");
const managerClubHint = el("managerClubHint");

function renderManagerClub() {
  managerClubSelect.innerHTML = "";
  for (const c of seed.clubs) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    managerClubSelect.appendChild(opt);
  }

  if (!progress.managerClubId) {
    progress.managerClubId = seed.clubs[0]?.id ?? null;
  }
  managerClubSelect.value = progress.managerClubId;

  managerClubHint.textContent = progress.managerClubId
    ? `Jij managet: ${clubsById[progress.managerClubId]}`
    : "Kies een club.";
}

btnSaveManagerClub.addEventListener("click", () => {
  progress.managerClubId = managerClubSelect.value || null;

  const clubPlayers = seed.players.filter(p => p.clubId === progress.managerClubId);
  clubPlayers.sort((a,b) =>
    (b.overall ?? overallFromAttackDefense(b.attack,b.defense)) -
    (a.overall ?? overallFromAttackDefense(a.attack,a.defense))
  );

  progress.squadPlayerIds = clubPlayers.slice(0, 14).map(p => p.id);
  saveProgress(progress);
  renderManagerClub();
  renderSquadTable();
});

  // Progress
  let progress = loadProgress() || { day: 1, dynByPlayerId: {} };
  progress.dynByPlayerId = initRuntimeState(seed.players, progress.dynByPlayerId);
  saveProgress(progress);

  function renderTrainingTable() {
    trainTableBody.innerHTML = "";
    for (const p of seed.players) {
      const dyn = progress.dynByPlayerId[p.id];
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${clubsById[p.clubId] ?? p.clubId}</td>
        <td>${p.position}</td>
        <td>${p.attack}</td>
        <td>${p.defense}</td>
        <td>${p.overall ?? overallFromAttackDefense(p.attack, p.defense)}</td>
        <td>${dyn.fitness}</td>
        <td>${dyn.form}</td>
        <td>${dyn.injuredDays > 0 ? dyn.injuredDays + "d" : "-"}</td>
      `;
      trainTableBody.appendChild(tr);
    }
    trainSummary.textContent = `Dag ${progress.day} — kies focus/intensiteit en klik “Volgende dag”.`;
  }

  btnNextDay.addEventListener("click", () => {
    const plan = { focus: trainFocus.value, intensity: trainIntensity.value };
    let lastLog = "OK";

    for (const p of seed.players) {
      const dyn = progress.dynByPlayerId[p.id];
      const out = applyTrainingDay(p, dyn, plan);

      // apply patch
      if (out.playerPatch.attack != null) p.attack = out.playerPatch.attack;
      if (out.playerPatch.defense != null) p.defense = out.playerPatch.defense;
      if (out.playerPatch.overall != null) p.overall = out.playerPatch.overall;

      progress.dynByPlayerId[p.id] = out.dynPatch;
      if (out.log && out.log.length) lastLog = out.log[out.log.length - 1];
    }

    progress.day += 1;
    saveProgress(progress);
    renderTrainingTable();
    trainSummary.textContent = `Dag ${progress.day - 1} verwerkt (${plan.focus}/${plan.intensity}). Laatste: ${lastLog}`;
  });

  btnResetProgress.addEventListener("click", () => {
    if (!confirm("Voortgang resetten op dit apparaat?")) return;
    localStorage.removeItem(PROGRESS_KEY);
    progress = { day: 1, dynByPlayerId: initRuntimeState(seed.players, {}) };
    saveProgress(progress);
    renderTrainingTable();
  });

  renderManagerClub();
renderSquadTable();
renderTrainingTable();
  
}

main().catch(err => {
  console.error(err);
  const s = document.getElementById("dataStatus");
  if (s) s.textContent = "Fout bij laden. Controleer of seed.json in de root staat.";
});
