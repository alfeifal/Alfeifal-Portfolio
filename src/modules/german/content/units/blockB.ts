import type { Unit, Concept, VocabItem, Exercise } from '../types'
import { v, mc, gap, tr, order, match, classify } from '../helpers'

export const units: Unit[] = [
{ id: 'u8', number: 8, block: 'B', title: 'Sustantivos y género', titleDe: 'Nomen und Genus', cefr: 'A1', page: 42,
  objectives: ['Usar las pistas de terminación para adivinar el género', 'Conocer los grupos semánticos por género', 'Formar el género de los sustantivos compuestos'],
  concepts: ['genus', 'komposita'],
  learn: [
    { title: 'Género gramatical', body: 'El género en alemán es **gramatical**, no biológico: *das Mädchen* (la chica) es neutro y *die Person* (la persona) es femenino aunque se refiera a un hombre. Por eso hay que aprender cada sustantivo con su artículo. Aun así, hay pistas fiables.' },
    { title: 'Pistas para masculino (der)', body: '**Terminaciones**: -er (der Lehrer, der Computer), -ig (der Honig), -ling (der Frühling), -ismus (der Tourismus), -ant/-ent (der Student), -ist (der Tourist).\n\n**Grupos**: días, meses y estaciones (*der Montag, der Mai, der Sommer*), puntos cardinales (*der Norden*), fenómenos meteorológicos (*der Regen, der Schnee*), marcas de coche (*der BMW*), bebidas alcohólicas (*der Wein*, pero *das Bier*).' },
    { title: 'Pistas para femenino (die)', body: '**Terminaciones**: -e (die Lampe, die Straße — la mayoría), -ung (die Zeitung), -heit/-keit (die Freiheit, die Möglichkeit), -schaft (die Freundschaft), -ion (die Nation), -tät (die Universität), -ie (die Familie), -ik (die Musik), -ur (die Natur), -in (die Lehrerin).\n\n**Grupos**: casi todos los nombres de árboles y flores (*die Rose*), muchos ríos alemanes, motos y barcos, y las cifras (*die Eins*).' },
    { title: 'Pistas para neutro (das)', body: '**Terminaciones**: -chen y -lein (das Mädchen, das Fräulein — diminutivos), -ment (das Dokument), -um (das Zentrum), -ma (das Thema), -o (das Auto, das Büro), -tum (das Eigentum).\n\n**Grupos**: infinitivos usados como sustantivo (*das Essen, das Lernen*), colores (*das Blau*), letras (*das A*), casi todos los países y ciudades (*das schöne Berlin*), metales (*das Gold*), muchas palabras con prefijo *Ge-* (*das Gebäude*).' },
    { title: 'Sustantivos compuestos', body: 'El alemán junta palabras. El género lo decide **la última**: *die Stadt + der Plan → der Stadtplan*; *das Haus + die Tür → die Haustür*. Aprende bien las palabras cortas y tendrás el género de cientos de compuestos.\n\nArtículos en plural: siempre **die** (*die Tische, die Frauen, die Kinder*). El indefinido no tiene plural (*Kinder*, sin artículo).' }
  ],
  understand: [
    { title: 'Estrategia realista', body: 'No intentes memorizar todas las reglas de golpe. Empieza por las más rentables: **-e → die** (con excepciones como *der Name, der Käse, das Ende*), **-ung / -heit / -keit / -ion → die**, **-chen → das**, **-er (personas y aparatos) → der**. Eso cubre la mayoría del vocabulario A1–A2.' }
  ],
  bookExercises: ['Asignar artículos a grupos de sustantivos (8.1, 8.2)', 'Reescribir con mayúsculas (8.3)', 'Traducción (8.4)']
},
{ id: 'u9', number: 9, block: 'B', title: 'Plural de los sustantivos', titleDe: 'Plural', cefr: 'A1', page: 50,
  objectives: ['Conocer los 5 patrones de plural', 'Predecir el plural según el género', 'Formar el plural de palabras extranjeras'],
  concepts: ['plural'],
  learn: [
    { title: 'Los patrones de plural', body: 'En español el plural es -s / -es. En alemán hay varias terminaciones, a veces con umlaut:\n\n| patrón | ejemplo |\n| -e (con o sin ¨) | der Tisch → die Tische; der Stuhl → die Stühle |\n| -(e)n | die Frau → die Frauen; die Lampe → die Lampen |\n| -er (con ¨ si puede) | das Kind → die Kinder; das Buch → die Bücher |\n| — (sin cambio, a veces ¨) | der Lehrer → die Lehrer; der Vater → die Väter |\n| -s | das Auto → die Autos; das Hotel → die Hotels |' },
    { title: 'Pistas por género', body: '**Masculinos**: la mayoría -e, a menudo con umlaut (*Züge, Stühle*). Los acabados en -er/-el/-en no cambian (*Lehrer, Schlüssel*).\n\n**Femeninos**: la gran mayoría **-(e)n** (*Frauen, Zeitungen, Straßen*). Los acabados en -in doblan la n: *Lehrerin → Lehrerinnen*. Excepción frecuente: *die Mutter → die Mütter*, *die Tochter → die Töchter*.\n\n**Neutros**: muchos **-er** con umlaut (*Kinder, Bücher, Häuser*); los de -chen/-lein no cambian (*die Mädchen*).\n\n**Palabras extranjeras**: -s (*Autos, Handys, Cafés, Hotels*).' }
  ],
  understand: [
    { title: 'Cómo aprenderlos', body: 'Aprende el plural **junto** con el artículo: *der Tisch, die Tische*. En el diccionario aparece como *Tisch, der; -e*. Si dudas: femenino → -n; neutro corto → -er con umlaut; extranjera → -s.' }
  ],
  bookExercises: ['Formar plurales a partir de la información dada (9.1, 9.2)', 'Identificar patrones por género (9.3)', 'Traducción (9.4)']
},
{ id: 'u10', number: 10, block: 'B', title: 'Los cuatro casos', titleDe: 'Die vier Fälle', cefr: 'A1+', page: 56,
  objectives: ['Entender qué es un caso y para qué sirve', 'Conocer los tres factores que determinan el caso', 'Identificar sujeto, objeto directo e indirecto'],
  concepts: ['kasus'],
  learn: [
    { title: 'Qué son los casos', body: 'El caso indica la **función** que hace un sustantivo o pronombre en la frase. En español lo vemos en los pronombres: *yo* (sujeto) / *me* (objeto) / *mí* (tras preposición). En alemán se ve en **todos** los artículos, posesivos, adjetivos y pronombres.\n\n| caso | función principal | ejemplo |\n| Nominativo | sujeto | **Der** Mann liest. |\n| Acusativo | objeto directo | Ich sehe **den** Mann. |\n| Dativo | objeto indirecto | Ich gebe **dem** Mann das Buch. |\n| Genitivo | posesión | Das Auto **des** Mannes. |' },
    { title: 'Tres factores que deciden el caso', body: '1. **La función** en la frase: sujeto → nominativo; objeto directo → acusativo; objeto indirecto → dativo.\n2. **El verbo**: algunos verbos exigen un caso concreto (*helfen* + dativo: *Ich helfe dir*).\n3. **La preposición**: cada preposición rige un caso (*für* + acusativo, *mit* + dativo).\n\nPrimero mira si hay preposición; luego el verbo; y si no, la función.' },
    { title: 'Tabla general de artículos', body: '| | masc. | fem. | neutro | plural |\n| Nom. | der / ein | die / eine | das / ein | die / — |\n| Acu. | den / einen | die / eine | das / ein | die / — |\n| Dat. | dem / einem | der / einer | dem / einem | den / — (+n) |\n| Gen. | des / eines (+s) | der / einer | des / eines (+s) | der / — |\n\nEsta tabla se verá caso por caso en las unidades 11–14.' }
  ],
  understand: [
    { title: 'Cómo encontrar el sujeto', body: 'Pregunta «¿quién hace la acción?» → nominativo. «¿Qué / a quién?» directamente tras el verbo → acusativo. «¿A quién le…?» (destinatario) → dativo. *Ich gebe **meiner Schwester** (dativo) **das Buch** (acusativo).*' }
  ],
  bookExercises: ['Subrayar el sujeto (10.1)', 'Identificar objetos acusativo/dativo (10.2)', 'Tabla de terminaciones (10.3)']
},
{ id: 'u11', number: 11, block: 'B', title: 'El nominativo', titleDe: 'Nominativ', cefr: 'A1+', page: 62,
  objectives: ['Reconocer el nominativo como caso del sujeto', 'Usarlo tras sein y werden', 'Formas del artículo en nominativo'],
  concepts: ['nominativ'],
  learn: [
    { title: 'El caso del sujeto', body: 'El nominativo es la forma «de diccionario». Lo usa el **sujeto** de la frase:\n\n- ***Der** Hund schläft.*\n- ***Eine** Frau wartet.*\n\n| | masc. | fem. | neutro | plural |\n| definido | der | die | das | die |\n| indefinido | ein | eine | ein | — |\n| negativo | kein | keine | kein | keine |' },
    { title: 'Tras sein y werden', body: 'Con *sein* (ser/estar) y *werden* (llegar a ser) las dos partes de la frase van en nominativo, porque no hay objeto sino identificación:\n\n- *Das ist **mein** Bruder.*\n- *Er wird **ein** guter Lehrer.*\n- *Sie ist **eine** Freundin von mir.*' }
  ],
  understand: [
    { title: 'Ojo con el orden', body: 'El sujeto no siempre va al principio: *Heute kommt **der** Zug* — *der Zug* sigue siendo sujeto y nominativo. La posición no decide el caso; la función sí.' }
  ],
  bookExercises: ['Artículos en nominativo (11.1)', 'Subrayar el sujeto (11.2)', 'Traducción (11.3)']
},
{ id: 'u12', number: 12, block: 'B', title: 'El acusativo', titleDe: 'Akkusativ', cefr: 'A1+', page: 65,
  objectives: ['Usar el acusativo para el objeto directo', 'Cambiar den / einen / keinen / meinen en masculino', 'Conocer las preposiciones de acusativo'],
  concepts: ['akkusativ', 'akkusativ-praepositionen'],
  learn: [
    { title: 'Cuándo se usa', body: 'El acusativo es el caso del **objeto directo** («¿qué?» tras el verbo):\n\n- *Ich kaufe **den** Tisch.* — Compro la mesa.\n- *Sie hat **einen** Bruder.* — Tiene un hermano.\n\nLa buena noticia: **solo cambia el masculino**. Femenino, neutro y plural son iguales que en nominativo.' },
    { title: 'Terminaciones', body: '| | masc. | fem. | neutro | plural |\n| definido | de**n** | die | das | die |\n| indefinido | eine**n** | eine | ein | — |\n| negativo | keine**n** | keine | kein | keine |\n| posesivo | meine**n** | meine | mein | meine |\n\nRegla: masculino acusativo = **-en** en todo lo que va delante del sustantivo.' },
    { title: 'Tras verbos y preposiciones', body: 'La mayoría de verbos con objeto (transitivos, «vt» en el diccionario) rigen acusativo: *haben, kaufen, sehen, essen, trinken, lesen, brauchen, suchen, finden…*\n\nEstas preposiciones **siempre** llevan acusativo:\n\n| bis | hasta |\n| durch | a través de |\n| für | para |\n| gegen | contra |\n| ohne | sin |\n| um | alrededor de / a las (hora) |\n\n*Das Geschenk ist für **meinen** Vater. Wir gehen durch **den** Park. Er kommt ohne **seinen** Freund.*\n\nPuede haber más de un acusativo en la frase: *Ich kaufe **einen** Tisch für **meinen** Bruder.*' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'En español no cambia el artículo: «Veo **el** coche». En alemán tienes que preguntarte: ¿es masculino? ¿es objeto? → **den**. Truco: si el sustantivo es *der*, y no es el sujeto, casi seguro es *den*.' }
  ],
  bookExercises: ['Formar frases con objetos (12.1)', 'Terminaciones tras preposiciones (12.2)', 'Traducción (12.3)']
},
{ id: 'u13', number: 13, block: 'B', title: 'El dativo', titleDe: 'Dativ', cefr: 'A2', page: 70,
  objectives: ['Usar el dativo para el objeto indirecto', 'Terminaciones dem / der / dem / den(+n)', 'Verbos y preposiciones de dativo'],
  concepts: ['dativ', 'dativ-praepositionen', 'dativ-verben'],
  learn: [
    { title: 'Cuándo se usa', body: 'El dativo marca el **objeto indirecto** («¿a quién?», el destinatario):\n\n- *Ich gebe **dem** Kind ein Eis.* — Le doy un helado al niño.\n- *Sie schreibt **ihrer** Mutter.* — Escribe a su madre.\n\nA diferencia del acusativo, **todos los géneros cambian**.' },
    { title: 'Terminaciones', body: '| | masc. | fem. | neutro | plural |\n| definido | de**m** | de**r** | de**m** | de**n** + -n |\n| indefinido | eine**m** | eine**r** | eine**m** | — + -n |\n| negativo | keine**m** | keine**r** | keine**m** | keine**n** + -n |\n| posesivo | meine**m** | meine**r** | meine**m** | meine**n** + -n |\n\nEn **plural dativo el sustantivo añade -n** si no lo tiene ya: *die Kinder → den Kinder**n***, *die Freunde → den Freunde**n*** (pero *die Autos → den Autos*).' },
    { title: 'Verbos de dativo', body: 'Algunos verbos rigen dativo aunque en español lleven objeto directo:\n\n- *helfen* — ayudar: *Ich helfe **dir**.*\n- *danken* — agradecer: *Ich danke **Ihnen**.*\n- *gefallen* — gustar: *Das gefällt **mir**.*\n- *gehören* — pertenecer: *Das gehört **meinem** Bruder.*\n- *antworten*, *folgen*, *glauben*, *gratulieren*, *passen*, *schmecken*.' },
    { title: 'Preposiciones de dativo', body: 'Siempre dativo:\n\n| aus | de (origen) |\n| bei | en casa de / junto a |\n| mit | con |\n| nach | a (países, ciudades) / después de |\n| seit | desde (tiempo) |\n| von | de |\n| zu | a (personas, lugares) |\n| gegenüber | enfrente de |\n\nContracciones: *bei + dem = **beim***, *von + dem = **vom***, *zu + dem = **zum***, *zu + der = **zur***.\n\n*Ich fahre mit **dem** Bus. Sie kommt aus **der** Schweiz. Wir gehen zum Arzt.*' }
  ],
  understand: [
    { title: 'Cómo distinguir acusativo y dativo', body: 'Si hay preposición, ella manda. Si no: el que **recibe** la acción es acusativo; el que **se beneficia** o recibe el objeto es dativo. *Ich kaufe **meiner Schwester** (dativo: para ella) **einen Hund** (acusativo: lo comprado).* Frase mnemotécnica de las preposiciones de dativo: **aus-bei-mit-nach-seit-von-zu**.' }
  ],
  bookExercises: ['Frases de regalos (13.1)', 'Terminaciones tras preposiciones y verbos de dativo (13.2)', 'Traducción (13.3)']
},
{ id: 'u14', number: 14, block: 'B', title: 'El genitivo', titleDe: 'Genitiv', cefr: 'A2', page: 75,
  objectives: ['Expresar posesión con genitivo', 'Añadir -s/-es al sustantivo masculino y neutro', 'Sustituirlo por von + dativo en lengua hablada'],
  concepts: ['genitiv'],
  learn: [
    { title: 'Posesión', body: 'El genitivo expresa «de» (posesión, pertenencia). El poseedor va detrás:\n\n- *das Auto **des** Mann**es*** — el coche del hombre\n- *die Tasche **der** Frau* — el bolso de la mujer\n- *das Zimmer **des** Kind**es*** — la habitación del niño\n\n| | masc. | fem. | neutro | plural |\n| definido | des + -(e)s | der | des + -(e)s | der |\n| indefinido | eines + -(e)s | einer | eines + -(e)s | — |\n| posesivo | meines + -(e)s | meiner | meines + -(e)s | meiner |\n\nMasculino y neutro añaden **-s** (o **-es** si son monosílabos o acaban en s/ß/z: *des Hauses, des Kindes*).' },
    { title: 'Nombres propios y preposiciones', body: 'Con nombres propios se añade -s **sin apóstrofo**: *Peters Auto*, *Marias Buch* (no *Peter\'s*).\n\nPreposiciones de genitivo (más formales): *wegen* (a causa de), *trotz* (a pesar de), *während* (durante), *(an)statt* (en lugar de): *Wegen des Regens bleiben wir zu Hause.*' },
    { title: 'En el alemán hablado', body: 'En conversación se sustituye a menudo por **von + dativo**: *das Auto von dem Mann → das Auto vom Mann*, *das Buch von meiner Schwester*. Aprende a reconocer el genitivo en la lengua escrita y a producirlo con *von* si no estás seguro.' }
  ],
  understand: [
    { title: 'Prioridad', body: 'El genitivo es el caso menos usado en el nivel básico. Prioriza dominar acusativo y dativo; del genitivo, de momento, quédate con *des …-(e)s* y con *wegen*.' }
  ],
  bookExercises: ['Sustituir genitivo por von + dativo (14.1)', 'Terminaciones y cambios del sustantivo (14.2)', 'Traducción (14.3)']
},
{ id: 'u15', number: 15, block: 'B', title: 'Pronombres personales', titleDe: 'Personalpronomen', cefr: 'A1+', page: 79,
  objectives: ['Usar los pronombres según el género gramatical (er = der Tisch)', 'Declinar los pronombres en acusativo y dativo', 'Elegir el caso del pronombre'],
  concepts: ['personalpronomen-nom', 'personalpronomen-akk', 'personalpronomen-dat'],
  learn: [
    { title: 'Pronombres en nominativo', body: '| ich | yo |\n| du | tú |\n| er / sie / es | él / ella / ello |\n| wir | nosotros |\n| ihr | vosotros |\n| sie | ellos |\n| Sie | usted / ustedes |\n\nLos pronombres siguen el **género gramatical**: *Der Tisch ist neu. **Er** ist groß.* (er, no es); *Die Tasche ist teuer. **Sie** ist schön.*; *Das Mädchen lernt. **Es** ist nett.*' },
    { title: 'Acusativo', body: '| nom. | acu. | |\n| ich | mich | me |\n| du | dich | te |\n| er | ihn | lo |\n| sie | sie | la |\n| es | es | lo |\n| wir | uns | nos |\n| ihr | euch | os |\n| sie / Sie | sie / Sie | los / le(s) |\n\n*Ich sehe **dich**. Kennst du **ihn**? Wir besuchen **euch**.* También tras preposiciones de acusativo: *Das ist für **mich**.*' },
    { title: 'Dativo', body: '| nom. | dat. | |\n| ich | mir | me |\n| du | dir | te |\n| er | ihm | le |\n| sie | ihr | le |\n| es | ihm | le |\n| wir | uns | nos |\n| ihr | euch | os |\n| sie / Sie | ihnen / Ihnen | les |\n\n*Ich helfe **dir**. Das gefällt **mir**. Gib **ihm** das Buch.* Tras preposiciones de dativo: *Kommst du mit **uns**?*\n\nFrases frecuentes: *Wie geht es **dir**? Es tut **mir** leid. Das ist **mir** egal.*' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'El español también distingue *lo* (directo) y *le* (indirecto), así que ya tienes la intuición: «lo veo» → *ihn*, «le doy» → *ihm*. Lo nuevo es que *mich/mir* y *dich/dir* se distinguen (en español ambos son *me/te*). *uns* y *euch* son iguales en los dos casos.' }
  ],
  bookExercises: ['Sustituir sujetos por pronombres (15.1)', 'Responder con pronombres (15.2)', 'Pronombres de dativo (15.3)', 'Traducción con du y Sie (15.4)']
},
{ id: 'u16', number: 16, block: 'B', title: 'Posesivos', titleDe: 'Possessivartikel', cefr: 'A1+', page: 87,
  objectives: ['Conocer los siete posesivos', 'Declinarlos como ein / kein', 'Manejar la variación euer → eure'],
  concepts: ['possessiv'],
  learn: [
    { title: 'Los posesivos', body: '| ich | mein | mi |\n| du | dein | tu |\n| er | sein | su (de él) |\n| sie | ihr | su (de ella) |\n| es | sein | su |\n| wir | unser | nuestro |\n| ihr | euer | vuestro |\n| sie | ihr | su (de ellos) |\n| Sie | Ihr | su (de usted) |\n\nOjo: *sein* = de él, *ihr* = de ella / de ellos. El español «su» no distingue; el alemán sí.' },
    { title: 'Terminaciones', body: 'Los posesivos se declinan **exactamente igual que ein / kein**. La terminación concuerda con el sustantivo poseído (género, número, caso), no con el poseedor:\n\n| | masc. | fem. | neutro | plural |\n| Nom. | mein | mein**e** | mein | mein**e** |\n| Acu. | mein**en** | mein**e** | mein | mein**e** |\n| Dat. | mein**em** | mein**er** | mein**em** | mein**en** |\n| Gen. | mein**es** | mein**er** | mein**es** | mein**er** |\n\n*Ich sehe **meinen** Bruder. Sie hilft **ihrer** Mutter. Das ist **unser** Haus.*\n\n**euer** pierde la e interna al añadir terminación: *euer Haus* pero *eu**re** Kinder*, *eu**rem** Vater*.' }
  ],
  understand: [
    { title: 'Truco', body: 'Si sabes decir *ein/eine/einen/einem/einer*, sabes decir todos los posesivos: sustituye *ein* por *mein, dein, sein…* Solo ten cuidado con *ihr* (ella / ellos) y *Ihr* (usted).' }
  ],
  bookExercises: ['Relacionar posesivos (16.1)', 'Terminaciones en nominativo (16.2)', 'Frases con «buscar» (16.3)', 'Traducción (16.4)']
},
{ id: 'u17', number: 17, block: 'B', title: 'Verbos reflexivos', titleDe: 'Reflexive Verben', cefr: 'A2', page: 92,
  objectives: ['Usar el pronombre reflexivo en acusativo', 'Usar el reflexivo en dativo cuando hay objeto directo', 'Conocer los reflexivos de la rutina diaria'],
  concepts: ['reflexiv'],
  learn: [
    { title: 'Pronombres reflexivos', body: 'Muchas acciones que uno hace sobre sí mismo usan un pronombre reflexivo (*sich*):\n\n| ich | mich (acu.) / mir (dat.) |\n| du | dich / dir |\n| er/sie/es | sich |\n| wir | uns |\n| ihr | euch |\n| sie/Sie | sich |\n\nSolo la 3ª persona tiene forma propia (*sich*); el resto coincide con los pronombres personales.' },
    { title: 'Reflexivos frecuentes', body: '- *sich waschen* — lavarse\n- *sich duschen* — ducharse\n- *sich anziehen* — vestirse\n- *sich kämmen* — peinarse\n- *sich freuen (auf/über)* — alegrarse\n- *sich interessieren (für)* — interesarse\n- *sich setzen* — sentarse\n- *sich beeilen* — darse prisa\n- *sich erinnern (an)* — acordarse\n- *sich fühlen* — sentirse\n\n*Ich wasche **mich**. Er zieht **sich** an. Wir freuen **uns**.*' },
    { title: 'Acusativo o dativo', body: 'Normalmente el reflexivo va en **acusativo**. Pero si la frase ya tiene un objeto directo (una parte del cuerpo, una prenda), el reflexivo pasa a **dativo**:\n\n- *Ich wasche **mich**.* → *Ich wasche **mir** die Hände.*\n- *Ich ziehe **mich** an.* → *Ich ziehe **mir** die Jacke an.*\n\nEsto solo se nota en *ich* (mich/mir) y *du* (dich/dir); *sich, uns, euch* no cambian.' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'El español funciona casi igual (*me lavo*, *me lavo las manos*), solo que no distingue *mich/mir*. Y no todos los reflexivos coinciden: *sich freuen* (alegrarse) sí, pero *sich setzen* = sentarse, *sich beeilen* = darse prisa. Reflexivo separable: *Ich ziehe mich um* (me cambio de ropa).' }
  ],
  bookExercises: ['Identificar reflexivos (17.1)', 'Formar frases (17.2)', 'Reflexivos en dativo (17.3)', 'Rutina de la mañana: traducción (17.4)']
},
{ id: 'u18', number: 18, block: 'B', title: 'Negación', titleDe: 'Negation: nicht und kein', cefr: 'A1+', page: 97,
  objectives: ['Negar con nicht y colocarlo bien', 'Negar sustantivos con kein', 'Declinar kein'],
  concepts: ['nicht', 'kein'],
  learn: [
    { title: 'nicht', body: '*nicht* niega verbos, adjetivos, adverbios y sustantivos con artículo definido o posesivo:\n\n- *Ich arbeite **nicht**.*\n- *Das Auto ist **nicht** neu.*\n- *Ich kenne **das** Buch **nicht**.*\n\n**Posición**: al final de la frase si niega todo; justo **delante** de lo que niega si es un elemento concreto; delante del infinitivo, participio o prefijo separable: *Ich kann **nicht** kommen. Ich stehe **nicht** auf. Er kommt **nicht** aus Berlin.*' },
    { title: 'kein', body: '*kein* niega sustantivos con **artículo indefinido o sin artículo** («ningún», «nada de»):\n\n- *Ich habe **ein** Auto.* → *Ich habe **kein** Auto.*\n- *Ich trinke Kaffee.* → *Ich trinke **keinen** Kaffee.*\n\nSe declina como *ein* (y tiene plural):\n\n| | masc. | fem. | neutro | plural |\n| Nom. | kein | keine | kein | keine |\n| Acu. | keinen | keine | kein | keine |\n| Dat. | keinem | keiner | keinem | keinen |' },
    { title: 'Casos ambiguos', body: 'Con expresiones fijas con *haben* se usa *kein*: *Ich habe **keine** Zeit / **keinen** Hunger / **keine** Lust.* Para responder a una pregunta negativa afirmativamente se usa *doch*: *Hast du keine Zeit? — **Doch**, ich habe Zeit.*' }
  ],
  understand: [
    { title: 'Regla rápida', body: '¿Delante del sustantivo hay *ein* o nada? → **kein**. ¿Hay *der/die/das* o *mein/dein…*? → **nicht**. ¿No hay sustantivo? → **nicht**.' }
  ],
  bookExercises: ['Negar con nicht en la posición correcta (18.1)', 'Responder con kein (18.2)', 'Traducción (18.3)']
}]

