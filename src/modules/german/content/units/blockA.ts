import type { Unit, Concept, VocabItem, Exercise } from '../types'
import { v, mc, gap, tr, order, match, classify } from '../helpers'

export const units: Unit[] = [
{ id: 'u1', number: 1, block: 'A', title: '¿Qué es diferente en alemán?', cefr: 'A1', page: 1,
  objectives: ['Reconocer las 6 grandes diferencias del alemán respecto al español', 'Saber qué son los umlauts y la ß', 'Entender qué significa que el alemán tiene casos'],
  concepts: ['grossschreibung', 'umlaut-ss', 'genus-intro', 'kasus-intro'],
  learn: [
    { title: 'Mayúsculas en todos los sustantivos', body: 'En alemán **todos los sustantivos** se escriben con mayúscula, no solo los nombres propios: *der Tisch*, *die Stadt*, *das Kind*. Esto te ayuda a leer: si una palabra en medio de una frase lleva mayúscula, es un sustantivo.\n\nLos adjetivos, verbos y adverbios van en minúscula (*deutsch*, *sprechen*), igual que en español.' },
    { title: 'Umlauts y ß', body: 'El alemán tiene tres vocales con diéresis (**Umlaut**): **ä, ö, ü**. No son adornos: cambian el significado o la forma gramatical.\n\n- *schon* (ya) / *schön* (bonito)\n- *Mutter* (madre) / *Mütter* (madres)\n- *Apfel* (manzana) / *Äpfel* (manzanas)\n\nLa **ß** (Eszett) suena como una *s* fuerte y aparece tras vocal larga o diptongo: *Straße*, *heißen*, *groß*. Si no puedes escribirla, la sustitución oficial es **ss**, pero en esta app te la pediremos siempre que sea posible.' },
    { title: 'Tres géneros y terminaciones', body: 'El alemán tiene tres géneros: **masculino (der)**, **femenino (die)** y **neutro (das)**. El género del alemán no coincide con el del español: *der Tisch* (la mesa), *die Sonne* (el sol), *das Mädchen* (la chica).\n\nRegla de oro de esta app: **aprende siempre el artículo con la palabra**. Nunca «Tisch», siempre «der Tisch».\n\nCasi todo lleva terminaciones que cambian: los verbos (*ich komm-e, du komm-st*), los artículos (*der, den, dem*), los posesivos (*mein, meinen*) y los adjetivos delante del sustantivo (*ein gut-er Wein*).' },
    { title: 'Casos y orden de palabras', body: 'El alemán tiene **4 casos**: nominativo, acusativo, dativo y genitivo. El caso indica la función de la palabra en la frase (sujeto, objeto directo, objeto indirecto, posesión) y cambia el artículo:\n\n| | masc. | fem. | neutro |\n| Nominativo | der | die | das |\n| Acusativo | den | die | das |\n\nGracias a los casos, el orden de palabras es más flexible que en español, pero hay una regla fija: **el verbo conjugado va en segunda posición** en las frases enunciativas.\n\nBuena noticia: el alemán tiene **un solo presente** (no distingue «hablo» / «estoy hablando») y solo dos tiempos de pasado de uso frecuente.' }
  ],
  understand: [
    { title: 'Lo esencial', body: 'Si te quedas con cuatro ideas:\n\n1. Sustantivo = mayúscula.\n2. ä ö ü ß no son opcionales.\n3. Cada sustantivo se aprende con su artículo.\n4. El verbo conjugado va en 2ª posición.' }
  ],
  bookExercises: ['Checklist de 4 preguntas (sin ejercicios en esta unidad)']
},
{ id: 'u2', number: 2, block: 'A', title: 'Verbos en presente', titleDe: 'Präsens', cefr: 'A1', page: 6,
  objectives: ['Formar la raíz de un verbo', 'Conjugar verbos regulares en presente', 'Saber qué es el verbo finito'],
  concepts: ['praesens-regular', 'verbstamm'],
  learn: [
    { title: 'La raíz del verbo', body: 'El infinitivo alemán termina en **-en** (a veces **-n**): *kommen*, *wohnen*, *lernen*. Quita la terminación y tienes la **raíz** (Stamm): *komm-*, *wohn-*, *lern-*. A la raíz se le añaden las terminaciones de persona.' },
    { title: 'Terminaciones del presente', body: '| persona | terminación | wohnen |\n| ich | -e | ich wohne |\n| du | -st | du wohnst |\n| er / sie / es | -t | er wohnt |\n| wir | -en | wir wohnen |\n| ihr | -t | ihr wohnt |\n| sie / Sie | -en | sie wohnen |\n\nFíjate: *wir* y *sie/Sie* usan la forma del infinitivo. *Sie* con mayúscula es el «usted / ustedes» formal y se conjuga igual que *sie* (ellos).' },
    { title: 'Un solo presente', body: 'El alemán usa el mismo presente para «trabajo», «estoy trabajando» y «trabajo (habitualmente)»: *Ich arbeite.* El contexto o un adverbio (*jetzt, gerade*) aclara el matiz.\n\nEl **verbo finito** es el verbo conjugado, el que concuerda con el sujeto. En *Ich lerne Deutsch* el finito es *lerne*.' }
  ],
  understand: [
    { title: 'Comparación con el español', body: 'En español el verbo también cambia según la persona (*vivo, vives, vive*), así que el sistema te resultará familiar. La diferencia es que en alemán **no puedes omitir el pronombre**: *Wohne in Berlin* es incorrecto; hay que decir *Ich wohne in Berlin*.' }
  ],
  bookExercises: ['Completar terminaciones (2.1, 2.3)', 'Huecos en una entrevista (2.2)', 'Traducción de frases (2.4)']
},
{ id: 'u3', number: 3, block: 'A', title: 'Variaciones e irregulares', titleDe: 'Unregelmäßige Verben', cefr: 'A1', page: 12,
  objectives: ['Añadir la -e de apoyo en raíces en -t/-d', 'Conjugar raíces en -s/-ß/-z', 'Reconocer los cambios vocálicos e→i, e→ie, a→ä'],
  concepts: ['stamm-variationen', 'vokalwechsel'],
  learn: [
    { title: 'Raíz terminada en -t, -d, -m, -n', body: 'Para que se pueda pronunciar, entre la raíz y las terminaciones **-st** y **-t** se añade una **-e**:\n\n| | arbeiten | finden |\n| du | arbeit**e**st | find**e**st |\n| er/sie/es | arbeit**e**t | find**e**t |\n| ihr | arbeit**e**t | find**e**t |\n\nLo mismo ocurre con *atmen* (du atmest) y *regnen* (es regnet).' },
    { title: 'Raíz terminada en -s, -ß, -z', body: 'La terminación de *du* pierde la *s*: solo se añade **-t**.\n\n- *heißen* → du heiß**t** (no *heißst*)\n- *tanzen* → du tanz**t**\n- *reisen* → du reis**t**' },
    { title: 'Cambio de vocal en du y er/sie/es', body: 'Muchos verbos frecuentes cambian la vocal de la raíz **solo en 2ª y 3ª persona del singular**. El resto de personas es regular.\n\n| cambio | infinitivo | du | er/sie/es |\n| e → i | sprechen | sprichst | spricht |\n| e → i | essen | isst | isst |\n| e → i | geben | gibst | gibt |\n| e → i | nehmen | nimmst | nimmt |\n| e → ie | lesen | liest | liest |\n| e → ie | sehen | siehst | sieht |\n| a → ä | fahren | fährst | fährt |\n| a → ä | schlafen | schläfst | schläft |\n| au → äu | laufen | läufst | läuft |\n\nOtros irregulares que hay que memorizar: *wissen* (ich weiß, du weißt, er weiß) y *werden* (du wirst, er wird).' }
  ],
  understand: [
    { title: 'Cómo no perderse', body: 'Regla práctica: si dudas, mira solo *du* y *er*. En *ich, wir, ihr, sie* la raíz **nunca** cambia de vocal: *ich fahre, wir fahren, ihr fahrt*. En el diccionario, los irregulares suelen indicar la 3ª persona: *fahren (fährt)*.' }
  ],
  bookExercises: ['Conjugar tablas completas (3.1)', 'Identificar verbos con cambio vocálico (3.2)', 'Redactar un retrato a partir de datos (3.3)', 'Traducción (3.4)']
},
{ id: 'u4', number: 4, block: 'A', title: 'haben y sein', cefr: 'A1', page: 19,
  objectives: ['Conjugar sein y haben de memoria', 'Usar frases hechas con haben', 'Distinguir cuándo usar sein (ser/estar) y haben (tener)'],
  concepts: ['sein', 'haben'],
  learn: [
    { title: 'sein — ser / estar', body: 'Completamente irregular. Hay que aprenderlo de memoria:\n\n| ich | bin |\n| du | bist |\n| er/sie/es | ist |\n| wir | sind |\n| ihr | seid |\n| sie/Sie | sind |\n\n*Ich bin müde. Wir sind aus Spanien. Das ist mein Bruder.*\n\n*sein* cubre tanto «ser» como «estar»: *Er ist Lehrer* (es), *Er ist in Berlin* (está).' },
    { title: 'haben — tener', body: 'Casi regular; solo *du* y *er/sie/es* pierden la **b**:\n\n| ich | habe |\n| du | ha**st** |\n| er/sie/es | ha**t** |\n| wir | haben |\n| ihr | habt |\n| sie/Sie | haben |' },
    { title: 'Frases útiles con haben', body: 'Muchas expresiones donde el español usa «tener» o «estar» usan *haben*:\n\n- *Hunger haben* — tener hambre\n- *Durst haben* — tener sed\n- *Zeit haben* — tener tiempo\n- *Lust haben* — tener ganas\n- *Angst haben* — tener miedo\n- *Recht haben* — tener razón\n- *Glück haben* — tener suerte\n\n*Ich habe keine Zeit. Hast du Hunger?*' }
  ],
  understand: [
    { title: 'Por qué importan tanto', body: 'Además de su significado propio, *haben* y *sein* son los **verbos auxiliares del pasado** (Perfekt): *Ich habe gegessen*, *Ich bin gefahren*. Si los dominas ahora, la Unidad 21 será mucho más fácil.' }
  ],
  bookExercises: ['Huecos con haben (4.1)', 'Diálogos con sein (4.2)', 'Conjugar tablas (4.3)', 'Traducción (4.4)']
},
{ id: 'u5', number: 5, block: 'A', title: 'Verbos separables', titleDe: 'Trennbare Verben', cefr: 'A1', page: 24,
  objectives: ['Identificar un verbo separable', 'Colocar el prefijo al final de la frase', 'Distinguir prefijos separables e inseparables'],
  concepts: ['trennbare-verben', 'untrennbare-praefixe'],
  learn: [
    { title: 'Qué es un verbo separable', body: 'Muchos verbos se forman con un **prefijo** + verbo base: *an|kommen* (llegar), *auf|stehen* (levantarse), *ein|kaufen* (hacer la compra). En el presente, el prefijo **se separa y se va al final de la frase**:\n\n- *Der Zug kommt um 8 Uhr **an**.*\n- *Ich stehe jeden Tag um 7 Uhr **auf**.*\n- *Wann kaufst du **ein**?*\n\nEn el infinitivo y en el diccionario aparecen juntos. El acento recae en el prefijo: **AN**kommen.' },
    { title: 'Separables frecuentes', body: '- *anfangen* — empezar\n- *anrufen* — llamar por teléfono\n- *aufhören* — dejar de\n- *aufmachen / zumachen* — abrir / cerrar\n- *ausgehen* — salir\n- *einladen* — invitar\n- *fernsehen* — ver la tele\n- *mitkommen* — venir con\n- *vorbereiten* — preparar\n- *zurückkommen* — volver' },
    { title: 'Prefijos inseparables', body: 'Estos prefijos **nunca** se separan y no llevan acento: **be-, emp-, ent-, er-, ge-, ver-, zer-**.\n\n- *bezahlen* → *Ich bezahle die Rechnung.*\n- *verstehen* → *Verstehst du das?*\n- *erklären* → *Er erklärt die Regel.*\n\nSi la frase tiene dos oraciones, el prefijo va al final de **su** oración: *Ich stehe auf und ich frühstücke.*' }
  ],
  understand: [
    { title: 'Truco para reconocerlos', body: 'Si el prefijo es una preposición o adverbio que existe solo (*an, auf, aus, ein, mit, vor, zu, zurück*), el verbo es separable. Si el prefijo no existe como palabra independiente (*be-, ver-, er-*), es inseparable.' }
  ],
  bookExercises: ['Huecos con verbo + prefijo (5.1)', 'Identificar separables (5.2)', 'Completar frases (5.3)', 'Traducción (5.4)']
},
{ id: 'u6', number: 6, block: 'A', title: 'Imperativo', titleDe: 'Imperativ', cefr: 'A1', page: 30,
  objectives: ['Formar las 4 formas del imperativo (du, ihr, Sie, wir)', 'Aplicar los cambios vocálicos en el imperativo', 'Usar separables y sein/haben en imperativo'],
  concepts: ['imperativ'],
  learn: [
    { title: 'Cuatro formas', body: 'El imperativo sirve para órdenes, peticiones y consejos. Tiene cuatro formas según a quién hablas:\n\n| forma | kommen | ejemplo |\n| du (informal, 1 persona) | Komm! | Komm her! |\n| ihr (informal, varias) | Kommt! | Kommt bitte! |\n| Sie (formal) | Kommen Sie! | Kommen Sie herein! |\n| wir (propuesta) | Kommen wir! | Gehen wir! |' },
    { title: 'Formación', body: '- **du**: raíz sin terminación y **sin pronombre**: *Trink!*, *Geh!*, *Lern!* Raíces en -t/-d añaden -e: *Arbeite!*, *Warte!*\n- **ihr**: forma de *ihr* sin pronombre: *Trinkt!*, *Wartet!*\n- **Sie**: infinitivo + *Sie*: *Trinken Sie!*\n- **wir**: infinitivo + *wir*: *Trinken wir!*' },
    { title: 'Irregularidades', body: 'Los verbos con cambio **e → i / e → ie** mantienen el cambio en la forma *du*: *Sprich!*, *Lies!*, *Nimm!*, *Iss!* Pero los de **a → ä** NO cambian: *Fahr!*, *Schlaf!*\n\nSeparables: el prefijo va al final: *Steh auf!*, *Ruf mich an!*, *Machen Sie die Tür zu!*\n\n*sein* es irregular: *Sei ruhig!* / *Seid ruhig!* / *Seien Sie ruhig!*\n*haben*: *Hab Geduld!* / *Habt Geduld!* / *Haben Sie Geduld!*\n\nEn alemán escrito suele ir signo de exclamación: *Komm!*' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'Como en español, hay una forma para «tú» y otra para «usted». La diferencia es que en alemán la forma formal **repite el pronombre** (*Kommen Sie!*) y la forma *du* **nunca** lo lleva. Y para suavizar, se añade *bitte*: *Komm bitte!*' }
  ],
  bookExercises: ['Completar órdenes (6.1)', 'Reescribir en forma du (6.2)', 'Consejos en forma du (6.3)', 'Traducción en las 3 formas (6.4)']
},
{ id: 'u7', number: 7, block: 'A', title: 'Preguntas', titleDe: 'Fragen', cefr: 'A1', page: 36,
  objectives: ['Formular preguntas de sí/no', 'Usar las W-Fragen', 'Distinguir wo / wohin / woher'],
  concepts: ['ja-nein-fragen', 'w-fragen'],
  learn: [
    { title: 'Dos tipos de preguntas', body: '**Preguntas de sí/no**: el verbo conjugado va en **primera** posición.\n\n- *Kommst du aus Spanien?* — ¿Vienes de España?\n- *Hat er Zeit?* — ¿Tiene tiempo?\n\n**W-Fragen** (con palabra interrogativa): la palabra interrogativa va primero y el verbo en **segunda** posición.\n\n- *Wo wohnst du?* — ¿Dónde vives?\n- *Was machen Sie?* — ¿Qué hace usted?' },
    { title: 'Palabras interrogativas', body: '| | |\n| wer | quién |\n| was | qué |\n| wo | dónde |\n| wohin | adónde |\n| woher | de dónde |\n| wann | cuándo |\n| wie | cómo |\n| warum | por qué |\n| wie viel / wie viele | cuánto / cuántos |\n| welcher / welche / welches | cuál |' },
    { title: 'Puntos útiles', body: '- Nombre y dirección se preguntan con **wie**: *Wie heißt du? Wie ist deine Adresse?* (no *was*).\n- Movimiento: *Wo* (dónde, sin movimiento), *Wohin* (hacia dónde), *Woher* (desde dónde): *Wo bist du? Wohin gehst du? Woher kommst du?*\n- Profesión: *Was sind Sie von Beruf?* / *Was machst du beruflich?*\n- El alemán no necesita auxiliar como el inglés «do»; la estructura es más simple: *Trinkst du Kaffee?*' }
  ],
  understand: [
    { title: 'Compárarlo con el español', body: 'El español también invierte («¿Vienes tú?»), pero en alemán la inversión es obligatoria y sistemática. Recuerda que en las W-Fragen el verbo sigue en 2ª posición: la regla del verbo en 2ª posición se cumple también aquí.' }
  ],
  bookExercises: ['Huecos con palabras interrogativas (7.1)', 'Reconstruir las preguntas de una entrevista (7.2)', 'Traducción con du y Sie (7.3)']
}]

