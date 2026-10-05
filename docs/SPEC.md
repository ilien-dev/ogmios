# Ogmios — Especificación del MVP

> Aplicación de escritorio open source para mejorar el inglés conversando con Claude.
> El usuario habla (voz o texto) sin interrupciones; al final recibe poco feedback, bien elegido,
> y una memoria de errores guía las siguientes conversaciones.

Estado: borrador v1 · Fecha: 2026-09-24 · Licencia: AGPL-3.0

---

## 0. Resumen en una página

| Decisión   | Valor                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| Usuario    | Adulto de cualquier idioma nativo que quiere hablar inglés con más soltura              |
| Plataforma | Escritorio: Linux, macOS, Windows (desarrollo y pruebas en Linux)                       |
| Stack      | Tauri 2 + React + TypeScript + Tailwind CSS; sidecar Node/Bun para Claude; SQLite local |
| Modelo     | Claude (un solo modelo elegido por el usuario para todo; recomendado Sonnet 5)          |
| Conexión   | API key (vía segura) + Claude Code local (binario del usuario, con aviso de riesgo)     |
| Entrada    | Voz → texto local (editable antes de enviar) o texto escrito                            |
| Salida     | Texto; el inglés en pantalla se lee con una voz local opcional (§12)                    |
| Datos      | 100 % locales                                                                           |
| Idioma UI  | Inglés y español, con i18n listo para más                                               |
| Feedback   | Al final de la sesión: 1 foco + 2 menores, autocorrección primero                       |
| Objetivo   | Open source, reputación. Todo lo discutido entra al MVP, construido en hitos            |

**Principio rector:** disfrute primero, nunca saturar. Cada pantalla y cada reporte se miden contra
esa regla. Si algo abruma, se colapsa, se acorta o se hace opcional.

---

## 1. Viabilidad

**Veredicto: viable.** El hueco de mercado es real y la técnica existe. Un riesgo serio (política de
Anthropic) está mitigado con la vía de API key.

### 1.1 Mercado

Ningún producto combina las cinco piezas centrales: feedback solo al final, limitado a 1–3 puntos,
memoria de errores entre sesiones, drills de la estructura fallada y "trae tu propio modelo".
Cada pieza existe por separado (ver §2).

### 1.2 Política de Anthropic (riesgo principal)

Verificado en la documentación oficial (2026-09-24):

- Agent SDK: _"Unless previously approved, Anthropic does not allow third party developers to offer
  claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."_
- Legal and compliance: los desarrolladores deben usar API key; no pueden ofrecer login de claude.ai
  ni enrutar peticiones por planes Free/Pro/Max, ni recolectar esas credenciales. **Pero** no impide
  que el usuario inicie sesión en el binario **sin modificar** de Claude Code con su propia cuenta.
- Enero 2026: Anthropic bloqueó clientes OAuth de terceros (OpenCode). Abril 2026: según prensa,
  las suscripciones dejaron de cubrir uso vía arneses de terceros.

Consecuencias para Ogmios:

1. **API key es la vía por defecto** y la recomendada en el onboarding.
2. **Claude Code local** se ofrece como opción: Ogmios ejecuta el `claude` que el usuario ya instaló
   y autenticó. Ogmios nunca ve, guarda ni pide credenciales de claude.ai. Se muestra un aviso claro:
   "Usa tu instalación de Claude Code. Anthropic puede limitar este uso en apps de terceros."
3. Antes de promocionar la vía de suscripción, pedir aprobación escrita a Anthropic.
4. Nunca implementar un flujo OAuth propio contra claude.ai.

Fuentes: https://code.claude.com/docs/en/agent-sdk/overview ·
https://code.claude.com/docs/en/legal-and-compliance · https://www.anthropic.com/legal/consumer-terms

### 1.3 Costo por sesión (estimación, no medido)

Supuestos: sesión de 20 min, ~40 turnos, ~2.000 palabras del usuario, prompt de sistema de 2–3k
tokens, historial reenviado con caché, más un análisis final.

| Modelo    | Precio in/out por MTok | Sesión con caché (estimado) |
| --------- | ---------------------- | --------------------------- |
| Haiku 4.5 | $1 / $5                | ~$0.10                      |
| Sonnet 5  | $2 / $10               | ~$0.20–0.25                 |
| Opus 5.5  | $4 / $20               | ~$0.40                      |
| Fable 5.1 | $10 / $50              | ~$0.85                      |

Se mide de verdad en el Hito 0 con el campo `usage` del resultado. Opus 5.5 no permite apagar el
razonamiento (thinking), lo que añade latencia en la charla: por eso se recomienda Sonnet 5.

---

## 2. Competencia

| Producto              | Precio     | Feedback                     | Memoria de errores                 | Trae tu modelo   |
| --------------------- | ---------- | ---------------------------- | ---------------------------------- | ---------------- |
| Speak Premium Plus    | $40/mes    | En vivo + breve al final     | Sí, con drills de frases similares | No               |
| Langua                | ~$200/año  | En vivo + reporte final      | Parcial                            | No               |
| Praktika              | $10/mes    | En vivo, sin resumen         | No                                 | No               |
| Univerbal             | ?          | En vivo, "mejor versión"     | Lista plana de errores             | No               |
| Pingo AI              | $15–18/mes | Al final, nota inflada       | No                                 | No               |
| Loora                 | ?          | En vivo + resumen            | Débil                              | No               |
| Duolingo Max          | ~$30/mes   | Al final (Roleplay)          | Solo repaso Duolingo               | No               |
| polyglot (OSS, 2.6k★) | Gratis     | En vivo                      | No                                 | API keys         |
| freelingo (OSS)       | Gratis     | Plan CEFR + flashcards       | Sí                                 | Anthropic/Ollama |
| EchoWise (OSS, Tauri) | Gratis     | Nunca interrumpe, nota 1–100 | No                                 | OpenAI           |

**Huecos que Ogmios llena:**

1. Feedback diferido de verdad, sin notas infladas.
2. Priorización explícita: pocos errores, los que importan, el resto guardado.
3. Estados por error (detectado → foco → mejorando → dominado → recaída), medidos en conversación
   espontánea, no en ejercicios.
4. "Pudiste decir…" sobre lo que el usuario realmente dijo, después de la charla.
5. Escritorio, local, gratis, con la cuenta de Claude del usuario.
6. Buen nivel para avanzados (C1+), donde los competidores quedan cortos.

Competidor a vencer: **Speak Premium Plus** (el único maduro con memoria + drills).
Referencia de calidad conversacional: **Langua**.

---

## 3. Principios de diseño (con base en investigación)

Etiquetas: **[F]** evidencia fuerte · **[M]** mixta · **[I]** inferencia de diseño.

1. **Corregir funciona y dura** [F] (Lyster & Saito 2010; Li 2010). El feedback es el núcleo, no un extra.
2. **Diferir tiene un costo** [M]. Se compensa mostrando la frase exacta del usuario con su contexto.
   Durante la charla, Claude sí pide aclaración cuando de verdad no entiende ("Sorry, do you mean…?").
   Eso es conversación real, no corrección.
3. **Autocorrección primero en errores de regla** [F] (prompts > recasts, sobre todo en niveles bajos).
   En vocabulario y colocaciones se da la versión correcta directo [M].
