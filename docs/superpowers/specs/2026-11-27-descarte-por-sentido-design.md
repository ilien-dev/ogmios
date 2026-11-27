# Descartar una palabra solo en el sentido que se sabe

Sigue a `2026-11-27-una-pregunta-una-respuesta-design.md`, que dio a cada palabra un sentido.

## Por qué

Al preparar un capítulo se dejaban fuera dos tipos de palabra: las terminadas en otro capítulo
y las marcadas «Ya la sé». Las dos se comparaban por cómo se escribe la palabra. «bug» (bicho)
aprendida quitaba «bug» (error de programa), y un verbo quitaba al adjetivo escrito igual: el
aprendiz nunca practicaba el otro significado.

El primer caso quedó resuelto con los sentidos (`learned_elsewhere`). Faltaban dos.

## Metas

- «Ya la sé» vale para un sentido, no para toda palabra escrita igual.
- Dos sentidos que la mirada une después se comportan como si hubieran sido uno desde el
  principio: lo que ya estaba aprendido en uno no se vuelve a pedir en el otro.

## No metas

- Mostrar una etiqueta de sentido. El sentido se reconoce por sus traducciones.
- Quitar una palabra de un capítulo ya preparado porque se terminó después en otro.
- Cambiar el repaso diario, que sigue siendo por palabra escrita.

## Lo que sería un fracaso aunque funcione

- Que el aprendiz pierda una marca, una respuesta o una palabra empezada al actualizar.
- Que una marca deje de valer al borrar su libro.

## Enfoques

**A. Una bandera en cada palabra de capítulo.** Simple de consultar, pero la marca muere con las
filas del libro y hay que mantenerla en cada unión de sentidos.

**B. La marca es un sentido más (elegido).** `known_words` pasa a guardar el sentido, el tipo de
palabra y lo que significa. Una palabra nueva busca su sentido entre los de sus capítulos y
entre las marcas, así que una marca sin libro se reconoce sola. Las consultas preguntan por el
sentido de la fila.

**C. Dejar «Ya la sé» por palabra.** Sin cambio, pero esconde significados que el aprendiz no
dijo saber.

## Diseño

- `known_words(sense_id, key, lemma, part_of_speech, glosses, created_at)` (migración 45).
- Marcar una palabra guarda su sentido con lo que significa en ese momento.
- `senses::siblings` ofrece también los sentidos sabidos sin palabra viva, con lo que
  significaban: una palabra de otro libro que comparte traducción cae en ese sentido.
- Al guardar un capítulo, una palabra cuyo sentido está sabido no se guarda, igual que una
  terminada en otro capítulo.
- Unir dos sentidos lleva la marca al que queda.
- Cuando la mirada une dos sentidos y uno estaba terminado o sabido, las palabras del otro sin
  respuestas, sin terminar y sin aprender salen de sus capítulos.
- La lista de palabras sabidas muestra lo que significa cada una y se deshace por sentido.
- Pedir practicar una palabra desde una traducción la deja como palabra por aprender.

## Datos ya guardados

- Una marca anterior pasa a valer para cada sentido que su palabra tiene en ese momento: el
  aprendiz dijo que sabía la palabra, y eso es todo lo que significaba hasta entonces.
- Si ningún capítulo tiene ya la palabra, la marca espera y vale para el primer sentido que
  llegue. Los siguientes se piden.
- Prueba que parte de marcas antiguas: `a_mark_made_by_key_becomes_the_senses_its_key_has_or_the_first_that_comes`.

## Decisiones tomadas por quien escribe (corregibles)

- Las marcas antiguas cubren todos los sentidos que la palabra tenía, no uno solo.
- Una palabra de conversación, que no tiene sentido, se sigue dejando fuera del repaso diario
  si alguna marca tiene esa misma palabra escrita.
- La unión tardía quita palabras sin empezar en las dos direcciones: también cuando la palabra
  mirada es la que estaba terminada.
