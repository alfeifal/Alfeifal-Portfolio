import type { Unit, Concept, VocabItem, Exercise } from '../types'
import { v, mc, gap, tr, order, match, classify, reading } from '../helpers'

export const units: Unit[] = [
{ id: 'u19', number: 19, block: 'C', title: 'Comparativo y superlativo', titleDe: 'Komparativ und Superlativ', cefr: 'A2', page: 102,
  objectives: ['Formar comparativos con -er y superlativos con am -sten', 'Conocer los irregulares (gut, viel, gern, hoch, nah)', 'Comparar con als y so … wie'],
  concepts: ['komparativ', 'superlativ'],
  learn: [
    { title: 'Formación', body: 'A diferencia del español («más grande»), el alemán **siempre** añade terminación, también en adjetivos largos:\n\n| | comparativo | superlativo |\n| klein | klein**er** | am klein**sten** |\n| schnell | schnell**er** | am schnell**sten** |\n| interessant | interessant**er** | am interessant**esten** |\n\n*Berlin ist größer als Girona. Der ICE ist am schnellsten.*\n\nAdjetivos de una sílaba con a, o, u suelen añadir **umlaut**: *alt → älter → am ältesten; groß → größer → am größten; jung → jünger; kurz → kürzer; warm → wärmer.* Si acaba en -t, -d, -s, -z, el superlativo añade -e-: *am ältesten, am kürzesten*.' },
    { title: 'Irregulares', body: '| gut | besser | am besten |\n| viel | mehr | am meisten |\n| gern | lieber | am liebsten |\n| hoch | höher | am höchsten |\n| nah | näher | am nächsten |\n| teuer | teurer | am teuersten |\n| dunkel | dunkler | am dunkelsten |\n\n*Ich trinke gern Tee, lieber Kaffee, am liebsten Wasser.*' },
    { title: 'Cómo comparar', body: '- **als** = que: *Er ist älter **als** ich.*\n- **so … wie** = tan … como: *Sie ist **so** groß **wie** ich.*\n- **nicht so … wie** = no tan … como.\n\nLos adverbios se comparan igual: *Er läuft schneller als ich. Sie spricht am besten.*\n\nDelante de un sustantivo, el comparativo/superlativo lleva además la terminación de adjetivo (Unidad 25): *ein schneller**es** Auto, der schnell**ste** Zug*.' }
  ],
  understand: [
    { title: 'Los tres errores típicos', body: '1. Usar *mehr* como el «más» español: *~~mehr schnell~~ → schneller*.\n2. Olvidar el umlaut: *~~alter~~ → älter*.\n3. Confundir *als* y *wie*: *als* solo para desigualdad.' }
  ],
  bookExercises: ['Completar formas (19.1)', 'Comparativo y superlativo de adjetivos (19.2)', 'Hacer comparaciones (19.3)', 'Traducción (19.4)']
},
{ id: 'u20', number: 20, block: 'C', title: 'Verbos modales', titleDe: 'Modalverben', cefr: 'A2', page: 109,
  objectives: ['Conjugar los seis modales', 'Colocar el infinitivo al final', 'Distinguir müssen / sollen / dürfen y «nicht müssen» vs «nicht dürfen»'],
  concepts: ['modalverben', 'modalverben-satzbau'],
  learn: [
    { title: 'Los seis modales', body: '| | significado | ich/er | du | wir/sie |\n| können | poder (capacidad) | kann | kannst | können |\n| müssen | tener que | muss | musst | müssen |\n| dürfen | poder (permiso) | darf | darfst | dürfen |\n| wollen | querer | will | willst | wollen |\n| sollen | deber (consejo, encargo) | soll | sollst | sollen |\n| mögen | gustar | mag | magst | mögen |\n| möchte(n) | querría / me gustaría | möchte | möchtest | möchten |\n\nPatrón irregular: **ich y er/sie/es son iguales y sin terminación**, y el singular pierde el umlaut (*können → kann*).' },
    { title: 'Orden de la frase', body: 'El modal se conjuga en 2ª posición y el **verbo principal va en infinitivo al final**:\n\n- *Ich **kann** heute nicht **kommen**.*\n- ***Musst** du morgen **arbeiten**?*\n- *Wir **wollen** nach Berlin **fahren**.*\n\nCon separables el infinitivo va junto: *Ich muss um 6 Uhr **aufstehen**.*\n\n*mögen* se usa casi siempre sin infinitivo: *Ich mag Pizza.* *möchte* = quisiera, más cortés que *wollen*: *Ich möchte einen Kaffee, bitte.*' },
    { title: 'Matices importantes', body: '- **sollen**: obligación que viene de otro / consejo: *Du sollst mehr schlafen* (te lo han dicho).\n- **nicht dürfen** = «no se puede / está prohibido»: *Hier darf man nicht rauchen.*\n- **nicht müssen** = «no hace falta»: *Du musst nicht kommen* (no es obligatorio).\n\nOjo: el «must not» inglés / «no debes» español se dice con **dürfen**, no con *müssen*.' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'El español también deja el segundo verbo en infinitivo (*puedo venir*), pero pegado al modal. En alemán el infinitivo **se va al final**, y todo lo demás queda en medio: *Ich kann heute leider nicht zur Party kommen.*' }
  ],
  bookExercises: ['Conjugar todos los modales (20.1)', 'Huecos con können (20.2)', 'Huecos con el modal indicado (20.3)', 'Traducción con du y Sie (20.4)']
},
{ id: 'u21', number: 21, block: 'C', title: 'El Perfekt', titleDe: 'Perfekt', cefr: 'A2', page: 116,
  objectives: ['Formar el Perfekt con haben/sein + participio', 'Formar participios regulares, irregulares y mixtos', 'Saber cuándo usar sein'],
  concepts: ['perfekt', 'partizip-ii', 'perfekt-sein'],
  learn: [
    { title: 'El pasado de la conversación', body: 'Para hablar del pasado en alemán **hablado** se usa el Perfekt (el Präteritum es más de la lengua escrita, salvo *haben, sein* y modales).\n\nEstructura: **haben / sein** (conjugado, 2ª posición) + **participio** (al final):\n\n- *Ich **habe** gestern Pizza **gegessen**.*\n- *Wir **sind** nach Berlin **gefahren**.*' },
    { title: 'El participio', body: '**Regulares**: ge- + raíz + **-t**: *gemacht, gelernt, gekauft, gearbeitet* (con -e- si la raíz acaba en -t/-d).\n\n**Irregulares**: ge- + raíz (a veces con vocal cambiada) + **-en**: *gesehen, gelesen, gegessen, getrunken, geschrieben, gefahren, gegangen, gekommen, geschlafen, gesprochen, genommen, gefunden.*\n\n**Mixtos** (cambio de vocal + -t): *gebracht (bringen), gedacht (denken), gekannt (kennen), gewusst (wissen).*\n\n**Sin ge-**: verbos en *-ieren* (*studiert, telefoniert*) y con prefijo inseparable (*bezahlt, verstanden, erklärt*).\n\n**Separables**: el *ge* va en medio: *auf**ge**standen, an**ge**rufen, ein**ge**kauft.*' },
    { title: 'haben o sein', body: 'La mayoría va con **haben**. Usa **sein** con:\n\n1. Verbos de **movimiento** de un sitio a otro: *gehen, fahren, kommen, fliegen, laufen, reisen*.\n2. Verbos de **cambio de estado**: *aufstehen, einschlafen, aufwachen, sterben, werden*.\n3. *sein* y *bleiben*: *Ich bin gewesen. Er ist geblieben.*\n\n*Sie ist um 7 Uhr aufgestanden und (ist) zur Arbeit gefahren. Dort hat sie viel gearbeitet.*\n\nEl Perfekt de haben y sein se usa poco; en su lugar se dice *ich hatte / ich war* (Unidad 22).' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'Se parece al «he comido» español, pero se usa **mucho más**: también donde el español diría «comí». Piensa en el catalán *vaig menjar* / castellano «he comido» para todo el pasado hablado. El participio siempre al final: *Ich habe gestern mit meinem Bruder im Restaurant Pizza gegessen.*' }
  ],
  bookExercises: ['Identificar participios irregulares y verbos con sein (21.1)', 'Completar en Perfekt (21.2)', 'Pasar frases al Perfekt (21.3, 21.4)']
},
{ id: 'u22', number: 22, block: 'C', title: 'El Präteritum', titleDe: 'Präteritum', cefr: 'A2+', page: 124,
  objectives: ['Reconocer el Präteritum en textos', 'Usar hatte, war y los modales en pasado', 'Conjugar regulares e irregulares'],
  concepts: ['praeteritum', 'praeteritum-haben-sein-modal'],
  learn: [
    { title: 'Uso', body: 'El Präteritum (pasado simple) se usa sobre todo en la **lengua escrita**: cuentos, noticias, novelas. En la conversación se prefiere el Perfekt, **excepto** con *haben, sein* y los modales, que se usan casi siempre en Präteritum también al hablar:\n\n- *Ich **war** gestern krank.* (no *bin gewesen*)\n- *Wir **hatten** keine Zeit.*\n- *Ich **konnte** nicht kommen.*' },
    { title: 'haben, sein y modales', body: '| | haben | sein | können | müssen | wollen |\n| ich / er | hatte | war | konnte | musste | wollte |\n| du | hattest | warst | konntest | musstest | wolltest |\n| wir / sie | hatten | waren | konnten | mussten | wollten |\n| ihr | hattet | wart | konntet | musstet | wolltet |\n\nLos modales pierden el umlaut: *können → konnte, müssen → musste, dürfen → durfte, mögen → mochte*.' },
    { title: 'Regulares e irregulares', body: '**Regulares**: raíz + **-te** + terminación: *ich lernte, du lerntest, er lernte, wir lernten, ihr lerntet, sie lernten*. Raíz en -t/-d: *arbeitete*.\n\n**Irregulares**: raíz cambiada, **sin terminación** en ich y er: *ich ging, du gingst, er ging, wir gingen*. Frecuentes: *kam (kommen), fuhr (fahren), sah (sehen), gab (geben), sprach, nahm, fand, schrieb, las, aß, trank, schlief, lief*.\n\n**Mixtos**: *brachte, dachte, kannte, wusste*.' }
  ],
  understand: [
    { title: 'Prioridad', body: 'Para hablar: aprende de memoria *hatte, war, konnte, musste, wollte, durfte, sollte* y usa Perfekt para todo lo demás. Para leer: reconoce los irregulares más comunes (*kam, ging, sah, gab*).' }
  ],
  bookExercises: ['Subrayar el Präteritum en un texto (22.1)', 'Conjugar (22.2)', 'Terminaciones (22.3)', 'Traducción (22.4)']
},
{ id: 'u23', number: 23, block: 'C', title: 'El futuro', titleDe: 'Futur', cefr: 'A2', page: 130,
  objectives: ['Usar el presente con marcador temporal para el futuro', 'Formar el futuro con werden + infinitivo', 'Conjugar werden'],
  concepts: ['futur'],
  learn: [
    { title: 'Presente + marcador', body: 'La forma más común de hablar del futuro es el **presente** con una expresión de tiempo:\n\n- *Morgen **fahre** ich nach Barcelona.*\n- *Nächste Woche **habe** ich Urlaub.*\n\nMarcadores: *morgen, übermorgen, nächste Woche, nächsten Monat, nächstes Jahr, bald, später, am Wochenende, in zwei Tagen.*' },
    { title: 'werden + infinitivo', body: 'Para intenciones, predicciones y promesas se usa **werden** + infinitivo al final:\n\n| ich | werde |\n| du | wirst |\n| er/sie/es | wird |\n| wir | werden |\n| ihr | werdet |\n| sie/Sie | werden |\n\n- *Ich **werde** mehr Deutsch **lernen**.*\n- *Es **wird** morgen **regnen**.*\n- *Wir **werden** dich **anrufen**.*\n\n*werden* solo también significa «llegar a ser»: *Er wird Arzt.*' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'Como en español («mañana voy a Barcelona»), el presente con adverbio es lo natural. *werden* equivale al futuro «iré / voy a ir» y se usa cuando no hay marcador temporal o para dar énfasis. No abuses de *werden*.' }
  ],
  bookExercises: ['Identificar expresiones de futuro (23.1)', 'Frases con werden (23.2)', 'Traducción con presente y con werden (23.3)']
},
{ id: 'u24', number: 24, block: 'C', title: 'Preposiciones', titleDe: 'Präpositionen', cefr: 'A2', page: 135,
  objectives: ['Clasificar preposiciones por caso', 'Dominar las 9 de doble caso (wo? / wohin?)', 'Usar las contracciones'],
  concepts: ['praepositionen', 'wechselpraepositionen'],
  learn: [
    { title: 'Repaso: acusativo y dativo', body: '**Solo acusativo**: bis, durch, für, gegen, ohne, um.\n**Solo dativo**: aus, bei, mit, nach, seit, von, zu, gegenüber.\n\nContracciones habituales: *zum, zur, beim, vom, ans, am, im, ins*.' },
    { title: 'Las nueve de doble caso (Wechselpräpositionen)', body: '| an | en (vertical) / junto a |\n| auf | sobre (horizontal) |\n| hinter | detrás de |\n| in | en / dentro de |\n| neben | al lado de |\n| über | encima de (sin contacto) |\n| unter | debajo de |\n| vor | delante de |\n| zwischen | entre |\n\nLa regla:\n- **Wohin?** (movimiento hacia un destino) → **acusativo**: *Ich gehe **in die** Küche. Er legt das Buch **auf den** Tisch.*\n- **Wo?** (posición, sin cambio de lugar) → **dativo**: *Ich bin **in der** Küche. Das Buch liegt **auf dem** Tisch.*\n\nContracciones: *in dem = **im***, *in das = **ins***, *an dem = **am***, *an das = **ans***.' },
    { title: 'Ejemplos contrastados', body: '| wohin? (acu.) | wo? (dat.) |\n| Ich fahre in die Stadt. | Ich wohne in der Stadt. |\n| Wir gehen ins Kino. | Wir sind im Kino. |\n| Er stellt die Lampe neben das Bett. | Die Lampe steht neben dem Bett. |\n| Sie hängt das Bild an die Wand. | Das Bild hängt an der Wand. |\n\nCon tiempo, siempre dativo: *am Montag, im Sommer, um 8 Uhr (um es acu.), vor einer Woche*.' }
  ],
  understand: [
    { title: 'La pregunta clave', body: 'Antes de escribir la preposición, pregúntate: ¿hay **desplazamiento** hacia un sitio? Si sí → acusativo. Si es «dónde está» → dativo. Verbos de colocar (*legen, stellen, setzen, hängen*) → acusativo; verbos de estar (*liegen, stehen, sitzen, hängen*) → dativo.' }
  ],
  bookExercises: ['Elegir preposición (24.1)', 'Clasificar por caso (24.2)', 'Terminaciones (24.3)', 'Traducción (24.4)']
}]

