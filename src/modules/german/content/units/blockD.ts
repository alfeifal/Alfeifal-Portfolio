import type { Unit, Concept, VocabItem, Exercise } from '../types'
import { v, mc, gap, tr, order, match, classify, reading, write } from '../helpers'

export const units: Unit[] = [
{ id: 'u25', number: 25, block: 'D', title: 'Declinación del adjetivo', titleDe: 'Adjektivdeklination', cefr: 'A2+', page: 143,
  objectives: ['Saber cuándo el adjetivo lleva terminación', 'Terminaciones tras der/die/das', 'Terminaciones tras ein/kein/posesivos y sin artículo'],
  concepts: ['adjektivdeklination'],
  learn: [
    { title: 'Cuándo hay terminación', body: 'El adjetivo **detrás** del sustantivo (con *sein*) no cambia: *Das Auto ist neu.* El adjetivo **delante** del sustantivo lleva terminación según género, caso y qué artículo lo precede: *das neu**e** Auto, ein neu**es** Auto.*' },
    { title: 'Tras artículo definido (der/die/das, dieser, jeder)', body: 'Solo dos terminaciones: **-e** o **-en**.\n\n| | masc. | fem. | neutro | plural |\n| Nom. | der alt**e** Mann | die alt**e** Frau | das alt**e** Haus | die alt**en** Männer |\n| Acu. | den alt**en** Mann | die alt**e** Frau | das alt**e** Haus | die alt**en** Männer |\n| Dat. | dem alt**en** Mann | der alt**en** Frau | dem alt**en** Haus | den alt**en** Männern |\n| Gen. | des alt**en** Mannes | der alt**en** Frau | des alt**en** Hauses | der alt**en** Männer |\n\n-e solo en nom. singular (los tres) y acu. fem./neutro. Todo lo demás: -en.' },
    { title: 'Tras ein / kein / posesivos', body: 'Como *ein* no muestra el género en masc. y neutro nominativo, el adjetivo lo hace:\n\n| | masc. | fem. | neutro | plural (kein-/mein-) |\n| Nom. | ein alt**er** Mann | eine alt**e** Frau | ein alt**es** Haus | meine alt**en** Freunde |\n| Acu. | einen alt**en** Mann | eine alt**e** Frau | ein alt**es** Haus | meine alt**en** Freunde |\n| Dat. | einem alt**en** Mann | einer alt**en** Frau | einem alt**en** Haus | meinen alt**en** Freunden |\n\nDiferencias con la tabla anterior: nom. masc. **-er** y nom./acu. neutro **-es**.' },
    { title: 'Sin artículo', body: 'El adjetivo toma la terminación que tendría el artículo definido:\n\n| | masc. | fem. | neutro | plural |\n| Nom. | gut**er** Wein | gut**e** Milch | gut**es** Bier | gut**e** Freunde |\n| Acu. | gut**en** Wein | gut**e** Milch | gut**es** Bier | gut**e** Freunde |\n| Dat. | gut**em** Wein | gut**er** Milch | gut**em** Bier | gut**en** Freunden |\n\n*Ich trinke gern kalt**es** Bier. Mit freundlich**en** Grüßen.*\n\nComparativos y superlativos siguen las mismas reglas: *ein besser**es** Angebot, der schnell**ste** Zug.*' }
  ],
  understand: [
    { title: 'Estrategia', body: 'No memorices tres tablas de golpe. Aprende primero la regla de oro: **tras der/die/das → -e en nominativo, -en en casi todo lo demás**. Luego añade las tres excepciones de *ein*: *ein guter Mann, ein gutes Kind, ein gutes Bier*. Con eso resuelves el 90 % de los casos del nivel A2.' }
  ],
  bookExercises: ['Terminaciones tras indefinido/posesivo (25.1)', 'Expresiones frecuentes (25.2)', 'Terminaciones mixtas (25.3)', 'Traducción (25.4)']
},
{ id: 'u26', number: 26, block: 'D', title: 'Números y fechas', titleDe: 'Zahlen und Daten', cefr: 'A1', page: 151,
  objectives: ['Formar los números (unidad + und + decena)', 'Usar ordinales y fechas', 'Decir años'],
  concepts: ['zahlen', 'ordinalzahlen-daten'],
  learn: [
    { title: 'Cardinales', body: '| 0 null | 10 zehn | 20 zwanzig |\n| 1 eins | 11 elf | 30 dreißig |\n| 2 zwei | 12 zwölf | 40 vierzig |\n| 3 drei | 13 dreizehn | 50 fünfzig |\n| 4 vier | 14 vierzehn | 60 sechzig |\n| 5 fünf | 15 fünfzehn | 70 siebzig |\n| 6 sechs | 16 sechzehn | 80 achtzig |\n| 7 sieben | 17 siebzehn | 90 neunzig |\n| 8 acht | 18 achtzehn | 100 (ein)hundert |\n| 9 neun | 19 neunzehn | 1000 (ein)tausend |\n\nA partir de 21 se dice **unidad + und + decena**, todo junto: *einundzwanzig* (21), *fünfunddreißig* (35), *zweihundertvierundsechzig* (264). Fíjate: *sechzehn, sechzig, siebzehn, siebzig* pierden letras; *dreißig* lleva ß.' },
    { title: 'Ordinales y fechas', body: 'Ordinales: **-te** del 1 al 19 (*der zweite, der vierte, der zehnte*; irregulares *der erste, der dritte, der siebte*), **-ste** a partir del 20 (*der zwanzigste, der einunddreißigste*). Llevan terminación de adjetivo.\n\nFecha: *Heute ist **der** 3. Mai (der dritte Mai).* Cuando algo ocurre en una fecha: **am** + dativo → *am dritt**en** Mai, am ersten Januar*. Preguntar: *Der Wievielte ist heute? / Den Wievielten haben wir heute?*' },
    { title: 'Años', body: 'Hasta 1999: en centenas: *1985 = neunzehnhundertfünfundachtzig*. Desde 2000: *zweitausendsechs* (2006), *zweitausendsechsundzwanzig* (2026). Se dice **im Jahr 2026** o simplemente **2026**, nunca *in 2026*.' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'Lo raro es el orden invertido: en español «veintiuno», en alemán «uno-y-veinte». Léelo de derecha a izquierda dentro de cada centena. Y en fechas y años se usa *am* / *im Jahr* como en español «el 3 de mayo» / «en el año».' }
  ],
  bookExercises: ['Escribir números (26.1)', 'Ordinales y festivos (26.2)', 'Fechas de nacimiento (26.3)', 'Traducción (26.4)']
},
{ id: 'u27', number: 27, block: 'D', title: 'Conjunciones y subordinadas', titleDe: 'Konjunktionen und Nebensätze', cefr: 'A2+', page: 158,
  objectives: ['Usar las coordinantes und, aber, oder, denn, sondern', 'Usar subordinantes con el verbo al final', 'Distinguir wenn/als y denn/weil'],
  concepts: ['konjunktionen-koordinierend', 'nebensaetze', 'wenn-als-weil-denn'],
  learn: [
    { title: 'Coordinantes: no cambian el orden', body: '**und, aber, oder, denn, sondern** unen dos frases principales; el verbo sigue en 2ª posición en las dos:\n\n- *Ich lerne Deutsch, **denn** ich möchte in Deutschland arbeiten.*\n- *Er kommt nicht, **aber** sie kommt.*\n- *Ich trinke nicht Kaffee, **sondern** Tee.* (sondern = sino, tras negación)\n\nSi el sujeto es el mismo puede omitirse en la segunda: *Ich stehe auf und (ich) dusche mich.*' },
    { title: 'Subordinantes: el verbo al final', body: 'Con estas conjunciones el **verbo conjugado va al final** de la subordinada, separada por coma:\n\n| dass | que |\n| weil | porque |\n| obwohl | aunque |\n| wenn | si / cuando (habitual, futuro) |\n| als | cuando (una vez, pasado) |\n| ob | si (interrogativo indirecto) |\n| bevor / nachdem | antes de que / después de que |\n| damit | para que |\n\n- *Ich weiß, **dass** er in Berlin **wohnt**.*\n- *Sie kommt nicht, **weil** sie krank **ist**.*\n- *Ich fahre nach Hause, **obwohl** ich müde **bin**.*\n\nCon dos verbos (modal, Perfekt, separable): el conjugado al final de todo: *…, weil ich arbeiten **muss**. …, dass er Pizza gegessen **hat**. …, wenn er **aufsteht** (separable se junta).*\n\nSi la subordinada va **primero**, la principal empieza por el verbo: ***Weil** ich krank bin, **bleibe** ich zu Hause.*' },
    { title: 'Pares que se confunden', body: '- **wenn** vs **als**: *als* = un hecho único en el pasado (*Als ich 10 war…*); *wenn* = presente/futuro o repetido (*Wenn ich Zeit habe…*, *Immer wenn…*).\n- **denn** vs **weil**: los dos = porque. *denn* es coordinante (verbo en 2ª posición); *weil* es subordinante (verbo al final).' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'Las conjunciones significan lo mismo que en español; lo nuevo es la **gimnasia del verbo**: cada vez que uses *dass, weil, wenn, obwohl, ob*, manda el verbo al final. Empieza a construir la subordinada por el final: «…krank ist» ← «weil sie».' }
  ],
  bookExercises: ['Unir con coordinantes (27.1)', 'Completar con dass/weil/obwohl/wenn/als (27.2)', 'Unir frases cambiando el orden (27.3)', 'Traducción (27.4)']
},
{ id: 'u28', number: 28, block: 'D', title: 'Orden de palabras', titleDe: 'Wortstellung', cefr: 'A2+', page: 167,
  objectives: ['Aplicar la regla del verbo en 2ª posición', 'Hacer la inversión sujeto-verbo', 'Ordenar complementos: Tiempo–Modo–Lugar'],
  concepts: ['wortstellung', 'temp-modo-lugar'],
  learn: [
    { title: 'El verbo en segunda posición', body: 'En una frase enunciativa, el verbo conjugado ocupa **siempre** la 2ª posición. La 1ª puede ser el sujeto o cualquier otro elemento (tiempo, lugar, objeto); entonces el sujeto pasa detrás del verbo (**inversión**):\n\n- *Ich fahre morgen nach Berlin.*\n- ***Morgen** fahre ich nach Berlin.*\n- ***Nach Berlin** fahre ich morgen.*\n\n«Segunda posición» = segundo **elemento**, no segunda palabra: *Meine ganze Familie* **kommt** *morgen.*' },
    { title: 'El segundo verbo al final', body: 'Cuando hay dos verbos (modal, Perfekt, futuro, separable), el conjugado va en 2ª posición y el otro (infinitivo, participio, prefijo) al **final**, formando un «paréntesis verbal»:\n\n- *Ich **muss** morgen früh **aufstehen**.*\n- *Wir **haben** gestern lange **gearbeitet**.*\n- *Sie **ruft** mich heute Abend **an**.*\n\nPreguntas sí/no e imperativo: verbo en 1ª posición. Subordinadas: verbo al final (Unidad 27).' },
    { title: 'Tiempo – Modo – Lugar', body: 'Cuando hay varios complementos en el medio de la frase, el orden habitual es **Tiempo → Modo (cómo) → Lugar**:\n\n- *Ich fahre **morgen** (T) **mit dem Zug** (M) **nach Berlin** (L).*\n- *Sie geht **jeden Tag** **zu Fuß** **zur Arbeit**.*\n\nObjetos: el dativo (persona) suele ir antes que el acusativo (cosa): *Ich gebe **meinem Bruder** **das Buch**.* Si el acusativo es pronombre, va primero: *Ich gebe **es** ihm.*\n\n*nicht* va delante de lo que niega o al final.' }
  ],
  understand: [
    { title: 'Lo que más cuesta desde el español', body: 'El español permite «Mañana yo voy…»; el alemán no: «Morgen **fahre ich**». Piensa: **algo – VERBO – sujeto (si no iba primero) – resto – verbo 2**. Y el orden T-M-L es casi el inverso al español («Voy a Berlín en tren mañana»).' }
  ],
  bookExercises: ['Empezar la frase por otro elemento (28.1)', 'Colocar complementos según T-M-L (28.2)', 'Ordenar palabras (28.3)', 'Traducción (28.4)']
}]

