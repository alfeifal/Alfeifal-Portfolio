# Training routine — source of truth

The Training module is seeded from the attached document **"RUTINA SEMANAL — AYOUB"** (7 pages).
The verbatim text extracted from the PDF is kept in `docs/training-routine-source.txt`; the
structured transcription lives in `src/server/training/routine.ts` and is what gets inserted into
the database for every new account (`seedRoutine`).

Nothing was invented, renamed or redesigned. Summary of what the document defines:

| Item | Value (from the document) |
|---|---|
| Profile | 77 kg · Recomposición · Estructura 3-1-3-1 (8 días) · Series straight · ~2.600 kcal · 155–165 g proteína |
| Cycle | 8 days, does **not** align with the calendar week: D1 Push · D2 Pull · D3 Legs+Abs · D4 Descanso · D5 Chest+Back · D6 Shoulders+Arms · D7 Legs+Abs (Arnold) · D8 Descanso |
| Intensity legend | PESADO 1–2 reps en reserva · MODERADO 2–3 · LIGERO 3+ (fallo técnico en la última serie) |
| Progression | Doble progresión: all sets at the top of the rep range → +2,5 kg (1,25 kg arms/forearm/shoulder, 5 kg press/hack). First week calibrates. |
| Rest | Compuestos pesados 2–3 min · compuestos moderados 90 s · aislamiento 60 s · antebrazo/core 45 s |
| Rest days | D4 and D8: caminata 30–45 min o movilidad 20 min. Sin pesas. |
| Exercises | 49 (7 + 8 + 7 + 7 + 10 + 10) with anatomical target, sets, reps, intensity, load range and rest, all verbatim |
| Anatomical map | Kept as `rules.anatomicalMap` on the plan and shown on `/training/routine` |

How it is used in the app:

- `/training` shows the workout for any date by mapping the date onto the 8-day cycle
  (`cycleDayIndex`). The cycle start date is editable on `/training/routine`.
- Sets are logged per exercise (weight × reps, seconds for timed holds, warm-up flag, RPE).
  Personal records (max weight, estimated 1RM via Epley, max volume set, max seconds) are
  computed from logged sets — never typed by hand.
- The routine can be modified manually (`/training/routine`) or by the assistant through the
  `modify_routine` tool, which requires confirmation. The original transcription in code is never
  changed by the app.