export const concepts: Concept[] = [
  { id: 'genus', name: 'Genus', nameEs: 'Género: pistas y grupos', unitId: 'u8', summary: '-e/-ung/-heit/-keit/-ion → die; -chen/-lein → das; -er (personas) → der.', mistakes: ['*das Zeitung* (-ung → die)', '*die Mädchen* en singular (-chen → das)', 'Copiar el género del español'], related: ['komposita', 'plural'] },
  { id: 'komposita', name: 'Komposita', nameEs: 'Sustantivos compuestos', unitId: 'u8', summary: 'El género lo da la última palabra.', mistakes: ['*das Haustür* (Tür es femenino → die Haustür)'], related: ['genus'] },
  { id: 'plural', name: 'Plural', nameEs: 'Plural de los sustantivos', unitId: 'u9', summary: '-e, -(e)n, -er, —, -s; femeninos casi siempre -(e)n.', mistakes: ['*die Frau-s*', '*die Kinds* (→ Kinder)', 'Olvidar el umlaut (*Bucher* → Bücher)'], related: ['genus', 'dativ'] },
  { id: 'kasus', name: 'Kasus', nameEs: 'Los cuatro casos', unitId: 'u10', summary: 'Función, verbo y preposición determinan el caso.', mistakes: ['Pensar que la posición en la frase decide el caso'], related: ['nominativ', 'akkusativ', 'dativ', 'genitiv'] },
  { id: 'nominativ', name: 'Nominativ', nameEs: 'Nominativo', unitId: 'u11', summary: 'Sujeto y complemento de sein/werden.', mistakes: ['*Das ist meinen Bruder* (tras sein: nominativo → mein Bruder)'], related: ['kasus'] },
  { id: 'akkusativ', name: 'Akkusativ', nameEs: 'Acusativo', unitId: 'u12', summary: 'Objeto directo; solo cambia masculino: den/einen/keinen/meinen.', mistakes: ['*Ich habe ein Bruder* (→ einen)', '*Ich sehe der Mann* (→ den)', 'Cambiar femenino/neutro (no cambian)'], related: ['akkusativ-praepositionen', 'personalpronomen-akk'] },
  { id: 'akkusativ-praepositionen', name: 'Präpositionen + Akkusativ', nameEs: 'Preposiciones de acusativo', unitId: 'u12', summary: 'bis, durch, für, gegen, ohne, um.', mistakes: ['*für meinem Vater* (→ meinen)', '*ohne dem Auto* (→ das Auto)'], related: ['akkusativ', 'praepositionen'] },
  { id: 'dativ', name: 'Dativ', nameEs: 'Dativo', unitId: 'u13', summary: 'Objeto indirecto: dem/der/dem/den+n.', mistakes: ['*Ich gebe den Kind das Buch* (→ dem)', 'Olvidar la -n del plural (*den Kindern*)', '*mit meine Freunde* (→ meinen Freunden)'], related: ['dativ-praepositionen', 'dativ-verben', 'personalpronomen-dat'] },
  { id: 'dativ-praepositionen', name: 'Präpositionen + Dativ', nameEs: 'Preposiciones de dativo', unitId: 'u13', summary: 'aus, bei, mit, nach, seit, von, zu, gegenüber. Contracciones beim, vom, zum, zur.', mistakes: ['*mit den Bus* (→ dem)', '*zu die Schule* (→ zur)'], related: ['dativ', 'praepositionen'] },
  { id: 'dativ-verben', name: 'Verben + Dativ', nameEs: 'Verbos de dativo', unitId: 'u13', summary: 'helfen, danken, gefallen, gehören, antworten, folgen, glauben, gratulieren, passen, schmecken.', mistakes: ['*Ich helfe dich* (→ dir)', '*Das gefällt mich* (→ mir)'], related: ['dativ'] },
  { id: 'genitiv', name: 'Genitiv', nameEs: 'Genitivo', unitId: 'u14', summary: 'des/der/des/der; masc. y neutro añaden -(e)s. Hablado: von + dativo.', mistakes: ['*das Auto des Mann* (→ Mannes)', '*Peter\'s Auto* (sin apóstrofo)'], related: ['kasus'] },
  { id: 'personalpronomen-nom', name: 'Personalpronomen (Nom.)', nameEs: 'Pronombres sujeto y género gramatical', unitId: 'u15', summary: 'er/sie/es siguen el género gramatical: der Tisch → er.', mistakes: ['*Der Tisch… es ist groß* (→ er)'], related: ['personalpronomen-akk', 'personalpronomen-dat'] },
  { id: 'personalpronomen-akk', name: 'Personalpronomen (Akk.)', nameEs: 'Pronombres en acusativo', unitId: 'u15', summary: 'mich, dich, ihn, sie, es, uns, euch, sie/Sie.', mistakes: ['*Ich sehe er* (→ ihn)', '*für ich* (→ mich)'], related: ['akkusativ'] },
  { id: 'personalpronomen-dat', name: 'Personalpronomen (Dat.)', nameEs: 'Pronombres en dativo', unitId: 'u15', summary: 'mir, dir, ihm, ihr, ihm, uns, euch, ihnen/Ihnen.', mistakes: ['*Ich helfe dich* (→ dir)', '*mit ihn* (→ ihm)', '*Wie geht es du?* (→ dir)'], related: ['dativ'] },
  { id: 'possessiv', name: 'Possessivartikel', nameEs: 'Posesivos', unitId: 'u16', summary: 'mein, dein, sein, ihr, unser, euer, ihr, Ihr; se declinan como ein/kein.', mistakes: ['*sein* para «de ella» (→ ihr)', '*euere* (→ eure)', 'Concordar con el poseedor en vez de con lo poseído'], related: ['akkusativ', 'dativ'] },
  { id: 'reflexiv', name: 'Reflexive Verben', nameEs: 'Verbos reflexivos', unitId: 'u17', summary: 'mich/dich/sich/uns/euch/sich; dativo (mir/dir) si hay objeto directo.', mistakes: ['*Ich wasche mich die Hände* (→ mir)', '*Er wäscht ihn* (reflexivo → sich)'], related: ['personalpronomen-akk', 'personalpronomen-dat'] },
  { id: 'nicht', name: 'nicht', nameEs: 'Negación con nicht', unitId: 'u18', summary: 'Niega verbos, adjetivos y sustantivos con artículo definido; va al final o delante de lo negado.', mistakes: ['*Ich nicht arbeite* (→ Ich arbeite nicht)', '*Ich kann kommen nicht* (→ nicht kommen)'], related: ['kein', 'wortstellung'] },
  { id: 'kein', name: 'kein', nameEs: 'Negación con kein', unitId: 'u18', summary: 'Niega ein + sustantivo o sustantivo sin artículo; se declina como ein.', mistakes: ['*Ich habe nicht ein Auto* (→ kein Auto)', '*Ich habe kein Zeit* (→ keine)', '*Ich trinke kein Kaffee* (→ keinen)'], related: ['nicht', 'akkusativ'] },
]