export const concepts: Concept[] = [
  { id: 'adjektivdeklination', name: 'Adjektivdeklination', nameEs: 'Terminaciones del adjetivo', unitId: 'u25', summary: 'Tras der: -e/-en. Tras ein: -er (m), -es (n), -e (f), -en (resto). Sin artículo: como der/die/das.', mistakes: ['*ein alter Haus* (→ altes)', '*der alten Mann* en nominativo (→ alte)', '*mit dem neue Auto* (→ neuen)'], related: ['akkusativ', 'dativ', 'komparativ'] },
  { id: 'zahlen', name: 'Zahlen', nameEs: 'Números', unitId: 'u26', summary: 'Unidad + und + decena, todo junto: einundzwanzig.', mistakes: ['*zwanzigeins*', '*sechszig* (→ sechzig)', '*dreissig* (→ dreißig)'], related: ['ordinalzahlen-daten'] },
  { id: 'ordinalzahlen-daten', name: 'Ordinalzahlen & Datum', nameEs: 'Ordinales y fechas', unitId: 'u26', summary: '-te (1–19), -ste (20+); der erste, der dritte, der siebte. am + dativo: am dritten Mai.', mistakes: ['*am dritte Mai* (→ dritten)', '*in 2026* (→ 2026 / im Jahr 2026)', '*der dreite* (→ dritte)'], related: ['zahlen', 'adjektivdeklination'] },
  { id: 'konjunktionen-koordinierend', name: 'Koordinierende Konjunktionen', nameEs: 'Conjunciones coordinantes', unitId: 'u27', summary: 'und, aber, oder, denn, sondern: verbo en 2ª posición.', mistakes: ['*aber* por *sondern* tras negación', 'Mandar el verbo al final tras denn'], related: ['nebensaetze'] },
  { id: 'nebensaetze', name: 'Nebensätze', nameEs: 'Subordinadas: verbo al final', unitId: 'u27', summary: 'dass, weil, obwohl, wenn, als, ob, bevor, nachdem, damit → verbo conjugado al final.', mistakes: ['*weil ich bin müde* (→ weil ich müde bin)', '*dass er hat gegessen* (→ gegessen hat)', 'Olvidar la coma', 'No invertir tras subordinada inicial'], related: ['wortstellung', 'wenn-als-weil-denn'] },
  { id: 'wenn-als-weil-denn', name: 'wenn/als, weil/denn', nameEs: 'wenn vs als, weil vs denn', unitId: 'u27', summary: 'als = una vez en el pasado; wenn = habitual/futuro. weil manda el verbo al final; denn no.', mistakes: ['*Wenn ich Kind war* (→ Als)', '*denn ich müde bin* (→ denn ich bin müde)'], related: ['nebensaetze'] },
  { id: 'wortstellung', name: 'Wortstellung', nameEs: 'Orden de palabras: verbo en 2ª posición', unitId: 'u28', summary: 'Verbo conjugado en 2ª posición; inversión si otro elemento va primero; segundo verbo al final.', mistakes: ['*Morgen ich fahre* (→ Morgen fahre ich)', '*Heute ich habe gearbeitet* (→ Heute habe ich gearbeitet)'], related: ['temp-modo-lugar', 'nebensaetze', 'modalverben-satzbau'] },
  { id: 'temp-modo-lugar', name: 'Zeit – Art – Ort', nameEs: 'Orden Tiempo–Modo–Lugar', unitId: 'u28', summary: 'Complementos en el orden tiempo, modo, lugar; dativo antes que acusativo.', mistakes: ['*Ich fahre nach Berlin morgen* (→ morgen nach Berlin)', '*Ich gebe das Buch meinem Bruder* (aceptable pero menos natural)'], related: ['wortstellung'] },
]

