# Instalador a la medida — diseño

Fecha: 2026-10-07 · Maquetas aprobadas: opción B (una sola pantalla) en Windows, ventana del
`.dmg` con la marca en Mac.

## Objetivo

El instalador de Windows es el asistente NSIS por defecto de Tauri: gris, con «Nullsoft Install
System», Siguiente / Atrás / Cancelar y ninguna seña de Ogmios. El `.dmg` de Mac se abre en una
ventana blanca con los iconos sin ordenar. Los dos pasan a verse como Ogmios en todo momento:
primera instalación, actualización y desinstalación.

Por dentro nada cambia: Windows sigue publicando el `setup.exe` NSIS de Tauri y Mac el `.dmg` y el
`.app.tar.gz`. El actualizador de las apps ya instaladas sigue funcionando sin tocarlo.

## Windows

### Pantallas

Ventana oscura, logo, tipografía Segoe UI. No hay botones Siguiente / Atrás / Cancelar ni la franja
de cabecera del asistente; la barra de título es la de Windows.

1. **Inicio.** Logo, «Ogmios», la frase de la app y un botón dorado «Instalar». Debajo, un enlace
   «Opciones» que despliega en la misma pantalla:
   - la carpeta de instalación, con «Examinar»;
   - la casilla «Crear acceso directo en el escritorio», marcada por defecto.
2. **Instalando.** Logo, «Instalando…» y una barra dorada. Sin el registro de detalles.
3. **Listo.** «Todo listo» y un botón dorado «Abrir Ogmios». Cerrar la ventana termina sin abrir.

Si la instalación falla, la pantalla 2 muestra el error y un enlace «Ver detalles» que enseña el
registro de NSIS.

### Ya instalado

Cuando hay una versión instalada, la pantalla de inicio cambia el botón: «Actualizar» si la
instalada es anterior, «Reinstalar» si es la misma o posterior. La lógica de Tauri que detecta la
versión previa, desinstala una instalación WiX antigua y pasa `/UPDATE` al desinstalador se
conserva; solo cambia su aspecto. Desinstalar se hace desde Windows, no desde el instalador.

### Actualización desde la app

El actualizador ejecuta el instalador en modo pasivo (`installMode: "passive"`): solo aparece la
pantalla 2, que se cierra sola y relanza la app, como hoy. Las pantallas 1 y 3 se saltan con el
mismo `SkipIfPassive` de la plantilla.

### Desinstalador

Dos pantallas con el mismo estilo: confirmación, con la casilla «Borrar también mis datos» que ya
existe, y progreso.

### Idiomas

Español e inglés. Se elige por el idioma de Windows, con inglés como reserva; no hay selector.
Todos los textos propios viven en un archivo por idioma.

### Colores

Derivados a mano de los tokens del tema oscuro de `src/styles/global.css` (`canvas`, `ink`,
`ink-soft`, `accent`, `on-accent`), convertidos a hexadecimal porque NSIS no entiende `oklch`. Se
definen una sola vez, al principio de la plantilla.

### Cómo se construye

- `src-tauri/windows/installer.nsi`: copia de la plantilla de `tauri-bundler` de la versión de
  Tauri instalada, enlazada con `bundle.windows.nsis.template` en `tauri.windows.conf.json`. Su
  cabecera anota de qué versión se copió.
- Solo cambian las páginas. Las secciones (`EarlyChecks`, `WebView2`, `Install`, `Uninstall`),
  `.onInit`, los ganchos y el manejo de `/P`, `/R`, `/UPDATE` y `/NS` quedan como en el original.
- Las páginas 1 y 3 y la confirmación del desinstalador son páginas `nsDialogs`. La de progreso es
  la página `INSTFILES` de NSIS, recoloreada en su función `SHOW`.
- El marco del asistente (cabecera, línea inferior, botones) se oculta en una función nueva,
  enganchada con `MUI_CUSTOMFUNCTION_GUIINIT`.