export const vocab: VocabItem[] = [
  v('u8','A1','casa','die','Lampe','Lampen','lámpara','Die Lampe ist neu.','La lámpara es nueva.'),
  v('u8','A1','medios','die','Zeitung','Zeitungen','periódico','Ich lese die Zeitung.','Leo el periódico.'),
  v('u8','A1','sociedad','die','Universität','Universitäten','universidad','Die Universität ist alt.','La universidad es antigua.'),
  v('u8','A1','familia','die','Familie','Familien','familia','Meine Familie ist groß.','Mi familia es grande.'),
  v('u8','A1','tecnología','der','Computer','Computer','ordenador','Der Computer ist kaputt.','El ordenador está roto.'),
  v('u8','A1','personas','der','Student','Studenten','estudiante','Der Student lernt viel.','El estudiante estudia mucho.'),
  v('u8','A1','personas','die','Lehrerin','Lehrerinnen','profesora','Die Lehrerin erklärt gut.','La profesora explica bien.'),
  v('u8','A1','tiempo','der','Montag','Montage','lunes','Am Montag arbeite ich.','El lunes trabajo.'),
  v('u8','A1','tiempo','der','Sommer','Sommer','verano','Der Sommer ist heiß.','El verano es caluroso.'),
  v('u8','A1','clima','der','Regen','','lluvia','Der Regen ist stark.','La lluvia es fuerte.'),
  v('u8','A1','transporte','das','Auto','Autos','coche','Das Auto ist schnell.','El coche es rápido.'),
  v('u8','A1','trabajo','das','Büro','Büros','oficina','Das Büro ist klein.','La oficina es pequeña.'),
  v('u8','A1','casa','das','Gebäude','Gebäude','edificio','Das Gebäude ist modern.','El edificio es moderno.'),
  v('u8','A1','casa','die','Haustür','Haustüren','puerta de casa','Die Haustür ist offen.','La puerta de casa está abierta.'),
  v('u8','A1','ciudad','der','Stadtplan','Stadtpläne','plano de la ciudad','Ich brauche einen Stadtplan.','Necesito un plano de la ciudad.'),
  v('u9','A1','casa','der','Stuhl','Stühle','silla','Die Stühle sind bequem.','Las sillas son cómodas.'),
  v('u9','A1','básico','das','Buch','Bücher','libro','Die Bücher sind teuer.','Los libros son caros.'),
  v('u9','A1','casa','das','Haus','Häuser','casa','Die Häuser sind alt.','Las casas son antiguas.'),
  v('u9','A1','familia','die','Frau','Frauen','mujer / señora','Die Frauen arbeiten.','Las mujeres trabajan.'),
  v('u9','A1','familia','der','Mann','Männer','hombre / marido','Die Männer spielen Fußball.','Los hombres juegan al fútbol.'),
  v('u9','A1','familia','die','Mutter','Mütter','madre','Die Mütter warten.','Las madres esperan.'),
  v('u9','A1','familia','der','Vater','Väter','padre','Die Väter kochen.','Los padres cocinan.'),
  v('u9','A1','familia','die','Tochter','Töchter','hija','Die Töchter sind klein.','Las hijas son pequeñas.'),
  v('u9','A1','familia','der','Sohn','Söhne','hijo','Die Söhne studieren.','Los hijos estudian.'),
  v('u9','A1','tecnología','das','Handy','Handys','móvil','Die Handys sind neu.','Los móviles son nuevos.'),
  v('u9','A1','viajes','das','Hotel','Hotels','hotel','Die Hotels sind voll.','Los hoteles están llenos.'),
  v('u9','A1','básico','der','Schlüssel','Schlüssel','llave','Die Schlüssel sind hier.','Las llaves están aquí.'),
  v('u9','A1','básico','der','Freund','Freunde','amigo / novio','Meine Freunde kommen.','Mis amigos vienen.'),
  v('u10','A1','animales','der','Hund','Hunde','perro','Der Hund schläft.','El perro duerme.'),
  v('u10','A1','animales','die','Katze','Katzen','gato','Die Katze spielt.','El gato juega.'),
  v('u10','A1','verbos','','geben','','dar','Ich gebe dem Kind ein Eis.','Le doy un helado al niño.','verb'),
  v('u10','A1','verbos','','helfen','','ayudar (+ dativo)','Ich helfe dir.','Te ayudo.','verb'),
  v('u10','A1','verbos','','schenken','','regalar','Er schenkt ihr Blumen.','Él le regala flores.','verb'),
  v('u10','A1','comida','das','Eis','','helado','Das Eis ist kalt.','El helado está frío.'),
  v('u11','A1','verbos','','werden','','llegar a ser / convertirse','Er wird Lehrer.','Él será profesor.','verb'),
  v('u11','A1','personas','die','Freundin','Freundinnen','amiga / novia','Sie ist meine Freundin.','Ella es mi amiga.'),
  v('u11','A1','básico','','neu','','nuevo','Das Auto ist neu.','El coche es nuevo.','adj'),
  v('u11','A1','básico','','heute','','hoy','Heute kommt der Zug.','Hoy llega el tren.','adv'),
  v('u12','A1','verbos','','brauchen','','necesitar','Ich brauche einen Stuhl.','Necesito una silla.','verb'),
  v('u12','A1','verbos','','suchen','','buscar','Sie sucht einen Job.','Ella busca un trabajo.','verb'),
  v('u12','A1','preposiciones','','für','','para (+ acusativo)','Das ist für dich.','Esto es para ti.','prep'),
  v('u12','A1','preposiciones','','ohne','','sin (+ acusativo)','Ich gehe ohne dich.','Voy sin ti.','prep'),
  v('u12','A1','preposiciones','','durch','','a través de (+ acusativo)','Wir gehen durch den Park.','Vamos por el parque.','prep'),
  v('u12','A1','preposiciones','','gegen','','contra (+ acusativo)','Er ist gegen das Angebot.','Él está en contra de la oferta.','prep'),
  v('u12','A1','preposiciones','','um','','alrededor de / a las (+ acusativo)','Um 8 Uhr.','A las 8.','prep'),
  v('u12','A1','casa','der','Schrank','Schränke','armario','Ich kaufe einen Schrank.','Compro un armario.'),
  v('u12','A1','ciudad','der','Park','Parks','parque','Der Park ist groß.','El parque es grande.'),
  v('u12','A1','básico','das','Geschenk','Geschenke','regalo','Das Geschenk ist für dich.','El regalo es para ti.'),
  v('u12','A1','básico','der','Regenschirm','Regenschirme','paraguas','Ich habe einen Regenschirm.','Tengo un paraguas.'),
  v('u13','A2','verbos','','gefallen','','gustar (+ dativo)','Das gefällt mir.','Eso me gusta.','verb'),
  v('u13','A2','verbos','','gehören','','pertenecer (+ dativo)','Das Auto gehört meinem Bruder.','El coche es de mi hermano.','verb'),
  v('u13','A2','verbos','','danken','','agradecer (+ dativo)','Ich danke Ihnen.','Le agradezco.','verb'),
  v('u13','A2','verbos','','schmecken','','saber (bien/mal), gustar (comida)','Die Pizza schmeckt mir.','La pizza me gusta.','verb'),
  v('u13','A1','preposiciones','','mit','','con (+ dativo)','Ich fahre mit dem Bus.','Voy en autobús.','prep'),
  v('u13','A1','preposiciones','','aus','','de (origen, + dativo)','Sie kommt aus der Schweiz.','Ella es de Suiza.','prep'),
  v('u13','A1','preposiciones','','bei','','en casa de / junto a (+ dativo)','Ich wohne bei meinen Eltern.','Vivo en casa de mis padres.','prep'),
  v('u13','A1','preposiciones','','nach','','a (ciudad/país) / después de (+ dativo)','Wir fahren nach Berlin.','Vamos a Berlín.','prep'),
  v('u13','A1','preposiciones','','seit','','desde (+ dativo)','Ich lerne seit einem Jahr Deutsch.','Aprendo alemán desde hace un año.','prep'),
  v('u13','A1','preposiciones','','von','','de (+ dativo)','Das ist ein Geschenk von meiner Mutter.','Es un regalo de mi madre.','prep'),
  v('u13','A1','preposiciones','','zu','','a (persona/lugar, + dativo)','Ich gehe zum Arzt.','Voy al médico.','prep'),
  v('u13','A1','familia','die','Eltern','','padres (pl.)','Meine Eltern wohnen in Girona.','Mis padres viven en Girona.'),
  v('u13','A1','salud','der','Arzt','Ärzte','médico','Ich gehe zum Arzt.','Voy al médico.'),
  v('u13','A1','transporte','der','Bus','Busse','autobús','Der Bus kommt.','El autobús viene.'),
  v('u14','A2','preposiciones','','wegen','','a causa de (+ genitivo)','Wegen des Regens bleibe ich zu Hause.','Por la lluvia me quedo en casa.','prep'),
  v('u14','A2','preposiciones','','trotz','','a pesar de (+ genitivo)','Trotz des Wetters gehen wir.','A pesar del tiempo, vamos.','prep'),
  v('u14','A2','preposiciones','','während','','durante (+ genitivo)','Während des Kurses.','Durante el curso.','prep'),
  v('u14','A2','básico','die','Tasche','Taschen','bolso / bolsa','Die Tasche der Frau.','El bolso de la mujer.'),
  v('u14','A2','casa','das','Zimmer','Zimmer','habitación','Das Zimmer des Kindes.','La habitación del niño.'),
  v('u14','A2','clima','das','Wetter','','tiempo (meteorológico)','Das Wetter ist schlecht.','El tiempo está malo.'),
  v('u15','A1','expresiones','','Wie geht es dir?','','¿Cómo estás?','Wie geht es dir? — Gut, danke.','¿Cómo estás? — Bien, gracias.','phrase'),
  v('u15','A1','expresiones','','Es tut mir leid.','','Lo siento.','Es tut mir leid, ich habe keine Zeit.','Lo siento, no tengo tiempo.','phrase'),
  v('u15','A1','expresiones','','Das ist mir egal.','','Me da igual.','Das ist mir egal.','Me da igual.','phrase'),
  v('u15','A1','verbos','','kennen','','conocer','Kennst du ihn?','¿Lo conoces?','verb'),
  v('u15','A1','verbos','','besuchen','','visitar','Wir besuchen euch.','Os visitamos.','verb'),
  v('u16','A1','familia','die','Großmutter','Großmütter','abuela','Meine Großmutter ist 80.','Mi abuela tiene 80 años.'),
  v('u16','A1','familia','der','Großvater','Großväter','abuelo','Sein Großvater lebt in Hamburg.','Su abuelo vive en Hamburgo.'),
  v('u16','A1','familia','die','Geschwister','','hermanos (pl.)','Hast du Geschwister?','¿Tienes hermanos?'),
  v('u16','A1','casa','die','Wohnung','Wohnungen','piso (vivienda)','Unsere Wohnung ist klein.','Nuestro piso es pequeño.'),
  v('u16','A1','básico','der','Job','Jobs','trabajo (empleo)','Ihr Job ist interessant.','Su trabajo es interesante.'),
  v('u17','A2','rutina','','sich waschen','','lavarse','Ich wasche mich.','Me lavo.','verb'),
  v('u17','A2','rutina','','sich duschen','','ducharse','Er duscht sich morgens.','Él se ducha por la mañana.','verb'),
  v('u17','A2','rutina','','sich anziehen','','vestirse','Sie zieht sich an.','Ella se viste.','verb'),
  v('u17','A2','rutina','','sich kämmen','','peinarse','Ich kämme mir die Haare.','Me peino.','verb'),
  v('u17','A2','rutina','','sich beeilen','','darse prisa','Beeil dich!','¡Date prisa!','verb'),
  v('u17','A2','emociones','','sich freuen','','alegrarse','Ich freue mich.','Me alegro.','verb'),
  v('u17','A2','emociones','','sich interessieren für','','interesarse por','Ich interessiere mich für Musik.','Me interesa la música.','verb'),
  v('u17','A2','emociones','','sich fühlen','','sentirse','Wie fühlst du dich?','¿Cómo te sientes?','verb'),
  v('u17','A2','rutina','','sich setzen','','sentarse','Setzen Sie sich!','¡Siéntese!','verb'),
  v('u17','A2','cuerpo','die','Hand','Hände','mano','Ich wasche mir die Hände.','Me lavo las manos.'),
  v('u17','A2','cuerpo','das','Haar','Haare','pelo','Sie kämmt sich die Haare.','Ella se peina.'),
  v('u17','A2','ropa','die','Jacke','Jacken','chaqueta','Ich ziehe mir die Jacke an.','Me pongo la chaqueta.'),
  v('u18','A1','negación','','nicht','','no','Ich arbeite nicht.','No trabajo.','adv'),
  v('u18','A1','negación','','kein','','ningún / nada de','Ich habe kein Auto.','No tengo coche.','other'),
  v('u18','A1','negación','','doch','','sí (respuesta a pregunta negativa)','Hast du keine Zeit? — Doch!','¿No tienes tiempo? — ¡Sí!','adv'),
  v('u18','A1','negación','','nie','','nunca','Ich trinke nie Alkohol.','Nunca bebo alcohol.','adv'),
  v('u18','A1','negación','','nichts','','nada','Ich verstehe nichts.','No entiendo nada.','pron'),
  v('u18','A1','negación','','niemand','','nadie','Niemand ist da.','No hay nadie.','pron'),
  v('u18','A1','comida','der','Kaffee','','café','Ich trinke keinen Kaffee.','No bebo café.'),
  v('u18','A1','comida','das','Brot','Brote','pan','Wir haben kein Brot.','No tenemos pan.'),
]

