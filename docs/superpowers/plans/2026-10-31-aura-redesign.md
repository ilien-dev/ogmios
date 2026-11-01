# Rediseño Aura: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir toda la interfaz por Aura, en claro y oscuro, con navegación sin barra lateral y animación de entrada y salida en cada elemento.

**Architecture:** Los tokens de `global.css` cambian de valor y arrastran casi todas las pantallas. `motion` aporta las salidas mediante primitivas propias (`Presence`, `Reveal`, `Stagger`), que son el único punto de contacto de las pantallas con la biblioteca. Las pantallas viven en un escenario apilado (`ScreenStage`): la saliente y la entrante conviven durante la transición, lo que permite que la esfera viaje entre ellas sin retrasar nada.

**Tech Stack:** React 19, Tailwind 4, `motion` (MIT), `@fontsource-variable/plus-jakarta-sans` (OFL), bun test, happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-31-aura-redesign-design.md`. Quien ejecute lee ambos. Mockups: el lienzo enlazado en el spec.

## Global Constraints

- Sin cambios en `src-tauri/src`, `sidecar/`, `shared/` ni en comandos IPC. El logo no se toca.
- Ningún hex ni valor arbitrario fuera de `global.css`. Textos por i18n en `en` y `es`.
- Nunca suprimir lint ni aflojar `.oxlintrc.jsonc`. Si un archivo supera `max-lines`, se divide.
- El gradiente vive solo en esfera, resplandor y acción principal.
- La charla nunca corrige. El reporte muestra 1 foco + 2 detalles como máximo.
- Sin imágenes generadas por IA.
- Entradas de 200 a 450 ms; salidas de 120 a 220 ms. Solo `transform` y `opacity` en lo que se repite.
- Ninguna animación bloquea teclado ni clics.
- Todo lo clicable tiene cursor pointer.
- `bun run dev` muestra todas las pantallas con `ipcMock.ts`.
- Versión 0.11.0 en `package.json` y `src-tauri/Cargo.toml`.
- Nunca confirmar `.gitignore`. Nunca añadir `Claude-Session:` ni enlaces de sesión a commits o PR.
- Cada tarea termina con `bun run typecheck && bun run lint && bun test` en verde.
- Commits solo sobre la rama `feat/aura`.

## Review Focus

1. **Navegación rápida:** dos clics seguidos durante una transición dejan una sola pantalla interactiva, la última. Test en Tarea 3.
2. **Enter durante una salida en Práctica:** la respuesta va al ítem nuevo y nunca se envía dos veces el anterior. Test en Tarea 7.
3. **`prefers-reduced-motion`:** nada queda con opacidad 0 ni desplazado; las entradas y salidas siguen como fundido. Test en Tarea 2.
4. **Capítulo con 2000 palabras:** la cascada no acumula retraso; la última fila no tarda más que la primera visible. Test en Tarea 2.
5. **Ventana de 720×560:** la barra de Libro cabe con sus 6 entradas. Bajo 1000 px las píldoras muestran solo icono y conservan su nombre accesible. Test en Tarea 3.

---

### Task 0: Rama, spec y dependencias

**Files:**

- Modify: `package.json`, `bun.lock`, `src-tauri/Cargo.toml`
- Add to git: `docs/superpowers/specs/2026-10-31-aura-redesign-design.md`, este plan

- [ ] **Step 1: Crear la rama**

Run: `git switch -c feat/aura`
Expected: rama nueva sobre `feat/sidebar-nav`, con `.gitignore` aún modificado y sin preparar.

- [ ] **Step 2: Instalar dependencias y subir versión**

Run: `bun add motion @fontsource-variable/plus-jakarta-sans` y `bun remove @fontsource-variable/geist @fontsource-variable/geist-mono @fontsource-variable/urbanist`. Subir ambas versiones a 0.11.0.

Los `@import` de `global.css` que apuntan a las fuentes retiradas se cambian en este mismo paso: `plus-jakarta-sans` entra y `newsreader` se queda. Sin esto, la build falla.

- [ ] **Step 3: Verificar el build**

Run: `bun run build`
Expected: termina sin errores.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src-tauri/Cargo.toml src-tauri/Cargo.lock src/styles/global.css docs/superpowers/specs/2026-10-31-aura-redesign-design.md docs/superpowers/plans/2026-10-31-aura-redesign.md
git commit -m "Prepare the Aura redesign (0.11.0)"
```

### Task 1: Tokens

**Files:**