export const concepts: Concept[] = [
  { id: 'komparativ', name: 'Komparativ', nameEs: 'Comparativo', unitId: 'u19', summary: '-er (+ umlaut); als = que; so … wie = tan como.', mistakes: ['*mehr schnell* (→ schneller)', '*alter* (→ älter)', '*größer wie* (→ größer als)'], related: ['superlativ', 'adjektivdeklination'] },
  { id: 'superlativ', name: 'Superlativ', nameEs: 'Superlativo', unitId: 'u19', summary: 'am -sten; irregulares am besten, am meisten, am liebsten.', mistakes: ['*am gutesten* (→ am besten)', '*am altsten* (→ am ältesten)'], related: ['komparativ'] },
  { id: 'modalverben', name: 'Modalverben', nameEs: 'Verbos modales', unitId: 'u20', summary: 'können, müssen, dürfen, wollen, sollen, mögen/möchte. ich = er, sin terminación.', mistakes: ['*ich kanne* (→ kann)', '*er musst* (→ muss)', '*nicht müssen* para prohibir (→ nicht dürfen)'], related: ['modalverben-satzbau', 'praeteritum-haben-sein-modal'] },
  { id: 'modalverben-satzbau', name: 'Modalverb + Infinitiv', nameEs: 'Orden con modales', unitId: 'u20', summary: 'Modal en 2ª posición, infinitivo al final.', mistakes: ['*Ich kann kommen nicht* (→ nicht kommen)', '*Ich muss aufstehen um 6* (→ um 6 aufstehen)'], related: ['wortstellung'] },
  { id: 'perfekt', name: 'Perfekt', nameEs: 'Perfekt (pasado hablado)', unitId: 'u21', summary: 'haben/sein + participio al final.', mistakes: ['Poner el participio en medio de la frase', 'Usar Präteritum de verbos normales al hablar'], related: ['partizip-ii', 'perfekt-sein', 'haben', 'sein'] },
  { id: 'partizip-ii', name: 'Partizip II', nameEs: 'Participio', unitId: 'u21', summary: 'ge-…-t (regular), ge-…-en (irregular); sin ge- en -ieren y prefijos inseparables; separables: aufGEstanden.', mistakes: ['*gestudiert* (→ studiert)', '*gebezahlt* (→ bezahlt)', '*geaufstanden* (→ aufgestanden)', '*geesst* (→ gegessen)'], related: ['perfekt'] },
  { id: 'perfekt-sein', name: 'Perfekt mit sein', nameEs: 'Perfekt con sein', unitId: 'u21', summary: 'Movimiento, cambio de estado, sein, bleiben.', mistakes: ['*Ich habe nach Berlin gefahren* (→ bin)', '*Ich bin gegessen* (→ habe)'], related: ['perfekt'] },
  { id: 'praeteritum', name: 'Präteritum', nameEs: 'Pasado simple', unitId: 'u22', summary: 'Regular: -te; irregular: raíz cambiada sin terminación (ich/er).', mistakes: ['*ich gingte* (→ ging)', '*er lernt* por pasado (→ lernte)'], related: ['praeteritum-haben-sein-modal'] },
  { id: 'praeteritum-haben-sein-modal', name: 'hatte / war / konnte', nameEs: 'Pasado de haben, sein y modales', unitId: 'u22', summary: 'hatte, war, konnte, musste, wollte, durfte, sollte.', mistakes: ['*ich bin gewesen* en conversación (mejor: ich war)', '*könnte* por pasado (könnte es condicional; pasado = konnte)'], related: ['praeteritum', 'modalverben'] },
  { id: 'futur', name: 'Futur', nameEs: 'Futuro', unitId: 'u23', summary: 'Presente + marcador temporal, o werden + infinitivo al final.', mistakes: ['*ich werde gehen morgen* (→ werde morgen gehen)', '*er werdet* (→ wird)'], related: ['modalverben-satzbau'] },
  { id: 'praepositionen', name: 'Präpositionen', nameEs: 'Preposiciones y caso', unitId: 'u24', summary: 'Acu: bis durch für gegen ohne um. Dat: aus bei mit nach seit von zu.', mistakes: ['*mit den Auto* (→ dem)', '*für dem* (→ den)'], related: ['akkusativ-praepositionen', 'dativ-praepositionen', 'wechselpraepositionen'] },
  { id: 'wechselpraepositionen', name: 'Wechselpräpositionen', nameEs: 'Preposiciones de doble caso', unitId: 'u24', summary: 'an auf hinter in neben über unter vor zwischen: wohin → acu., wo → dat.', mistakes: ['*Ich gehe in der Küche* (movimiento → in die)', '*Ich bin ins Kino* (posición → im)', '*am Montag* con acusativo (tiempo → dativo)'], related: ['praepositionen'] },
]

