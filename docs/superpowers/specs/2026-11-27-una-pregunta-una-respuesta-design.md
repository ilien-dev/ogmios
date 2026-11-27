# Una pregunta, una respuesta

Qué se acepta al preguntar una palabra del libro, y de dónde sale.

## Por qué

Una misma tarjeta («lichen-like», ADJETIVO, sin frase a la vista) aceptó «parecida al liquen»
una vez, la rechazó otra a favor de «similares al liquen», y otra pidió el plural. El aprendiz no
tenía nada en pantalla que le dijera cuál tocaba. Pasa con adjetivos, verbos (la forma -ing o el
pasado no se piden como tales), sustantivos y expresiones.

La persona dueña del producto quiere que se aprenda **el significado general** de la palabra, no
la traducción literal que le tocó en una frase del capítulo, y que una palabra escrita igual con
traducciones distintas según el contexto llegue a **una traducción de consenso** cuando son
sinónimos, o dé al aprendiz con qué saber cuál se pide cuando no lo son.

## Lo que se midió

Se cargaron los 20 primeros capítulos de _Dungeon Crawler Carl_ (nivel básico, profundidad
«casi todas», modelo real) y se auditó además la base real de uso (265 palabras, 1 304 frases).
La auditoría usa las mismas funciones que juzgan en la app: toma cada respuesta que una frase da
por buena y la juzga en las otras frases de la misma palabra con el mismo enunciado.

| Medida                                                                              | Resultado               |
| ----------------------------------------------------------------------------------- | ----------------------- |
| Palabras cuya tarjeta acepta respuestas distintas según la frase oculta (base real) | 102 de 265 (38 %)       |
| De ellas, sin ningún contexto a la vista                                            | 77                      |
| Respuestas buenas en una frase y fallo en otra                                      | 1 396                   |
| Respuestas buenas en una frase y «otra forma» en otra (casi todo verbos)            | 751                     |
| Frases cuya pista no es ninguna traducción de su palabra                            | 72 de 1 304             |
| Palabras de los 20 capítulos                                                        | 7 574 (4 297 distintas) |
| Palabras repetidas en más de un capítulo                                            | 1 368                   |
| … con listas idénticas                                                              | 472                     |
| … con listas que se solapan: un sentido, sinónimos                                  | 662                     |
| … de otro tipo de palabra                                                           | 145                     |
| … del mismo tipo sin nada en común                                                  | 89                      |
| Palabras marcadas con «rivales»                                                     | 4 035 de 7 574 (53 %)   |
| De ellas, mismo tipo y una traducción en común (rival falso)                        | 2 775                   |

Ejemplos reales: «depicting» pide «mostrando» con una frase y «muestra» con otra; «concerned»
acepta «inquieto» solo con una; «missing» acepta «no estaba» solo con una; «landscape architect»
rechaza «arquitecta paisajista». Entre capítulos: «sign» sale con cuatro listas distintas del
mismo sentido; «bug» (bicho / error de programa) y «chest» (pecho / cofre) sí son dos sentidos.
«boss» es rival de «boss fight», «health» de «health bar» y «lichen» de «lichen-like» solo porque
una empieza como la otra.

Se probó también la solución: a 40 palabras repetidas, con sus frases y listas, se le pidió al
modelo agrupar los usos en sentidos, con un significado general por sentido y una marca corta que
los distinga. Unió los sinónimos («sign»: letrero, cartel, señal, aviso; «somewhere», «equally»,
«stuff» en un sentido) y separó los sentidos reales: «bug» (animal) y «bug»
(informática), «chest» (cuerpo) y «chest» (objeto), «turn» (movimiento) y «turn» (al jugar).

## Causas

1. **Lo que se acepta depende de la frase, y la frase no se ve.** Inglés → nativo se juzga contra
   la pista de la frase sorteada más las traducciones de la palabra. Una pista que no está entre
   esas traducciones vale solo con su frase.
2. **La forma pedida sale de la traducción de la frase**, no de la palabra inglesa: el plural y el
   género de un adjetivo, o el tiempo de un verbo, son los que el español necesitó en esa frase.
3. **Cada capítulo guarda la palabra otra vez con su propia lista**, tomada «en el sentido de esa
   frase». Dos listas que no son idénticas cuentan como dos significados.
4. **Una palabra que empieza como otra cuenta como escrita igual.**

## Metas

- **Una pregunta, una respuesta:** lo que se acepta depende solo de lo que el aprendiz ve antes
  de responder. Dos tarjetas que se ven igual aceptan lo mismo, siempre.