- Modify: `src/styles/global.css`
- Test: `src/styles/contrast.test.ts`

**Interfaces:**

- Produces: utilidades `bg-orb`, `bg-orb-book`, `bg-cta`, `bg-cta-book`; tokens `on-cta`, `on-cta-book`, `shadow-glow`, `shadow-glow-book`; animaciones `animate-orb-drift`, `animate-orb-spin`.

- [ ] **Step 1: Escribir el test de contraste**

`src/styles/contrast.test.ts` lee `global.css`, extrae valores del bloque `@theme` y del bloque `data-theme="dark"`, y convierte hex y `oklch()` a sRGB con un ayudante local. Exige 4.5:1 en ambos temas para:

```ts
const PAIRS = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["ink", "you-soft"],
  ["ink", "partner-soft"],
  ["ink", "book-soft"],
  ["ink-soft", "canvas"],
  ["ink-soft", "surface"],
  ["ink-soft", "raised"],
  ["ink-faint", "surface"],
  ["you", "surface"],
  ["book", "canvas"],
  ["book", "surface"],
  ["partner", "partner-soft"],
  ["danger", "surface"],
  ["correct", "surface"],
  ["partial", "surface"],
  ["wrong", "surface"],
  ["known", "surface"],
  ["noun", "surface"],
  ["verb", "surface"],
  ["adjective", "surface"],
  ["adverb", "surface"],
] as const;
```

- [ ] **Step 2: Ejecutarlo**

Run: `bun test src/styles/contrast.test.ts`
Expected: FAIL en los pares que los valores nuevos aún no cumplen, o en la lectura si falta un token.

- [ ] **Step 3: Aplicar los valores del spec**

Correspondencia: fondo→`canvas`, superficie→`surface`, suave→`raised`, línea→`line`, tinta→`ink`, tinta suave→`ink-soft`, tú→`you`, `accent`, `accent-text`, burbuja tú→`you-soft`, burbuja compañero→`partner-soft`, libro→`book`, fondo libro→`book-soft`.

Valores derivados: `sunken` entre `canvas` y `raised`; `line-strong` claro `#C9CCDB`, oscuro `#4A4E68`; `ink-faint` lo más tenue que pase el test. Reajustar la escala semántica solo lo necesario para pasar.

Radios: `--radius-sm: 0.75rem`, `--radius-md: 1.125rem`, `--radius-lg: 1.5rem`, `--radius-xl: 2rem`.

Sombras: `--shadow-card`, igual que `shadow` del mockup; `--shadow-glow` y `--shadow-glow-book`, igual que `glow` y `glowWarm`, con sus valores oscuros. Se copian de `LIGHT` y `DARK` en el generador, resumidos aquí:

| Token              | Claro                                 | Oscuro                               |
| ------------------ | ------------------------------------- | ------------------------------------ |
| `shadow-card`      | `0 4px 18px rgb(35 35 58 / 0.06)`     | `0 4px 18px rgb(0 0 0 / 0.3)`        |
| `shadow-glow`      | `0 24px 70px rgb(154 140 240 / 0.28)` | `0 24px 90px rgb(154 140 240 / 0.4)` |
| `shadow-glow-book` | `0 20px 60px rgb(240 160 110 / 0.3)`  | `0 20px 80px rgb(240 160 110 / 0.3)` |

Fuentes: `--font-sans` y `--font-display` usan `"Plus Jakarta Sans Variable"`; `--font-mono` queda igual a `--font-sans`.

Utilidades con los gradientes exactos del mockup:

```css
@utility bg-orb {
  background:
    radial-gradient(circle at 34% 30%, #fff4e6 0 12%, transparent 42%),
    radial-gradient(circle at 70% 36%, #afc6ff 0 10%, transparent 52%),
    radial-gradient(circle at 44% 76%, #f7b8d8 0 8%, transparent 50%),
    radial-gradient(circle at 78% 78%, #9a8cf0 0 6%, transparent 46%), #d6e3ff;
}
@utility bg-orb-book {
  background:
    radial-gradient(circle at 34% 30%, #fff8e8 0 12%, transparent 44%),
    radial-gradient(circle at 72% 38%, #ffd49a 0 10%, transparent 52%),
    radial-gradient(circle at 42% 78%, #f9b48c 0 8%, transparent 50%),
    radial-gradient(circle at 80% 78%, #e8917a 0 6%, transparent 46%), #ffe7c7;
}
@utility bg-cta {
  background: linear-gradient(90deg, #e7ddfb, #ffd9e4);
}
@utility bg-cta-book {
  background: linear-gradient(90deg, #ffe7c7, #ffd3b8);
}
```

