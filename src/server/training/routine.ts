/**
 * SOURCE OF TRUTH: "RUTINA SEMANAL — AYOUB" (attached PDF, 7 pages).
 * This file is a faithful, structured transcription of the document. Nothing here was invented
 * or redesigned: names, anatomical targets, sets, reps, intensity, load ranges and rest periods
 * are copied verbatim (Spanish kept as written). See docs/training-routine.md for the full text.
 */

export type Intensity = "PESADO" | "MODERADO" | "LIGERO";

export interface RoutineExercise {
  name: string;
  target: string; // "PARTE ANATÓMICA" column, verbatim
  muscleGroup: string;
  sets: number;
  reps: string; // verbatim, e.g. "8–10", "12/pierna", "30–45 s"
  repsMin: number | null;
  repsMax: number | null;
  intensity: Intensity;
  load: string; // "KG" column, verbatim
  loadMin: number | null;
  loadMax: number | null;
  rest: string; // "DESC." column, verbatim
  restSeconds: number;
  bodyweight?: boolean;
  timed?: boolean;
}

export interface RoutineDay {
  index: number; // 0-based inside the 8-day cycle
  label: string; // D1..D8
  name: string;
  focus: string[];
  isRest: boolean;
  notes?: string;
  exercises: RoutineExercise[];
}

export const ROUTINE_META = {
  name: "Rutina semanal — Ayoub (3-1-3-1)",
  description: "77 kg · Recomposición · Estructura 3-1-3-1 (8 días) · Series straight · ~2.600 kcal · 155–165 g proteína",
  cycleLength: 8,
  bodyweightKg: 77,
  caloriesTarget: 2600,
  proteinTarget: "155–165 g",
  rules: {
    intensityLegend: "PESADO 1–2 reps en reserva · MODERADO 2–3 · LIGERO 3+ (fallo técnico en la última serie). Siluetas: I principal · I secundario.",
    cycle: "Ciclo de 8 días: no coincide con la semana natural, sigue el orden.",
    progression:
      "Doble progresión: cuando completes todas las series en el tope del rango de reps, sube 2,5 kg (1,25 kg en brazos/antebrazo/hombro, 5 kg en prensa/hack). Los kg son orientativos para 77 kg y un nivel intermedio: la primera semana calibra y anota.",
    progressionIncrements: { default: 2.5, armsForearmShoulder: 1.25, pressHack: 5 },
    rest: "Compuestos pesados 2–3 min · compuestos moderados 90 s · aislamiento 60 s · antebrazo/core 45 s. Con tiempo de sobra, no los acortes: el rendimiento de la siguiente serie depende de ello.",
    restDays: "DÍAS 4 Y 8 — DESCANSO: Caminata 30–45 min o movilidad 20 min. Sin pesas.",
  },
  anatomicalMap: [
    { group: "PECHO", parts: [["Clavicular (superior)", "Press inclinado · D1/D5"], ["Esternal (medio)", "Press banca / plano · D1/D5"], ["Costal (inferior)", "Fondos · cable fly alto→bajo · D1/D5"]] },
    { group: "ESPALDA", parts: [["Dorsal ancho (anchura)", "Dominadas · jalón · D2/D5"], ["Dorsal fibras bajas (grosor)", "Remo polea cerrado · pull-over · D2/D5"], ["Romboides · trapecio medio", "Remo barra · remo Smith · D2/D5"], ["Trapecio inferior", "Remo pecho apoyado · face pull · D5"], ["Trapecio superior", "Farmer's carry · D6"], ["Erectores espinales", "RDL · hiperextensiones · D3/D5"]] },
    { group: "HOMBRO", parts: [["Deltoides anterior", "Press militar · press mancuernas · D1/D6"], ["Deltoides lateral", "Elevación lateral polea/mancuerna · D1/D6"], ["Deltoides posterior", "Face pull · rear delt fly · D2/D6"], ["Manguito rotador", "Rotación externa polea · D6"]] },
    { group: "BÍCEPS", parts: [["Cabeza larga (pico)", "Curl inclinado · Bayesian · D2/D6"], ["Cabeza corta (grosor)", "Curl barra agarre ancho · D6"], ["Braquial", "Curl martillo · D2"]] },
    { group: "TRÍCEPS", parts: [["Cabeza larga", "Overhead cuerda · skullcrusher · D1/D6"], ["Cabeza lateral", "Pushdown neutro · D1"], ["Cabeza medial", "Pushdown cuerda extensión completa · D6"]] },
    { group: "ANTEBRAZO", parts: [["Flexores", "Curl de muñeca supino · D2"], ["Extensores", "Curl muñeca inverso · curl inverso EZ · D2/D6"], ["Braquiorradial", "Curl martillo · curl inverso · D2/D6"], ["Agarre", "Farmer's carry · D6"]] },
    { group: "CUÁDRICEPS", parts: [["Vasto lateral", "Prensa pies bajos · hack squat · D3/D7"], ["Vasto medial (VMO)", "Búlgara · extensión pies fuera · D7"], ["Recto femoral", "Sentadilla · extensión cuádriceps · D3/D7"], ["Vasto intermedio", "Hack squat · D7"]] },
    { group: "ISQUIOS", parts: [["Bíceps femoral", "RDL · D3"], ["Semitendinoso / semimembranoso", "Curl femoral sentado · D3"]] },
    { group: "GLÚTEO", parts: [["Glúteo mayor", "Hip thrust · sentadilla · D3/D7"], ["Glúteo medio / menor", "Abducción · búlgara · D7"]] },
    { group: "ADUCTORES", parts: [["Aductores", "Aducción máquina · D7"]] },
    { group: "GEMELO", parts: [["Gastrocnemio", "Gemelo de pie · D3"], ["Sóleo", "Gemelo sentado · D7"]] },
    { group: "ABDOMEN", parts: [["Recto superior", "Crunch polea · D3/D7"], ["Recto inferior", "Elevación piernas colgado · D3"], ["Oblicuos", "Pallof · wood-chop · D7"], ["Transverso", "Plancha · D7"]] },
  ],
} as const;