4. **Pocos errores a la vez** [M]. 1 foco + 2 menores.
5. **Priorizar:** errores globales (impiden entender) → recurrentes → "listos" (a veces bien, a veces
   mal) → tratables por regla. Ignorar deslices que el usuario ya corrigió y estructuras muy por
   encima de su nivel [I].
6. **Dominar = uso espontáneo** [I]. Los drills ayudan, pero solo la conversación prueba dominio.
7. **Drills mezclados** [M]. Una ronda corta de la misma estructura para calentar, luego mezclada con
   otros errores activos.
8. **Tarea, no interrogatorio** [F]. Claude opina, cuenta anécdotas, crea huecos de información.
   El usuario produce al menos el 60 % de las palabras.
9. **La novedad se agota** [M] (Wu & Yu 2023). Rotar modos y personalidades; progreso visible.
10. **Menos ansiedad, mejor aprendizaje** [F] (r = −.36, Teimouri 2019). Sin corrección en vivo,
    texto como opción suave, racha que no castiga.

---

## 4. Niveles

| Nivel en UI | CEFR  | Turno de Claude          | Meta por turno del usuario (inicial, ajustable) | Prioridad del feedback                        |
| ----------- | ----- | ------------------------ | ----------------------------------------------- | --------------------------------------------- |
| Básico      | A1–A2 | 1–2 frases cortas        | 5–15 palabras                                   | Fluidez y hacerse entender                    |
| Intermedio  | B1–B2 | 2–3 frases (B2: hasta 4) | 20–60 palabras                                  | + precisión en patrones frecuentes            |
| Avanzado    | C1–C2 | hasta 4 frases           | 60–120 palabras                                 | Complejidad, precisión, registro, naturalidad |

El nivel controla:

- **Vocabulario y gramática de Claude.**
- **Largo de respuesta esperada** (pista + medidor, §6.3).
- **Tipo de preguntas:** básico = hechos concretos y opciones; avanzado = hipótesis, debate, matices.
- **Exigencia del feedback:** básico ignora detalles finos; avanzado corrige registro y naturalidad.
- **Andamiaje:** básico muestra palabras clave e inicios de frase ("I think that…"); avanzado, nada.
- **Idioma nativo permitido:** básico puede mezclar palabras de su idioma (Claude da la palabra en
  inglés en su respuesta); avanzado, todo en inglés.
- **Ritmo y modismos de Claude:** básico, frases simples; avanzado, phrasal verbs, idioms, humor.
- **Estructura objetivo:** Claude provoca el uso de los patrones en foco (§8.5).

**Nivel estimado.** El usuario elige nivel por sesión. Tras cada análisis, Ogmios estima el CEFR con
una rúbrica de 5 dimensiones (rango, precisión, fluidez, interacción, coherencia; CEFR Companion
Volume, apéndice 3) más las métricas de §10. Si 3 sesiones seguidas quedan fuera del nivel elegido,
sugiere cambiar. Nunca cambia solo.

---

## 5. Onboarding (primera vez)

Pantallas, una por paso, saltables salvo 1 y 5:

1. **Idioma nativo** (define idioma del feedback y la UI si hay traducción).
2. **Nombre** (opcional).
3. **Para qué quieres inglés:** trabajo · viajes · exámenes · social · otro. Afecta prioridades:
   trabajo sube el peso de registro formal; social, el de naturalidad.
4. **Intereses:** chips + texto libre. Alimenta temas sugeridos.
5. **Conexión a Claude:** API key (recomendado) o Claude Code local (detecta `claude` en PATH, prueba
   con una llamada mínima, muestra el aviso de §1.2). Selector de modelo y de esfuerzo (§13).
6. **Voz:** descarga de uno o varios modelos de voz a texto (muestra tamaño) y elección del que se
   usa, o "solo texto por ahora". Ninguno viene elegido.
7. **Variante de inglés:** americano / británico.
8. **Recordatorio diario:** hora o ninguno.
9. **Nivel inicial:** básico / intermedio / avanzado, con una descripción de una línea de cada uno.

El perfil sigue creciendo: durante el análisis, Claude extrae datos que el usuario mencionó
("trabajo en logística", "tengo un perro") y los guarda en `profile_facts`. El usuario puede verlos y
borrarlos.

---

## 6. Flujo de una sesión

### 6.1 Pantalla de inicio

Un botón grande **"Empezar charla"** con un tema sugerido ya cargado. Debajo, en pequeño:

- Foco actual: "Estás trabajando: present perfect".
- Repaso pendiente si lo hay: "2 min de práctica pendiente" (opcional).
- Racha suave.

Un clic empieza. "Personalizar" abre el setup completo.

### 6.2 Setup de sesión

- **Tema:** prompt corto (máx. 200 caracteres) o chips sugeridos del perfil.
- **Nivel:** básico / intermedio / avanzado.
- **Modo:** charla casual · entrevista de trabajo · debate · contar una historia · roleplay
  (restaurante, aeropuerto, reunión…) · material propio (pegar un artículo o correo).
- **Personalidad de Claude:** amigo curioso · entrevistador exigente · colega de trabajo ·
  alguien que no está de acuerdo contigo.
- **Enfoque:** libre · practicar lo pendiente (Claude guía la charla hacia los patrones en foco).
- **Duración objetivo:** 5 · 10 · 20 min de habla · sin límite.

Se recuerda la última configuración.

### 6.3 Conversación

- Claude abre con **una pregunta inicial que abre pero guía**: concreta, ligada al tema, y cuya forma
  sugiere el largo esperado. Ejemplo intermedio, tema "mi trabajo":
  _"What's one thing you did at work this week that you're proud of? Tell me what happened."_
- Bajo cada pregunta, **pista de largo**: "Try 2–3 sentences".
- **Medidor en vivo:** barra que se llena mientras el usuario habla o escribe, hasta la meta del
  nivel. Sin castigo si no llega.
- **Mensaje animador** fijo y discreto, que rota:
  "Keep going — say it however you can. We'll fix things at the end."
- **Micrófono:** pulsar para hablar (push-to-talk) o alternar. Al soltar, aparece la transcripción
  editable. Enviar con Enter.
- **Botón "¿Cómo digo…?":** el usuario escribe en su idioma y recibe 1–3 opciones en inglés al
  instante. Única excepción a "no corregir en vivo". Se guarda para el reporte (vocabulario).
- **Claude no corrige.** Si el usuario mezcla idiomas en nivel básico, Claude usa la palabra en inglés
  dentro de su respuesta de forma natural. Si no entiende, pide aclaración.
- **Botón "Terminar"** siempre visible.

### 6.4 Meta de duración (por producción, no por reloj)

El tiempo se mide en **minutos de habla**, no en tiempo de pantalla:

- Voz: segundos con voz detectada (VAD, detección de actividad de voz) en los audios del usuario.
- Texto: palabras escritas ÷ 100 palabras/min (constante estimada, ajustable).

Al llegar a la meta: aviso discreto "Llegaste a tu meta. ¿Seguir o ver feedback?". Diez minutos en
silencio no cuentan.

### 6.5 Edición de la transcripción