export const vocab: VocabItem[] = [
  v('u19','A2','adjetivos','','alt','','viejo / antiguo','Er ist älter als ich.','Él es mayor que yo.','adj'),
  v('u19','A2','adjetivos','','jung','','joven','Meine Schwester ist jünger.','Mi hermana es más joven.','adj'),
  v('u19','A2','adjetivos','','klein','','pequeño','Girona ist kleiner als Berlin.','Girona es más pequeña que Berlín.','adj'),
  v('u19','A2','adjetivos','','teuer','','caro','Das ist zu teuer.','Es demasiado caro.','adj'),
  v('u19','A2','adjetivos','','billig','','barato','Das Hotel ist billiger.','El hotel es más barato.','adj'),
  v('u19','A2','adjetivos','','gut','','bueno','Das ist besser.','Eso es mejor.','adj'),
  v('u19','A2','adjetivos','','hoch','','alto','Der Berg ist am höchsten.','La montaña es la más alta.','adj'),
  v('u19','A2','adjetivos','','kurz','','corto','Der Weg ist kürzer.','El camino es más corto.','adj'),
  v('u19','A2','adjetivos','','lang','','largo','Der Film ist länger.','La película es más larga.','adj'),
  v('u19','A2','adverbios','','gern','','con gusto','Ich trinke gern Tee, lieber Kaffee.','Me gusta el té, prefiero el café.','adv'),
  v('u19','A2','adverbios','','viel','','mucho','Er arbeitet mehr als ich.','Él trabaja más que yo.','adv'),
  v('u19','A2','conjunciones','','als','','que (comparación)','Sie ist größer als er.','Ella es más alta que él.','conj'),
  v('u19','A2','conjunciones','','so … wie','','tan … como','Er ist so alt wie ich.','Él tiene la misma edad que yo.','conj'),
  v('u20','A2','modales','','können','','poder (capacidad)','Ich kann schwimmen.','Sé nadar.','verb'),
  v('u20','A2','modales','','müssen','','tener que','Ich muss arbeiten.','Tengo que trabajar.','verb'),
  v('u20','A2','modales','','dürfen','','poder (permiso)','Darf ich rauchen?','¿Puedo fumar?','verb'),
  v('u20','A2','modales','','wollen','','querer','Ich will nach Berlin.','Quiero ir a Berlín.','verb'),
  v('u20','A2','modales','','sollen','','deber (consejo)','Du sollst mehr schlafen.','Deberías dormir más.','verb'),
  v('u20','A2','modales','','mögen','','gustar','Ich mag Pizza.','Me gusta la pizza.','verb'),
  v('u20','A2','modales','','möchten','','querría / me gustaría','Ich möchte einen Kaffee.','Querría un café.','verb'),
  v('u20','A2','verbos','','schwimmen','','nadar','Kannst du schwimmen?','¿Sabes nadar?','verb'),
  v('u20','A2','verbos','','rauchen','','fumar','Hier darf man nicht rauchen.','Aquí no se puede fumar.','verb'),
  v('u20','A2','pronombres','','man','','se / uno (impersonal)','Man darf hier parken.','Aquí se puede aparcar.','pron'),
  v('u20','A2','viajes','der','Urlaub','Urlaube','vacaciones','Ich möchte Urlaub machen.','Me gustaría irme de vacaciones.'),
  v('u21','A2','verbos','','gestern','','ayer','Gestern habe ich gearbeitet.','Ayer trabajé.','adv'),
  v('u21','A2','verbos','','fliegen','','volar','Wir sind nach Berlin geflogen.','Volamos a Berlín.','verb'),
  v('u21','A2','verbos','','bleiben','','quedarse','Er ist zu Hause geblieben.','Él se quedó en casa.','verb'),
  v('u21','A2','verbos','','einschlafen','','dormirse','Ich bin sofort eingeschlafen.','Me dormí enseguida.','verb'),
  v('u21','A2','verbos','','schreiben','','escribir','Ich habe eine E-Mail geschrieben.','Escribí un email.','verb'),
  v('u21','A2','verbos','','bringen','','traer / llevar','Er hat Blumen gebracht.','Él trajo flores.','verb'),
  v('u21','A2','verbos','','denken','','pensar','Ich habe an dich gedacht.','Pensé en ti.','verb'),
  v('u21','A2','verbos','','telefonieren','','hablar por teléfono','Wir haben telefoniert.','Hablamos por teléfono.','verb'),
  v('u21','A2','verbos','','treffen','','encontrarse con','Ich habe Freunde getroffen.','Quedé con amigos.','verb'),
  v('u21','A2','tiempo','das','Wochenende','Wochenenden','fin de semana','Am Wochenende bin ich gewandert.','El fin de semana hice senderismo.'),
  v('u21','A2','comida','das','Restaurant','Restaurants','restaurante','Wir haben im Restaurant gegessen.','Comimos en el restaurante.'),
  v('u22','A2','tiempo','','früher','','antes / antiguamente','Früher wohnte ich in Marokko.','Antes vivía en Marruecos.','adv'),
  v('u22','A2','tiempo','','damals','','entonces / en aquella época','Damals war ich klein.','Entonces era pequeño.','adv'),
  v('u22','A2','básico','','krank','','enfermo','Ich war krank.','Estaba enfermo.','adj'),
  v('u22','A2','básico','','plötzlich','','de repente','Plötzlich kam ein Mann.','De repente vino un hombre.','adv'),
  v('u22','A2','literatura','das','Märchen','Märchen','cuento','Das Märchen war schön.','El cuento era bonito.'),
  v('u22','A2','literatura','der','König','Könige','rey','Es war einmal ein König.','Érase una vez un rey.'),
  v('u23','A2','tiempo','','morgen','','mañana','Morgen fahre ich nach Barcelona.','Mañana voy a Barcelona.','adv'),
  v('u23','A2','tiempo','','übermorgen','','pasado mañana','Übermorgen habe ich frei.','Pasado mañana tengo libre.','adv'),
  v('u23','A2','tiempo','','nächste Woche','','la semana que viene','Nächste Woche beginnt der Kurs.','El curso empieza la semana que viene.','phrase'),
  v('u23','A2','tiempo','','nächstes Jahr','','el año que viene','Nächstes Jahr fahre ich nach Deutschland.','El año que viene voy a Alemania.','phrase'),
  v('u23','A2','tiempo','','bald','','pronto','Ich komme bald.','Vengo pronto.','adv'),
  v('u23','A2','tiempo','','später','','más tarde','Wir sehen uns später.','Nos vemos más tarde.','adv'),
  v('u23','A2','verbos','','regnen','','llover','Es wird morgen regnen.','Mañana va a llover.','verb'),
  v('u23','A2','verbos','','werden','','ir a (futuro) / llegar a ser','Ich werde Deutsch lernen.','Aprenderé alemán.','verb'),
  v('u24','A2','preposiciones','','in','','en / a (dentro)','Ich gehe ins Kino. Ich bin im Kino.','Voy al cine. Estoy en el cine.','prep'),
  v('u24','A2','preposiciones','','auf','','sobre / en (superficie)','Das Buch liegt auf dem Tisch.','El libro está en la mesa.','prep'),
  v('u24','A2','preposiciones','','an','','en (contacto vertical) / junto a','Das Bild hängt an der Wand.','El cuadro cuelga de la pared.','prep'),
  v('u24','A2','preposiciones','','neben','','al lado de','Die Lampe steht neben dem Bett.','La lámpara está junto a la cama.','prep'),
  v('u24','A2','preposiciones','','unter','','debajo de','Die Katze ist unter dem Tisch.','El gato está debajo de la mesa.','prep'),
  v('u24','A2','preposiciones','','über','','encima de / sobre','Die Lampe hängt über dem Tisch.','La lámpara cuelga sobre la mesa.','prep'),
  v('u24','A2','preposiciones','','vor','','delante de / hace (tiempo)','Vor dem Haus. Vor einer Woche.','Delante de la casa. Hace una semana.','prep'),
  v('u24','A2','preposiciones','','hinter','','detrás de','Hinter dem Haus ist ein Garten.','Detrás de la casa hay un jardín.','prep'),
  v('u24','A2','preposiciones','','zwischen','','entre','Zwischen dem Bett und dem Schrank.','Entre la cama y el armario.','prep'),
  v('u24','A2','verbos','','legen','','poner (tumbado)','Ich lege das Buch auf den Tisch.','Pongo el libro en la mesa.','verb'),
  v('u24','A2','verbos','','stellen','','poner (de pie)','Er stellt die Flasche in den Kühlschrank.','Él pone la botella en la nevera.','verb'),
  v('u24','A2','verbos','','liegen','','estar (tumbado)','Das Buch liegt auf dem Tisch.','El libro está en la mesa.','verb'),
  v('u24','A2','verbos','','stehen','','estar (de pie)','Die Flasche steht im Kühlschrank.','La botella está en la nevera.','verb'),
  v('u24','A2','casa','die','Küche','Küchen','cocina','Ich bin in der Küche.','Estoy en la cocina.'),
  v('u24','A2','casa','das','Bett','Betten','cama','Ich gehe ins Bett.','Me voy a la cama.'),
  v('u24','A2','casa','die','Wand','Wände','pared','Das Bild hängt an der Wand.','El cuadro está en la pared.'),
  v('u24','A2','ciudad','das','Kino','Kinos','cine','Wir gehen ins Kino.','Vamos al cine.'),
  v('u24','A2','ciudad','der','Bahnhof','Bahnhöfe','estación','Ich bin am Bahnhof.','Estoy en la estación.'),
]