- El botón dorado es un control con texto real, color de fondo y esquinas redondeadas por región,
  no una imagen: se traduce como cualquier otro texto.
- `src-tauri/windows/lang/English.nsh` y `Spanish.nsh`: los textos de Tauri más los nuestros,
  enlazados con `customLanguageFiles`. `languages: ["English", "Spanish"]`.
- `src-tauri/windows/logo.bmp`: el logo sobre el fondo oscuro. `installerIcon` y `uninstallerIcon`
  usan `icons/icon.ico`.
- Sin complementos de NSIS nuevos: solo los que ya trae Tauri (`nsDialogs`, `System`,
  `nsis_tauri_utils`).

## Mac

En Mac no hay asistente: se abre el `.dmg` y se arrastra la app a Aplicaciones. Un asistente real
sería un `.pkg`, que sin certificado de Apple recibe avisos más duros; se descarta.

- `src-tauri/macos/dmg-background.png`: fondo de 660 × 400 con una flecha dorada entre los dos
  iconos. Sin texto, así no hay nada que traducir.
- `bundle.macOS.dmg` en `tauri.macos.conf.json`: `background`, `windowSize` 660 × 400,
  `appPosition` (180, 190) y `applicationFolderPosition` (480, 190).
- Finder escribe los nombres de los iconos en negro o en blanco según el tema del sistema, no según
  el fondo. El fondo es por eso un grafito medio que se lee con los dos, no el casi negro de la
  maqueta. Se comprueba en un Mac real en modo claro y oscuro antes de dar la versión por buena.

El actualizador de Mac usa el `.app.tar.gz`: el `.dmg` solo se ve en la primera instalación.

## Pruebas

`scripts/installer.test.ts`, al estilo de los demás tests de configuración:

- `tauri.windows.conf.json` apunta a la plantilla, a los dos archivos de idioma y a los iconos, y
  todos existen; lo mismo para el fondo del `.dmg` en `tauri.macos.conf.json`.
- La plantilla conserva lo que el actualizador necesita: `/UPDATE`, `/P`, `SkipIfPassive`, las
  cuatro secciones y los cuatro ganchos.
- La plantilla no nombra a Nullsoft en `BrandingText`.
- Los dos archivos de idioma definen exactamente las mismas claves.
- La versión de `@tauri-apps/cli` instalada es la que anota la cabecera de la plantilla. Cuando
  Tauri sube, el test falla hasta que alguien compare la plantilla nueva con la copia.

Prueba real en Windows, con el instalador construido en local:

1. Instalación limpia, con y sin abrir «Opciones».
2. Otra carpeta y sin acceso directo en el escritorio.
3. Reinstalar sobre la misma versión.
4. Actualización pasiva: `setup.exe /P /R /UPDATE`.
5. Desinstalar, con y sin borrar los datos.
6. Windows en español y en inglés.

Mac: el `.dmg` se construye en CI; alguien lo abre en un Mac en modo claro y en modo oscuro.

## Riesgos

- **Que NSIS no deje ocultar del todo el marco del asistente.** El primer paso del plan es un
  prototipo de la ventana oscura con las tres pantallas vacías. Si no queda limpio, se para y se
  decide con el resultado delante antes de seguir.
- **Mantener la copia de la plantilla.** Cada subida de Tauri obliga a revisarla; el test de
  versión lo convierte en un fallo visible en vez de una rotura silenciosa del actualizador.
- **El `.dmg` no se puede ver en local.** Su colocación la hace Finder en el runner de macOS; se
  valida con una ejecución del workflow antes de fusionar.

## Fuera de alcance

- Firmar el instalador de Windows o notarizar la app de Mac: los avisos de SmartScreen y de
  Gatekeeper siguen como hoy.
- Los paquetes de Linux.
- Cualquier cambio en el actualizador o en `release.yml`.

## Versión y otros

- 0.7.0 → 0.8.0 en `package.json` y `src-tauri/Cargo.toml`.
- `.superpowers/` entra en `.gitignore` y `.prettierignore`.
