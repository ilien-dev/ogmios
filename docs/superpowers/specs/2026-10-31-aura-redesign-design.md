# Rediseño Aura

Referencia visual: [lienzo «Ogmios — nuevas propuestas de diseño»](https://claude.ai/artifact/1o6bbTp8mEAgZ1HxRXnXNw),
páginas **Aura** (Charla, Feedback, Capítulo y Práctica, en claro y oscuro) y **Propuestas**
(fila «6. Aura», Inicio). Esas ocho pantallas más Inicio son la meta visual; donde difieran de
este documento, manda este documento.

## Por qué

La persona dueña del producto rechazó el diseño actual (Grafito) «en lo absoluto» y, entre siete
propuestas, eligió Aura: aire, calma y un compañero con presencia propia. Se aceptó de antemano
un refactor completo de la interfaz.

## Metas

- Toda la interfaz adopta Aura en claro y oscuro: tokens, tipografía, formas, navegación y cada
  pantalla, incluidas las que no se dibujaron (Progreso, Ejercicios, Traducir, Estructuras, Oído,
  Repaso, Libros, Ajustes, configuración de charla, onboarding, actualización).
- El compañero es una esfera iridiscente. Libro tiene su gemela cálida. Son la firma del producto.
- El logotipo, el icono y los instaladores adoptan la esfera (decisión de la persona dueña, 31-oct).
- Se mantiene la regla de navegación del 31-oct: las funciones principales se ven en Inicio,
  separadas en Conversación y Libro, y nada queda a más de 3 clics.

## No metas

- Funciones nuevas, cambios en Rust, sidecar, protocolo, datos o comandos IPC.
- Cambiar el comportamiento de las pantallas: lo que hoy se puede hacer se sigue pudiendo hacer.

## Lo que sería un fracaso aunque funcione

- Que parezca una app genérica de IA: gradientes por todas partes. El gradiente vive solo en la
  esfera, su resplandor y la acción principal de cada pantalla.
- Que Libro quede como sección secundaria.
- Pantallas más cargadas que hoy: ante la duda, colapsar o cortar.
- Algún elemento que aparezca o desaparezca de golpe, o un movimiento que retrase al aprendiz.
- Corregir durante la charla o mostrar más de 1 foco + 2 detalles en el reporte.
- Usar imágenes generadas por IA.

## Decisiones de la persona dueña

- Dirección: Aura, en tema claro y oscuro.
- Refactor completo aceptado.
- Regla del 3 y funciones visibles en la primera pantalla (31-oct).
- Experiencia premium: mucho movimiento, elementos que se mueven e interacciones con el ratón.
  Todos los elementos, sin excepción, tienen animación de entrada y de salida; ninguno aparece ni
  desaparece de forma estática (31-oct). Detalle en «Movimiento».

## Decisiones de diseño (mías, ya presentadas salvo donde se indica)

### Sistema visual

Valores exactos: los generadores del lienzo (resumidos aquí).

| Token             | Claro     | Oscuro    |
| ----------------- | --------- | --------- |
| fondo             | `#F6F7FB` | `#0E0F1A` |
| superficie        | `#FFFFFF` | `#191B2B` |
| suave             | `#EEF0F7` | `#23263A` |
| línea             | `#E8EAF2` | `#2C2F45` |
| tinta             | `#23233A` | `#F1F2FA` |
| tinta suave       | `#5C5F74` | `#A9ACC4` |
| tú                | `#0F766E` | `#7FDCCB` |
| burbuja tú        | `#DFF2EE` | `#14393A` |
| burbuja compañero | `#ECE9FB` | `#26244A` |
| libro             | `#A3540F` | `#F2BE8A` |
| fondo libro       | `#FCEBD8` | `#3C2A1A` |

- Se conservan los nombres de token de `global.css` y su significado: cambian los valores. Una
  voz, un color. La escala de veredicto, `danger`, `known` y las clases de palabra siguen vigentes,
  reajustando valores para que pasen 4.5:1 sobre los fondos nuevos.
- Radios grandes: controles en píldora, tarjetas de 18–32 px. Se redefine la escala `--radius-*`.
- Sombras suaves en vez de bordes. La línea solo separa filas.
- Tipografía de interfaz y títulos: Plus Jakarta Sans por `@fontsource-variable` (OFL, compatible
  con AGPL). Salen Geist, Geist Mono y Urbanist. Newsreader se queda para el texto de los libros.
- Esferas: utilidades `bg-orb` y `bg-orb-book` en `global.css`, solo CSS, sin imágenes. Un
  componente `Orb` con tamaño, sección (`partner`/`book`) y estado (`idle`, `listening`,
  `thinking`). La animación es lenta y respeta `prefers-reduced-motion`.
- Salen `bg-hero`, `bg-partner-panel`, `bg-glow`, `bg-voices` y `Waveform`, salvo que el
  constructor encuentre un uso sin sustituto.

### Movimiento

Requisito de la persona dueña; lo que sigue es cómo lo cumplo (mi decisión).

- **Regla:** todo lo que entra o sale del árbol de la interfaz se anima al entrar y al salir, en
  cada pantalla: pantallas, secciones, tarjetas, filas, mensajes, burbujas, píldoras, popovers,
  tooltips, avisos, modales, errores, estados vacíos y de carga. Una revisión del PR recorre cada
  aparición condicional (`&&`, ternarios, listas) buscando las que falten.
- **Biblioteca:** `motion` (MIT, compatible con AGPL), porque CSS no anima la salida de lo que React
  desmonta. Un solo juego de variantes y duraciones vive en un módulo compartido: las pantallas no
  inventan las suyas. Los valores de tiempo y curva salen de tokens, sin valores arbitrarios.
- **Pantallas:** al cambiar de ruta, la saliente se va y la entrante llega con sus bloques en
  cascada. Se conservan las pantallas de ventana completa con su propia transición.
- **Listas:** entrada escalonada; al quitar o reordenar, las filas se recolocan con animación de
  posición en vez de saltar.
- **Elementos compartidos:** la píldora activa de la barra se desliza a la nueva entrada; la esfera
  de Inicio viaja a su lugar en Charla y en Capítulo; los puntos de pasos y las barras de avance se
  deslizan; los números que cambian (racha, contadores) cuentan hasta su valor.
- **Ratón:** todo lo clicable tiene cursor pointer y respuesta al pasar (elevación suave) y al
  presionar (ligera compresión). Las tarjetas principales de Inicio se inclinan con un parallax
  sutil según el puntero, la esfera sigue el cursor lentamente y su brillo responde a la cercanía.
  El botón principal tiene atracción magnética leve. Solo con ratón: en táctil o teclado no hay
  nada que dependa de esto, y el foco visible se mantiene.
- **Esfera viva:** deriva constante y lenta; en `listening` late con el volumen del micrófono si ese
  dato ya existe en la interfaz, y si no, con un pulso propio; en `thinking`, gira más rápido.
- **Ritmo:** el movimiento no estorba. Entradas de 200 a 450 ms; salidas más cortas, de 120 a
  220 ms. Nada bloquea la entrada: el teclado y los clics responden durante cualquier animación, y
  en Práctica y Ejercicios el ítem siguiente no espera a que termine la salida del anterior para
  aceptar respuesta. El texto en streaming entra como un solo mensaje, sin animar cada fragmento.
- **Rendimiento:** solo `transform` y `opacity` en lo que se repite. La app debe ir fluida en
  listas largas: en tablas de muchas filas, la cascada cubre lo visible al entrar; el resto entra
  sin retraso, con fundido.
- **`prefers-reduced-motion`:** es la única excepción de forma, no de regla. Se mantienen entrada y
  salida como un fundido corto; salen desplazamientos, parallax, seguimiento del cursor y deriva de
  la esfera. Es un ajuste de accesibilidad del sistema. Con los efectos de animación desactivados
  en Windows, la app se verá en este modo.
- **Pruebas:** los tests no esperan animaciones: un `MotionConfig` o equivalente las anula en el
  entorno de pruebas sin desactivar reglas de lint.

### Inicio

Tres columnas: Conversación, centro, Libro.

Las 9 entradas y Ajustes se ven sin desplazarse en el tamaño por defecto de la ventana (1100×760)
y hasta donde quepan en tamaños menores. Por eso Inicio tiene una composición compacta, no un
simple apilado:

- En 1100×760 la esfera central mide unos 160 px, no 260, y `Para hoy` muestra una sola línea.
- Debajo de unos 1000 px de ancho, el centro va arriba con una esfera de unos 96 px, y Conversación
  y Libro quedan debajo, lado a lado, en filas compactas. Solo el tamaño mínimo (720×560) puede
  necesitar desplazamiento.
- No cambian el tamaño por defecto ni el mínimo de la ventana.

- Centro: esfera, saludo actual, tema de hoy, `Empezar charla`, `Otro tema`, `Personalizar` y
  `Continuar la anterior` (solo si existe).
- Conservar lo que el mockup omite: bajo el tema, la línea de foco; bajo las acciones, como mucho
  una línea discreta de «Para hoy» con el reto, la rotación o el cambio de nivel, en ese orden de
  prioridad. Si hay más de una, un control `Ver más` despliega las demás dentro de Inicio: ninguna
  se pierde.
- Laterales: las 3 y 6 entradas, cada una con etiqueta y un dato secundario solo si ya existe en el
  estado actual (`dueWords`, `dueReviews`, racha, capítulo actual). Sin comandos nuevos: los datos
  del mockup como «3 nuevas» o «2 en la repisa» no se implementan si exigirían uno.
- La columna Libro usa una esfera cálida pequeña, de unos 32 px junto a su título, y el color de
  libro para equilibrar las dos secciones.
- Encabezado: logo, racha y Ajustes. Sin libros, Libro lleva a Libros, igual que hoy.

### Navegación

- Desaparece `Sidebar` y su `Select` de capítulo. No hay menú permanente.
- Fuera de Inicio, barra superior: `←` a Inicio, las entradas de la sección actual como píldoras
  (3 en Conversación, 6 en Libro) y Ajustes. El mockup de Capítulo muestra 4 píldoras; la barra
  lleva las 6 para cumplir la regla del 3.
- En Libro, el título del capítulo actual en la barra abre el selector de capítulo, con la misma
  lógica de hoy.
- Cruzar de sección cuesta 2 clics: `←` y la entrada.
- Pantallas de ventana completa (`showsNav` falso): sin barra, solo salida propia. La lógica de
  `showsNav` no cambia.
- La tarjeta de actualización y su barra de carga siguen flotando, abajo a la derecha, solo mientras
  hay algo que atender.
- La versión en uso, `Buscar actualizaciones` y la forma de reabrir una actualización descartada con
  `Más tarde`, que hoy están en `UpdateHint`, pasan a una fila nueva en Ajustes. Mientras haya una
  actualización descartada, el botón de Ajustes lleva un punto discreto. Nada de esto se pierde.

### Pantallas dibujadas

- **Charla:** esfera a la izquierda con estado, minutos y aviso de ánimo; mensajes a la derecha;
  compositor en píldora con `¿Cómo digo…?`. Conserva `Te puede servir`, contador de palabras,
  transcripción editable, meta alcanzada y demás estados actuales.
- **Feedback:** una tarjeta por paso con puntos arriba. Todos los tipos de tarjeta actuales se
  rehacen con este patrón. El análisis previo usa la esfera en estado `thinking`.
- **Capítulo:** a la izquierda esfera cálida, libro, capítulo, avance y `Practicar`; a la derecha
  la tabla de palabras. Conserva sus estados: elegir profundidad, preparando, sin palabras, listo.
- **Práctica:** barra de avance, esfera cálida pequeña, un solo ítem. Conserva pista, `No lo sé`,
  atajos, disputa y veredicto.

### Pantallas sin dibujar

Aplican el mismo sistema: columna centrada, una acción principal, tarjetas suaves. Conversación
usa esfera lila; Libro, la cálida. Portadas de libro actuales, ajustadas a los radios nuevos.

## Restricciones del repositorio

- Solo utilidades Tailwind y tokens; ningún hex fuera de `global.css`. Textos por i18n en + es.
- `ipcMock.ts` sigue funcionando; `bun run dev` debe mostrar todas las pantallas.
- Sin suprimir lint. `bun run check` en verde. Los tests que dependan de `Sidebar`, `Waveform` o
  de textos retirados se reescriben; no se saltan.
- El PR sube versión minor. Actualizar `docs/SPEC.md` (estilo, navegación e Inicio) y el comentario
  de `global.css`.

## Rama (mi decisión)

Partir de `feat/sidebar-nav` (PR #16 abierto) para no reescribir su trabajo de rutas por capítulo.
La parte de Aura se publica en un PR propio sobre esa rama; si #16 se fusiona antes, se rebasa
sobre `main`.

## Para el constructor

- Orden de las fases, siempre que cada una deje el app usable. Sugerencia: tokens y fuentes,
  componentes base, navegación, Inicio, flujo de Charla, flujo de Libro, resto.
- Detalles de espaciado dentro del lenguaje del mockup, y curvas y duraciones exactas dentro de
  «Movimiento».
- Componentes nuevos o a retirar, y cómo agrupar los PR.