`--color-on-cta: #23233a` y `--color-on-cta-book: #3a2410`, iguales en ambos temas.

Añadir `--animate-orb-drift` (rotación de 24 s con `ease-in-out`, infinita) y `--animate-orb-spin` (rotación de 6 s, lineal, infinita). Reescribir el comentario superior del archivo describiendo Aura. `bg-hero`, `bg-partner-panel`, `bg-glow` y `bg-voices` se quedan hasta la Tarea 10.

Sustituir el bloque `prefers-reduced-motion` por uno que anule `animation-iteration-count` y `animation-name` de las animaciones infinitas y conserve los fundidos CSS en vez de reducirlos a 1 ms.

- [ ] **Step 4: Ejecutar test y build**

Run: `bun test src/styles/contrast.test.ts && bun run build`
Expected: PASS y build sin clases desconocidas.

- [ ] **Step 5: Commit**

```bash
git add src/styles
git commit -m "Set the Aura tokens, type and orb gradients"
```

### Task 2: Primitivas de movimiento

**Files:**

- Create: `src/lib/motion.ts`, `src/components/motion/Presence.tsx`, `src/components/motion/Reveal.tsx`, `src/components/motion/Stagger.tsx`, `src/components/motion/CountUp.tsx`, `src/components/motion/Tilt.tsx`, `src/components/motion/Magnetic.tsx`
- Modify: `src/test/setup.ts`, `src/main.tsx`
- Test: `src/components/motion/motion.test.tsx`

**Interfaces:**

- Produces:

```ts
// src/lib/motion.ts
export const DURATION: { enter: number; enterSlow: number; exit: number; exitFast: number }; // 0.3, 0.45, 0.18, 0.12
export const EASE_OUT: [number, number, number, number]; // [0.16, 1, 0.3, 1]
export const STAGGER_STEP: number;       // 0.04
export const STAGGER_LIMIT: number;      // 12
export type RevealKind = "rise" | "fade" | "scale" | "slide";
export const REVEAL: Record<RevealKind, Variants>;
export function animated(): boolean;     // false con MotionGlobalConfig.skipAnimations
export function staggerDelay(index: number): number;

// Componentes
<Presence swap?: boolean>{cond && <Reveal key="x" />}</Presence>
<Reveal as?: "div"|"li"|"section"|"p"|"span"|"tr"|"main" kind?: RevealKind index?: number className? ... />
<Stagger as? className?>{children}</Stagger>
<CountUp value: number format?: (n: number) => string className? />
<Tilt className?>{children}</Tilt>
<Magnetic className?>{children}</Magnetic>
```

- [ ] **Step 1: Configurar el modo de prueba**

En `src/test/setup.ts`, `MotionGlobalConfig.skipAnimations = true`. Confirmar en `node_modules/motion-dom` o en `motion/react` que el símbolo existe. Si cambió de nombre, usar el vigente; `animated()` es el único lugar que lo lee.

- [ ] **Step 2: Escribir los tests**

`motion.test.tsx` activa la animación en `beforeEach` y la restaura en `afterEach`, para comprobar salidas reales:

```ts
test("what leaves stays until its exit ends", async () => {
  /* cond true→false: sigue en el DOM justo después; findBy… ausente al final */
});
test("an element on its way out cannot be used", () => {
  /* el Reveal saliente lleva inert */
});
test("Presence swap puts the new element in at once", () => {
  /* ambos conviven; el nuevo no espera */
});
test("with animations skipped, Presence renders in place", () => {
  /* skip=true: al quitar desaparece de forma síncrona */
});
test("staggerDelay stops growing past the limit", () => {
  expect(staggerDelay(STAGGER_LIMIT + 1988)).toBe(staggerDelay(STAGGER_LIMIT));
});
test("under reduced motion, nothing stays hidden", async () => {
  /* MotionConfig reducedMotion="always": el Reveal acaba con opacidad 1 y sin transform */
});
test("CountUp shows the final value at once when skipped", () => {
  /* texto "42" síncrono */
});
```

- [ ] **Step 3: Ejecutarlos**

Run: `bun test src/components/motion/motion.test.tsx`
Expected: FAIL por módulos inexistentes.

- [ ] **Step 4: Implementar**