- Se aprende el significado general de la palabra; la frase es un ejemplo, nunca la clave.
- Una palabra tiene un solo significado en todo el libro, y en todos los libros, salvo que de
  verdad signifique otra cosa; entonces se pregunta con una frase a la vista, y el aprendiz
  deduce el sentido leyéndola. Nunca se le dice.
- La forma pedida es la de la palabra inglesa mostrada: -ing pide -ing, pasado pide pasado. El
  plural se pide solo cuando la palabra mostrada es plural; nunca porque lo fuera en una frase
  que no se ve, y nunca se muestra una frase solo para avisar del número.
- Vale para todos los tipos de palabra y para práctica, castigo, repaso antes de leer y repaso
  diario.

## No metas

- Cambiar el calendario, el avance de una palabra, los tamaños de sesión o el castigo.
- Cambiar nativo → inglés más allá de que su enunciado salga del mismo sitio.
- Pedirle nada al modelo mientras se responde.

## Lo que sería un fracaso aunque funcione

- Que se acepte de todo: una traducción de otro sentido sigue siendo un fallo.
- Que el aprendiz pierda avance, respuestas o palabras aprendidas al actualizar.
- Que la tarjeta regale la respuesta: ninguna marca dice el sentido («bug (animal)» es una pista
  demasiado grande). El sentido se deduce de la frase.
- Que la frase salga donde no hace falta: solo la llevan las palabras con dos sentidos reales del
  mismo tipo.
- Que preparar un capítulo cueste más peticiones que hoy.

## Enfoques

**A. Juntar las pistas de todas las frases de la palabra al juzgar.** Poco código y sin datos
nuevos. Quita el «vale aquí y allá no», pero mete en la clave traducciones que solo valen dentro
de una frase («no estaba» para «missing»), no arregla la forma ni los rivales falsos, y cada
capítulo sigue con su lista.

**B. Mostrar siempre la frase.** Simple, pero cambia el ejercicio (se deduce por contexto en vez
de saber la palabra), pesa más y va contra aprender el significado general.

**C. El sentido como única fuente de la respuesta (elegido).** Cada palabra tiene uno o más
_sentidos_ compartidos por todos los capítulos. El sentido guarda los significados generales; la
tarjeta pregunta un sentido en una forma, y eso decide lo aceptado. Las frases solo ilustran. Es
el más grande, y el único que quita las cuatro causas; la prueba con 40 palabras dice que el
modelo agrupa bien.

**D. Que el modelo juzgue cada respuesta.** Lento, de pago por respuesta y distinto cada vez;
rompe «el modelo etiqueta, el código decide».

## Diseño

### El sentido

- Un **sentido** es una palabra (su clave), un tipo de palabra y sus **significados** generales
  en forma base. No lleva marca ni descripción que se muestre.
- La palabra de un capítulo apunta a su sentido. El avance, las respuestas y el «terminada»
  siguen siendo de la palabra del capítulo, como hoy.
- Las traducciones en la forma de un verbo («juró», «juraba», «jurado») pasan a ser del sentido y
  de esa forma, no de cada capítulo.
- Una respuesta que «Tenía razón» da por buena se suma al sentido: vale en todos los capítulos.
- «Escrita igual» es tener la misma clave. Que una empiece como otra deja de contar.
- Una palabra terminada deja de pedirse en otros capítulos solo en ese sentido: «bug» (animal)
  aprendida no quita «bug» (informática).

### Quién decide el sentido

- La extracción pide ya el significado general de la palabra en el sentido de su frase, no cómo
  quedó traducida ahí.
- La mirada que ya revisa cada palabra contra su frase (40 por petición) recibe además los
  sentidos que esa palabra ya tiene. Responde si es uno de ellos o uno nuevo, y sus significados
  generales.
- El código decide: comprueba que el sentido nombrado es de esa palabra y de ese tipo, une los
  significados, o crea el sentido. Un sentido nombrado que no existe es un sentido nuevo.
- La segunda mirada de cada frase dice además cuáles de sus pistas son un significado general de
  la palabra. Esas se suman al sentido; las demás se quedan en la frase.

Ninguna petición nueva: son campos en dos peticiones que ya existen.

### La tarjeta y lo que acepta

- Inglés → nativo muestra la palabra **como se llama** (su forma base, o la forma de un verbo que
  es palabra propia), nunca la forma de la frase sorteada.
- Lo aceptado es función del sentido y de esa forma, y la frase no entra en el juicio:
  - sustantivo, adverbio, expresión: los significados, en el número de la palabra mostrada:
    «hedge» pide «seto»; solo «hedges» pide «setos». El otro número no es fallo, pero nunca es lo
    que se pide ni lo que se lista;
  - adjetivo: el inglés no dice género ni número, así que se pide y se lista en masculino
    singular; escrito en otro género o número también vale;
  - verbo: los significados en la forma que dice su etiqueta (forma base → infinitivo; -ing →
    gerundio; pasado → cualquier pasado y persona; participio → participio en cualquier género y
    número; presente → presente). Otra forma del verbo correcto sigue sin ser fallo: segundo
    intento, como hoy.
