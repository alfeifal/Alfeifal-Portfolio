# Deutsch — plataforma de alemán (localhost)

Curso interactivo basado en la estructura de *Basic German: A Grammar and Workbook* (Schenke & Seago, Routledge 2004): 28 unidades, 53 conceptos, ~300 palabras con artículo y plural, ~265 ejercicios de 8 tipos, tests de unidad con desbloqueo progresivo, repaso espaciado, exámenes (acumulativo, adaptativo, Mixed, Mock, Boss, generador), Daily Challenge, estadísticas y AI Tutor.

## Arrancar

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` genera `dist/` (estático; se puede servir con cualquier servidor o abrir con `npm run preview`).

## Estructura

```
src/content/        contenido: types, helpers, units/blockA-D.ts (unidades, conceptos, vocab, ejercicios)
src/engine/         grade (corrección), srs (repaso espaciado), mastery (niveles), exam (generador), recommend (plan de hoy)
src/store/          Zustand + IndexedDB (idb-keyval). storage.ts es el adaptador a cambiar para usar un backend
src/tutor/          cliente de la API de Anthropic (API key local) para tutor, conversación y corrección de escritura
src/ui/             App (HashRouter), Layout, componentes (ExerciseRunner, Session, Markdown) y páginas
```

## Cómo ampliar contenido

Añade ejercicios en `src/content/units/blockX.ts` con los helpers `mc`, `gap`, `tr`, `order`, `match`, `classify`, `reading`, `write`. Cada ejercicio lleva unidad, conceptos, dificultad (1–4) y explicación. Los conceptos nuevos se declaran en el array `concepts` del bloque y se referencian desde `Unit.concepts`.

## SOURCE vs AI

Del libro se toma la estructura, los conceptos y los tipos de ejercicio (SOURCE, con página). Explicaciones, ejemplos, ejercicios y vocabulario están escritos para esta app (AI), basados en cada unidad. No se reproduce texto del libro.

## AI Tutor

Ajustes → pega tu API key de Anthropic. Se guarda solo en el navegador (IndexedDB) y las peticiones van directamente a `api.anthropic.com` desde tu dispositivo. Sin key, todo lo demás funciona igual.

## Exportar / importar

Ajustes → «Exportar progreso» descarga un JSON con todo el estado; «Importar» lo restaura (sirve para migrar a un backend más adelante: el estado ya es serializable).