- `Presence`: si `animated()` es falso, devuelve `children` tal cual, para que los tests existentes sigan siendo síncronos. Si no, `AnimatePresence`, con `mode="popLayout"` cuando `swap` es verdadero.
- `Reveal`: `motion[as]` con `REVEAL[kind]`, `initial="hidden"`, `animate="shown"`, `exit="gone"`, y `inert` cuando `useIsPresent()` es falso. Si `animated()` es falso, `initial={false}`. Tipar con `HTMLMotionProps`.
- `Stagger`: asigna `index` por posición a sus hijos `Reveal` mediante contexto. Los índices mayores que `STAGGER_LIMIT` usan el retraso tope.
- `CountUp`: al cambiar `value`, `animate(prev, value, { onUpdate })`. Con `animated()` falso o reducción de movimiento, muestra `value` directo. El texto final siempre llega al DOM.
- `Tilt`: rotación de hasta 3 grados, con `useMotionValue` y `useSpring`, solo con `(hover: hover) and (pointer: fine)` y sin reducción de movimiento.
- `Magnetic`: desplazamiento de hasta 6 px hacia el puntero, con las mismas condiciones.

En `src/main.tsx`, envolver la app en `<MotionConfig reducedMotion="user" transition={{ duration: DURATION.enter, ease: EASE_OUT }}>`.

- [ ] **Step 5: Ejecutar y commit**

Run: `bun test src/components/motion/motion.test.tsx && bun test`
Expected: PASS.

```bash
git add src/lib/motion.ts src/components/motion src/test/setup.ts src/main.tsx
git commit -m "Add the motion primitives"
```

### Task 3: Kit de interfaz, esfera y navegación

**Files:**

- Create: `src/components/ui/Orb.tsx`, `src/components/ui/useOrbPointer.ts`, `src/app/places.ts`, `src/app/useShelf.ts`, `src/app/TopBar.tsx`, `src/app/ChapterMenu.tsx`, `src/app/ScreenStage.tsx`, `src/features/update/UpdateRow.tsx`
- Modify: `src/components/ui/{Button,Card,Chip,ChoiceGroup,HubCard,Notice,ProgressBar,Tooltip,Verdict,BackLink}.tsx`, `src/styles/global.css`, `src/app/routes.ts`, `src/app/App.tsx`, `src/features/settings/SettingsScreen.tsx`, `src/features/update/{UpdateCard,UpdateProgress}.tsx`, `src/features/update/AppUpdate.test.tsx`, `src/lib/i18n/{en,es}.ts`
- Delete: `src/app/Sidebar.tsx`, `src/app/Sidebar.test.tsx`, `src/features/update/UpdateHint.tsx`
- Test: `src/app/TopBar.test.tsx`, `src/app/ScreenStage.test.tsx`, `src/app/routes.test.ts`

**Interfaces:**

- Consumes: Tarea 2.
- Produces:

```ts
// places.ts: lo que hoy está en Sidebar.tsx
export type Entry; export function entryOf(route: Route): Entry | "settings";
export function bookRoutes(current: Current | null): Partial<Record<Entry, Route>>;
export const CONVERSATION_PLACES; export const BOOK_PLACES;
export function placeTarget(entry: Entry, current: Current | null): Route;

// useShelf.ts: el efecto actual de App
export function useShelf(route: Route, enabled: boolean): {
  counts: Partial<Record<Entry, number>>; books: Book[]; currentId: string | null;
};

// routes.ts
export function screenKey(route: Route): string;
export function sectionOf(route: Route): "conversation" | "book" | null;

// Orb
export type OrbState = "idle" | "listening" | "thinking";
<Orb size: "xs"|"sm"|"md"|"lg"|"xl" section?: "partner"|"book" state?: OrbState
     level?: MotionValue<number> shared?: boolean follow?: boolean className? />

// Button: variantes nuevas
variant: ... | "primaryBook"
```

- [ ] **Step 1: Escribir los tests**

`TopBar.test.tsx` reescribe los casos de `Sidebar.test.tsx`, conservando `ROUTES` de `entryOf` y `chapterOn`, y añade:

```ts
test("conversation shows its 3 places and book its 6", ...);
test("the back arrow goes home", ...);
test("the place of the screen is marked with aria-current", ...);
test("what is due shows on its place", ...);
test("with no chapter, Vocabulary, Translate and Listening lead to the shelf", ...);
test("the chapter title opens the picker and picking opens that chapter", ...);
test("under 1000px, pills show only an icon and keep their name", ...); // getByRole("button", { name })
test("a dismissed update puts a dot on Settings", ...);
```

`ScreenStage.test.tsx`, con animación activada:

```ts
test("the screen on its way out cannot be used", ...);
test("two moves in a row leave only the last screen", ...);
```

`routes.test.ts`:

```ts
test("moving inside a section keeps the key only when the screen is the same", ...);
test("books and a chapter of the same book have different keys", ...);
```

`AppUpdate.test.tsx`: los casos de `UpdateHint` se reescriben sobre `UpdateRow` y conservan cada aserción. «Later folds the card until the hint opens it again» pasa a abrirse desde `UpdateRow`.

- [ ] **Step 2: Ejecutarlos**

Run: `bun test src/app src/features/update`
Expected: FAIL por módulos inexistentes.

- [ ] **Step 3: Kit de interfaz**

- `global.css`, capa base: hover y presión para todo lo clicable, con las propiedades `translate` y `scale` para no chocar con los `transform` de `motion`. Elevación de 1 px en `(hover: hover)`; compresión a 0.97 en `:active`; ambas fuera con reducción de movimiento.

```css
button:not(:disabled),
a,
summary,
[role="button"]:not([aria-disabled="true"]) {
  transition:
    translate 160ms var(--ease-out-expo),
    scale 120ms var(--ease-out-expo);
}
```

- `Button`: `rounded-full` en los tres tamaños; `primary` pasa a `bg-cta text-on-cta`; nuevo `primaryBook` con `bg-cta-book text-on-cta-book`; `disabled` igual que hoy. Altura mínima de 44 px en `md`.
- `Tooltip`, `Notice` y demás componentes con aparición condicional usan `Presence` y `Reveal`. `Notice` recibe `Reveal` internamente.
- `Orb`: círculo `bg-orb` o `bg-orb-book` con `shadow-glow` en `lg` y `xl`. Tamaños: `xs` 32 px, `sm` 40, `md` 96, `lg` 160, `xl` 200. Con `shared`, `layoutId` `orb` u `orb-book`. `idle` usa `animate-orb-drift`, `thinking` usa `animate-orb-spin`, `listening` escala con `level`, si llega, y con pulso propio si no. Con `follow`, `useOrbPointer` desplaza hasta 12 px hacia el cursor y aumenta el brillo con la cercanía. Siempre `aria-hidden`.

- [ ] **Step 4: Navegación**

- Mover `Entry`, `entryOf` y `bookRoutes` a `places.ts`. Mover el efecto de datos de `App` a `useShelf`.
- `TopBar`: `←` a Inicio, píldoras de la sección, Ajustes. La píldora activa usa un `motion.span` con `layoutId="nav-pill"`, para deslizarse. En Libro, botón con el título del capítulo que abre `ChapterMenu`. Sin barra en `home`, que tiene encabezado propio.
- El corte de 1000 px es un token: `--breakpoint-nav: 62.5rem` en `@theme`, usado como `nav:` en las clases. Inicio, Charla y Capítulo usan el mismo.
- `ChapterMenu` sustituye al `Select` nativo, porque el desplegable del sistema no se puede animar: popover con `Presence`, agrupado por libro, navegable con flechas, Enter y Escape, con `role="listbox"`.
- `ScreenStage`: contenedor `relative` y `AnimatePresence` sin `mode`; cada pantalla es un `Reveal kind="slide"` en `absolute inset-0` con `key={screenKey(route)}`. `screenKey` separa pantallas distintas, no cada cambio de propiedades: `books` usa `bookId`, `chapterId` y el modo; `report`, `sessionId`; `recall`, `structures` y `listening`, su estado corriente.
- `App`: elimina el `flex` lateral y compone `TopBar`, `ScreenStage` y `UpdateCard`. `UpdateCard` flota abajo a la derecha con `Presence`.
- `UpdateRow`, en Ajustes: toda la lógica de `UpdateHint`. El punto de Ajustes aparece cuando `offered(state) !== null` y la tarjeta está plegada, leyendo `folded` de `useUpdate`.

Si al probar en navegador la esfera no viaja entre pantallas con `layoutId`, envolver `ScreenStage` en `LayoutGroup`. Si tampoco, dejar `layoutId` fuera y usar `kind="scale"` en la esfera: la meta es que la pantalla nunca espere por ella.