export const vocab: VocabItem[] = [
  v('u25','A2','adjetivos','','freundlich','','amable','Mit freundlichen Grüßen','Atentamente (fórmula de despedida)','adj'),
  v('u25','A2','adjetivos','','kalt','','frío','Ich trinke gern kaltes Bier.','Me gusta la cerveza fría.','adj'),
  v('u25','A2','adjetivos','','warm','','caliente / cálido','Ein warmer Tag.','Un día cálido.','adj'),
  v('u25','A2','adjetivos','','schwarz','','negro','Ein schwarzer Kaffee, bitte.','Un café solo, por favor.','adj'),
  v('u25','A2','adjetivos','','rot','','rojo','Das rote Auto ist schnell.','El coche rojo es rápido.','adj'),
  v('u25','A2','adjetivos','','wichtig','','importante','Eine wichtige Frage.','Una pregunta importante.','adj'),
  v('u25','A2','adjetivos','','richtig','','correcto','Die richtige Antwort.','La respuesta correcta.','adj'),
  v('u25','A2','adjetivos','','falsch','','incorrecto / falso','Ein falscher Name.','Un nombre falso.','adj'),
  v('u25','A2','comida','der','Wein','Weine','vino','Ein guter Wein.','Un buen vino.'),
  v('u25','A2','comida','das','Bier','Biere','cerveza','Ein kaltes Bier.','Una cerveza fría.'),
  v('u25','A2','comida','die','Milch','','leche','Frische Milch.','Leche fresca.'),
  v('u25','A2','básico','die','Frage','Fragen','pregunta','Ich habe eine wichtige Frage.','Tengo una pregunta importante.'),
  v('u25','A2','básico','die','Antwort','Antworten','respuesta','Die richtige Antwort ist B.','La respuesta correcta es B.'),
  v('u26','A1','números','','eins','','uno','Nummer eins.','Número uno.','num'),
  v('u26','A1','números','','zwanzig','','veinte','Ich bin zwanzig.','Tengo veinte.','num'),
  v('u26','A1','números','','einundzwanzig','','veintiuno','Er ist einundzwanzig Jahre alt.','Él tiene veintiún años.','num'),
  v('u26','A1','números','','dreißig','','treinta','dreißig Euro','treinta euros','num'),
  v('u26','A1','números','','hundert','','cien','hundert Prozent','cien por cien','num'),
  v('u26','A1','números','','tausend','','mil','zweitausend','dos mil','num'),
  v('u26','A1','fechas','','der erste','','el primero','Heute ist der erste Mai.','Hoy es uno de mayo.','other'),
  v('u26','A1','fechas','','der dritte','','el tercero','Am dritten Oktober.','El tres de octubre.','other'),
  v('u26','A1','fechas','der','Januar','','enero','Im Januar ist es kalt.','En enero hace frío.'),
  v('u26','A1','fechas','der','Mai','','mayo','Am 1. Mai.','El 1 de mayo.'),
  v('u26','A1','fechas','der','Geburtstag','Geburtstage','cumpleaños','Wann hast du Geburtstag?','¿Cuándo es tu cumpleaños?'),
  v('u26','A1','fechas','das','Jahr','Jahre','año','Im Jahr 2026.','En el año 2026.'),
  v('u26','A1','fechas','der','Monat','Monate','mes','Dieser Monat ist kurz.','Este mes es corto.'),
  v('u27','A2','conjunciones','','dass','','que','Ich weiß, dass er kommt.','Sé que viene.','conj'),
  v('u27','A2','conjunciones','','weil','','porque (verbo al final)','Ich bleibe, weil ich müde bin.','Me quedo porque estoy cansado.','conj'),
  v('u27','A2','conjunciones','','denn','','porque (verbo en 2ª pos.)','Ich bleibe, denn ich bin müde.','Me quedo, porque estoy cansado.','conj'),
  v('u27','A2','conjunciones','','obwohl','','aunque','Er arbeitet, obwohl er krank ist.','Trabaja aunque está enfermo.','conj'),
  v('u27','A2','conjunciones','','wenn','','si / cuando (habitual)','Wenn ich Zeit habe, lerne ich.','Cuando tengo tiempo, estudio.','conj'),
  v('u27','A2','conjunciones','','als','','cuando (pasado, una vez)','Als ich 10 war, wohnte ich in Marokko.','Cuando tenía 10 años, vivía en Marruecos.','conj'),
  v('u27','A2','conjunciones','','ob','','si (indirecto)','Ich weiß nicht, ob er kommt.','No sé si viene.','conj'),
  v('u27','A2','conjunciones','','sondern','','sino','Nicht Kaffee, sondern Tee.','No café, sino té.','conj'),
  v('u27','A2','conjunciones','','aber','','pero','Er ist nett, aber laut.','Es simpático, pero ruidoso.','conj'),
  v('u27','A2','conjunciones','','oder','','o','Tee oder Kaffee?','¿Té o café?','conj'),
  v('u27','A2','conjunciones','','bevor','','antes de que','Bevor ich gehe, esse ich.','Antes de irme, como.','conj'),
  v('u27','A2','conjunciones','','damit','','para que','Ich lerne, damit ich die Prüfung bestehe.','Estudio para aprobar el examen.','conj'),
  v('u27','A2','estudio','die','Prüfung','Prüfungen','examen','Die Prüfung ist schwer.','El examen es difícil.'),
  v('u28','A2','tiempo','','jeden Tag','','cada día','Ich lerne jeden Tag.','Estudio cada día.','phrase'),
  v('u28','A2','modo','','zu Fuß','','a pie','Ich gehe zu Fuß.','Voy a pie.','phrase'),
  v('u28','A2','modo','','mit dem Zug','','en tren','Ich fahre mit dem Zug.','Voy en tren.','phrase'),
  v('u28','A2','tiempo','','heute Abend','','esta noche','Heute Abend rufe ich dich an.','Esta noche te llamo.','phrase'),
  v('u28','A2','lugar','','zur Arbeit','','al trabajo','Ich fahre zur Arbeit.','Voy al trabajo.','phrase'),
  v('u28','A2','lugar','','nach Hause','','a casa (dirección)','Ich gehe nach Hause.','Voy a casa.','phrase'),
  v('u28','A2','lugar','','zu Hause','','en casa (posición)','Ich bin zu Hause.','Estoy en casa.','phrase'),
  v('u28','A2','tiempo','','leider','','desgraciadamente','Leider habe ich keine Zeit.','Desgraciadamente no tengo tiempo.','adv'),
]

