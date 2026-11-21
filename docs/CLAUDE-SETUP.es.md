# Conectar Ogmios con Claude

**English:** [CLAUDE-SETUP.md](CLAUDE-SETUP.md)

Ogmios es gratis, pero las conversaciones las lleva Claude, la IA de
Anthropic, y Ogmios no la incluye. La primera vez que abres Ogmios te pide
conectar Claude de una de dos formas. Esta página explica las dos.

## Opción 1: una API key de Anthropic (recomendada)

Una API key es una contraseña larga que permite a Ogmios usar Claude en tu
nombre. Solo pagas a Anthropic lo que usas: una conversación de 20 minutos
cuesta unos 0,20 USD con Sonnet 5. Es una estimación, no una medición.

1. Entra en [platform.claude.com](https://platform.claude.com) y crea una
   cuenta, o inicia sesión.
2. Añade saldo en **Billing**. Con unos pocos dólares basta para empezar.
3. Abre **API keys** y elige **Create key**. Ponle un nombre que reconozcas,
   como `Ogmios`.
4. Copia la key. Empieza por `sk-ant-` y Anthropic solo la muestra una vez.
5. En Ogmios, en la pantalla **Conecta con Claude** (o después en
   **Ajustes**), pégala en **API key de Anthropic** y elige **Guardar key**.
6. Elige **Probar conexión**. Cuando responda, elige el modelo que quieras.

La key se guarda en el llavero del sistema (Llavero en macOS, Administrador de
credenciales en Windows) y solo se envía a Anthropic. **Quitar key** la borra.

Si pierdes la key o crees que otra persona la tiene, bórrala en la página de
Anthropic y crea una nueva.

## Opción 2: Claude Code en este ordenador

Si ya usas Claude Code y tienes la sesión iniciada, Ogmios puede ejecutarlo por
ti:

1. Instala [Claude Code](https://claude.com/claude-code) e inicia sesión una
   vez en una terminal escribiendo `claude`.
2. En Ogmios, elige **Claude Code en este ordenador** y después
   **Buscar claude**.

Ogmios ejecuta el `claude` que instalaste, tal cual, y nunca ve tus
credenciales. Anthropic puede limitar el uso de suscripciones en apps de
terceros, así que esta vía puede dejar de funcionar en cualquier momento. Si
pasa, cambia a una API key.

## Coste y límites

- En la consola de Anthropic puedes poner un límite de gasto mensual, para que
  ningún mes cueste más de lo que decidas.
- **Esfuerzo de razonamiento**, en Ajustes, cambia velocidad y coste por
  respuestas más cuidadas. **Automático** mantiene la conversación rápida y la
  corrección cuidada.

Ogmios es un proyecto independiente. No está afiliado a Anthropic ni cuenta con
su respaldo.