- [ ] **Step 5: Ejecutar y comprobar**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS. `rg "Sidebar|UpdateHint" src` no devuelve nada.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "Replace the sidebar with a section bar and animated screens"
```

### Task 4: Inicio

**Files:**

- Create: `src/features/home/HomeCenter.tsx`, `src/features/home/HomeColumn.tsx`, `src/features/home/TodayLine.tsx`, `src/features/home/homeLayout.ts`
- Modify: `src/features/home/Home.tsx`, `src/features/home/Home.test.tsx`, `src/app/App.tsx`, `src/lib/i18n/{en,es}.ts`
- Delete: `src/features/home/HomeLine.tsx` si `TodayLine` la sustituye

**Interfaces:**

- Consumes: `Orb`, `CountUp`, `Tilt`, `Magnetic`, `Stagger`, `placeTarget`, `CONVERSATION_PLACES`, `BOOK_PLACES`.
- Produces:

```ts
<Home navigate current={Current | null} counts={Partial<Record<Entry, number>>} />
export type TodayKind = "challenge" | "rotation" | "level";
export function todayLines(home: HomeState): TodayKind[]; // en ese orden de prioridad
```

- [ ] **Step 1: Reescribir `Home.test.tsx`**

```ts
test("every place shows at once: 3 of conversation, 6 of book, and Settings", ...);
test("opens on the start button, with the focus line under the topic", ...);
test("the partner steers towards the focus, once", ...);
test("today shows one line, the challenge first", ...);
test("See more unfolds the rest inside Home", ...);
test("no lines, no Today and no See more", ...);
test("Continue shows only when there is a previous chat", ...);
test("with no books, Book leads to the shelf", ...);
test("the numbers show only what exists", ...);       // Ejercicios: dueReviews; Repaso: dueWords; Progreso: racha
test("todayLines keeps challenge, rotation, level", ...);
test("is in Spanish too", ...);
```

- [ ] **Step 2: Ejecutarlos**

Run: `bun test src/features/home`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- `Home`: encabezado con logo, racha con `CountUp` y Ajustes, más tres columnas con el `Stagger` principal.
- Rejilla: desde 1000 px, columnas `Conversación · centro · Libro`. Por debajo, centro arriba y las dos columnas en filas compactas, lado a lado. `Orb size="lg"` desde 1000 px, `size="md"` por debajo, con `shared` y `follow`.
- `HomeColumn`: entradas como tarjetas con `Tilt`, icono, etiqueta y dato solo si existe. La columna Libro lleva `Orb size="xs" section="book"` junto a su título. Altura compacta: las 9 entradas y Ajustes caben en 1100×760 sin desplazarse.
- `HomeCenter`: saludo, tema con `Presence swap` al cambiar por `Otro tema`, línea de foco, `Empezar charla` en `Magnetic`, `Otro tema`, `Personalizar`, `Continuar la anterior`.
- `TodayLine`: primera línea de `todayLines` y `Ver más` con despliegue animado de altura.
- Claves i18n nuevas: `home.seeMore`, `home.seeLess`. Las claves sin uso se retiran de ambos idiomas.

- [ ] **Step 4: Verificar en navegador**

Run: `bun run dev` y abrir `/?mock=ready` en 1100×760, 999×700 y 720×560, en claro y oscuro.
Expected: en las dos primeras, sin barra de desplazamiento; en 720×560, desplazamiento permitido y todo accesible.

- [ ] **Step 5: Ejecutar y commit**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS.

```bash
git add src
git commit -m "Rebuild Home around the orb with both sections in view"
```

### Task 5: Flujo de Charla

**Files:**

- Modify: `src/features/setup/Setup.tsx`, `src/features/conversation/{Conversation,MessageList,Composer,MicButton,HelpPopover,AnalysisView,useRecorder}.tsx|ts`, `src/features/report/ReportScreen.tsx`, `src/features/report/cards/*.tsx`, `src/lib/i18n/{en,es}.ts`
- Test: `src/features/conversation/Conversation.test.tsx`, `src/features/report/ReportScreen.test.tsx`, `src/features/conversation/MessageList.test.tsx`

**Interfaces:**

- Consumes: `Orb` con `level`, `Reveal`, `Presence`, `Stagger`, `CountUp`.
- Produces: `useRecorder` expone `level: MotionValue<number>`, alimentado con `level.peak` en el `onSttLevel` que ya escucha. `Composer` acepta `onLevel?: (level: MotionValue<number>) => void`.

- [ ] **Step 1: Escribir los tests**

```ts
test("a streamed reply keeps one element from first to last chunk", ...); // mismo nodo tras varios deltas
test("the orb says it is listening while recording", ...);
test("the screen shows spoken minutes and the mood note", ...);
test("nothing on the chat screen corrects", ...);                         // mantiene los actuales
test("the report has one card per step with its dots", ...);
test("Back and Next move between cards", ...);
test("a report never shows more than one focus and two minors", ...);
```

- [ ] **Step 2: Ejecutarlos**

Run: `bun test src/features/conversation src/features/report`
Expected: FAIL en los nuevos.

- [ ] **Step 3: Implementar**

- `Conversation`: esfera `xl` a la izquierda con `shared`, estado, minutos y aviso; mensajes a la derecha; bajo 1000 px, esfera `sm` en cabecera. Salen `Waveform` y `bg-voices`. Avance y minutos con `CountUp`.
- `MessageList`: burbujas `you-soft` a la derecha y `partner-soft` a la izquierda con `Orb size="xs"`. Cada mensaje entra con un solo `Reveal`, clave por `id`; los deltas actualizan texto sin relanzar animación. Conservar `Te puede servir`, contador y edición.
- `Composer`: píldora con `¿Cómo digo…?`, micrófono con `bg-cta`. Todo su contenido condicional va por `Presence`.
- `AnalysisView`: `Orb` `lg` en `thinking`. `Setup`: sistema general con `Stagger`.
- `ReportScreen`: tarjeta `rounded-xl`, una por paso, con `Presence swap`; puntos con `layoutId="report-dot"`.
- Sale cada `motion-safe:animate-*` de estos archivos.

- [ ] **Step 4: Ejecutar, recorrer y commit**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS. En `bun run dev`, recorrer Inicio → Charla → Terminar → Reporte en ambos temas.

```bash
git add src
git commit -m "Rebuild the conversation flow in Aura"
```

### Task 6: Estantería y Capítulo

**Files:**

- Modify: `src/features/books/{BooksScreen,BookDetail,BookCover,ChapterRow,ChapterScreen,KnownWordsScreen,WordList,DisputeNote}.tsx` y sus tests

**Interfaces:**

- Consumes: `Orb section="book"`, `Stagger`, `Button variant="primaryBook"`.

- [ ] **Step 1: Escribir los tests**

```ts
test("the chapter shows book, progress and Practise beside the words", ...);
test("removing a word lets the rest close the gap", ...);   // la fila se va y las demás quedan
test("each state of the chapter still shows", ...);         // profundidad, preparando, sin palabras, listo
```

- [ ] **Step 2: Ejecutarlos**

Run: `bun test src/features/books/ChapterScreen.test.tsx`
Expected: FAIL en la primera.

- [ ] **Step 3: Implementar**

`ChapterScreen` a dos columnas: izquierda con `Orb lg section="book" shared`, libro, capítulo, avance y `Practicar`; derecha con tabla en tarjeta. Bajo 1000 px, columna única. `WordList` usa `layout` en filas y `Stagger`, cuyo tope cubre las listas largas. Portadas con radios nuevos y `Tilt`. Migrar `motion-safe:animate-*`.

- [ ] **Step 4: Ejecutar y commit**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS.

```bash
git add src
git commit -m "Rebuild the shelf and the chapter screen in Aura"
```

### Task 7: Sesiones de un ítem

**Files:**

- Modify: `src/features/books/{SittingScreen,SittingItem,SittingParts,Tally,RefreshRun,TriageRun}.tsx`, `src/features/drills/{Practice,DrillRunner,SpotErrorChoice}.tsx`, `src/features/recall/{RecallScreen,RecallRun,StrengthMark,WordNote}.tsx`
- Test: `src/features/books/SittingItem.test.tsx`, `src/features/drills/DrillRunner.test.tsx`

**Interfaces:**

- Consumes: `Reveal`, `Presence swap`, `Orb`, `ProgressBar`.

- [ ] **Step 1: Escribir los tests**

Con animación activada:

```ts
test("Enter during an exit answers the new item and never the old one twice", ...);
test("the next item takes input while the last one leaves", ...);
```

- [ ] **Step 2: Ejecutarlos**

Run: `bun test src/features/books/SittingItem.test.tsx src/features/drills/DrillRunner.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Ítem por `Presence swap` con clave por ítem, `Orb sm section="book"` en Libro y lila en Ejercicios. Barra de avance arriba. Veredicto, pista, `No lo sé`, atajos y disputa se conservan; el foco pasa de inmediato al campo nuevo, y `inert` en el saliente evita el doble envío. La animación `animate-point` se mantiene.

- [ ] **Step 4: Ejecutar y commit**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS.

```bash
git add src
git commit -m "Animate one-item sessions without delaying input"
```

### Task 8: Traducir, Estructuras y Oído

**Files:**

- Modify: `src/features/books/{TranslateScreen,TranslateDetail,TranslateRows}.tsx`, `src/features/structures/*.tsx`, `src/features/listening/*.tsx`

**Interfaces:**

- Consumes: `Reveal`, `Presence`, `Stagger`, `Orb section="book"`.

- [ ] **Step 1: Migrar pantalla a pantalla**

Por cada archivo: columna centrada, una acción principal en `primaryBook`, tarjetas suaves, `Stagger` en menús y listas, `Presence` en toda aparición condicional, sin `motion-safe:animate-rise`. `StructureRun` y `DictationRun` usan `Presence swap`, igual que la Tarea 7. Dividir archivos que excedan `max-lines`.

- [ ] **Step 2: Ejecutar y recorrer**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS. En `bun run dev`, recorrer las tres secciones.

- [ ] **Step 3: Commit**

```bash
git add src
git commit -m "Bring translation, structures and listening into Aura"
```

### Task 9: Progreso, Ajustes, onboarding y arranque

**Files:**

- Modify: `src/features/progress/*.tsx`, `src/features/settings/*.tsx`, `src/features/onboarding/*.tsx`, `src/features/speech/SpeakButton.tsx`, `src/app/App.tsx`

**Interfaces:**

- Consumes: `CountUp`, `Stagger`, `Reveal`, `Orb`.

- [ ] **Step 1: Migrar**

- Progreso: tarjetas con `Stagger`, cifras con `CountUp`, barras de `WeeklyBars` que crecen al entrar.
- Ajustes: secciones con `Stagger`. Selector de tema con píldora deslizante; el cambio de tema funde colores en 300 ms.
- Onboarding: pasos con `Presence swap` y esfera lila.
- `App`: carga y error de arranque con `Reveal`; el paso de carga a la app funde.

- [ ] **Step 2: Ejecutar y commit**

Run: `bun test && bun run typecheck && bun run lint`
Expected: PASS.

```bash
git add src
git commit -m "Bring progress, settings and onboarding into Aura"
```

### Task 10: Auditoría de movimiento, limpieza y documentación

**Files:**

- Create: `scripts/motion-coverage.test.ts`
- Delete: `src/components/ui/Waveform.tsx`
- Modify: `src/styles/global.css`, `docs/SPEC.md`, `README.md` si describe el estilo

- [ ] **Step 1: Escribir el guardián**

`scripts/motion-coverage.test.ts` recorre `src/**/*.tsx`, sin tests, y exige:

```ts
test("no screen keeps a CSS entrance", ...);                 // sin motion-safe:animate-(rise|enter|lift|fade)
test("no retired look survives", ...);                       // sin bg-hero|bg-partner-panel|bg-glow|bg-voices|Waveform
test("conditional JSX in a screen goes through Presence", ...);
```

El tercero busca en cada archivo bajo `src/features`, `src/app` y `src/components` los patrones `{… && (` y `? (` seguidos de JSX fuera de un `<Presence>`. Una lista `ALLOWED` en el propio test nombra los casos que no son aparición visual, como el `<option>` de un `select`, cada uno con su motivo. Si la lista crece más de lo razonable, la detección se afina, no se amplía la lista.

- [ ] **Step 2: Ejecutarlo y corregir cada hallazgo**

Run: `bun test scripts/motion-coverage.test.ts`
Expected: al final, PASS. Cada hallazgo se corrige en su pantalla.

- [ ] **Step 3: Retirar y documentar**

Borrar `Waveform.tsx`, `bg-hero`, `bg-partner-panel`, `bg-glow`, `bg-voices`, los tokens `hero-*` y las animaciones sin uso. En `docs/SPEC.md`, reescribir §6.1 y §17: navegación sin barra lateral, Inicio de tres columnas, estilo Aura y regla de movimiento.

- [ ] **Step 4: Verificación total**

Run: `bun run check`
Expected: verde completo.

Recorrer en `bun run tauri:dev`, en claro y oscuro, cada pantalla con ratón y solo con teclado. Repetir con los efectos de animación de Windows desactivados. Medir Inicio y una lista larga en las DevTools de WebView2: sin tareas largas sostenidas durante las transiciones.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs
git commit -m "Hold every screen to the motion rule and retire the old look"
```

## Fuera del plan

Abrir el PR y fusionar se decide al terminar, con `superpowers:finishing-a-development-branch`. El PR apunta a `feat/sidebar-nav`; si #16 ya se fusionó, se rebasa sobre `main`.