export const concepts: Concept[] = [
  { id: 'grossschreibung', name: 'Großschreibung', nameEs: 'Mayúsculas en sustantivos', unitId: 'u1', summary: 'Todos los sustantivos llevan mayúscula inicial.', mistakes: ['Escribir *das haus* en minúscula', 'Poner mayúscula a adjetivos de nacionalidad (*deutsch* va en minúscula)'], related: ['genus-intro'] },
  { id: 'umlaut-ss', name: 'Umlaut & ß', nameEs: 'Umlauts y ß', unitId: 'u1', summary: 'ä ö ü ß cambian significado y forma gramatical.', mistakes: ['Escribir *schon* por *schön*', 'Olvidar el umlaut en plurales (*Apfel* → *Äpfel*)'], related: ['plural'] },
  { id: 'genus-intro', name: 'Genus', nameEs: 'Los tres géneros', unitId: 'u1', summary: 'der / die / das. El género se aprende con la palabra.', mistakes: ['Trasladar el género del español (*die Sonne*, no *der*)'], related: ['genus'] },
  { id: 'kasus-intro', name: 'Kasus (intro)', nameEs: 'Los casos: idea general', unitId: 'u1', summary: 'Cuatro casos que cambian los artículos según la función.', mistakes: [], related: ['kasus'] },
  { id: 'praesens-regular', name: 'Präsens: regelmäßige Verben', nameEs: 'Presente regular', unitId: 'u2', summary: 'raíz + -e, -st, -t, -en, -t, -en.', mistakes: ['*du wohnt* (falta la -s: *wohnst*)', '*ihr wohnen* (ihr lleva -t)', 'Omitir el pronombre sujeto'], related: ['stamm-variationen', 'vokalwechsel'] },
  { id: 'verbstamm', name: 'Verbstamm', nameEs: 'Raíz del verbo', unitId: 'u2', summary: 'Infinitivo sin -en / -n.', mistakes: ['Conjugar sobre el infinitivo entero (*ich wohnene*)'], related: ['praesens-regular'] },
  { id: 'stamm-variationen', name: 'Stamm auf -t/-d/-s', nameEs: 'Raíces en -t, -d, -s, -ß, -z', unitId: 'u3', summary: 'Añadir -e (arbeitest) o perder la -s (du heißt).', mistakes: ['*du arbeitst*', '*du heißst*'], related: ['praesens-regular'] },
  { id: 'vokalwechsel', name: 'Vokalwechsel', nameEs: 'Cambio vocálico (e→i, e→ie, a→ä)', unitId: 'u3', summary: 'Solo en du y er/sie/es.', mistakes: ['*er sprecht* (→ spricht)', '*wir sprichen* (wir es regular: sprechen)', '*du fahrst* (→ fährst)'], related: ['imperativ'] },
  { id: 'sein', name: 'sein', nameEs: 'Verbo sein', unitId: 'u4', summary: 'bin, bist, ist, sind, seid, sind.', mistakes: ['*ihr sind* (→ seid)', '*du ist* (→ bist)'], related: ['haben', 'perfekt'] },
  { id: 'haben', name: 'haben', nameEs: 'Verbo haben', unitId: 'u4', summary: 'habe, hast, hat, haben, habt, haben. Expresiones: Hunger/Durst/Zeit haben.', mistakes: ['*du habst* (→ hast)', '*er habt* (→ hat)'], related: ['sein', 'perfekt'] },
  { id: 'trennbare-verben', name: 'Trennbare Verben', nameEs: 'Verbos separables', unitId: 'u5', summary: 'El prefijo va al final de la oración.', mistakes: ['*Ich aufstehe um 7* (→ Ich stehe um 7 auf)', 'Poner el prefijo justo tras el verbo'], related: ['wortstellung', 'perfekt'] },
  { id: 'untrennbare-praefixe', name: 'Untrennbare Präfixe', nameEs: 'Prefijos inseparables', unitId: 'u5', summary: 'be-, emp-, ent-, er-, ge-, ver-, zer- no se separan.', mistakes: ['*Ich stehe das ver* (verstehen no es separable)'], related: ['trennbare-verben'] },
  { id: 'imperativ', name: 'Imperativ', nameEs: 'Imperativo', unitId: 'u6', summary: 'du: raíz (Komm!), ihr: -t (Kommt!), Sie: infinitivo + Sie.', mistakes: ['*Komm du!* (sin pronombre)', '*Fähr!* (a→ä no se aplica: Fahr!)', '*Sprech!* (e→i sí se aplica: Sprich!)'], related: ['vokalwechsel', 'trennbare-verben'] },
  { id: 'ja-nein-fragen', name: 'Ja/Nein-Fragen', nameEs: 'Preguntas de sí/no', unitId: 'u7', summary: 'Verbo en primera posición.', mistakes: ['*Du kommst aus Spanien?* (solo válido con entonación; la forma estándar es *Kommst du…?*)'], related: ['wortstellung'] },
  { id: 'w-fragen', name: 'W-Fragen', nameEs: 'Preguntas con partícula', unitId: 'u7', summary: 'wer, was, wo, wohin, woher, wann, wie, warum + verbo en 2ª posición.', mistakes: ['*Was heißt du?* (→ Wie heißt du?)', 'Confundir wo / wohin / woher'], related: ['wortstellung'] },
]

