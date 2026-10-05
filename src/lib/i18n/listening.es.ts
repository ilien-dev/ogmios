import type { listeningEn } from "./listening.en";

/** The listening section in Spanish. */
export const listeningEs: typeof listeningEn = {
  title: "Oído",
  intro:
    "Entrena el oído con el libro que estás leyendo: escucha un capítulo o escribe las frases que oyes.",
  voice: {
    need: "Oído necesita la voz que lee en alto. Se queda en este ordenador.",
    get: "Descargar la voz ({{size}})",
    getting: "Descargando la voz · {{percent}} %",
  },
  noBook: "Lo que escuchas es tu propia lectura. Añade antes un libro.",
  toBooks: "Ir a Libros",
  pace: {
    label: "Velocidad",
    slow: "Lenta",
    normal: "Normal",
    fast: "Rápida",
  },
  understood: {
    label: "Ya entiendes a velocidad",
    none: "Ninguna todavía",
    noneHint: "Diez frases a una velocidad dicen cómo oyes en ella.",
  },
  standing: {
    title: "Por velocidad",
    bar: "Palabras oídas a velocidad {{pace}}",
    count_one: "{{percent}} % · {{count}} frase",
    count_other: "{{percent}} % · {{count}} frases",
    none: "Sin probar",
    held: "Esta velocidad es tuya",
    note: "Una velocidad es tuya cuando oyes el 90 % de las palabras en tus últimas 30 frases a esa velocidad.",
  },
  chapter: {
    label: "Capítulo",
  },
  dictation: {
    title: "Dictado",
    hint: "Hasta 10 frases del capítulo. Escribe lo que oyes.",
    start: "Empezar",
  },
  listen: {
    title: "Escuchar el capítulo",
    fresh_one: "{{count}} frase",
    fresh_other: "{{count}} frases",
    place: "Vas en la frase {{current}} de {{total}}",
    start: "Escuchar",
    continue: "Seguir",
  },
  paused: {
    title: "En pausa",
    progress: "{{done}} de {{total}} frases",
    continue: "Continuar",
    end: "Terminar",
  },
  missed: {
    title: "Lo que más se te escapa",
    times_one: "{{count}} vez",
    times_other: "{{count}} veces",
  },
  reinforced: {
    title: "En refuerzo",
    hint: "Tus próximos dictados guardan frases para estas palabras, hasta que oigas cada una tres veces seguidas.",
  },
  reading: {
    back: "Oído",
    play: "Reproducir",
    pause: "Pausar",
    previous: "Frase anterior",
    next: "Frase siguiente",
    progress: "Avance del capítulo",
    place: "Frase {{current}} de {{total}}",
    hide: "Solo oír",
    show: "Mostrar el texto",
    hidden: "El texto está oculto. Solo escucha.",
  },
  run: {
    progress: "Avance del dictado",
    count: "{{current}} de {{total}}",
    play: "Escuchar",
    again: "Escuchar otra vez",
    stop: "Parar",
    playKey: "Alt+L",
    listens_one: "{{count}} escucha",
    listens_other: "{{count}} escuchas",
    free: "Dos escuchas son libres. La tercera cuenta como ayuda, igual que bajar la velocidad después de oírla.",
    retry: "Esta la fallaste antes. Aquí está otra vez.",
    field: "Escribe lo que oyes",
    check: "Comprobar",
    unknown: "No lo sé",
    next: "Siguiente",
    last: "Ver cómo fue",
    pause: "Pausar",
    finish: "Terminar",
    said: "Lo que decía",
    verdict: {
      correct: "Entera",
      partial: "Entera, con ayuda",
      wrong: "{{right}} de {{total}} palabras",
    },
    why: {
      slowed:
        "Bajaste la velocidad después de oírla: cuenta para la más lenta.",
      listens: "Hicieron falta más de dos escuchas.",
    },
  },
  summary: {
    title: "Dictado terminado",
    lead: "{{right}} de {{total}} palabras oídas, a velocidad {{pace}}.",
    correct: "enteras",
    partial: "con ayuda",
    wrong: "falladas",
    understood: "Entiendes a velocidad {{pace}}.",
    notYet: "Ninguna velocidad es tuya todavía: sigue.",
    hint: {
      faster:
        "Dos dictados entendidos a esta velocidad. Prueba una más rápida.",
      slower:
        "Este costó. Una velocidad más lenta te ayudará a separar las palabras.",
    },
    next: "Velocidad del siguiente",
    again: "Otro dictado",
  },
};
