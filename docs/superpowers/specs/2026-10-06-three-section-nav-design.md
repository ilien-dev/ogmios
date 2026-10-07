# Navegación en tres secciones — diseño

Fecha: 2026-10-06 · Prototipo aprobado: https://claude.ai/code/artifact/2e03e2dc-9098-4ae9-9563-db1354e82337

## Objetivo

El menú lateral tiene ocho opciones al mismo nivel (Inicio, Práctica, Estructuras, Oído, Libros,
Repaso, Progreso, Ajustes) y desorienta. Pasa a tener tres secciones, **Conversación**, **Libro**
y **Estructuras**, más **Ajustes** fijo abajo. Cada sección abre una pantalla principal con
tarjetas que llevan a lo que hoy son opciones sueltas del menú.

Ninguna pantalla desaparece ni cambia por dentro: cambia cómo se llega a ella.

## Dónde queda cada opción

| Hoy         | Después                                                        |
| ----------- | -------------------------------------------------------------- |
| Inicio      | Pantalla principal de Conversación                             |
| Práctica    | Conversación › tarjeta «Ejercicios de 2 min»                   |
| Progreso    | Conversación › tarjeta «Progreso»                              |
| Libros      | Libro › «Cambiar» (la estantería)                              |
| Repaso      | Libro › tarjeta «Repaso diario»                                |
| Oído        | Libro › tarjeta «Oído»                                         |
| Estructuras | Estructuras                                                    |
| Ajustes     | Ajustes, fijo al pie del menú, sobre el aviso de actualización |

## Menú lateral

`Sidebar.tsx` muestra tres ítems arriba y Ajustes abajo. `sectionOf` asigna cada ruta a su sección
para marcar `aria-current`:

- **conversation:** `home`, `setup`, `practice`, `progress`, `report`.
- **book:** `books`, `recall`, `listening`.
- **structures:** `structures`.
- **settings:** `settings`.

Conversación y Libro llevan un contador cuando hay algo pendiente hoy: `dueReviews` y `dueWords`
de `homeState`. `App` lo pide al montar y cada vez que la ruta vuelve a mostrar el menú, y lo pasa
al `Sidebar` como prop; si la petición falla no hay contador ni aviso. Estructuras no lleva
contador (el prototipo mostraba uno; se deja fuera hasta que haga falta).

`showsNav` no cambia: las pantallas que hoy ocupan toda la ventana lo siguen haciendo.

## Rutas

Los nombres de `Route` se conservan. Dos rutas ganan un campo para separar la pantalla principal
de lo que antes era su menú:

- `books`: `{ bookId: null }` es ahora la pantalla principal de Libro. La estantería pasa a
  `{ bookId: null, shelf: true }`.
- `structures`: sin campos es ahora la pantalla principal de Estructuras. El catálogo (el
  `StructureMenu` actual) pasa a `{ catalog: true }`.

Todo `navigate` que hoy apunta a la estantería o al catálogo se actualiza: el «volver» de
`BookDetail` y de «Palabras que ya sé», borrar un libro, el enlace de `ListeningMenu` cuando no
hay capítulo, y el cierre de una sesión de estructuras que salió del catálogo.

## Tarjeta de sección

Un componente nuevo, `src/components/ui/HubCard.tsx`: un botón con la apariencia de `Card`
(no un `Card` con un botón dentro) que recibe `title`, `text`, `status` opcional y `onClick`.
El estado es una línea bajo un separador; un pendiente se muestra con `Chip`. Las tres pantallas
principales lo usan en una rejilla que se adapta al ancho.

## Conversación (`Home.tsx`)

Arriba queda igual: saludo, tema ya elegido, botón grande «Empezar» y sus tres botones discretos
(§6.1 de `docs/SPEC.md`). Empezar una charla sigue costando un clic.

Debajo, dos tarjetas:

- **Ejercicios de 2 min** → `practice` sin `autostart`. Estado: «N pendientes» si
  `dueReviews > 0`.
- **Progreso** → `progress`. Estado: la racha, con el mismo texto que hoy.

Bajo las tarjetas siguen las líneas discretas de foco, palabras por repasar (lleva a `recall`),
reto, rotación y nivel. Se quitan dos líneas que las tarjetas sustituyen: la de ejercicios
pendientes y la de la racha.

La pantalla `Practice` cambia su título a «Ejercicios de 2 min» (en: «2-minute drills») para que
no se confunda con Estructuras.

## Libro (`BookHub.tsx`, nuevo, en `features/books/`)

Trabaja sobre el **capítulo actual**: el abierto por última vez (`book_chapters.opened_at`, lo
mismo que ya usan Oído y Estructuras).