- «Se acepta» lista los significados en esa forma canónica, siempre los mismos para esa tarjeta.
- Tras responder, la frase sale como hoy. «En esta frase: similares al liquen» se queda como
  nota de cómo quedó ahí; no se exige ni cambia el veredicto.
- Una palabra con dos sentidos del mismo tipo («bug», bicho, y «bug», error de programa) se
  pregunta siempre con una frase a la vista, y el aprendiz deduce el sentido de ella: es lo que
  ve, así que sigue habiendo una sola respuesta. Lo aceptado son los significados del sentido de
  esa frase, nunca su pista. Con sentidos de otro tipo basta la etiqueta, como hoy. Responder
  con el significado de otro sentido sigue sin ser fallo: «También es correcta, pero no es la que
  busco».
- La frase no sale por ninguna otra razón: no para decir el número, el género ni el tiempo.
- Nativo → inglés muestra los significados del sentido en la forma de la palabra y pide esa
  palabra.

### Las frases de las palabras con dos sentidos

- **La frase manda** (alternativa B del lienzo de diseño, elegida el 27-nov): en una palabra con
  dos sentidos del mismo tipo no hay palabra suelta arriba. La frase se lee en grande donde iría
  la palabra, y la palabra pedida va dentro, más grande y en una pastilla rellena del color de su
  tipo. La palabra sola sigue siendo el título para quien no ve la pantalla.
- Se mantiene el paso de hoy: frase corta con las palabras que fijan el sentido, y la frase
  completa como último intento.
- Las 5 frases escritas y su reposición son solo para estas palabras. Un rival de otro tipo lo
  distingue la etiqueta de la tarjeta y no necesita frase escrita.
- Hoy la regla alcanzaría al 53 % de las palabras de los 20 capítulos. Con sentidos, sin pedir
  nada al modelo, son 209 de 7 574, y bajan cuando la mirada une los sinónimos sin nada en común.

### Datos ya guardados

- Al actualizar, el código crea los sentidos sin pedir nada: por palabra y tipo, las palabras de
  capítulo que comparten una traducción son un sentido, con la unión de sus listas; las que no
  comparten ninguna quedan como sentidos aparte y a la espera de la mirada, que las une o las
  deja aparte. Se preguntan con su frase a la vista, como toda palabra de dos sentidos.
- Respuestas, avance, palabras aprendidas, «ya la sé», disputas y frases se conservan. Las
  frases quedan atadas al sentido.
- Las pistas de las frases ya guardadas pasan en segundo plano por la segunda mirada para saber
  cuáles son significado general.
- Prueba que parte de filas antiguas, como pide la regla del repositorio.

### Cómo se comprueba

- El juicio inglés → nativo deja de recibir la frase: no puede depender de ella.
- La auditoría de esta investigación se queda como prueba: sobre una base de ejemplo, ninguna
  tarjeta acepta dos conjuntos distintos. Hoy da 102 palabras; tiene que dar 0.
- Se repite la carga de los 20 capítulos: rivales falsos a 0, y «lichen-like» con una sola
  respuesta en sus tres frases.

## Entrega

Un solo PR, a petición de la persona dueña (27-nov): el sentido, el juicio, lo que el modelo
dice y la tarjeta no funcionan por separado.

## Decididas por la persona dueña (27-nov)

- Sin marca de sentido en la tarjeta: es una pista demasiado grande. El sentido se deduce de una
  frase.
- El plural se pide solo si la palabra mostrada es plural. Nunca por el contexto, y nunca se
  muestra la frase solo para decir el número.
- La frase a la vista se dibuja como «la frase manda» (alternativa B).

## Decisiones tomadas por quien escribe (corregibles)

- La tarjeta muestra la palabra como se llama, no la forma de la frase.
- El otro número, o el otro género de un adjetivo, no es fallo: se acepta sin pedirlo.
- -ing pide gerundio; el infinitivo cuenta como «otra forma» (segundo intento), no como fallo.
- Las palabras de dos sentidos conservan el paso de hoy: frase corta primero, frase completa
  como último intento.
- Un sentido es un significado, sea cual sea la forma del verbo: «entered» en pasado y en
  participio son un sentido, y cada tarjeta pide la forma de su palabra.
- «Escrita igual» es llamarse igual. Compartir una forma no cuenta: «feet» no es rival de «foot».
- «Se acepta» lista hasta 4 significados; todos los del sentido valen.