export const vocab: VocabItem[] = [
  v('u1','A1','básico','der','Tisch','Tische','mesa','Der Tisch ist groß.','La mesa es grande.'),
  v('u1','A1','básico','die','Stadt','Städte','ciudad','Die Stadt ist schön.','La ciudad es bonita.'),
  v('u1','A1','básico','das','Kind','Kinder','niño/niña','Das Kind spielt.','El niño juega.'),
  v('u1','A1','básico','die','Sonne','Sonnen','sol','Die Sonne scheint.','El sol brilla.'),
  v('u1','A1','básico','das','Mädchen','Mädchen','chica','Das Mädchen lernt Deutsch.','La chica aprende alemán.'),
  v('u1','A1','básico','die','Straße','Straßen','calle','Die Straße ist lang.','La calle es larga.'),
  v('u1','A1','básico','der','Apfel','Äpfel','manzana','Der Apfel ist rot.','La manzana es roja.'),
  v('u1','A1','básico','','schön','','bonito','Das ist schön.','Eso es bonito.','adj'),
  v('u1','A1','básico','','schon','','ya','Ich bin schon da.','Ya estoy aquí.','adv'),
  v('u1','A1','básico','','groß','','grande','Berlin ist groß.','Berlín es grande.','adj'),
  v('u1','A1','básico','','heißen','','llamarse','Ich heiße Ayoub.','Me llamo Ayoub.','verb'),
  v('u2','A1','verbos','','kommen','','venir','Ich komme aus Spanien.','Vengo de España.','verb'),
  v('u2','A1','verbos','','wohnen','','vivir (residir)','Wir wohnen in Girona.','Vivimos en Girona.','verb'),
  v('u2','A1','verbos','','lernen','','aprender','Du lernst Deutsch.','Aprendes alemán.','verb'),
  v('u2','A1','verbos','','machen','','hacer','Was machst du?','¿Qué haces?','verb'),
  v('u2','A1','verbos','','spielen','','jugar / tocar (instrumento)','Er spielt Fußball.','Él juega al fútbol.','verb'),
  v('u2','A1','verbos','','trinken','','beber','Sie trinken Kaffee.','Ellos beben café.','verb'),
  v('u2','A1','verbos','','kaufen','','comprar','Ich kaufe Brot.','Compro pan.','verb'),
  v('u2','A1','verbos','','gehen','','ir (a pie)','Wir gehen nach Hause.','Vamos a casa.','verb'),
  v('u2','A1','verbos','','hören','','oír / escuchar','Ich höre Musik.','Escucho música.','verb'),
  v('u2','A1','verbos','','studieren','','estudiar (en la universidad)','Sie studiert Medizin.','Ella estudia medicina.','verb'),
  v('u2','A1','verbos','','jetzt','','ahora','Ich arbeite jetzt.','Ahora trabajo.','adv'),
  v('u2','A1','básico','das','Deutsch','','alemán (idioma)','Ich lerne Deutsch.','Aprendo alemán.'),
  v('u3','A1','verbos','','arbeiten','','trabajar','Er arbeitet im Hotel.','Él trabaja en el hotel.','verb'),
  v('u3','A1','verbos','','finden','','encontrar / opinar','Ich finde das gut.','Me parece bien.','verb'),
  v('u3','A1','verbos','','sprechen','','hablar','Sprichst du Deutsch?','¿Hablas alemán?','verb'),
  v('u3','A1','verbos','','essen','','comer','Er isst eine Pizza.','Él come una pizza.','verb'),
  v('u3','A1','verbos','','lesen','','leer','Sie liest ein Buch.','Ella lee un libro.','verb'),
  v('u3','A1','verbos','','sehen','','ver','Siehst du das?','¿Ves eso?','verb'),
  v('u3','A1','verbos','','fahren','','ir (en vehículo), conducir','Er fährt nach Berlin.','Él va a Berlín.','verb'),
  v('u3','A1','verbos','','schlafen','','dormir','Das Kind schläft.','El niño duerme.','verb'),
  v('u3','A1','verbos','','nehmen','','tomar / coger','Ich nehme den Bus.','Cojo el autobús.','verb'),
  v('u3','A1','verbos','','geben','','dar','Er gibt mir das Buch.','Él me da el libro.','verb'),
  v('u3','A1','verbos','','wissen','','saber (información)','Ich weiß es nicht.','No lo sé.','verb'),
  v('u3','A1','verbos','','tanzen','','bailar','Du tanzt gut.','Bailas bien.','verb'),
  v('u3','A1','verbos','','laufen','','correr / caminar','Sie läuft jeden Morgen.','Ella corre cada mañana.','verb'),
  v('u4','A1','verbos','','sein','','ser / estar','Ich bin müde.','Estoy cansado.','verb'),
  v('u4','A1','verbos','','haben','','tener','Hast du Zeit?','¿Tienes tiempo?','verb'),
  v('u4','A1','expresiones','der','Hunger','','hambre','Ich habe Hunger.','Tengo hambre.'),
  v('u4','A1','expresiones','der','Durst','','sed','Er hat Durst.','Él tiene sed.'),
  v('u4','A1','expresiones','die','Zeit','Zeiten','tiempo (cronológico)','Wir haben keine Zeit.','No tenemos tiempo.'),
  v('u4','A1','expresiones','die','Lust','','ganas','Hast du Lust?','¿Tienes ganas?'),
  v('u4','A1','expresiones','die','Angst','Ängste','miedo','Sie hat Angst.','Ella tiene miedo.'),
  v('u4','A1','expresiones','das','Glück','','suerte / felicidad','Du hast Glück!','¡Tienes suerte!'),
  v('u4','A1','básico','','müde','','cansado','Ich bin müde.','Estoy cansado.','adj'),
  v('u4','A1','básico','der','Bruder','Brüder','hermano','Das ist mein Bruder.','Este es mi hermano.'),
  v('u4','A1','básico','die','Schwester','Schwestern','hermana','Meine Schwester ist 20.','Mi hermana tiene 20 años.'),
  v('u4','A1','básico','der','Lehrer','Lehrer','profesor','Er ist Lehrer.','Él es profesor.'),
  v('u4','A1','básico','','Recht haben','','tener razón','Du hast Recht.','Tienes razón.','phrase'),
  v('u5','A1','separables','','anfangen','','empezar','Der Kurs fängt um 9 Uhr an.','El curso empieza a las 9.','verb'),
  v('u5','A1','separables','','anrufen','','llamar por teléfono','Ich rufe dich an.','Te llamo.','verb'),
  v('u5','A1','separables','','aufstehen','','levantarse','Ich stehe um 6 Uhr auf.','Me levanto a las 6.','verb'),
  v('u5','A1','separables','','ankommen','','llegar','Der Zug kommt an.','El tren llega.','verb'),
  v('u5','A1','separables','','einkaufen','','hacer la compra','Wir kaufen am Samstag ein.','Hacemos la compra el sábado.','verb'),
  v('u5','A1','separables','','fernsehen','','ver la tele','Er sieht abends fern.','Él ve la tele por la noche.','verb'),
  v('u5','A1','separables','','mitkommen','','venir con (alguien)','Kommst du mit?','¿Vienes?','verb'),
  v('u5','A1','separables','','aufhören','','dejar de / parar','Hör auf!','¡Para!','verb'),
  v('u5','A1','separables','','zurückkommen','','volver','Sie kommt morgen zurück.','Ella vuelve mañana.','verb'),
  v('u5','A1','separables','','einladen','','invitar','Ich lade dich ein.','Te invito.','verb'),
  v('u5','A1','inseparables','','bezahlen','','pagar','Ich bezahle das Essen.','Pago la comida.','verb'),
  v('u5','A1','inseparables','','verstehen','','entender','Ich verstehe nicht.','No entiendo.','verb'),
  v('u5','A1','inseparables','','erklären','','explicar','Er erklärt die Regel.','Él explica la regla.','verb'),
  v('u5','A1','básico','der','Zug','Züge','tren','Der Zug ist pünktlich.','El tren es puntual.'),
  v('u6','A1','imperativo','','warten','','esperar','Warte bitte!','¡Espera, por favor!','verb'),
  v('u6','A1','imperativo','','öffnen','','abrir','Öffnen Sie die Tür!','¡Abra la puerta!','verb'),
  v('u6','A1','imperativo','','aufmachen','','abrir','Mach das Fenster auf!','¡Abre la ventana!','verb'),
  v('u6','A1','imperativo','','zumachen','','cerrar','Mach die Tür zu!','¡Cierra la puerta!','verb'),
  v('u6','A1','básico','die','Tür','Türen','puerta','Die Tür ist offen.','La puerta está abierta.'),
  v('u6','A1','básico','das','Fenster','Fenster','ventana','Das Fenster ist zu.','La ventana está cerrada.'),
  v('u6','A1','básico','','bitte','','por favor','Komm bitte!','¡Ven, por favor!','adv'),
  v('u6','A1','básico','','ruhig','','tranquilo','Sei ruhig!','¡Estate tranquilo!','adj'),
  v('u6','A1','básico','die','Geduld','','paciencia','Hab Geduld!','¡Ten paciencia!'),
  v('u6','A1','básico','','langsam','','despacio / lento','Sprich langsam!','¡Habla despacio!','adv'),
  v('u6','A1','básico','','schnell','','rápido','Komm schnell!','¡Ven rápido!','adv'),
  v('u7','A1','preguntas','','wer','','quién','Wer ist das?','¿Quién es?','pron'),
  v('u7','A1','preguntas','','was','','qué','Was machst du?','¿Qué haces?','pron'),
  v('u7','A1','preguntas','','wo','','dónde','Wo wohnst du?','¿Dónde vives?','adv'),
  v('u7','A1','preguntas','','wohin','','adónde','Wohin gehst du?','¿Adónde vas?','adv'),
  v('u7','A1','preguntas','','woher','','de dónde','Woher kommst du?','¿De dónde eres?','adv'),
  v('u7','A1','preguntas','','wann','','cuándo','Wann kommst du?','¿Cuándo vienes?','adv'),
  v('u7','A1','preguntas','','wie','','cómo','Wie heißt du?','¿Cómo te llamas?','adv'),
  v('u7','A1','preguntas','','warum','','por qué','Warum lernst du Deutsch?','¿Por qué aprendes alemán?','adv'),
  v('u7','A1','preguntas','','wie viel','','cuánto','Wie viel kostet das?','¿Cuánto cuesta?','adv'),
  v('u7','A1','básico','der','Beruf','Berufe','profesión','Was sind Sie von Beruf?','¿Cuál es su profesión?'),
  v('u7','A1','básico','die','Adresse','Adressen','dirección','Wie ist deine Adresse?','¿Cuál es tu dirección?'),
  v('u7','A1','básico','der','Name','Namen','nombre','Mein Name ist Ayoub.','Mi nombre es Ayoub.'),
]