const U = (u: string, c: string[], d?: 1|2|3|4, mixed?: boolean) => ({ u, c, d, mixed })

export const exercises: Exercise[] = [
  // U25
  gap(U('u25',['adjektivdeklination'],1),'Tras artículo definido, nominativo','der alt___ Mann; die alt___ Frau; das alt___ Haus',['e','e','e'],'Nominativo singular tras der/die/das: -e.'),
  gap(U('u25',['adjektivdeklination'],2),'Tras artículo definido','Ich sehe den alt___ Mann. Ich helfe der alt___ Frau.',['en','en'],'Acu. masc. y dat.: -en.'),
  gap(U('u25',['adjektivdeklination'],2),'Tras ein, nominativo','ein alt___ Mann; eine alt___ Frau; ein alt___ Haus',['er','e','es'],'Tras ein, el adjetivo muestra el género: -er, -e, -es.'),
  gap(U('u25',['adjektivdeklination','akkusativ'],3),'Tras ein, acusativo','Ich habe einen neu___ Computer und ein neu___ Handy.',['en','es'],'Acu. masc. -en; acu. neutro -es.'),
  gap(U('u25',['adjektivdeklination','dativ'],3),'Dativo','Ich fahre mit meinem neu___ Auto zu meiner alt___ Schule.',['en','en'],'Dativo: siempre -en.'),
  gap(U('u25',['adjektivdeklination'],3),'Sin artículo','Ich trinke gern kalt___ Bier (n) und gut___ Wein (m).',['es','en'],'Sin artículo el adjetivo toma la terminación del artículo: kaltes, guten (acu. masc.).'),
  mc(U('u25',['adjektivdeklination'],2),'Elige la opción correcta','Das ist ein ___ Film.',['gute','guter','gutes'],1,'ein + masc. nom. → -er.'),
  mc(U('u25',['adjektivdeklination'],2),'Elige la opción correcta','Fórmula de despedida en un email:',['Mit freundliche Grüße','Mit freundlichen Grüßen','Mit freundlicher Grüßen'],1,'mit + dativo plural: freundlichen Grüßen.'),
  tr(U('u25',['adjektivdeklination'],2),'Un café solo, por favor.',['Einen schwarzen Kaffee, bitte.','Ein schwarzer Kaffee, bitte.'],'Al pedir se usa acusativo: einen schwarzen Kaffee.'),
  tr(U('u25',['adjektivdeklination','akkusativ','perfekt'],4,true),'Ayer compré un coche nuevo y un libro interesante.',['Gestern habe ich ein neues Auto und ein interessantes Buch gekauft.','Ich habe gestern ein neues Auto und ein interessantes Buch gekauft.'],'Neutros en acusativo tras ein → -es; participio al final.'),
  // U26
  gap(U('u26',['zahlen'],1),'Escribe en letras','21 → ___; 35 → ___',['einundzwanzig','fünfunddreißig'],'Unidad + und + decena.'),
  gap(U('u26',['zahlen'],2),'Escribe en letras','16 → ___; 60 → ___; 17 → ___',['sechzehn','sechzig','siebzehn'],'sechs y sieben pierden letras.'),
  gap(U('u26',['zahlen'],3),'Escribe en letras','264 → ___',['zweihundertvierundsechzig'],'Todo junto: zweihundert-vier-und-sechzig.'),
  gap(U('u26',['ordinalzahlen-daten'],2),'Ordinales','Heute ist der ___ (1.) Mai. Morgen ist der ___ (2.) Mai.',['erste','zweite'],'der erste (irregular), der zweite.'),
  gap(U('u26',['ordinalzahlen-daten'],3),'Fecha con am','Ich habe am ___ (3.) Oktober Geburtstag. Der Kurs beginnt am ___ (20.) Januar.',['dritten','zwanzigsten'],'am + dativo: -ten / -sten.'),
  mc(U('u26',['ordinalzahlen-daten'],2),'Elige la opción correcta','«en 2026»',['in 2026','im Jahr 2026','am 2026'],1,'im Jahr 2026 o solo 2026.'),
  match(U('u26',['zahlen'],2),'Relaciona',[['zwölf','12'],['zwanzig','20'],['dreißig','30'],['dreiundvierzig','43'],['siebzig','70'],['hundert','100']],'Fíjate en dreißig (ß) y siebzig.'),
  tr(U('u26',['ordinalzahlen-daten','haben'],3),'Mi cumpleaños es el 15 de agosto.',['Ich habe am fünfzehnten August Geburtstag.','Mein Geburtstag ist am fünfzehnten August.'],'am + fünfzehnten.'),
  // U27
  gap(U('u27',['konjunktionen-koordinierend'],1),'Coordinantes','Ich trinke Tee ___ Kaffee. (o) Er ist nett, ___ laut. (pero)',['oder','aber'],'oder / aber no cambian el orden.'),
  gap(U('u27',['konjunktionen-koordinierend'],2),'aber o sondern','Ich trinke nicht Kaffee, ___ Tee.',['sondern'],'Tras negación, «sino» = sondern.'),
  tr(U('u27',['nebensaetze'],2),'Ich weiß: Er wohnt in Berlin. (dass)',['Ich weiß, dass er in Berlin wohnt.'],'dass → verbo al final.','transform','Une las frases con la conjunción indicada'),
  tr(U('u27',['nebensaetze'],2),'Sie kommt nicht. Sie ist krank. (weil)',['Sie kommt nicht, weil sie krank ist.'],'weil → verbo al final.','transform','Une las frases con la conjunción indicada'),
  tr(U('u27',['nebensaetze','modalverben-satzbau'],3),'Ich bleibe zu Hause. Ich muss arbeiten. (weil)',['Ich bleibe zu Hause, weil ich arbeiten muss.'],'Con modal, el conjugado (muss) va al final de todo.','transform','Une las frases con la conjunción indicada'),
  tr(U('u27',['nebensaetze','perfekt'],3),'Ich glaube: Er hat Pizza gegessen. (dass)',['Ich glaube, dass er Pizza gegessen hat.'],'Perfekt en subordinada: participio + hat al final.','transform','Une las frases con la conjunción indicada'),
  tr(U('u27',['nebensaetze','wortstellung'],3),'Weil ich krank bin → empieza por la subordinada: «…, ich bleibe zu Hause»',['Weil ich krank bin, bleibe ich zu Hause.'],'Tras subordinada inicial, la principal empieza por el verbo.','transform','Reescribe la frase completa'),
  classify(U('u27',['wenn-als-weil-denn'],3),'¿wenn o als?',['wenn','als'],[['___ ich 10 war, wohnte ich in Marokko.',1],['___ ich Zeit habe, lerne ich Deutsch.',0],['Immer ___ es regnet, bleibe ich zu Hause.',0],['___ ich gestern nach Hause kam, war niemand da.',1]],'als = una vez en el pasado; wenn = habitual/futuro.'),
  mc(U('u27',['wenn-als-weil-denn'],2),'Elige la opción correcta','Ich lerne Deutsch, ___ ich möchte in Deutschland arbeiten.',['weil','denn','dass'],1,'El verbo está en 2ª posición (ich möchte) → denn.'),
  mc(U('u27',['nebensaetze'],2),'Elige la opción correcta','Ich weiß nicht, ___ er heute kommt.',['dass','ob','wenn'],1,'«no sé si» → ob.'),
  tr(U('u27',['nebensaetze'],3),'Aprendo alemán porque quiero trabajar en Alemania.',['Ich lerne Deutsch, weil ich in Deutschland arbeiten will.','Ich lerne Deutsch, weil ich in Deutschland arbeiten möchte.','Ich lerne Deutsch, denn ich will in Deutschland arbeiten.'],'weil + … will al final; o denn con orden normal.'),
  // U28
  tr(U('u28',['wortstellung'],1),'Ich fahre morgen nach Berlin. (empieza por Morgen)',['Morgen fahre ich nach Berlin.'],'Inversión: verbo en 2ª posición, sujeto detrás.','transform','Reescribe empezando por el elemento indicado'),
  tr(U('u28',['wortstellung','perfekt'],2),'Ich habe gestern lange gearbeitet. (empieza por Gestern)',['Gestern habe ich lange gearbeitet.'],'habe en 2ª posición; participio al final.','transform','Reescribe empezando por el elemento indicado'),
  order(U('u28',['temp-modo-lugar'],2),['fahre','ich','nach Berlin','mit dem Zug','morgen'],['Ich fahre morgen mit dem Zug nach Berlin.','Morgen fahre ich mit dem Zug nach Berlin.'],'Tiempo (morgen) – Modo (mit dem Zug) – Lugar (nach Berlin).'),
  order(U('u28',['temp-modo-lugar'],3),['zur Arbeit','geht','jeden Tag','zu Fuß','sie'],['Sie geht jeden Tag zu Fuß zur Arbeit.','Jeden Tag geht sie zu Fuß zur Arbeit.'],'T-M-L.'),
  order(U('u28',['wortstellung','trennbare-verben'],2),['heute Abend','an','ruft','mich','sie'],['Sie ruft mich heute Abend an.','Heute Abend ruft sie mich an.'],'Prefijo al final.'),
  order(U('u28',['temp-modo-lugar','dativ','akkusativ'],3),['das Buch','gebe','ich','meinem Bruder'],['Ich gebe meinem Bruder das Buch.'],'Dativo (persona) antes que acusativo (cosa).'),
  mc(U('u28',['wortstellung'],2),'Elige la frase correcta',' ',['Heute ich habe keine Zeit.','Heute habe ich keine Zeit.','Heute habe keine Zeit ich.'],1,'Verbo en 2ª posición: Heute habe ich…'),
  tr(U('u28',['wortstellung','temp-modo-lugar','modalverben'],4,true),'Mañana tengo que ir al trabajo en autobús.',['Morgen muss ich mit dem Bus zur Arbeit fahren.','Ich muss morgen mit dem Bus zur Arbeit fahren.'],'muss en 2ª posición, T-M-L, fahren al final.'),

  // ===== MIXED / BOSS (combinan varias unidades) =====
  tr(U('u28',['modalverben-satzbau','akkusativ','trennbare-verben'],3,true),'Quiero llamar a mi hermano esta noche.',['Ich will heute Abend meinen Bruder anrufen.','Ich möchte heute Abend meinen Bruder anrufen.','Heute Abend will ich meinen Bruder anrufen.','Ich will meinen Bruder heute Abend anrufen.'],'Modal + acusativo (meinen Bruder) + separable en infinitivo al final.'),
  tr(U('u28',['perfekt-sein','dativ-praepositionen','nebensaetze'],4,true),'No fui al trabajo porque estaba enfermo.',['Ich bin nicht zur Arbeit gefahren, weil ich krank war.','Ich bin nicht zur Arbeit gegangen, weil ich krank war.'],'sein + gefahren/gegangen; zur Arbeit (zu + dat.); weil … war al final.'),
  tr(U('u28',['kein','dativ-verben','personalpronomen-dat','modalverben'],4,true),'No puedo ayudarte porque no tengo tiempo.',['Ich kann dir nicht helfen, weil ich keine Zeit habe.','Ich kann dir nicht helfen, denn ich habe keine Zeit.'],'helfen + dir (dat.); keine Zeit; weil … habe al final.'),
  tr(U('u28',['adjektivdeklination','wechselpraepositionen','possessiv'],4,true),'Mi nuevo compañero de piso vive en la habitación pequeña.',['Mein neuer Mitbewohner wohnt in dem kleinen Zimmer.','Mein neuer Mitbewohner wohnt im kleinen Zimmer.'],'mein neuer (nom. masc. tras posesivo); in + dat. (posición); kleinen (dat. tras dem).'),
  tr(U('u28',['reflexiv','perfekt','trennbare-verben','temp-modo-lugar'],4,true),'Esta mañana me levanté a las 6, me duché y fui en tren al trabajo.',['Heute Morgen bin ich um 6 Uhr aufgestanden, habe mich geduscht und bin mit dem Zug zur Arbeit gefahren.','Heute Morgen bin ich um 6 aufgestanden, habe mich geduscht und bin mit dem Zug zur Arbeit gefahren.'],'Tres Perfekt: bin aufgestanden, habe mich geduscht, bin gefahren; T-M-L.'),
  tr(U('u28',['imperativ','dativ','possessiv','akkusativ'],3,true),'¡Dale el libro a tu hermana! (a un amigo)',['Gib deiner Schwester das Buch!'],'Imperativo du de geben (Gib!); deiner Schwester (dat.); das Buch (acu.).'),
  tr(U('u28',['komparativ','nebensaetze','modalverben'],4,true),'Creo que el tren es más rápido que el autobús, pero no sé si es más barato.',['Ich glaube, dass der Zug schneller als der Bus ist, aber ich weiß nicht, ob er billiger ist.','Ich glaube, dass der Zug schneller ist als der Bus, aber ich weiß nicht, ob er billiger ist.'],'dass … ist; schneller als; ob … ist.'),
  tr(U('u28',['w-fragen','perfekt','wechselpraepositionen'],3,true),'¿Dónde has puesto mi llave? — En la mesa.',['Wo hast du meinen Schlüssel hingelegt? — Auf den Tisch.','Wohin hast du meinen Schlüssel gelegt? — Auf den Tisch.'],'Colocar → wohin + acusativo: auf den Tisch.'),
  tr(U('u28',['praeteritum-haben-sein-modal','wenn-als-weil-denn','ordinalzahlen-daten'],4,true),'Cuando tenía 15 años quería ser médico.',['Als ich 15 Jahre alt war, wollte ich Arzt werden.','Als ich fünfzehn war, wollte ich Arzt werden.','Als ich 15 war, wollte ich Arzt werden.'],'als (pasado único) … war; wollte + werden al final; principal empieza por el verbo.'),
  tr(U('u28',['futur','nebensaetze','modalverben'],3,true),'Si hace buen tiempo mañana, iremos a la playa.',['Wenn das Wetter morgen gut ist, fahren wir an den Strand.','Wenn morgen das Wetter gut ist, gehen wir an den Strand.','Wenn das Wetter morgen gut ist, werden wir an den Strand fahren.'],'wenn … ist; principal invertida; an den Strand (movimiento → acu.).'),
  write(U('u28',['perfekt','temp-modo-lugar','nebensaetze','akkusativ'],3,true),'Escribe 4–6 frases sobre lo que hiciste ayer. Usa al menos: un Perfekt con sein, un Perfekt con haben, una frase con weil y un objeto en acusativo.',['Perfekt con haben y con sein correctos','Participios al final','Subordinada con weil con el verbo al final','Artículos en acusativo correctos','Verbo en 2ª posición en las principales'],'Ejercicio de escritura evaluado por el AI Tutor con la rúbrica indicada.'),
  write(U('u28',['modalverben','wechselpraepositionen','adjektivdeklination'],3,true),'Describe tu habitación en 4–6 frases. Usa preposiciones de lugar (auf, neben, an, unter…), al menos dos adjetivos delante de sustantivo y un verbo modal.',['Preposiciones de posición con dativo','Adjetivos con terminación correcta','Modal con infinitivo al final','Género de los sustantivos correcto'],'Ejercicio de escritura evaluado por el AI Tutor con la rúbrica indicada.'),
  reading(U('u28',['perfekt','nebensaetze','wechselpraepositionen'],3,true),'Hallo Lena! Ich bin am Samstag nach Barcelona gefahren, weil meine Schwester dort studiert. Wir haben zusammen im Park gefrühstückt und sind dann ins Museum gegangen. Das Museum war sehr interessant, aber es war zu voll. Am Abend haben wir in einem kleinen Restaurant neben dem Strand gegessen. Ich musste um 22 Uhr den letzten Zug nehmen, obwohl ich gern länger geblieben wäre. Nächstes Wochenende kommt meine Schwester zu mir. Willst du auch kommen? Liebe Grüße, Ayoub',[
    { q: '¿Por qué fue Ayoub a Barcelona?', options: ['Porque trabaja allí','Porque su hermana estudia allí','Porque había un concierto'], answer: 1 },
    { q: '¿Dónde cenaron?', options: ['En el museo','En un restaurante junto a la playa','En casa de la hermana'], answer: 1 },
    { q: '¿Qué pasa el fin de semana que viene?', options: ['Ayoub vuelve a Barcelona','La hermana viene a casa de Ayoub','Lena va a Barcelona'], answer: 1 },
    { q: '«…weil meine Schwester dort studiert»: ¿por qué «studiert» va al final?', options: ['Es un verbo separable','weil es subordinante','Es Perfekt'], answer: 1 },
  ],'Texto escrito por la app (AI). Combina Perfekt, subordinadas con weil/obwohl, modales y preposiciones de lugar.'),
]