const U = (u: string, c: string[], d?: 1|2|3|4, mixed?: boolean) => ({ u, c, d, mixed })

export const exercises: Exercise[] = [
  // U8
  classify(U('u8',['genus'],1),'Elige el artículo por la terminación',['der','die','das'],[['Zeitung',1],['Mädchen',2],['Computer',0],['Universität',1],['Dokument',2],['Student',0],['Freiheit',1],['Auto',2]],'-ung/-tät/-heit → die; -chen/-ment/-o → das; -er/-ent → der.'),
  classify(U('u8',['genus'],2),'Elige el artículo por el grupo semántico',['der','die','das'],[['Montag',0],['Rose',1],['Gold',2],['Winter',0],['Musik',1],['Essen (comida)',2],['Regen',0],['Lehrerin',1]],'Días, estaciones y clima → der; -e/-ik/-in → die; metales e infinitivos → das.'),
  mc(U('u8',['komposita'],2),'Elige el artículo','___ Haustür (das Haus + die Tür)',['der','die','das'],1,'El género lo decide la última palabra: die Tür → die Haustür.'),
  mc(U('u8',['komposita'],2),'Elige el artículo','___ Stadtplan (die Stadt + der Plan)',['der','die','das'],0,'der Plan → der Stadtplan.'),
  gap(U('u8',['genus','grossschreibung'],2),'Escribe el artículo correcto','___ Familie wohnt in ___ Stadt. (nominativo / dativo → «der»)',['Die','der'],'Familie es femenino (die); tras «in» (lugar) va dativo: der Stadt.'),
  tr(U('u8',['genus'],2),'El periódico es interesante.',['Die Zeitung ist interessant.'],'-ung → die.'),
  tr(U('u8',['genus','sein'],3),'La chica es estudiante y el ordenador es nuevo.',['Das Mädchen ist Studentin und der Computer ist neu.'],'Mädchen → das; Computer → der; profesión femenina: Studentin.'),
  // U9
  gap(U('u9',['plural'],1),'Escribe el plural','der Tisch → die ___',['Tische'],'Masculino → -e.'),
  gap(U('u9',['plural'],1),'Escribe el plural','die Frau → die ___',['Frauen'],'Femenino → -en.'),
  gap(U('u9',['plural'],2),'Escribe el plural (con umlaut)','das Buch → die ___',['Bücher'],'Neutro → -er + umlaut.'),
  gap(U('u9',['plural'],2),'Escribe el plural','das Auto → die ___; der Lehrer → die ___',['Autos','Lehrer'],'Extranjeras → -s; -er no cambia.'),
  gap(U('u9',['plural','umlaut-ss'],3),'Escribe el plural','die Mutter → die ___; der Stuhl → die ___; die Lehrerin → die ___',['Mütter','Stühle','Lehrerinnen'],'Mutter es excepción con umlaut; Stuhl -e + umlaut; -in → -innen.'),
  classify(U('u9',['plural'],2),'¿Qué patrón de plural?',['-e','-(e)n','-er','sin cambio','-s'],[['Zug',0],['Lampe',1],['Kind',2],['Schlüssel',3],['Handy',4],['Zeitung',1],['Haus',2]],'Züge, Lampen, Kinder, Schlüssel, Handys, Zeitungen, Häuser.'),
  tr(U('u9',['plural','sein'],2),'Los libros son caros.',['Die Bücher sind teuer.'],'Buch → Bücher; plural → die + sind.'),
  tr(U('u9',['plural','haben'],3),'Tengo dos hermanos y tres amigos.',['Ich habe zwei Brüder und drei Freunde.'],'Bruder → Brüder; Freund → Freunde.'),
  // U10
  mc(U('u10',['kasus'],1),'Identifica el caso','En «Die Frau kauft den Hund», *die Frau* está en…',['nominativo','acusativo','dativo'],0,'Es el sujeto (quien compra).'),
  mc(U('u10',['kasus'],1),'Identifica el caso','En «Die Frau kauft den Hund», *den Hund* está en…',['nominativo','acusativo','dativo'],1,'Es el objeto directo (lo comprado).'),
  mc(U('u10',['kasus'],2),'Identifica el caso','En «Ich gebe dem Kind ein Eis», *dem Kind* está en…',['nominativo','acusativo','dativo'],2,'Es el destinatario: objeto indirecto → dativo.'),
  mc(U('u10',['kasus'],2),'¿Qué factor decide el caso?','En «Ich fahre mit dem Bus», *dem Bus* es dativo porque…',['es el sujeto','lo exige la preposición mit','lo exige el verbo fahren'],1,'Las preposiciones mandan: mit + dativo.'),
  classify(U('u10',['kasus'],3),'Indica la función de la palabra en negrita',['sujeto (nom.)','objeto directo (acu.)','objeto indirecto (dat.)'],[['**Der Lehrer** erklärt die Regel.',0],['Der Lehrer erklärt **die Regel**.',1],['Ich schenke **meiner Mutter** Blumen.',2],['Ich schenke meiner Mutter **Blumen**.',1],['Heute kommt **der Zug**.',0]],'La posición no decide: «Heute kommt der Zug» → der Zug es sujeto.'),
  // U11
  gap(U('u11',['nominativ'],1),'Artículo definido en nominativo','___ Hund schläft. ___ Katze spielt. ___ Kind lacht.',['Der','Die','Das'],'Sujeto → nominativo: der/die/das.'),
  gap(U('u11',['nominativ'],2),'Artículo indefinido en nominativo','Das ist ___ Tisch (m). Das ist ___ Lampe (f). Das ist ___ Auto (n).',['ein','eine','ein'],'ein / eine / ein.'),
  gap(U('u11',['nominativ','possessiv'],2),'Tras sein va nominativo','Das ist ___ Bruder. (mi)',['mein'],'Tras sein: nominativo → mein (no meinen).'),
  mc(U('u11',['nominativ'],2),'Elige la opción correcta','Er wird ___ guter Arzt.',['ein','einen','einem'],0,'werden + nominativo.'),
  tr(U('u11',['nominativ','sein'],2),'Esta es una amiga mía.',['Das ist eine Freundin von mir.'],'sein + nominativo: eine Freundin.'),
  // U12
  gap(U('u12',['akkusativ'],1),'Artículo en acusativo','Ich kaufe ___ Tisch (m).',['den'],'Objeto directo masculino: den.'),
  gap(U('u12',['akkusativ'],1),'Artículo en acusativo','Sie hat ___ Bruder (m) und ___ Schwester (f).',['einen','eine'],'Masculino → einen; femenino no cambia → eine.'),
  gap(U('u12',['akkusativ'],2),'Artículo en acusativo','Wir brauchen ___ Auto (n) und ___ Computer (m).',['ein','einen'],'Neutro no cambia (ein); masculino → einen.'),
  gap(U('u12',['akkusativ-praepositionen'],2),'Completa tras la preposición','Das Geschenk ist für ___ Vater (m). Wir gehen durch ___ Park (m).',['meinen','den'],'für / durch + acusativo → meinen / den.'),
  gap(U('u12',['akkusativ-praepositionen'],2),'Completa tras la preposición','Er kommt ohne ___ Freundin (f). Ich bin gegen ___ Idee (f).',['seine','die'],'Femenino no cambia en acusativo.'),
  mc(U('u12',['akkusativ','haben'],1),'Elige la opción correcta','Ich habe ___ Hund.',['ein','einen','einem'],1,'haben + acusativo; Hund es masculino → einen.'),
  order(U('u12',['akkusativ','wortstellung'],2),['kauft','einen','er','Schrank','neuen'],['Er kauft einen neuen Schrank.'],'Sujeto + verbo + objeto acusativo.'),
  tr(U('u12',['akkusativ'],2),'Necesito una silla y una mesa.',['Ich brauche einen Stuhl und einen Tisch.'],'Stuhl y Tisch son masculinos → einen.'),
  tr(U('u12',['akkusativ','akkusativ-praepositionen'],3),'Compro un regalo para mi hermano.',['Ich kaufe ein Geschenk für meinen Bruder.'],'Geschenk es neutro (ein); für + acusativo → meinen Bruder.'),
  tr(U('u12',['akkusativ','trennbare-verben'],3,true),'Llamo a mi profesor (m).',['Ich rufe meinen Lehrer an.'],'anrufen + acusativo (a diferencia del español «llamar a»): meinen Lehrer … an.'),
  // U13
  gap(U('u13',['dativ'],1),'Artículo en dativo','Ich gebe ___ Kind (n) ein Eis.',['dem'],'Objeto indirecto neutro: dem.'),
  gap(U('u13',['dativ'],2),'Artículo en dativo','Sie schreibt ___ Mutter (f) und ___ Vater (m).',['ihrer','ihrem'],'Femenino → -er; masculino → -em.'),
  gap(U('u13',['dativ','plural'],3),'Dativo plural (+n)','Ich helfe ___ Kinder___. (die Kinder)',['den','n'],'Dativo plural: den + sustantivo con -n.'),
  gap(U('u13',['dativ-praepositionen'],2),'Completa tras la preposición','Ich fahre mit ___ Bus (m). Sie kommt aus ___ Schweiz (f).',['dem','der'],'mit / aus + dativo.'),
  gap(U('u13',['dativ-praepositionen'],2),'Usa la contracción','Ich gehe ___ Arzt (zu + dem). Er wohnt ___ Bahnhof (bei + dem).',['zum','beim'],'zu + dem = zum; bei + dem = beim.'),
  gap(U('u13',['dativ-verben','personalpronomen-dat'],2),'Verbos de dativo','Das gefällt ___ (yo). Ich danke ___ (usted).',['mir','Ihnen'],'gefallen / danken + dativo.'),
  mc(U('u13',['dativ-verben'],2),'Elige la opción correcta','Ich helfe ___ Frau.',['die','der','den'],1,'helfen + dativo; femenino → der.'),
  classify(U('u13',['dativ-praepositionen','akkusativ-praepositionen'],2),'¿Acusativo o dativo?',['acusativo','dativo'],[['für',0],['mit',1],['ohne',0],['nach',1],['durch',0],['seit',1],['bei',1],['gegen',0],['zu',1],['um',0]],'Acusativo: bis, durch, für, gegen, ohne, um. Dativo: aus, bei, mit, nach, seit, von, zu.'),
  tr(U('u13',['dativ','dativ-praepositionen'],3),'Voy en tren con mi hermana.',['Ich fahre mit meiner Schwester mit dem Zug.','Ich fahre mit dem Zug mit meiner Schwester.','Ich fahre mit meiner Schwester Zug.'],'mit + dativo: meiner Schwester, dem Zug.'),
  tr(U('u13',['dativ','akkusativ'],3,true),'Le regalo a mi madre un libro.',['Ich schenke meiner Mutter ein Buch.'],'Destinatario en dativo (meiner Mutter), lo regalado en acusativo (ein Buch).'),
  tr(U('u13',['dativ-verben'],2),'El coche es de mi hermano. (pertenece)',['Das Auto gehört meinem Bruder.'],'gehören + dativo.'),
  // U14
  gap(U('u14',['genitiv'],2),'Completa el genitivo','das Auto ___ Mann___ (m)',['des','es'],'Masculino: des + -es (monosílabo).'),
  gap(U('u14',['genitiv'],2),'Completa el genitivo','die Tasche ___ Frau (f); das Zimmer ___ Kind___ (n)',['der','des','es'],'Femenino: der (sin -s); neutro: des Kindes.'),
  tr(U('u14',['genitiv','dativ-praepositionen'],2),'das Haus meines Vaters → (con von)',['das Haus von meinem Vater'],'von + dativo sustituye al genitivo.','transform','Sustituye el genitivo por von + dativo'),
  mc(U('u14',['genitiv'],2),'Elige la forma correcta','El coche de Peter:',['Peter\'s Auto','Peters Auto','Peter Auto'],1,'Sin apóstrofo en alemán.'),
  gap(U('u14',['genitiv'],3),'Preposición de genitivo','___ des Regens bleiben wir zu Hause. (a causa de)',['Wegen'],'wegen + genitivo.'),
  tr(U('u14',['genitiv'],3),'A pesar del mal tiempo, vamos al parque.',['Trotz des schlechten Wetters gehen wir in den Park.'],'trotz + genitivo (des Wetters); in + acusativo (movimiento).'),
  // U15
  gap(U('u15',['personalpronomen-nom'],1),'Sustituye por el pronombre','Der Tisch ist neu. ___ ist groß.',['Er'],'Der Tisch → er (género gramatical).'),
  gap(U('u15',['personalpronomen-nom'],1),'Sustituye por el pronombre','Das Mädchen lernt. ___ ist nett.',['Es'],'Das Mädchen → es.'),
  gap(U('u15',['personalpronomen-akk'],2),'Pronombre en acusativo','Kennst du meinen Bruder? — Ja, ich kenne ___.',['ihn'],'meinen Bruder (acu. masc.) → ihn.'),
  gap(U('u15',['personalpronomen-akk'],2),'Pronombre en acusativo','Siehst du die Katze? — Ja, ich sehe ___. Das Geschenk ist für ___ (tú).',['sie','dich'],'die Katze → sie; für + acusativo → dich.'),
  gap(U('u15',['personalpronomen-dat'],2),'Pronombre en dativo','Wie geht es ___ (tú)? — Gut. Und ___ (usted)?',['dir','Ihnen'],'gehen + dativo: dir / Ihnen.'),
  gap(U('u15',['personalpronomen-dat','dativ-verben'],2),'Pronombre en dativo','Ich helfe ___ (él). Gib ___ (ella) das Buch.',['ihm','ihr'],'helfen + dativo; geben + dativo del destinatario.'),
  classify(U('u15',['personalpronomen-akk','personalpronomen-dat'],3),'¿mich o mir?',['mich','mir'],[['Er sieht ___.',0],['Das gefällt ___.',1],['Kommst du mit ___?',1],['Das ist für ___.',0],['Es tut ___ leid.',1],['Sie liebt ___.',0]],'sehen/für/lieben → acusativo (mich); gefallen/mit/leid tun → dativo (mir).'),
  tr(U('u15',['personalpronomen-akk'],2),'Te veo mañana.',['Ich sehe dich morgen.','Morgen sehe ich dich.'],'sehen + acusativo → dich.'),
  tr(U('u15',['personalpronomen-dat'],2),'Lo siento. ¿Puede usted ayudarme?',['Es tut mir leid. Können Sie mir helfen?'],'helfen + dativo → mir.'),
  // U16
  match(U('u16',['possessiv'],1),'Relaciona',[['mein','mi'],['dein','tu'],['sein','su (de él)'],['ihr','su (de ella)'],['unser','nuestro'],['euer','vuestro'],['Ihr','su (de usted)']],'ihr = de ella / de ellos; Ihr = de usted.'),
  gap(U('u16',['possessiv'],1),'Posesivo en nominativo','Das ist ___ Auto (mi, n) und das ist ___ Tasche (tu, f).',['mein','deine'],'Neutro: mein; femenino: deine.'),
  gap(U('u16',['possessiv','akkusativ'],2),'Posesivo en acusativo','Ich suche ___ Schlüssel (mi, m) und ___ Handy (mi, n).',['meinen','mein'],'Acusativo masc. → meinen; neutro → mein.'),
  gap(U('u16',['possessiv','dativ'],3),'Posesivo en dativo','Sie hilft ___ Mutter (su, de ella) und ___ Vater (su, de él).',['ihrer','seinem'],'de ella → ihr + -er; de él → sein + -em.'),
  gap(U('u16',['possessiv'],3),'euer → eure','Wo sind ___ Kinder? (vuestros)',['eure'],'euer pierde la e interna: eure.'),
  mc(U('u16',['possessiv'],2),'Elige la opción correcta','Maria und ___ Bruder wohnen in Wien.',['sein','ihr','ihre'],1,'de ella (Maria) → ihr; Bruder masc. nom. → sin terminación.'),
  tr(U('u16',['possessiv','akkusativ'],3),'Busco a mi hermano y a su novia. (de él)',['Ich suche meinen Bruder und seine Freundin.'],'suchen + acusativo: meinen Bruder; seine Freundin (fem. no cambia).'),
  tr(U('u16',['possessiv','dativ-praepositionen'],3),'Vivo con mis padres en nuestro piso.',['Ich wohne mit meinen Eltern in unserer Wohnung.'],'mit + dativo plural → meinen Eltern; in (lugar) + dativo fem. → unserer Wohnung.'),
  // U17
  gap(U('u17',['reflexiv'],1),'Pronombre reflexivo','Ich wasche ___ jeden Morgen.',['mich'],'ich → mich.'),
  gap(U('u17',['reflexiv'],1),'Pronombre reflexivo','Er zieht ___ an. Wir freuen ___.',['sich','uns'],'er → sich; wir → uns.'),
  gap(U('u17',['reflexiv'],2),'Reflexivo en dativo (hay objeto directo)','Ich wasche ___ die Hände.',['mir'],'Con objeto directo (die Hände) el reflexivo va en dativo: mir.'),
  gap(U('u17',['reflexiv'],2),'Reflexivo en dativo','Ziehst du ___ die Jacke an?',['dir'],'dich → dir con objeto directo.'),
  classify(U('u17',['reflexiv'],3),'¿mich o mir?',['mich','mir'],[['Ich dusche ___.',0],['Ich kämme ___ die Haare.',1],['Ich setze ___.',0],['Ich putze ___ die Zähne.',1],['Ich beeile ___.',0]],'Sin objeto directo → mich; con objeto directo → mir.'),
  order(U('u17',['reflexiv','trennbare-verben'],3),['sich','er','an','morgens','zieht'],['Er zieht sich morgens an.','Morgens zieht er sich an.'],'Reflexivo tras el verbo, prefijo al final.'),
  tr(U('u17',['reflexiv'],2),'Me alegro.',['Ich freue mich.'],'sich freuen → ich freue mich.'),
  tr(U('u17',['reflexiv','imperativ'],3),'¡Siéntese, por favor!',['Setzen Sie sich bitte!','Setzen Sie sich, bitte!'],'Imperativo formal + sich.'),
  tr(U('u17',['reflexiv','trennbare-verben'],3,true),'Me levanto, me ducho y me visto.',['Ich stehe auf, dusche mich und ziehe mich an.'],'aufstehen no es reflexivo; duschen y anziehen sí. Prefijos al final.'),
  // U18
  tr(U('u18',['nicht'],1),'Ich arbeite heute.',['Ich arbeite heute nicht.'],'nicht al final cuando niega toda la frase.','transform','Niega la frase con nicht'),
  tr(U('u18',['nicht'],2),'Ich kann kommen.',['Ich kann nicht kommen.'],'nicht delante del infinitivo.','transform','Niega la frase con nicht'),
  tr(U('u18',['nicht','trennbare-verben'],2),'Er steht früh auf.',['Er steht nicht früh auf.'],'nicht delante de lo negado (früh) y del prefijo.','transform','Niega la frase con nicht'),
  gap(U('u18',['kein'],1),'Niega con kein','Hast du ein Auto? — Nein, ich habe ___ Auto.',['kein'],'Neutro: kein.'),
  gap(U('u18',['kein','akkusativ'],2),'Niega con kein','Trinkst du Kaffee? — Nein, ich trinke ___ Kaffee.',['keinen'],'Kaffee es masc. y objeto directo → keinen.'),
  gap(U('u18',['kein'],2),'Niega con kein','Hast du Zeit? — Nein, ich habe ___ Zeit. Hast du Geschwister? — Nein, ich habe ___ Geschwister.',['keine','keine'],'Zeit fem. → keine; plural → keine.'),
  classify(U('u18',['nicht','kein'],2),'¿nicht o kein?',['nicht','kein-'],[['Ich habe ___ Hunger.',1],['Das Auto ist ___ neu.',0],['Ich kenne den Mann ___.',0],['Wir haben ___ Zeit.',1],['Er ist ___ mein Bruder.',0],['Sie trinkt ___ Bier.',1]],'kein niega ein + sustantivo o sustantivo sin artículo; nicht el resto.'),
  mc(U('u18',['kein'],2),'Elige la respuesta','Hast du keine Zeit? — ___, ich habe Zeit.',['Ja','Nein','Doch'],2,'A una pregunta negativa se responde afirmativamente con doch.'),
  tr(U('u18',['kein','akkusativ'],3),'No tengo hermano ni hermana.',['Ich habe keinen Bruder und keine Schwester.'],'keinen (masc. acu.), keine (fem.).'),
  tr(U('u18',['nicht','kein','haben'],3,true),'No tengo tiempo y no puedo venir.',['Ich habe keine Zeit und ich kann nicht kommen.','Ich habe keine Zeit und kann nicht kommen.'],'keine Zeit; nicht delante del infinitivo.'),
]