const U = (u: string, c: string[], d?: 1|2|3|4) => ({ u, c, d })

export const exercises: Exercise[] = [
  // U1
  mc(U('u1',['grossschreibung'],1),'Elige la opción correcta','¿Cuál está bien escrita?',['das haus ist groß.','Das Haus ist groß.','Das Haus ist Groß.'],1,'Los sustantivos (Haus) llevan mayúscula; los adjetivos (groß) no.'),
  mc(U('u1',['umlaut-ss'],1),'Elige la opción correcta','¿Qué palabra significa «bonito»?',['schon','schön','schoen'],1,'*schön* = bonito; *schon* = ya. La forma *schoen* solo se usa cuando no hay teclado con umlauts.'),
  classify(U('u1',['grossschreibung'],2),'¿Sustantivo (mayúscula) o no?',['Sustantivo','No sustantivo'],[['tisch',0],['schnell',1],['kind',0],['lernen',1],['stadt',0],['gut',1]],'Tisch, Kind y Stadt son sustantivos y van con mayúscula: Tisch, Kind, Stadt.'),
  mc(U('u1',['genus-intro'],1),'Elige el artículo','___ Sonne (el sol)',['der','die','das'],1,'El género no se traduce del español: *die Sonne* es femenino.'),
  mc(U('u1',['kasus-intro'],2),'Elige la opción correcta','En «Der Mann kauft den Computer», ¿por qué «den»?',['Es el sujeto','Es el objeto directo (acusativo)','Es plural'],1,'El objeto directo masculino va en acusativo: der → den.'),
  gap(U('u1',['umlaut-ss'],2),'Escribe la palabra con la ortografía correcta (usa ß)','Die ___ ist lang. (calle)',['Straße'],'*Straße* lleva ß tras vocal larga.'),
  // U2
  gap(U('u2',['praesens-regular'],1),'Completa con la terminación correcta','Ich wohn___ in Girona.',['e'],'ich → -e.'),
  gap(U('u2',['praesens-regular'],1),'Completa con la terminación correcta','Du lern___ Deutsch.',['st'],'du → -st.'),
  gap(U('u2',['praesens-regular'],1),'Completa con la terminación correcta','Er komm___ aus Berlin.',['t'],'er/sie/es → -t.'),
  gap(U('u2',['praesens-regular'],2),'Completa con la terminación correcta','Ihr spiel___ Fußball und wir trink___ Wasser.',['t','en'],'ihr → -t; wir → -en.'),
  gap(U('u2',['praesens-regular'],2),'Conjuga el verbo entre paréntesis','Sie ___ (machen) Sport. (ellos)',['machen'],'sie (ellos) → -en.'),
  gap(U('u2',['praesens-regular'],2),'Conjuga el verbo entre paréntesis','Was ___ (studieren) du?',['studierst'],'du → -st.'),
  mc(U('u2',['praesens-regular'],2),'Elige la forma correcta','Wir ___ Musik.',['höre','hörst','hören'],2,'wir → -en.'),
  tr(U('u2',['praesens-regular'],2),'Vivimos en Girona.',['Wir wohnen in Girona.'],'wir + -en. El pronombre es obligatorio.'),
  tr(U('u2',['praesens-regular'],2),'¿Aprendes alemán?',['Lernst du Deutsch?'],'Pregunta sí/no: verbo primero. du → -st.'),
  tr(U('u2',['praesens-regular'],3),'Ella compra pan y él bebe café.',['Sie kauft Brot und er trinkt Kaffee.'],'sie/er → -t.'),
  order(U('u2',['praesens-regular','w-fragen'],2),['kommt','aus','Spanien','er'],['Er kommt aus Spanien.'],'Sujeto + verbo (2ª posición) + complemento.'),
  // U3
  gap(U('u3',['stamm-variationen'],1),'Conjuga','Du ___ (arbeiten) viel.',['arbeitest'],'Raíz en -t: se añade -e antes de -st.'),
  gap(U('u3',['stamm-variationen'],1),'Conjuga','Er ___ (finden) das gut.',['findet'],'Raíz en -d: findet.'),
  gap(U('u3',['stamm-variationen'],2),'Conjuga','Wie ___ (heißen) du?',['heißt'],'Raíz en -ß: du solo añade -t.'),
  gap(U('u3',['vokalwechsel'],2),'Conjuga','Er ___ (sprechen) Deutsch.',['spricht'],'e → i en 3ª persona singular.'),
  gap(U('u3',['vokalwechsel'],2),'Conjuga','Du ___ (lesen) ein Buch.',['liest'],'e → ie en 2ª persona.'),
  gap(U('u3',['vokalwechsel'],2),'Conjuga','Sie ___ (fahren) nach Berlin. (ella)',['fährt'],'a → ä en 3ª persona singular.'),
  gap(U('u3',['vokalwechsel'],2),'Conjuga','Wir ___ (essen) Pizza. Er ___ (essen) Salat.',['essen','isst'],'wir es regular (essen); er cambia e → i (isst).'),
  gap(U('u3',['vokalwechsel'],3),'Conjuga','Ich ___ (wissen) das. ___ (wissen) du das auch?',['weiß','Weißt'],'wissen es irregular: ich weiß, du weißt.'),
  classify(U('u3',['vokalwechsel'],2),'¿Cambia la vocal en du/er?',['Cambia','No cambia'],[['schlafen',0],['wohnen',1],['nehmen',0],['kommen',1],['sehen',0],['lernen',1],['laufen',0]],'schlafen→schläft, nehmen→nimmt, sehen→sieht, laufen→läuft. wohnen, kommen, lernen son regulares.'),
  mc(U('u3',['vokalwechsel'],2),'Elige la forma correcta','Ihr ___ zu schnell.',['fährt','fahrt','fährst'],1,'ihr no cambia la vocal: ihr fahrt.'),
  tr(U('u3',['vokalwechsel'],3),'Él duerme mucho y come poco.',['Er schläft viel und isst wenig.'],'schlafen → schläft; essen → isst.'),
  tr(U('u3',['stamm-variationen','vokalwechsel'],3),'¿Trabajas en Girona? ¿Hablas catalán?',['Arbeitest du in Girona? Sprichst du Katalanisch?'],'arbeitest (-e-), sprichst (e→i).'),
  // U4
  gap(U('u4',['sein'],1),'Completa con sein','Ich ___ müde.',['bin'],'ich bin.'),
  gap(U('u4',['sein'],1),'Completa con sein','Wir ___ aus Spanien. Ihr ___ aus Deutschland.',['sind','seid'],'wir sind, ihr seid.'),
  gap(U('u4',['haben'],1),'Completa con haben','Du ___ Hunger und er ___ Durst.',['hast','hat'],'du hast, er hat (sin b).'),
  gap(U('u4',['haben'],2),'Completa con haben','___ Sie Zeit? Ja, wir ___ Zeit.',['Haben','haben'],'Sie (usted) y wir → haben.'),
  mc(U('u4',['sein','haben'],2),'Elige la opción correcta','Ich ___ 19 Jahre alt.',['habe','bin','ist'],1,'La edad se dice con *sein*: Ich bin 19 (Jahre alt).'),
  mc(U('u4',['haben'],2),'Elige la opción correcta','«Tengo razón» en alemán:',['Ich bin Recht.','Ich habe Recht.','Ich habe richtig.'],1,'Recht haben = tener razón.'),
  match(U('u4',['haben'],2),'Relaciona la expresión con su significado',[['Hunger haben','tener hambre'],['Angst haben','tener miedo'],['Glück haben','tener suerte'],['Lust haben','tener ganas'],['Zeit haben','tener tiempo']],'Todas usan *haben*.'),
  tr(U('u4',['sein'],2),'Mi hermano es profesor.',['Mein Bruder ist Lehrer.'],'Profesión sin artículo: *ist Lehrer*.'),
  tr(U('u4',['haben','sein'],3),'¿Tienes sed? Estoy cansado.',['Hast du Durst? Ich bin müde.'],'Durst haben; müde sein.'),
  tr(U('u4',['sein'],2),'Vosotros sois de Girona.',['Ihr seid aus Girona.'],'ihr seid.'),
  // U5
  gap(U('u5',['trennbare-verben'],1),'Completa con el verbo y el prefijo','Ich ___ um 7 Uhr ___. (aufstehen)',['stehe','auf'],'El prefijo *auf* va al final.'),
  gap(U('u5',['trennbare-verben'],2),'Completa con el verbo y el prefijo','Wann ___ der Zug ___? (ankommen)',['kommt','an'],'kommt … an.'),
  gap(U('u5',['trennbare-verben'],2),'Completa con el verbo y el prefijo','Er ___ abends ___. (fernsehen)',['sieht','fern'],'fernsehen: sieht … fern (e→ie).'),
  gap(U('u5',['untrennbare-praefixe'],2),'Conjuga el verbo','Ich ___ die Regel nicht. (verstehen)',['verstehe'],'ver- es inseparable: verstehe, sin separar.'),
  classify(U('u5',['trennbare-verben','untrennbare-praefixe'],2),'¿Separable o inseparable?',['Separable','Inseparable'],[['anrufen',0],['bezahlen',1],['einkaufen',0],['erklären',1],['mitkommen',0],['verstehen',1],['aufhören',0]],'Prefijos an-, ein-, mit-, auf- son separables; be-, er-, ver- no.'),
  order(U('u5',['trennbare-verben'],2),['ich','dich','morgen','rufe','an'],['Ich rufe dich morgen an.','Morgen rufe ich dich an.'],'anrufen: rufe … an.'),
  order(U('u5',['trennbare-verben'],3),['am Samstag','wir','kaufen','ein','immer'],['Wir kaufen am Samstag immer ein.','Am Samstag kaufen wir immer ein.','Wir kaufen immer am Samstag ein.'],'einkaufen: kaufen … ein al final.'),
  tr(U('u5',['trennbare-verben'],2),'¿Vienes (conmigo)?',['Kommst du mit?'],'mitkommen: Kommst du mit?'),
  tr(U('u5',['trennbare-verben','vokalwechsel'],3),'Él se levanta a las 6 y ve la tele por la noche.',['Er steht um 6 Uhr auf und sieht abends fern.','Er steht um 6 auf und sieht abends fern.'],'Cada prefijo va al final de su oración.'),
  tr(U('u5',['untrennbare-praefixe'],2),'Pago la cuenta.',['Ich bezahle die Rechnung.'],'bezahlen no se separa.'),
  // U6
  gap(U('u6',['imperativ'],1),'Pon en imperativo (du)','___ bitte! (kommen)',['Komm'],'du: raíz sin pronombre.'),
  gap(U('u6',['imperativ'],2),'Pon en imperativo (du)','___ langsam! (sprechen)',['Sprich'],'e → i se mantiene en el imperativo du.'),
  gap(U('u6',['imperativ'],2),'Pon en imperativo (du)','___ nicht so schnell! (fahren)',['Fahr'],'a → ä NO se aplica: Fahr!'),
  gap(U('u6',['imperativ'],2),'Pon en imperativo (Sie)','___ ___ bitte die Tür! (öffnen)',['Öffnen','Sie'],'Sie: infinitivo + Sie.'),
  gap(U('u6',['imperativ','trennbare-verben'],3),'Pon en imperativo (ihr)','___ das Fenster ___! (aufmachen)',['Macht','auf'],'ihr: -t, prefijo al final.'),
  gap(U('u6',['imperativ','sein'],3),'Pon en imperativo (du)','___ ruhig! (sein)',['Sei'],'sein: Sei! / Seid! / Seien Sie!'),
  mc(U('u6',['imperativ'],2),'Elige la forma correcta','Consejo a un amigo: «¡Duerme más!»',['Schläf mehr!','Schlaf mehr!','Schlafen mehr!'],1,'a → ä no se aplica en imperativo.'),
  tr(U('u6',['imperativ'],2),'¡Espera, por favor! (a un amigo)',['Warte bitte!','Warte, bitte!'],'Raíz en -t: Warte!'),
  tr(U('u6',['imperativ'],3),'¡Cierre la puerta, por favor! (a usted)',['Machen Sie bitte die Tür zu!','Machen Sie die Tür bitte zu!','Schließen Sie bitte die Tür!'],'Sie + infinitivo, prefijo zu al final.'),
  tr(U('u6',['imperativ','vokalwechsel'],3),'¡Lee el libro! (a un amigo)',['Lies das Buch!'],'lesen → Lies! (e → ie).'),
  // U7
  gap(U('u7',['w-fragen'],1),'Completa con la palabra interrogativa','___ heißt du? — Ich heiße Ayoub.',['Wie'],'Nombre → *wie*.'),
  gap(U('u7',['w-fragen'],1),'Completa con la palabra interrogativa','___ kommst du? — Aus Spanien.',['Woher'],'Origen → woher.'),
  gap(U('u7',['w-fragen'],2),'Completa con la palabra interrogativa','___ gehst du? — Nach Hause.',['Wohin'],'Destino → wohin.'),
  gap(U('u7',['w-fragen'],2),'Completa con la palabra interrogativa','___ kostet das? — 5 Euro.',[['Wie viel','Wieviel']],'Cantidad → wie viel.'),
  order(U('u7',['ja-nein-fragen'],1),['du','Kaffee','trinkst'],['Trinkst du Kaffee?'],'Pregunta sí/no: verbo primero.'),
  order(U('u7',['w-fragen'],2),['wohnt','wo','Bruder','dein'],['Wo wohnt dein Bruder?'],'W-Wort + verbo + sujeto.'),
  classify(U('u7',['w-fragen'],2),'¿wo, wohin o woher?',['wo','wohin','woher'],[['___ bist du jetzt?',0],['___ fährst du im Sommer?',1],['___ kommt deine Familie?',2],['___ arbeitest du?',0],['___ gehst du heute Abend?',1]],'wo = lugar sin movimiento; wohin = destino; woher = origen.'),
  tr(U('u7',['ja-nein-fragen'],2),'¿Habla usted español?',['Sprechen Sie Spanisch?'],'Sie + verbo en 1ª posición.'),
  tr(U('u7',['w-fragen'],2),'¿Cuál es su profesión? (usted)',['Was sind Sie von Beruf?','Was machen Sie beruflich?'],'Was sind Sie von Beruf?'),
  tr(U('u7',['w-fragen','praesens-regular'],3),'¿Por qué aprendes alemán? ¿Cuándo empieza el curso?',['Warum lernst du Deutsch? Wann fängt der Kurs an?','Warum lernst du Deutsch? Wann beginnt der Kurs?'],'warum / wann + verbo en 2ª posición; anfangen es separable.'),
]