Se guardan dos textos por turno: `said_text` (lo transcrito) y `sent_text` (lo enviado).
**Solo se evalúa `sent_text`.** Editar antes de enviar nunca cuenta como fallo: el modelo de voz
confunde palabras y estructuras, y el usuario tiene que poder arreglarlas sin castigo. Un patrón bien
usado en el texto enviado es un uso correcto completo, aunque se haya corregido antes de enviar.

El análisis igual clasifica cada cambio (error del modelo de voz o autocorrección del usuario) solo
para el reporte ("Lo notaste tú solo"); no genera eventos ni afecta el estado del patrón.

Automático, sin preguntar al usuario.

---

## 7. Reporte de fin de sesión

Se presenta **por pasos**: una tarjeta a la vez, estilo historias, cada una saltable. Duración
objetivo de lectura: ≤ 2 min. Orden:

1. **Logro.** 1–2 cosas concretas que hizo bien, con evidencia ("Usaste bien el past simple 8 veces").
   Incluye **tu mejor frase** de la sesión (va a la colección del perfil).
2. **Foco (1).** El error prioritario:
   - Errores de regla: la frase original marcada → "¿Puedes arreglarla?" → el usuario escribe o dice
     su intento → pista si falla → corrección + explicación de una o dos líneas en su idioma.
   - Errores de vocabulario o colocación: frase original → versión correcta → por qué.
   - Si el patrón es recurrente: "Esto apareció en 4 de tus últimas 6 charlas" o
     "Antes 5 veces, hoy 1".
3. **Menores (2).** Formato corto, mismo flujo.
4. **Pudiste decir…** 2–3 frases correctas pero mejorables, con versión más natural o rica.
5. **Cómo lo diría un nativo.** Otro fragmento de la charla, lado a lado con su reescritura, y
   debajo hasta 3 cambios (qué dijo → qué diría un nativo, y por qué en su idioma), marcados en
   ambos textos.
6. **Vocabulario.** Palabras pedidas con "¿Cómo digo…?" y 2–3 palabras útiles que usó Claude.
7. **Métricas.** Minutos de habla, palabras, errores por 100 palabras, palabras por turno, variedad
   léxica. Siempre como tendencia frente a sesiones anteriores, nunca como nota.
8. **Reto para la próxima.** Una misión: "En tu próxima charla usa 2 veces el present perfect".
   Se valida sola en la siguiente sesión.
9. **Cierre.** "¿Practicar este punto 2 min?" (drill opcional) · "Otra charla" · "Listo".

Cada corrección tiene un botón **"No estoy de acuerdo"**: marca el evento como disputado, no cuenta
para la memoria y queda registrado para mejorar los prompts. Protege la confianza ante falsos
positivos del modelo.

**Sin calificación numérica.** Nivel CEFR estimado solo en el mapa de progreso.

---

## 8. Memoria de errores

### 8.1 Concepto

