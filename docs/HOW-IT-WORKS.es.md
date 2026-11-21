# Cómo decide Ogmios qué practicas

**English:** [HOW-IT-WORKS.md](HOW-IT-WORKS.md)

Esta página explica con más detalle que el README cómo Ogmios convierte tus
conversaciones en práctica. La especificación completa del producto está en
[SPEC.md](SPEC.md).

## Claude etiqueta, Ogmios decide

Después de cada conversación, Claude lee lo que dijiste y etiqueta los errores:
qué estructura, con cuánta seguridad y la frase donde ocurrió. Las etiquetas
con menos de un 60 % de seguridad se descartan. Todo lo demás (qué error pasa a
ser tu foco, cuándo cuenta como aprendido, cuándo lo repasas) lo decide el
propio código de Ogmios, no la IA, así que se comporta igual cada vez.

## El reporte

El reporte después de una conversación muestra:

- lo que salió bien;
- **un foco**, el error que merece tu atención ahora;
- **como mucho dos puntos menores**.

Lo demás queda en la memoria para más adelante. En gramática ves tu propia
frase e intentas corregirla antes de que aparezca la respuesta. Las
explicaciones están en tu idioma nativo.

## La memoria de errores

Un error que repites se convierte en un _patrón_, y cada patrón tiene un
estado:

| Estado    | Cuándo                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detectado | Apareció al menos una vez y todavía no ha sido tu foco.                                                                                           |
| En foco   | Se eligió como foco o como punto menor de un reporte.                                                                                             |
| Mejorando | Aciertas entre el 40 y el 79 % de las veces que surge por sí solo, o solo en ejercicios.                                                          |
| Dominado  | Aciertas el 80 % o más, en 3 conversaciones distintas y en 5 o más ocasiones de usarlo, la última al menos 7 días después de tu último ejercicio. |
| Recaída   | Fallaste en una conversación un patrón dominado; vuelve al foco, el primero de la fila.                                                           |

Como mucho hay un patrón en foco hasta que empieza a mejorar, y como mucho tres
activos a la vez. Los demás esperan como detectados, así que nunca te pide
trabajar en todo a la vez.

"Dominado" solo se gana en conversación real. Los ejercicios ayudan, pero nunca
dominan un patrón por sí solos.

## Cómo la memoria guía la siguiente conversación

A tu compañero se le dice qué patrones están activos, y lleva las siguientes
conversaciones hacia situaciones donde los vas a necesitar, sin decírtelo y sin
corregirte mientras hablas.

## Ejercicios

Una sesión de práctica dura unos dos minutos. Mezcla la estructura en foco con
otras que ya trabajaste, para que tengas que distinguirlas. Los patrones
vuelven a repaso después de 1, 3, 7 y 21 días.

## Palabras de tus libros

Cada palabra de un capítulo se estudia con una frase del libro, hacia tu idioma
y de vuelta al inglés. Una palabra aprendida vuelve después de 1, 3, 7, 21 y 60
días, y tu compañero de conversación también usa las palabras que estás a punto
de olvidar. También puedes traducir un capítulo frase a frase, practicar sus
estructuras o hacer dictados con él.
