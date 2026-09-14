# German module — technical audit and integration

## What was provided
`deutsch-plataforma.zip` → project `deutsch-lernen` (Vite 5 · React 18 · TypeScript · Tailwind 3 ·
Zustand 4 + idb-keyval · react-router 6 (HashRouter) · recharts 2). 2 638 lines of source.

| Area | Findings |
|---|---|
| Content | 28 units in 4 blocks (A–D), 53 concepts, ~300 vocabulary items, 265 exercises of 8 types (`mc`, `gap`, `translate`, `order`, `match`, `classify`, `reading`, `write`) in `src/content/units/block*.ts`. Structure follows *Basic German: A Grammar and Workbook* (SOURCE); explanations/exercises written for the app (AI). |
| Engine | `grade.ts` (normalisation, umlaut tolerance), `srs.ts` (spaced repetition 1→3→7→14→30→60 days), `mastery.ts` (5 levels), `exam.ts` (unit, cumulative, adaptive, mixed, mock, boss, daily, weak, retake generators), `recommend.ts` (daily plan, weak concepts, progress), `speech.ts` (Web Speech API). |
| Pages | Dashboard, Course, Lesson (learn/understand/practice/review/test/mastery tabs, unlock at 70 %), Grammar (+concept pages), Vocab, Review, Errors, Practice, Challenges (+Daily), Stats, Tutor, Conversation, Search, Settings, More. |
| Persistence | Zustand `persist` → IndexedDB (`deutsch-progress`). `storage.ts` is explicitly the adapter to swap for a backend. Export/import JSON in Settings. |
| AI Tutor | Called `api.anthropic.com` **directly from the browser** with a user-pasted API key stored in IndexedDB (`anthropic-dangerous-direct-browser-access`). |
| Conflicts with Personal OS | Global Tailwind classes (`.card`, `.btn`, `.field`, `.muted`, `.tab`…), `@/` alias, HashRouter, `document.documentElement.classList.toggle('dark')`, its own sidebar/bottom navigation, recharts 2 vs 3 typing, browser-held API key. |

## Integration (all functionality preserved)
The project was copied to `src/modules/german/` unchanged except for the points below.

| Change | Why | Where |
|---|---|---|
| Import alias `@/` → `@german/` | The OS uses `@/` for `src/` | all module files (mechanical rewrite) |
| `storage.ts` → server-backed adapter | Progress is stored in PostgreSQL per user (`german_progress`), follows the user across devices and is included in backups/export. IndexedDB remains a local cache/offline fallback. Writes are debounced and revision-tagged. | `store/storage.ts`, `/api/german/state` |
| Tutor via `/api/german/tutor` | The Anthropic key must never reach the browser (spec §4). Same prompts, same behaviour; `askTutor` signature kept. Settings no longer asks for a key. | `tutor/client.ts`, `ui/pages/Settings.tsx`, `ui/pages/Tutor.tsx`, `ExerciseRunner.tsx` |
| `Layout.tsx` renders a tab strip instead of its own sidebar/bottom nav; no `dark` toggling | It lives inside the OS shell; dark mode follows the OS theme | `ui/components/Layout.tsx` |
| `HashRouter` → `BrowserRouter basename="/german"` | Deep links from the OS (`/german/curso/u12`) and search results work | `ui/App.tsx`, `app/(app)/german/[[...slug]]/page.tsx` |
| Styles scoped under `.german-app` | Original look preserved without leaking `.card`/`.btn` into the OS | `app/globals.css`, `tailwind.config.ts` (palette merged) |
| `bridge.ts` + 3 store hooks | Learning events (session time, unit tests, exams, daily challenge) are posted to `/api/german/events` | `store/index.ts` (`addTime`, `recordTest`, `addResult`) |
| recharts formatter typing | recharts 3 types | `ui/pages/Stats.tsx` (one line) |

Everything else — lessons, exercises, grading, SRS, mastery, exams (cumulative, adaptive, Mixed,
Mock, Boss, generator), Daily Challenge, errors log, bookmarks, achievements, XP/streak, speech,
export/import — is the original code.

## Connections to the OS
`recordGermanEvent` (server) turns a session event into a **study session** for the `German`
subject (slug `german`), adds the minutes to any active **goal** with category `german` and unit
`min`, and feeds **Analytics** and the **weekly/daily reviews**. The assistant answers "How much
German did I study this week?", "What lesson should I do next?" through `get_german_progress`,
and "Test me" by pointing at the module's exam modes.
