# Desarrollar Ogmios

**English:** [DEVELOPMENT.md](DEVELOPMENT.md)

Cómo compilar, ejecutar y probar Ogmios desde el código, y cómo encajan sus
partes. Para enviar un cambio, lee primero
[CONTRIBUTING.md](../CONTRIBUTING.md). La especificación del producto es
[SPEC.md](SPEC.md) y cómo funciona la memoria de errores está en
[HOW-IT-WORKS.es.md](HOW-IT-WORKS.es.md).

## Requisitos

[Bun](https://bun.sh) 1.3+, Rust estable y los
[requisitos de Tauri](https://v2.tauri.app/start/prerequisites/) de tu
plataforma (en Linux, también `libasound2-dev`).

## Comandos

```bash
bun install
bun run hooks:install   # comprobación de formato antes de cada commit
bun run tauri:dev       # la app de escritorio
bun run dev             # solo la interfaz, sobre un backend falso
bun run check           # tipos, lint, formato, tests (TypeScript y Rust)
```

El reconocedor de voz para Linux x86_64 está en `src-tauri/vendor/parakeet/`.
Para otra plataforma, ejecuta `scripts/build-parakeet.sh` (necesita CMake,
Ninja y un compilador de C++).

## Arquitectura

| Carpeta      | Qué contiene                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`       | La interfaz en React. Solo `src/lib/ipc.ts` habla con el backend.                                                                               |
| `src-tauri/` | El backend en Rust: la base de datos SQLite, el audio y el reconocimiento de voz, el llavero y la memoria de errores (`src-tauri/src/memory/`). |
| `sidecar/`   | Un proceso sin estado que habla con Claude, por la API de Anthropic o por el Claude Code del usuario.                                           |
| `shared/`    | Los tipos que intercambian la interfaz, el backend y el sidecar.                                                                                |

Rust es el dueño de todos los datos. El sidecar recibe lo que necesita en cada
llamada y no guarda nada. Claude etiqueta los errores; los estados de los
patrones, la prioridad, los límites y el calendario de repaso los decide código
probado en `src-tauri/src/memory/`, nunca un prompt.

## La web

La web ([ogmios.ilien.dev](https://ogmios.ilien.dev)) es su propio repositorio,
[ogmios-site](https://github.com/ilien-dev/ogmios-site), incluido aquí como el
submódulo `site/`. Sus ventanas reproducen la interfaz real, así que después de
un cambio en la interfaz se vuelve a generar la demo:

```bash
bun run site:install    # una vez: trae el submódulo y sus paquetes
bun run site:demo       # regenera la demo desde este checkout
bun run site:dev        # la web, en http://localhost:4321
```

Haz commit dentro de `site/` y súbelo, y después haz commit del nuevo puntero
`site` aquí.