Arriba, el libro y el capítulo actuales con un botón «Cambiar» que abre la estantería. Elegir un
capítulo allí funciona como hoy y lo convierte en el actual.

Cuatro tarjetas:

- **Vocabulario** → `books` con ese `bookId` y `chapterId` (`ChapterScreen`). Estado: el
  porcentaje listo del capítulo, «Listo para leer» al 100 % o «Sin preparar».
- **Traducir el capítulo** → lo mismo con `translating: true`. Sin estado.
- **Repaso diario** → `recall`. Estado: «Hoy te tocan N» si `dueWords > 0`.
- **Oído** → `listening` con ese `chapterId`. Sin estado.

Debajo, dos líneas discretas: «Estructuras de este capítulo» (→ `structures` con `chapterId` y
`bookId`) y «Palabras que ya sé: N» (→ `books` con `known: true`).

**Sin capítulo actual** (ningún libro, o ninguno abierto): no se muestran las tarjetas de
capítulo ni la línea de estructuras. La pantalla dice qué falta y ofrece un botón a la estantería.
«Repaso diario» y «Palabras que ya sé» siguen visibles: no dependen de un capítulo.

### Datos

Un comando nuevo de solo lectura, `book_hub`, sin modelo:

```ts
interface BookHub {
  /** El capítulo abierto por última vez y su libro; null si no hay ninguno. */
  current: { bookId: string; bookTitle: string; chapter: Chapter } | null;
  dueWords: number;
  knownWords: number;
}
```

Se define en `shared/domain.ts` y `domain.rs`, se expone en `ipc.ts` y se refleja en `ipcMock.ts`.
No añade ni cambia nada guardado: no hay migración ni backfill.

## Estructuras (`StructuresScreen.tsx`)

Sin campos en la ruta muestra la pantalla principal, con los datos de `structuresState`:

- **Sesión libre** → `{ catalog: true }`. Estado: cuántas estructuras hay y cuántas son firmes.
- **Del capítulo** → `{ chapterId }` del capítulo actual. Solo aparece si hay capítulo actual.
- **En pausa** → solo aparece si hay sesiones en pausa. Con una, la continúa
  (`{ running: id }`); con varias, abre el catálogo, que ya las lista.

## Volver

Las pantallas que dejan de estar en el menú ganan un enlace «volver» a su sección, con el mismo
patrón que el `onBack` de `ChapterScreen`: `Practice` (sin `autostart`) y `ProgressScreen` →
`home`; `RecallScreen` (menú), `ListeningMenu` y la estantería → `books`; el catálogo de
estructuras → `structures`.

## Textos

`nav` en `en.ts` y `es.ts` queda con `label`, `conversation`, `book`, `structures` y `settings`;
se borran `home`, `practice`, `books`, `recall`, `listening` y `progress`. Los textos de las
tarjetas, del estado vacío de Libro y de los enlaces «volver» van en ambos idiomas.

## `docs/SPEC.md`

- §6.1: la pantalla de inicio es la principal de Conversación y lleva las dos tarjetas.
- §9.4, §9.8: Repaso y Oído ya no son «una sección propia»; se abren desde Libro.
- §9.7: Estructuras sigue siendo sección propia; se describe su pantalla principal.
- §17: un párrafo con las tres secciones y Ajustes.

## Pruebas

Primero las pruebas, como pide `CLAUDE.md`:

- `Sidebar`: cuatro ítems; cada ruta marca su sección (una por nombre de ruta); contadores.
- `Home`: las dos tarjetas navegan donde deben; el botón «Empezar» sigue igual; ya no salen las
  dos líneas sustituidas.
- `BookHub`: con capítulo actual (cuatro tarjetas y sus destinos) y sin él (estado vacío).
- `StructuresScreen`: pantalla principal con y sin capítulo, con cero, una y varias en pausa.
- `BooksScreen`, `ListeningMenu`: los destinos que cambiaron a `shelf: true`.
- Rust: `book_hub` con y sin capítulo abierto.

## Fuera de alcance

- El contenido de cualquier pantalla de destino (ejercicios, repaso, dictado, traducción,
  progreso, ajustes).
- Mover el vocabulario de Progreso a Libro.
- Estado en las tarjetas «Traducir» y «Oído», y contador de Estructuras en el menú.

## Entrega

Es una funcionalidad: sube la versión menor en `package.json` y `src-tauri/Cargo.toml`. La rama
`feat/update-card` también toca `Sidebar.tsx` y `App.tsx` (el aviso de actualización ya no recibe
`onOpen`); la que entre segunda resuelve ese cruce.