const ex = (name: string, target: string, muscleGroup: string, sets: number, reps: string, intensity: Intensity, load: string, rest: string, extra: Partial<RoutineExercise> = {}): RoutineExercise => ({
  name, target, muscleGroup, sets, reps, intensity, load, rest,
  ...parseReps(reps), ...parseLoad(load), restSeconds: parseRest(rest), ...extra,
});

function parseReps(reps: string) {
  const m = reps.replace(/\s/g, "").match(/^(\d+)(?:[–-](\d+))?/);
  if (!m) return { repsMin: null, repsMax: null };
  return { repsMin: Number(m[1]), repsMax: Number(m[2] ?? m[1]) };
}
function parseLoad(load: string) {
  const m = load.replace(/\s/g, "").match(/^(\d+(?:[.,]\d+)?)(?:[–-](\d+(?:[.,]\d+)?))?kg/);
  if (!m) return { loadMin: null, loadMax: null };
  const n = (s: string) => Number(s.replace(",", "."));
  return { loadMin: n(m[1]), loadMax: n(m[2] ?? m[1]) };
}
function parseRest(rest: string) {
  const s = rest.replace(/\s/g, "");
  const min = s.match(/^(\d+)(?:[–-](\d+))?min/);
  if (min) return Number(min[2] ?? min[1]) * 60; // use the upper bound ("no los acortes")
  const sec = s.match(/^(\d+)s/);
  return sec ? Number(sec[1]) : 60;
}