const U = (u: string, c: string[], d?: 1|2|3|4, mixed?: boolean) => ({ u, c, d, mixed })

export const exercises: Exercise[] = [
  // U19
  gap(U('u19',['komparativ'],1),'Escribe el comparativo','klein → ___; schnell → ___',['kleiner','schneller'],'Siempre -er.'),
  gap(U('u19',['komparativ'],2),'Escribe el comparativo (con umlaut)','alt → ___; groß → ___; jung → ___',['älter','größer','jünger'],'Monosílabos con a/o/u → umlaut.'),
  gap(U('u19',['komparativ','superlativ'],2),'Completa los irregulares','gut → ___ → am ___; gern → ___ → am ___',['besser','besten','lieber','liebsten'],'Irregulares que hay que memorizar.'),
  gap(U('u19',['superlativ'],2),'Escribe el superlativo','interessant → am ___; alt → am ___',['interessantesten','ältesten'],'Tras -t se añade -e-: -esten.'),
  mc(U('u19',['komparativ'],2),'Elige la opción correcta','Berlin ist größer ___ Girona.',['wie','als','dass'],1,'Desigualdad → als.'),
  mc(U('u19',['komparativ'],2),'Elige la opción correcta','Er ist so alt ___ ich.',['als','wie','dass'],1,'Igualdad: so … wie.'),
  mc(U('u19',['komparativ'],1),'Elige la opción correcta','«más interesante»',['mehr interessant','interessanter','interessantester'],1,'Nunca mehr + adjetivo.'),
  tr(U('u19',['komparativ'],2),'Mi hermano es mayor que yo.',['Mein Bruder ist älter als ich.'],'alt → älter; als.'),
  tr(U('u19',['superlativ'],3),'Me gusta el té, pero lo que más me gusta es el café.',['Ich trinke gern Tee, aber am liebsten trinke ich Kaffee.','Ich mag Tee, aber am liebsten mag ich Kaffee.','Ich trinke gern Tee, aber Kaffee trinke ich am liebsten.'],'gern → lieber → am liebsten.'),
  tr(U('u19',['komparativ','modalverben'],3,true),'Puedes correr más rápido que yo.',['Du kannst schneller laufen als ich.','Du kannst schneller als ich laufen.'],'Modal + infinitivo al final; schneller als.'),
  // U20
  gap(U('u20',['modalverben'],1),'Conjuga el modal','Ich ___ (können) schwimmen. Er ___ (können) nicht kommen.',['kann','kann'],'ich = er = kann.'),
  gap(U('u20',['modalverben'],1),'Conjuga el modal','Du ___ (müssen) arbeiten. Wir ___ (müssen) lernen.',['musst','müssen'],'du musst; wir müssen.'),
  gap(U('u20',['modalverben'],2),'Conjuga el modal','___ (dürfen) ich hier rauchen? — Nein, hier ___ (dürfen) man nicht rauchen.',['Darf','darf'],'dürfen → darf.'),
  gap(U('u20',['modalverben'],2),'Conjuga el modal','Ihr ___ (wollen) nach Berlin fahren? Ich ___ (möchten) einen Kaffee.',['wollt','möchte'],'ihr wollt; ich möchte.'),
  order(U('u20',['modalverben-satzbau'],2),['ich','heute','kommen','kann','nicht'],['Ich kann heute nicht kommen.','Heute kann ich nicht kommen.'],'Modal en 2ª posición, infinitivo al final.'),
  order(U('u20',['modalverben-satzbau','trennbare-verben'],3),['muss','um 6 Uhr','ich','aufstehen','morgen'],['Ich muss morgen um 6 Uhr aufstehen.','Morgen muss ich um 6 Uhr aufstehen.','Ich muss um 6 Uhr morgen aufstehen.'],'Infinitivo del separable al final, junto.'),
  mc(U('u20',['modalverben'],3),'Elige la opción correcta','«Aquí no se puede aparcar» (prohibido):',['Hier muss man nicht parken.','Hier darf man nicht parken.','Hier soll man nicht parken.'],1,'Prohibición → nicht dürfen. nicht müssen = no hace falta.'),
  mc(U('u20',['modalverben'],2),'Elige la opción correcta','Pedir con cortesía en un café:',['Ich will einen Kaffee.','Ich möchte einen Kaffee.','Ich mag einen Kaffee.'],1,'möchte es la forma cortés.'),
  tr(U('u20',['modalverben','modalverben-satzbau'],2),'Tengo que trabajar hoy.',['Ich muss heute arbeiten.','Heute muss ich arbeiten.'],'müssen + infinitivo al final.'),
  tr(U('u20',['modalverben','modalverben-satzbau','akkusativ'],3,true),'¿Puedes ayudarme? Quiero comprar un coche.',['Kannst du mir helfen? Ich will ein Auto kaufen.','Kannst du mir helfen? Ich möchte ein Auto kaufen.'],'helfen + dativo (mir); ein Auto (neutro acu.); infinitivos al final.'),
  tr(U('u20',['modalverben'],3),'¿Puede usted hablar más despacio, por favor?',['Können Sie bitte langsamer sprechen?','Können Sie langsamer sprechen, bitte?'],'Können Sie … + infinitivo al final; langsamer (comparativo).'),
  // U21
  gap(U('u21',['partizip-ii'],1),'Escribe el participio (regular)','machen → ___; lernen → ___; arbeiten → ___',['gemacht','gelernt','gearbeitet'],'ge- + raíz + -t (-et tras -t).'),
  gap(U('u21',['partizip-ii'],2),'Escribe el participio (irregular)','sehen → ___; essen → ___; trinken → ___; schreiben → ___',['gesehen','gegessen','getrunken','geschrieben'],'ge- … -en con posible cambio de vocal.'),
  gap(U('u21',['partizip-ii'],2),'Participio sin ge-','studieren → ___; bezahlen → ___; verstehen → ___',['studiert','bezahlt','verstanden'],'-ieren y prefijos inseparables no llevan ge-.'),
  gap(U('u21',['partizip-ii','trennbare-verben'],3),'Participio de separables','aufstehen → ___; anrufen → ___; einkaufen → ___',['aufgestanden','angerufen','eingekauft'],'ge en medio: auf-ge-standen.'),
  gap(U('u21',['perfekt','perfekt-sein'],2),'haben o sein','Ich ___ gestern Pizza gegessen. Wir ___ nach Berlin gefahren.',['habe','sind'],'essen → haben; fahren (movimiento) → sein.'),
  gap(U('u21',['perfekt-sein'],2),'haben o sein','Sie ___ um 7 Uhr aufgestanden und ___ dann gefrühstückt.',['ist','hat'],'aufstehen (cambio de estado) → sein; frühstücken → haben.'),
  classify(U('u21',['perfekt-sein'],2),'¿haben o sein?',['haben','sein'],[['gehen',1],['kaufen',0],['kommen',1],['lesen',0],['bleiben',1],['schlafen',0],['einschlafen',1],['arbeiten',0]],'Movimiento, cambio de estado, sein y bleiben → sein.'),
  tr(U('u21',['perfekt'],2),'Ich lerne Deutsch.',['Ich habe Deutsch gelernt.'],'haben + gelernt al final.','transform','Pasa la frase al Perfekt'),
  tr(U('u21',['perfekt','perfekt-sein'],2),'Er fährt nach Hamburg.',['Er ist nach Hamburg gefahren.'],'fahren → sein + gefahren.','transform','Pasa la frase al Perfekt'),
  tr(U('u21',['perfekt','partizip-ii','trennbare-verben'],3),'Wir stehen um 6 Uhr auf.',['Wir sind um 6 Uhr aufgestanden.'],'sein + aufgestanden.','transform','Pasa la frase al Perfekt'),
  order(U('u21',['perfekt','wortstellung'],3),['habe','ich','gestern','gegessen','im Restaurant'],['Ich habe gestern im Restaurant gegessen.','Gestern habe ich im Restaurant gegessen.'],'Participio al final; complementos en medio.'),
  tr(U('u21',['perfekt','partizip-ii','akkusativ'],3,true),'Ayer compré un libro y llamé a mi madre.',['Gestern habe ich ein Buch gekauft und meine Mutter angerufen.','Ich habe gestern ein Buch gekauft und meine Mutter angerufen.'],'haben + gekauft / angerufen; meine Mutter en acusativo.'),
  // U22
  gap(U('u22',['praeteritum-haben-sein-modal'],1),'Pasado de sein y haben','Gestern ___ (sein) ich krank. Ich ___ (haben) Fieber.',['war','hatte'],'war / hatte.'),
  gap(U('u22',['praeteritum-haben-sein-modal'],2),'Pasado de sein y haben','Wo ___ (sein) ihr? Wir ___ (haben) keine Zeit.',['wart','hatten'],'ihr wart; wir hatten.'),
  gap(U('u22',['praeteritum-haben-sein-modal'],2),'Pasado de los modales','Ich ___ (können) nicht kommen. Er ___ (müssen) arbeiten. Sie ___ (wollen) schlafen.',['konnte','musste','wollte'],'Modales en pasado pierden el umlaut: konnte, musste, wollte.'),
  gap(U('u22',['praeteritum'],2),'Präteritum regular','Früher ___ (wohnen) ich in Marokko und ___ (arbeiten) im Hotel.',['wohnte','arbeitete'],'raíz + -te; arbeiten → arbeitete.'),
  gap(U('u22',['praeteritum'],3),'Präteritum irregular','Der König ___ (kommen) und ___ (gehen) in den Wald. Er ___ (sehen) ein Haus.',['kam','ging','sah'],'kam, ging, sah: sin terminación en er.'),
  reading(U('u22',['praeteritum','praeteritum-haben-sein-modal'],3),'Es war einmal ein junger Mann. Er wohnte in einem kleinen Dorf und arbeitete in einer Bäckerei. Jeden Morgen stand er um fünf Uhr auf. Eines Tages kam eine Frau in die Bäckerei. Sie hatte einen großen Korb und wollte zehn Brote kaufen. Der junge Mann konnte nicht alle Brote finden, denn er hatte nur sechs. Die Frau lachte und nahm die sechs Brote.',[
    { q: '¿Dónde trabajaba el joven?', options: ['En una panadería','En un hotel','En un bosque'], answer: 0 },
    { q: '¿Cuántos panes quería la mujer?', options: ['seis','diez','cinco'], answer: 1 },
    { q: '¿Qué verbo del texto es un Präteritum irregular?', options: ['wohnte','arbeitete','kam'], answer: 2 },
  ],'Texto escrito por la app en Präteritum (AI). kam es irregular (kommen); wohnte y arbeitete son regulares.'),
  tr(U('u22',['praeteritum-haben-sein-modal'],2),'Ayer estaba cansado y no tenía tiempo.',['Gestern war ich müde und hatte keine Zeit.','Gestern war ich müde und ich hatte keine Zeit.'],'war / hatte.'),
  tr(U('u22',['praeteritum-haben-sein-modal','modalverben-satzbau'],3),'No pude venir porque tenía que trabajar.',['Ich konnte nicht kommen, denn ich musste arbeiten.','Ich konnte nicht kommen, weil ich arbeiten musste.'],'konnte / musste; con weil el modal va al final.'),
  // U23
  gap(U('u23',['futur'],1),'Conjuga werden','Ich ___ Deutsch lernen. Er ___ Arzt.',['werde','wird'],'ich werde; er wird.'),
  gap(U('u23',['futur'],2),'Conjuga werden','Du ___ das schaffen. Ihr ___ uns besuchen.',['wirst','werdet'],'du wirst; ihr werdet.'),
  order(U('u23',['futur','modalverben-satzbau'],2),['werde','morgen','ich','anrufen','dich'],['Ich werde dich morgen anrufen.','Morgen werde ich dich anrufen.'],'werden en 2ª posición, infinitivo al final.'),
  mc(U('u23',['futur'],2),'Elige la forma más natural','Mañana voy a Barcelona:',['Morgen werde ich nach Barcelona fahren werden.','Morgen fahre ich nach Barcelona.','Morgen ich fahre nach Barcelona.'],1,'Con marcador temporal, el presente es lo natural.'),
  tr(U('u23',['futur'],2),'El año que viene aprenderé más alemán.',['Nächstes Jahr werde ich mehr Deutsch lernen.','Nächstes Jahr lerne ich mehr Deutsch.'],'Ambas correctas: presente o werden.'),
  tr(U('u23',['futur'],3),'Mañana va a llover. Nos quedaremos en casa.',['Morgen wird es regnen. Wir werden zu Hause bleiben.','Morgen regnet es. Wir bleiben zu Hause.'],'werden + infinitivo o presente.'),
  // U24
  gap(U('u24',['wechselpraepositionen'],1),'wohin? → acusativo','Ich gehe in ___ Küche (f). Er geht in ___ Park (m).',['die','den'],'Movimiento → acusativo.'),
  gap(U('u24',['wechselpraepositionen'],1),'wo? → dativo','Ich bin in ___ Küche (f). Er ist in ___ Park (m).',['der','dem'],'Posición → dativo.'),
  gap(U('u24',['wechselpraepositionen'],2),'Usa la contracción','Wir gehen ___ Kino (in + das). Wir sind ___ Kino (in + dem).',['ins','im'],'ins = in das; im = in dem.'),
  gap(U('u24',['wechselpraepositionen'],2),'Colocar vs. estar','Ich lege das Buch auf ___ Tisch (m). Das Buch liegt auf ___ Tisch.',['den','dem'],'legen → acu.; liegen → dat.'),
  gap(U('u24',['wechselpraepositionen'],3),'Completa','Sie hängt das Bild an ___ Wand (f). Jetzt hängt es an ___ Wand.',['die','der'],'hängen (colocar) → acu.; hängen (estar) → dat.'),
  gap(U('u24',['wechselpraepositionen','dativ'],2),'Tiempo → dativo','___ Montag (an + dem) habe ich frei. ___ Sommer (in + dem) ist es heiß.',['Am','Im'],'Expresiones de tiempo con an/in → dativo: am, im.'),
  classify(U('u24',['praepositionen','wechselpraepositionen'],2),'¿Qué caso rige?',['solo acusativo','solo dativo','ambos (wo/wohin)'],[['für',0],['mit',1],['in',2],['auf',2],['ohne',0],['seit',1],['zwischen',2],['zu',1],['durch',0],['über',2]],'Acusativo: bis durch für gegen ohne um. Dativo: aus bei mit nach seit von zu. Doble: an auf hinter in neben über unter vor zwischen.'),
  mc(U('u24',['wechselpraepositionen'],2),'Elige la opción correcta','Die Katze schläft ___ Bett.',['unter das','unter dem','unter den'],1,'Posición (wo?) → dativo neutro: dem.'),
  tr(U('u24',['wechselpraepositionen'],3),'Voy al cine. Estoy en el cine.',['Ich gehe ins Kino. Ich bin im Kino.'],'ins (movimiento) / im (posición).'),
  tr(U('u24',['wechselpraepositionen','perfekt'],3,true),'Ayer puse el libro en la mesa.',['Gestern habe ich das Buch auf den Tisch gelegt.','Ich habe gestern das Buch auf den Tisch gelegt.'],'legen → acusativo (auf den Tisch); Perfekt: habe … gelegt.'),
  tr(U('u24',['dativ-praepositionen','wechselpraepositionen','modalverben'],4,true),'¿Puedes ir a la estación con el autobús y esperar delante de la puerta?',['Kannst du mit dem Bus zum Bahnhof fahren und vor der Tür warten?'],'mit dem Bus (dat.), zum Bahnhof (zu + dat.), vor der Tür (posición → dat.); infinitivos al final.'),
]