Un **patrón** es un error recurrente normalizado ("present perfect vs past simple con time
expressions", "falta de artículo antes de sustantivos contables", "make vs do").
Cada aparición o uso correcto en el texto enviado es un **evento** ligado a un turno.

### 8.2 Estados

```
Detectado ──(elegido como foco)──▶ En foco ──(≥40 % correcto)──▶ Mejorando ──(criterio)──▶ Dominado
                                      ▲                                                     │
                                      └──────────────── Recaída ◀──(falla tras dominar)─────┘
```

| Estado    | Criterio                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| Detectado | Apareció al menos una vez; no se ha mostrado como foco                                                                |
| En foco   | Elegido como foco o menor en un reporte                                                                               |
| Mejorando | 40–79 % de usos correctos espontáneos, o correcto solo en drills                                                      |
| Dominado  | ≥80 % correcto en ≥3 conversaciones distintas, ≥5 contextos obligatorios, último uso ≥7 días después del último drill |
| Recaída   | Falla en conversación estando Dominado; vuelve a En foco con prioridad alta                                           |

"Contexto obligatorio" = un punto donde la estructura era necesaria (p. ej., hablar de experiencias
de vida sin fecha pide present perfect).

Todos los umbrales son constantes configurables en código.

### 8.3 Límites

- Máximo **1 foco activo** hasta que pase a Mejorando; máximo **3 patrones activos** (En foco o
  Mejorando) a la vez. El resto espera en Detectado.
- El foco no cambia en cada sesión: se mantiene hasta que avance, para no dispersar.

### 8.4 Priorización (código determinista, no el modelo)

El modelo etiqueta; el código decide. Puntaje por patrón candidato:

```
score = 3·global            // impide entender
      + 2·min(sesiones_con_error, 4)/4
      + 2·listo             // 20–79 % correcto: a veces bien, a veces mal
      + 1·por_regla         // tratable con una regla
      + 1·peso_meta         // p. ej. registro si la meta es trabajo
      + 3·recaida
      − 3·sobre_nivel       // estructura muy por encima del nivel
```

Ignorar: deslices autocorregidos en el mismo turno, errores con baja confianza, eventos con sospecha
de error de transcripción.

### 8.5 Cómo la memoria guía las charlas

Al iniciar sesión, el prompt de Claude recibe los patrones activos y sus contextos obligatorios.
Con enfoque "practicar lo pendiente" o si hay reto activo, Claude diseña la charla para que la
estructura sea **esencial a la tarea** (pasado → pedir una historia; condicional → dilema
hipotético), sin mencionarlo ni corregir.

---

## 9. Drills y repaso espaciado

### 9.1 Formatos

1. **5 frases** con la estructura: 5 situaciones distintas, el usuario produce la frase.
2. **Transformación:** "Convierte esta frase a present perfect".
3. **Mini-charla dirigida:** 2 min de conversación diseñada para forzar la estructura.
4. **Detecta el error:** frases con y sin el error; el usuario elige cuál está mal y la arregla.

### 9.2 Estructura de una sesión de práctica (~2 min)

- 3 ítems de la misma estructura (calentamiento).
- 2 ítems mezclados con otros patrones activos (interleaving).
- Corrección una por una. Si falla: explicación breve y un ítem nuevo equivalente (máx. 1 reintento).

Los drills registran eventos `drill_ok` / `drill_fail`. **No** bastan para Dominado.

### 9.3 Calendario

Repaso de cada patrón activo a los 1 → 3 → 7 → 21 días. Un patrón vencido:

- aparece como "2 min de práctica pendiente" en inicio (opcional), y
- se inyecta como estructura objetivo en la siguiente charla.

### 9.4 Repaso de palabras

Las palabras aprendidas vuelven con los días en una sección propia, **Repaso**. Entran las
terminadas en un capítulo de un libro y las pedidas con "¿Cómo digo…?"; nunca las marcadas como
"ya la sé". Las que usó el compañero no entran: no tienen traducción con la que preguntarlas.

- **Calendario (código, sin modelo):** cada palabra está en un escalón. Vuelve a los
  1 → 3 → 7 → 21 → 60 días del último repaso. Un acierto la sube un escalón, un fallo la baja uno.
- **Una ronda:** hasta 10 palabras vencidas, las más atrasadas, cada una una vez y en orden
  aleatorio. Se elige inglés → idioma nativo, al revés, o ambos (alterna según el escalón). Las
  pedidas en una charla solo se preguntan hacia el inglés. Inicio muestra "hoy te tocan N".
- **Un fallo no reabre el capítulo.** Las respuestas del repaso se guardan aparte de las de la
  práctica: el capítulo sigue listo para leer.
- **Uso en conversación:** el compañero recibe hasta 5 palabras aprendidas, las más cercanas a
  olvidarse, para usarlas donde encajen, sin señalarlas. Al terminar la charla, el código marca
  como usada cada palabra aprendida que el usuario dijo sin que el compañero la acabara de decir.
  Un uso vale dos escalones: ningún ejercicio lo sustituye.
- **Fuerza:** nueva (escalón 0), asentándose (1–3), firme (4 o más: aguantó tres semanas). Se ve
  en la lista del capítulo, en el vocabulario del progreso y en Repaso.
- **Palabras que se resisten:** con 3 fallos entre práctica y repaso, la palabra vuelve antes
  (1 → 2 → 4 → 10 → 30 días) y, al fallarla, el usuario puede escribir su propio truco para
  recordarla; se le muestra la próxima vez que falle.
- **Encuentros al traducir:** en el texto en inglés de un capítulo, las palabras aprendidas van
  subrayadas con un color propio. No al traducir hacia el inglés, donde serían la respuesta.

### 9.5 Frases de cada palabra

En la práctica del capítulo y en Repaso cada palabra se pregunta con una frase del libro; el
repaso rápido antes de leer no cambia.

- **La frase no se ve de entrada:** se muestra solo la palabra y la etiqueta del tipo de palabra;
  eso basta para saber qué traducción se pide. La frase es la primera pista (ver «Pista a
  petición») y sale completa tras responder. Solo las palabras marcadas como ambiguas, que
  necesitan su frase para distinguir el sentido, la muestran desde el principio.

- **Banco por palabra:** solo frases reales del libro que tienen la palabra una sola vez (las
  busca el código). Claude no escribe frases nuevas: tardaba minutos por capítulo y aportaba
  poco. Las palabras pedidas en charlas no tienen libro y se preguntan sin frase.
- **Una frase, una sola vez:** cada palabra recibe 1 frase, la de su capítulo o, si esa no sirve,
  otra del libro. No se repone nunca, para no gastar tokens: una palabra que ya recibió frase no
  se vuelve a pedir, aunque la frase se rechazara o se marcara como mala. Se prepara en segundo
  plano al abrir el capítulo y al entrar en Repaso, unas 10 palabras por petición, y cada
  respuesta se guarda al llegar. Una palabra sin frase se pregunta como antes. Los bancos de
  varias frases guardados antes de este cambio se conservan.
- **El modelo etiqueta, el código decide:** Claude solo dice qué es la palabra en la forma que
  tiene en cada frase y traduce la frase. Se guarda si la pista no contiene la palabra en inglés.
  Después una segunda petición la revisa; solo se usa si la da por buena. Lo rechazado se recuerda
  para no volver a pedirlo. La pista tiene que significar la palabra por sí sola: «llama» para
  «wisp» en «a wisp of fire» nombra la frase, no la palabra, y se rechaza. Las frases ya dadas por
  buenas cuya pista no se parece a ninguna traducción de su palabra pasan otra vez por esa revisión. Las frases que Claude escribió antes de este cambio se conservan.
- **Gasto:** con una sola frase, la palabra se pregunta siempre con ella. En un banco anterior de
  varias, cada frase se gasta a las 2 respuestas, acierte o falle: la primera vez sale la del
  propio capítulo; después, al azar entre las no gastadas; gastadas todas, vuelve la menos vista.
- **Una forma que niega no es una forma:** «was not fond of» no es una forma de «be fond of»: sus
  traducciones dirían lo contrario. Vale cuando la palabra ya niega («couldn't help but» para
  «can't help but»). No se guarda al preparar un capítulo, y las guardadas antes se retiraron con
  sus frases.
- **Inglés → nativo:** la palabra en la forma que tiene en la frase; al mostrarse la frase, la
  palabra va resaltada. Vale la traducción base o la de esa forma; si se escribe la base y la
  frase la tiene en otra forma, cuenta como acierto y se señala cuál era. «Estaba bien» se juzga
  sobre esa forma, no sobre la base.
- **Nativo → inglés:** se pregunta por la traducción ya en la forma de la frase («removió»); al
  mostrarse la frase, lleva un hueco. Solo vale la forma exacta. La palabra en otra forma conocida (del libro o
  del banco) no se guarda: aviso ámbar y un segundo intento, que cuenta como acierto con ayuda o
  como fallo. Una forma que ni el libro ni el banco tienen es un fallo directo.
- **Otra palabra para lo mismo:** un fallo solo cuenta si lo mostrado decía qué palabra se pedía.
  Nativo → inglés, otra palabra inglesa que también traduce lo mostrado («ideas» cuando se busca
  «notions») no se guarda: aviso ámbar «es correcto, pero busco otra palabra», la frase con hueco
  y la primera letra de la palabra, y un segundo intento como el de la otra forma. Cuáles lo son
  lo lista la segunda mirada de cada frase, y lo dicen las demás palabras del aprendiz que
  comparten traducción; vale con frase o sin ella, en la práctica y en el repaso diario. Las
  frases guardadas antes se etiquetan una vez, en la siguiente pasada que da frases. La lista es
  de palabras inglesas: las frases cuya lista traía palabras del idioma del aprendiz («hebra»,
  «jirón» para la pista de «wisp») se etiquetan otra vez.
- **La traducción preferida va primero:** las traducciones de una palabra se muestran con la que el
  aprendiz más escribe al acertar inglés → nativo delante (práctica, repaso antes de leer y repaso
  diario, en cualquier capítulo). Solo se reordenan las que el capítulo trajo al prepararse: una
  respuesta que no es ninguna de ellas (parecida, o aceptada por «estaba bien») no cuenta ni se
  lista. Con artículo, en otro número o en otra forma del verbo cuenta para su traducción. Los
  empates conservan el orden del libro. No se guarda nada: se lee de las respuestas cada vez.
- **Tras responder:** la frase completa con audio, su traducción y si es del libro o un ejemplo.
  «Frase mala» la descarta para siempre y deshace esa respuesta; solo sobre la última respuesta
  de la sesión y no sobre una ya llevada a «Tenía razón».
- «Tenía razón» se juzga sobre la frase que se mostró.
- **Pista a petición:** el botón «Pista» o Alt+H desde el campo. La hace el código, sin pedir
  nada a Claude. La primera muestra la frase: la del banco con la que se pregunta o, si aún no
  tiene, la de su capítulo (con hueco si la respuesta es la palabra). La segunda, cuántas letras
  tiene la respuesta. Cada una siguiente da una letra más, nunca la última. Una palabra que ya
  muestra su frase, o que no tiene ninguna, empieza por la cantidad de letras. Un acierto tras
  cualquier pista, también la de la frase, se marca en ámbar, como acierto con ayuda; cuenta
  igual que un acierto limpio para el avance de la palabra. En práctica y en Repaso; no en el
  repaso rápido antes de leer.
- **Teclas:** Alt+N desde el campo es «No lo sé». Cada botón muestra su tecla (Alt+N, Alt+H).

### 9.6 Repaso extra de un capítulo

Practicar nunca se niega. Una sesión se elige en ambas direcciones, inglés → idioma nativo o al
revés, y las tres se ofrecen siempre.

- **Con algo pendiente** en la dirección elegida, la sesión pregunta las palabras que deben algo
  en ella, como siempre.
- **Sin nada pendiente**, es un repaso extra: entran todas las palabras del capítulo, terminadas
  incluidas, menos las marcadas como "ya la sé". La pantalla lo avisa en una línea al elegirla.
  "Ambas" solo es repaso extra cuando ninguna de las dos direcciones debe nada.
- **Qué cuenta:** dentro del repaso extra cada palabra pide dos aciertos seguidos por dirección,
  contados solo con las respuestas de esa sesión. Las respuestas se guardan como las demás: un
  fallo deja la palabra debiendo esa dirección, y si estaba terminada vuelve a estar abierta.
- Un capítulo listo para leer conserva el botón «Practicar» junto al repaso rápido, y el resumen
  de una sesión ofrece «Continuar» aunque no quede nada abierto.
- **Fallo en el repaso rápido:** la palabra vuelve a la práctica desde cero, debiendo dos aciertos
  seguidos en las dos direcciones: primero inglés → idioma nativo y, terminada esa, al revés.

### 9.7 Estructuras

Una sección propia, **Estructuras**, para escribir frases con una estructura hasta que salga sola
en una conversación. No corrige errores del usuario: practica estructuras de un catálogo fijo.

- **Catálogo (código):** 36 estructuras, 12 por nivel (básico, intermedio, avanzado), en
  `src-tauri/src/structures/`. El menú es una sola pantalla con todas; el filtro de nivel es
  opcional y arranca en «Todas». El nivel del perfil no limita lo que se ve.
- **Sesión:** 10, 20, 40 o 60 frases. Con estructuras elegidas practica esas; sin elegir, todas las
  de la lista. El primer 30 % (mínimo 3) calienta con una sola estructura; el resto recorre todas
  una y otra vez, cada vuelta en otro orden.
- **Consigna (código, sin modelo):** estructura y palabra, o estructura y tema; nunca las tres
  cosas, que juntas no dejan una frase natural que escribir. Con palabra, la frase trata de lo que
  el usuario quiera; sin palabra, de un tema, que sale de los intereses del perfil y de una lista
  fija. La palabra, del vocabulario del capítulo abierto por última vez y del aprendido en los
  libros más cerca de olvidarse, de cualquier categoría (sustantivo, verbo, adjetivo, adverbio,
  expresión); nunca una marcada como "ya la sé" ni una de categoría «otra». Sin palabras vistas, la
  consigna va sin palabra. Las palabras pedidas en charlas no entran: no son de ningún libro. Al
  pasar el cursor, la palabra dice su categoría y sus traducciones, leídas del libro cada vez;
  lleva el color de su categoría.
- **La palabra tiene que caber en la estructura (código):** la pasiva y el causativo se construyen
  sobre un verbo con objeto, así que solo piden verbos y phrasal verbs transitivos; si no hay
  ninguno, van sin palabra y con tema. El resto de estructuras admite cualquier categoría. Que un
  verbo lleva objeto lo etiqueta el modelo al preparar el capítulo; a los guardados antes se les
  pregunta en segundo plano, con las palabras sin categoría, y mientras no se sepa no se piden en
  esas dos estructuras.
- **«No encaja»:** junto a la palabra, un botón la quita de esa frase. La frase pasa a pedirse con
  su tema y sin palabra, y no pierde nada: no cuenta como «falta la palabra».
- **La forma se esconde:** en el calentamiento la fórmula está a la vista, a la derecha; después
  hay que pedirla («Ver la forma», Alt+H). Se escribe siempre a la izquierda.
- **El modelo etiqueta, el código decide:** una petición por frase dice si usa la estructura, si
  está bien formada, si usa la palabra y si hay un desliz fuera de ella, con una explicación corta y
  una frase modelo. El veredicto lo pone el código: rojo sin la estructura bien formada o sin
  respuesta; ámbar si falta la palabra, se miró la forma tras el calentamiento o hay un desliz;
  verde en otro caso.
- **Un fallo vuelve una vez**, al final de la sesión, con otro tema y otra palabra.
- **Pausar y terminar:** bajo la sesión hay siempre dos botones. Una sesión dejada queda en pausa
  en el menú, para continuarla o terminarla; una sin nada escrito no se guarda. El resumen dice
  cómo fue cada estructura, la más floja primero, y ofrece siempre otra sesión.
- **Fuerza y calendario:** se cuentan de las sesiones terminadas. Una estructura con al menos el
  80 % de sus frases sin fallo sube un escalón y vuelve a los 1 → 3 → 7 → 21 días; si no, baja uno.
  Nueva (escalón 0), asentándose (1–2), firme (3 o más). Nunca "dominada": eso solo se gana en
  conversación (§8.2). El análisis de una charla todavía no reconoce estructuras del catálogo, así
  que usarla hablando no sube su fuerza.
- **En las charlas:** con enfoque "practicar lo pendiente", la estructura practicada más vencida va
  al compañero como estructura objetivo, sin nombrarla: una como mucho, y solo si los patrones
  activos dejan sitio (menos de 3 objetivos).
- **Estructuras del capítulo:** la primera vez que se abren, el modelo lee hasta 6 trozos del
  capítulo y etiqueta qué estructuras del catálogo aparecen, con una frase de ejemplo cada una. El
  código cuenta, ordena y guarda; no se vuelve a leer. Un ejemplo solo se muestra si está en el
  texto, letra por letra. La sesión practica las 5 más usadas, con las palabras de ese capítulo. El
  menú muestra las del capítulo abierto por última vez.

### 9.8 Oído

Una sección propia, **Oído**, para entrenar el oído con el libro que se está leyendo. Todo lo
decide el código: no se le pide nada al modelo y no gasta tokens. Necesita la voz descargada (§12);
sin ella, la sección solo ofrece descargarla.

- **Menú:** la velocidad que ya se entiende, una barra por velocidad, el capítulo (el abierto por
  última vez, o el que se elija de cualquier libro) con sus dos caminos, los dictados en pausa y las
  palabras que más se escapan. La pantalla del capítulo no gana botones.
- **Tres velocidades**, cada una un nivel: lenta (0,75), normal (1,0) y rápida (1,25). Son síntesis
  reales del motor, no audio estirado.
- **Escuchar el capítulo:** la voz lo lee frase a frase, con las mismas frases que se traducen. La
  que suena va resaltada; un clic en una frase salta a ella, y hay frase anterior y siguiente. Se
  guarda dónde se iba y se sigue desde ahí; oído hasta el final, vuelve al principio. «Solo oír»
  oculta el texto. Las palabras aprendidas van subrayadas, como al traducir (§9.4).
- **Dictado:** hasta 10 frases del capítulo de 6 a 14 palabras, elegidas por código; primero las
  nunca dictadas. La frase solo se oye: no llega a la pantalla hasta responder. Se escribe a la
  izquierda y se escucha a la derecha.
- **Comparación (código):** palabra por palabra contra la frase del libro. No cuentan mayúsculas ni
  puntuación; una contracción vale por sus palabras («don't» = «do not»), salvo «'s» y «'d», que
  pueden ser dos cosas. Una palabra de más también es un fallo.
- **Veredicto:** verde con la frase entera y hasta dos escuchas; ámbar entera pero con ayuda (más
  de dos escuchas, o bajar la velocidad después de oírla); rojo si falta o sobra una palabra. Tras
  responder se ve la frase con las palabras falladas marcadas y se puede oír otra vez.
- **Cambiar de velocidad:** antes de oír la frase es libre en los dos sentidos. Después, bajar es
  una pista: el acierto sale en ámbar y la frase cuenta para la velocidad más lenta a la que se oyó.
  Sin oírla, cuenta para la velocidad elegida.
- **Un fallo vuelve una vez**, al final del dictado.
- **Pausar y terminar:** bajo el dictado hay siempre dos botones. Uno dejado queda en pausa en el
  menú; uno sin nada respondido no se guarda.
- **Sin puntos.** Lo que dice cómo va el usuario es la **velocidad que ya entiende**: la más rápida
  en la que oyó al menos el 90 % de las palabras en sus últimas 30 frases a esa velocidad (con 10
  frases como mínimo). Cada velocidad tiene su barra y nunca se mezclan; las que ya son del usuario
  llevan una marca.
- **La app propone, el usuario decide:** un dictado con menos del 60 % de las palabras sugiere una
  velocidad más lenta; las últimas 20 frases entendidas a una velocidad sugieren la siguiente. El
  resumen deja elegir la velocidad del próximo. El menú ofrece la velocidad por encima de la que ya
  se entiende.
- **Refuerzo, aparte de Repaso:** una palabra fallada al oído 3 veces entra en refuerzo. Cada
  dictado reserva hasta 3 de sus frases para frases de cualquier capítulo del libro que la
  contienen. Sale al oírla bien 3 veces seguidas; un fallo reinicia la cuenta. Como mucho 5 palabras
  a la vez, las más falladas. Un fallo al oído nunca entra en Repaso ni reabre un capítulo, y el
  dictado no hace «dominada» ninguna palabra (§8.2).

---

## 10. Métricas por sesión

Calculadas en código a partir de los turnos (las de complejidad y errores las aporta el análisis):

| Métrica                                       | Fuente         |
| --------------------------------------------- | -------------- |
| Minutos de habla                              | VAD / palabras |
| Palabras del usuario y % del total            | Turnos         |
| Palabras por turno                            | Turnos         |
| Variedad léxica (MTLD)                        | Código         |
| Errores por 100 palabras (globales y locales) | Análisis       |
| Cláusulas por oración, % subordinadas         | Análisis       |
| Velocidad de habla y pausas                   | Solo voz       |

Voz y texto no se comparan entre sí (la escritura da más precisión, el habla más complejidad):
las tendencias se muestran separadas por modo. Tendencias sobre ≥5 sesiones.

---

## 11. Hábito y progreso

- **Racha suave:** días con al menos 1 sesión; 2 "días libres" por semana que no rompen la racha.
- **Recordatorio diario:** notificación de escritorio a la hora elegida; desactivable.
- **Mapa de progreso:** patrones por estado (dominados vs activos), minutos de habla por semana,
  nivel CEFR estimado en el tiempo, colección de mejores frases, vocabulario aprendido.
- **Eliminar una charla:** desde la lista de charlas, con confirmación. Se van sus turnos, audio,
  feedback, vocabulario y mejor frase; deja de contar en minutos, CEFR, racha y patrones. Un patrón
  visto solo en ella desaparece, un foco que solo ella abrió vuelve a detectado y el resto se
  recalcula como tras un "No estoy de acuerdo".
- **Rotación anti-novedad:** si el usuario repite el mismo modo 4 sesiones, el inicio sugiere otro.

---

## 12. Voz a texto

- **Local por defecto**, en Rust, con parakeet.cpp (MIT) cargado en tiempo de ejecución. Modelos:
  **Parakeet TDT 0.6B v3** (multilingüe, 742 MB, CC-BY-4.0), con pista de idioma `auto` para que
  una palabra en el idioma nativo salga legible, y **Parakeet TDT-CTC 110M** (solo inglés, 143 MB).
- Ningún modelo viene instalado ni elegido: el usuario descarga uno o varios (también en el
  onboarding) y elige cuál usar. Sin modelo elegido, la app es solo texto.
- Descarga única del modelo, con tamaño visible y verificación sha256. Opción de API en la nube
  para equipos lentos (v2).
- **Riesgo:** los modelos de voz tienden a "limpiar" lo dicho. Medido en H0 con voz sintética
  (Piper TTS, no un acento real): "Yesterday I go to the store and buy two apple" salió literal en
  ambos modelos (110M: 71 ms; v3: 948 ms). Mitigación restante: guardar el audio y marcar
  `asrSuspect` en el análisis.
- **Mezcla de idiomas:** resuelta con el modelo v3 multilingüe.
- **Captura de audio en Rust** (crate `cpal`), no en el webview: `getUserMedia` en WebKitGTK (Linux)
  es poco fiable.
- Audio guardado localmente (WAV 16 kHz mono 16 bits), borrable por sesión o en bloque desde ajustes.

### Texto a voz

- **Local, en CPU**, con Kokoro 82M (pesos Apache-2.0, 367 MB) sobre sherpa-onnx (Apache-2.0),
  enlazado en el binario. Una descarga opcional desde ajustes, con tamaño visible y sha256; sin
  ella la app no habla.
- **Solo se lee inglés:** las líneas del compañero en la conversación (nunca las del usuario) y,
  en los libros, la palabra y su frase. Preguntada hacia el inglés, la palabra es la respuesta:
  se lee cuando el veredicto la muestra, no antes.
- **En Oído (§9.8)** lee un capítulo entero, frase a frase, y las frases de un dictado, a tres
  velocidades. Mientras suena una frase se sintetiza la siguiente, para que no haya espera entre
  ellas. Lo ya dicho se recuerda por voz, velocidad y texto.
- Lectura automática al aparecer, con un botón para oírlo otra vez; se puede dejar solo a
  petición. Cuatro voces, americanas y británicas; la primera sigue la variante del perfil.
- Reproducción en Rust (`cpal`), frase a frase según se sintetiza. Empezar a grabar la calla.

---

## 13. Conexión a Claude

Una interfaz `Provider` en el sidecar con dos implementaciones:

| Modo              | Implementación                                                                                      | Credenciales                              |
| ----------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| API key           | `@anthropic-ai/sdk` (Messages API) directo                                                          | Key en el llavero del sistema (keyring)   |
| Claude Code local | `@anthropic-ai/claude-agent-sdk` con `pathToClaudeCodeExecutable` apuntando al `claude` del usuario | Las de su instalación; Ogmios no las toca |

Por qué dos caminos: en modo API no hace falta empaquetar el binario de Claude Code (mantiene la app
ligera, que es la razón de usar Tauri) y la Messages API da control directo de caché y salida
estructurada. La interfaz deja la puerta abierta a Ollama en el futuro.

Configuración del modo Claude Code (verificar en Hito 0):

- `systemPrompt`: string propio (reemplaza el de Claude Code).
- `settingSources: []`: no carga CLAUDE.md ni ajustes del usuario.
- `tools: []`: sin herramientas de archivos ni shell. **No verificado** que quite todas.
- `includePartialMessages: true` para streaming.
- Sesión: guardar `session_id` y reanudar con `resume`.

**Un solo modelo** para charla, análisis y drills, elegido por el usuario. La lista no está fija en
la app: se pide al proveedor (`supportedModels()` de Claude Code, con nombre y descripción; o
`/v1/models` con la API key, solo nombre y sin los que no admiten salida estructurada). Default:
la familia Sonnet. Si el modelo guardado ya no está en la lista, pasa al más nuevo de su familia.

**Esfuerzo de razonamiento** opcional, entre los niveles que el modelo admite, para todas las
llamadas. Sin elegir (automático): charla con esfuerzo bajo, análisis y drills con esfuerzo
medio. Sonnet 5.5, Opus 5.5 y Fable no permiten apagar el razonamiento; Haiku no admite esfuerzo
y va sin razonamiento. Con la API key no se envía un esfuerzo que el modelo no admite.

---

## 14. Arquitectura

```
┌────────────────────────── Tauri app ──────────────────────────┐
│  Webview: React + TypeScript + Tailwind CSS + i18next         │
│     │ invoke / events                                         │
│  Rust core                                                    │
│   ├─ db: SQLite (rusqlite), migraciones                       │
│   ├─ audio: cpal → VAD → STT (sherpa-onnx)                    │
│   ├─ memory: estados, priorización, calendario (determinista) │
│   ├─ metrics: palabras, MTLD, minutos de habla                │
│   ├─ notifications, keyring, descarga de modelos              │
│   └─ sidecar manager ──stdio JSON-lines──┐                    │
│                                          ▼                    │
│  Sidecar "ogmios-agent" (TS compilado con bun --compile)      │
│   └─ Provider: Messages API | Agent SDK (claude del usuario)  │
└───────────────────────────────────────────────────────────────┘
```

Reglas:

- **Rust es el dueño de los datos.** El sidecar no toca SQLite: recibe el contexto en cada llamada y
  devuelve texto o JSON.
- **El modelo etiqueta, el código decide.** Estados, prioridades y calendario son código probado.
- Sidecar declarado con `externalBin` de Tauri, un binario por plataforma.

### 14.1 Protocolo sidecar (JSON-lines por stdio)

| Método            | Entrada                                                           | Salida                                 |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------- |
| `chat.start`      | perfil, setup, patrones activos, reto                             | `session_ref`, primer mensaje (stream) |
| `chat.turn`       | `session_ref`, texto del usuario                                  | deltas de texto (stream)               |
| `help.translate`  | texto en L1, contexto                                             | 1–3 opciones en inglés                 |
| `analyze`         | transcript completo (said/sent), patrones existentes, nivel, meta | JSON `Analysis`                        |
| `report.compose`  | patrones elegidos por Rust, análisis                              | JSON de tarjetas en idioma nativo      |
| `drill.generate`  | patrones, formato                                                 | ítems                                  |
| `drill.grade`     | ítem, respuesta                                                   | correcto/incorrecto + explicación      |
| `provider.check`  | modo, modelo                                                      | ok / error legible                     |
| `structureGrade`  | estructura, palabra pedida y su categoría, frase del usuario      | etiquetas + explicación + frase modelo |
| `structureDetect` | catálogo, un trozo de capítulo                                    | estructuras halladas, con un ejemplo   |

### 14.2 JSON `Analysis` (resumen)

```ts
type Analysis = {
  errors: {
    turn_id: string;
    original: string; // fragmento exacto
    corrected: string;
    kind:
      | "grammar_rule"
      | "lexical"
      | "collocation"
      | "word_order"
      | "register"
      | "pronoun"
      | "other";
    global: boolean; // impide entender
    pattern: { existing_id?: string; new_key?: string; description: string };
    confidence: number; // 0–1; < 0.6 se descarta
    asr_suspect: boolean; // posible error de transcripción
  }[];
  correct_uses: { turn_id: string; pattern_id: string }[]; // contextos obligatorios bien usados
  missed_contexts: { turn_id: string; pattern_id: string }[];
  edits: {
    turn_id: string;
    type: "asr_fix" | "self_correction";
    pattern_hint?: string;
  }[];
  could_have_said: {
    turn_id: string;
    original: string;
    better: string;
    why: string;
  }[];
  native_rewrite: {
    original: string;
    rewrite: string;
    notes: { from: string; to: string; why: string }[]; // el reporte muestra 3 como máximo
  };
  strengths: { text: string; evidence_turn_ids: string[] }[];
  best_sentence_turn_id: string;
  complexity: { clauses_per_unit: number; subordination_ratio: number };
  cefr_rubric: {
    range: string;
    accuracy: string;
    fluency: string;
    interaction: string;
    coherence: string;
  };
  profile_facts: string[];
  challenge_check?: { achieved: boolean; evidence_turn_ids: string[] };
};
```

El modelo recibe la lista de patrones existentes y debe reusar `existing_id` antes de crear uno
nuevo (evita duplicados).

---

## 15. Modelo de datos (SQLite)

```
profile(id, name, native_lang, ui_lang, goal, variant, reminder_time, model, provider_mode, created_at)
profile_facts(id, text, source_session_id, created_at, deleted)
interests(id, label)

sessions(id, started_at, ended_at, topic, level, mode, personality, focus_mode, target_minutes,
         speech_minutes, user_words, claude_words, estimated_cefr, report_json)
turns(id, session_id, idx, role, said_text, sent_text, audio_path, speech_seconds, words, created_at)

patterns(id, key, description_l1, kind, rule_based, state, first_seen_session, last_seen_session,
         state_changed_at, next_review_at, review_step, priority_cache)
pattern_events(id, pattern_id, session_id, turn_id,
               kind /* error|correct_use|missed_context|self_corrected (histórico, sin peso)|drill_ok|drill_fail */,
               disputed, created_at)

drills(id, pattern_ids, format, items_json, results_json, created_at)
vocab(id, l1_text, en_options, chosen, session_id, created_at)
best_sentences(id, session_id, turn_id, text)
challenges(id, session_id_created, pattern_id, text, target_count, achieved_session_id)
streak_days(date, sessions, freeze_used)
settings(key, value)

structure_sittings(id, size, chapter_id, started_at, finished_at)
structure_items(sitting_id, idx, structure, topic, verb, verb_source, warm, retry_of,
                answer, peeked, verdict, explanation, better, answered_at)
chapter_structures(chapter_id, structure, count, example)
chapter_structure_scans(chapter_id, scanned_at)
book_chapters(…, opened_at)

listening_places(chapter_id, sentence, updated_at)
dictation_sittings(id, chapter_id, pace, started_at, finished_at)
dictation_items(sitting_id, idx, sentence, reinforces, retry_of, listens, first_pace, pace,
                answer, verdict, right, total, answered_at)
dictation_words(sitting_id, idx, at, word, heard)
```

---

## 16. Prompt de conversación (reglas clave)

El prompt de sistema se arma por sesión con: nivel, modo, personalidad, variante, perfil, patrones
activos, reto. Reglas fijas:

- Eres un compañero de conversación, no un profesor. **Nunca corrijas** ni comentes errores.
- Largo de turno según tabla §4. Una pregunta por turno, como máximo.
- Comparte opiniones y anécdotas breves; reacciona a lo que dijo el usuario (backchannel:
  "Oh really?", "That sounds stressful").
- Plantea tareas con hueco de información (planear algo juntos, resolver un desacuerdo), no
  cuestionarios.
- Haz que las estructuras objetivo sean necesarias para la tarea, sin nombrarlas.
- El usuario debe producir ≥60 % de las palabras: si tus turnos crecen, acórtalos.
- Si no entiendes, pide aclaración natural.
- Si el usuario usa su idioma (nivel básico), responde en inglés incluyendo la palabra en inglés.
- El texto del usuario puede venir de reconocimiento de voz: no reacciones a errores obvios de
  transcripción.
- Al abrir: una pregunta concreta que guíe el tema y sugiera el largo esperado.

**Inglés real.** Todo prompt que escribe inglés que el usuario puede copiar (conversación, "¿cómo
digo…?", análisis y ejercicios) lleva la misma regla (`REAL_ENGLISH_RULE`): decir lo que la gente dice
en esa situación, no lo que enseña un libro, y, cuando no pueda saberse si una forma se usa, elegir la
más llana y común y no inventar modismos. Sus ejemplos están medidos en transcripciones de habla real
(The People's Speech e ICSI Meeting Corpus, CC BY 4.0). Ningún código comprueba todavía una frase
contra uso real: la regla es el mejor esfuerzo del modelo, no una validación.

**Frases de reuniones reales.** Con objetivo "trabajo", variante americana y nivel intermedio o
avanzado, Rust entrega al compañero 8 frases por sesión (`src-tauri/src/phrases/`), las mismas en cada
turno y otras en la sesión siguiente, para que las use donde encajen sin señalarlas. Cada una la
dijeron al menos 8 hablantes nativos en 12 o más reuniones del ICSI Meeting Corpus y aparece al menos
una vez por millón de palabras en The People's Speech. Los demás objetivos, el británico y el nivel
básico no reciben frases: no hay grabaciones abiertas que las respalden.

---

## 17. Interfaz

- **Tailwind CSS** para todo el diseño; tokens de color, espaciado y tipografía definidos en el tema
  de Tailwind (tema claro y oscuro).
- Referencia visual: la sobriedad de pen.dev (fondo oscuro, tarjetas, caja de chat inferior).
- Accesibilidad: todo usable con teclado (atajo global para el micrófono), contraste AA,
  lectores de pantalla en el reporte.
- i18next con `en` y `es` desde el día uno; ningún texto de UI fijo en componentes.

---

## 18. Hitos

Todo lo anterior es el MVP. Se construye en este orden; cada hito termina usable y verificado.

**H0 — Spike técnico (validar riesgos).** Hecho cuando:

- Tauri abre, lanza el sidecar y recibe un "pong".
- Modo Claude Code: conversación con `claude` del usuario, `tools: []`, streaming. Confirmado que no
  hay herramientas disponibles.
- Modo API key: misma conversación vía Messages API.
- Captura de micrófono en Rust + Parakeet transcribe una frase en Linux. Medida la latencia.
- Probado: frase con palabra en español en medio; frase con error gramatical (¿lo "arregla" el STT?).
- Medidos tokens y costo reales de una charla de 10 min.

**H1 — Conversación.** Onboarding mínimo (idioma, conexión, voz), setup (tema, nivel, modo),
charla con voz/texto, transcripción editable, medidor, pista de largo, "¿Cómo digo…?", minutos de
habla, meta, terminar. Todo persistido.

**H2 — Análisis, reporte y memoria.** `analyze`, patrones y eventos, estados, priorización,
reporte por pasos completo (§7), "No estoy de acuerdo", métricas.

**H3 — Drills y repaso.** 4 formatos, estructura 3+2, calendario, práctica pendiente en inicio,
inyección de patrones vencidos en la charla.

**H4 — Personalización.** Onboarding completo, perfil que aprende, temas sugeridos, personalidad,
enfoque, material propio, variante, nivel estimado y sugerencia de cambio, reto, mejor frase,
reescritura nativa.

**H5 — Hábito y publicación.** Racha, recordatorio, mapa de progreso, rotación de modos, i18n
completo, empaquetado para Linux/macOS/Windows en CI, README, capturas, licencia AGPL-3.0.

---

## 19. Riesgos

| Riesgo                                  | Impacto                 | Mitigación                                                        |
| --------------------------------------- | ----------------------- | ----------------------------------------------------------------- |
| Anthropic bloquea la vía de suscripción | Alto para ese modo      | API key como default; pedir aprobación; nunca OAuth propio        |
| Falsos positivos en errores             | Pérdida de confianza    | Umbral de confianza, "No estoy de acuerdo", código decide estados |
| STT oculta o inventa errores            | Feedback erróneo        | Modelo con menos sesgo, audio guardado, marca `asr_suspect`       |
| Latencia en la charla                   | Se siente lento         | Streaming, Sonnet 5 por defecto, caché de prompt                  |
| Tauri + sidecar + Rust para una persona | Lentitud de desarrollo  | H0 valida todo antes de construir; protocolo pequeño              |
| Alcance grande para un MVP              | Meses sin feedback real | Hitos usables; usar la app uno mismo desde H2                     |
| Efecto novedad                          | Abandono                | Rotación de modos, progreso visible, sesiones cortas              |

---

## 20. Preguntas abiertas

1. ~~¿Modelo de voz multilingüe?~~ Resuelto: Parakeet v3 multilingüe, a elección del usuario.
2. ¿Constante de 100 palabras/min para texto? (ajustar con datos propios)
3. ¿Umbrales de Dominado (80 %, 3 sesiones, 5 contextos, 7 días)? (ajustar tras uso real)
4. ¿Pedir aprobación a Anthropic antes o después de publicar? Recomendado: antes de promocionar el
   modo suscripción.

---

## 21. Fuentes principales

- Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview
- Legal y cumplimiento: https://code.claude.com/docs/en/legal-and-compliance
- Precios: https://platform.claude.com/docs/en/about-claude/pricing
- Tauri sidecar: https://v2.tauri.app/develop/sidecar/
- Parakeet: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3 · parakeet.cpp: https://github.com/mudler/parakeet.cpp
- Lyster & Saito 2010: http://kazuyasaito.net/SSLA2010.pdf
- Li 2010: https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-9922.2010.00561.x
- Karpicke & Roediger 2008: https://doi.org/10.1126/science.1152408
- Lynch 2007 (reformulación): https://doi.org/10.1093/elt/ccm050
- Interleaving en habla (2020): https://doi.org/10.1177/1362168820913985
- Cepeda et al. 2008 (espaciado): https://doi.org/10.1111/j.1467-9280.2008.02209.x
- CEFR Companion Volume: https://rm.coe.int/common-european-framework-of-reference-for-languages-learning-teaching/16809ea0d4
- Teimouri et al. 2019 (ansiedad): https://doi.org/10.1017/s0272263118000311
- Wu & Yu 2023 (chatbots, novedad): https://doi.org/10.1111/bjet.13334
- Competencia: speak.com · languatalk.com/langua · univerbal.app · github.com/liou666/polyglot ·
  github.com/artcc/freelingo · github.com/hujiulin/EchoWise · github.com/F5ve-leaFCloveR/english-tutor