export const ROUTINE_DAYS: RoutineDay[] = [
  {
    index: 0, label: "D1", name: "Push", isRest: false,
    focus: ["Pecho medio/superior", "Deltoides anterior + lateral", "Tríceps cabeza larga", "Tríceps cabeza lateral"],
    exercises: [
      ex("Press Banca con Barra", "Pecho · porción esternal (medio)", "chest", 4, "6", "PESADO", "65–75 kg", "2–3 min"),
      ex("Press Inclinado Mancuernas 30°", "Pecho · porción clavicular (superior)", "chest", 3, "8–10", "MODERADO", "22–26 kg", "90 s"),
      ex("Fondos en paralelas (inclinado)", "Pecho · porción costal (inferior)", "chest", 3, "8–12", "MODERADO", "Corporal (+5 kg si >12)", "90 s", { bodyweight: true }),
      ex("Press Militar Barra (de pie)", "Deltoides anterior", "shoulders", 3, "6–8", "PESADO", "40–50 kg", "2 min"),
      ex("Elevación Lateral en Polea", "Deltoides lateral", "shoulders", 3, "12–15", "LIGERO", "6–8 kg", "60 s"),
      ex("Extensión Overhead con cuerda", "Tríceps · cabeza larga", "triceps", 3, "10–12", "MODERADO", "14–18 kg", "75 s"),
      ex("Pushdown unilateral (agarre neutro)", "Tríceps · cabeza lateral", "triceps", 3, "12–15", "LIGERO", "10–14 kg", "60 s"),
    ],
  },
  {
    index: 1, label: "D2", name: "Pull", isRest: false,
    focus: ["Dorsal ancho", "Trapecio medio + romboides", "Bíceps cabeza larga/corta", "Antebrazo flexores/extensores"],
    exercises: [
      ex("Dominadas (o Jalón) agarre prono", "Dorsal ancho · fibras superiores (anchura)", "back", 4, "6–8", "PESADO", "Corporal +5–10 kg", "2–3 min", { bodyweight: true }),
      ex("Remo con Barra (torso 45°)", "Dorsal medio · romboides · trapecio medio", "back", 4, "6–8", "PESADO", "60–70 kg", "2 min"),
      ex("Remo en Polea Baja (agarre cerrado)", "Dorsal · fibras inferiores (grosor)", "back", 3, "10–12", "MODERADO", "45–55 kg", "90 s"),
      ex("Face Pull en polea (cuerda)", "Deltoides posterior · trapecio medio · manguito", "shoulders", 3, "15", "LIGERO", "12–16 kg", "60 s"),
      ex("Curl Inclinado Mancuernas (banco 45°)", "Bíceps · cabeza larga (pico, en estiramiento)", "biceps", 3, "10", "MODERADO", "10–12 kg", "75 s"),
      ex("Curl Martillo Mancuernas", "Braquial · braquiorradial", "biceps", 3, "12", "MODERADO", "12–14 kg", "60 s"),
      ex("Curl de Muñeca (supino, barra)", "Antebrazo · flexores", "forearms", 3, "15", "LIGERO", "12–16 kg", "45 s"),
      ex("Curl de Muñeca Inverso (prono)", "Antebrazo · extensores", "forearms", 3, "15", "LIGERO", "8–12 kg", "45 s"),
    ],
  },
  {
    index: 2, label: "D3", name: "Legs + Abs", isRest: false,
    focus: ["Cuádriceps (vasto lateral + recto femoral)", "Isquios · bíceps femoral", "Gastrocnemio", "Recto abdominal"],
    exercises: [
      ex("Sentadilla Trasera con Barra", "Cuádriceps global + glúteo mayor", "quads", 4, "6", "PESADO", "80–95 kg", "3 min"),
      ex("Peso Muerto Rumano", "Isquios · bíceps femoral (estiramiento) · glúteo", "hamstrings", 3, "8", "PESADO", "70–85 kg", "2–3 min"),
      ex("Prensa (pies bajos y juntos)", "Cuádriceps · vasto lateral", "quads", 3, "10", "MODERADO", "120–150 kg", "2 min"),
      ex("Curl Femoral Sentado", "Isquios · semitendinoso/semimembranoso (acortado)", "hamstrings", 3, "12", "MODERADO", "35–45 kg", "90 s"),
      ex("Elevación de Gemelos de Pie", "Gastrocnemio (rodilla extendida)", "calves", 4, "15", "MODERADO", "60–80 kg", "60 s"),
      ex("Crunch en Polea (arrodillado)", "Recto abdominal · porción superior", "abs", 3, "15", "MODERADO", "16–22 kg", "60 s"),
      ex("Elevación de Piernas Colgado", "Recto abdominal · porción inferior · flexores cadera", "abs", 3, "12–15", "LIGERO", "Corporal", "60 s", { bodyweight: true }),
    ],
  },
  { index: 3, label: "D4", name: "Descanso", isRest: true, focus: [], notes: "Caminata 30–45 min o movilidad 20 min. Sin pesas.", exercises: [] },
  {
    index: 4, label: "D5", name: "Chest + Back", isRest: false,
    focus: ["Pecho superior (clavicular)", "Dorsal ancho + redondo mayor", "Trapecio inferior", "Erectores espinales"],
    exercises: [
      ex("Press Inclinado en Smith 30–45°", "Pecho · porción clavicular (superior)", "chest", 4, "6", "PESADO", "55–65 kg", "2–3 min"),
      ex("Remo en Smith (pecho apoyado o 45°)", "Dorsal medio · trapecio medio/inferior", "back", 4, "8", "PESADO", "55–65 kg", "2 min"),
      ex("Press Plano Mancuernas", "Pecho · porción esternal (medio)", "chest", 3, "8–10", "MODERADO", "24–28 kg", "90 s"),
      ex("Jalón al Pecho (agarre neutro ancho)", "Dorsal ancho · redondo mayor", "back", 3, "10–12", "MODERADO", "55–65 kg", "90 s"),
      ex("Cable Fly de alto a bajo", "Pecho · porción costal (inferior)", "chest", 3, "12–15", "LIGERO", "10–14 kg", "60 s"),
      ex("Pull-over en Polea Alta (brazos rectos)", "Dorsal · fibras inferiores · serrato", "back", 3, "12–15", "LIGERO", "20–28 kg", "60 s"),
      ex("Hiperextensiones 45° (con disco)", "Erectores espinales · lumbar", "back", 3, "12", "LIGERO", "10–20 kg", "60 s"),
    ],
  },
  {
    index: 5, label: "D6", name: "Shoulders + Arms", isRest: false,
    focus: ["Deltoides · 3 cabezas", "Bíceps + braquial", "Tríceps · 3 cabezas", "Antebrazo · braquiorradial + agarre"],
    exercises: [
      ex("Press Hombro Mancuernas (sentado)", "Deltoides anterior + lateral", "shoulders", 4, "6", "PESADO", "18–22 kg", "2 min"),
      ex("Elevación Lateral Mancuernas", "Deltoides lateral", "shoulders", 3, "15", "LIGERO", "8–10 kg", "60 s"),
      ex("Rear Delt Fly (pec-deck inverso)", "Deltoides posterior", "shoulders", 3, "12–15", "LIGERO", "25–35 kg", "60 s"),
      ex("Rotación Externa en polea", "Manguito rotador (infraespinoso)", "shoulders", 2, "15", "LIGERO", "4–6 kg", "45 s"),
      ex("Curl con Barra Recta (agarre ancho)", "Bíceps · cabeza corta", "biceps", 3, "8–10", "MODERADO", "25–32 kg", "90 s"),
      ex("Curl Bayesian en Polea", "Bíceps · cabeza larga (estiramiento)", "biceps", 3, "10–12", "MODERADO", "8–12 kg", "75 s"),
      ex("Skullcrushers Barra EZ (hacia atrás)", "Tríceps · cabeza larga", "triceps", 3, "8–10", "MODERADO", "25–35 kg", "90 s"),
      ex("Pushdown con cuerda (abrir abajo)", "Tríceps · cabeza lateral + medial", "triceps", 3, "12–15", "LIGERO", "14–18 kg", "60 s"),
      ex("Curl Inverso Barra EZ", "Braquiorradial · extensores antebrazo", "forearms", 3, "12–15", "LIGERO", "15–20 kg", "60 s"),
      ex("Farmer's Carry", "Antebrazo · agarre isométrico · trapecio superior", "forearms", 3, "30–45 s", "PESADO", "28–32 kg/mano", "90 s", { timed: true, loadMin: 28, loadMax: 32 }),
    ],
  },
  {
    index: 6, label: "D7", name: "Legs + Abs (Arnold)", isRest: false,
    focus: ["Glúteo mayor + medio", "Vasto medial (VMO) + aductores", "Sóleo", "Oblicuos + transverso"],
    exercises: [
      ex("Hack Squat (pies bajos)", "Cuádriceps · vasto lateral + intermedio", "quads", 3, "6–8", "PESADO", "80–100 kg", "2–3 min"),
      ex("Hip Thrust con Barra", "Glúteo mayor (pausa 1 s arriba)", "glutes", 3, "10", "PESADO", "80–100 kg", "2 min"),
      ex("Sentadilla Búlgara (torso vertical)", "Cuádriceps · vasto medial + glúteo", "quads", 3, "12/pierna", "MODERADO", "16–20 kg", "90 s"),
      ex("Extensión de Cuádriceps (pies rotados fuera)", "Recto femoral + vasto medial", "quads", 3, "12–15", "LIGERO", "40–55 kg", "60 s"),
      ex("Abducción en máquina / polea", "Glúteo medio + menor", "glutes", 3, "15", "LIGERO", "30–40 kg", "60 s"),
      ex("Aducción en máquina", "Aductores", "adductors", 3, "15", "LIGERO", "30–40 kg", "60 s"),
      ex("Elevación de Gemelos Sentado", "Sóleo (rodilla flexionada)", "calves", 4, "15", "MODERADO", "40–60 kg", "60 s"),
      ex("Crunch con cuerda en polea", "Recto abdominal", "abs", 3, "15", "MODERADO", "16–22 kg", "60 s"),
      ex("Press Pallof / Wood-chop en polea", "Oblicuos externos e internos (anti-rotación)", "abs", 3, "12/lado", "LIGERO", "8–12 kg", "45 s"),
      ex("Plancha con elevación de brazo", "Transverso abdominal (anti-extensión)", "abs", 3, "30–45 s", "LIGERO", "Corporal", "45 s", { bodyweight: true, timed: true }),
    ],
  },
  { index: 7, label: "D8", name: "Descanso", isRest: true, focus: [], notes: "Caminata 30–45 min o movilidad 20 min. Sin pesas.", exercises: [] },
];

export const ROUTINE_EXERCISE_COUNT = ROUTINE_DAYS.reduce((a, d) => a + d.exercises.length, 0); // 49
