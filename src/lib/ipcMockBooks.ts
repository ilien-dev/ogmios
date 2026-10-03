/**
 * The mock's bookshelf, and the file its "native dialog" hands over. The
 * dialog cannot open outside Tauri, so `pick_book_file` answers with a path
 * the tests choose; a file named after a refusal is refused that way.
 */
import type { Book, BookRefusal, Chapter, Depth } from "@shared/domain";

type Outline = Array<[title: string, words: number]>;

/** The chapter of the seeded book that comes already prepared. */
const PREPARED: Record<string, Depth> = { "book-alice-0": "relevant" };

function book(
  id: string,
  heading: [string, string | null],
  outline: Outline,
): Book {
  const [title, author] = heading;
  return {
    id,
    title,
    author,
    chapters: outline.map(([name, words], index): Chapter => ({
      id: `${id}-${index}`,
      index,
      title: name,
      words,
      prepared: PREPARED[`${id}-${index}`] ?? null,
      // Counted from the chapter's words, which a file above this one has.
      readiness: null,
    })),
  };
}

const ALICE = book(
  "book-alice",
  ["Alice's Adventures in Wonderland", "Lewis Carroll"],
  [
    ["I. Down the Rabbit-Hole", 2184],
    ["II. The Pool of Tears", 2098],
    ["III. A Caucus-Race and a Long Tale", 1701],
    ["IV. The Rabbit Sends in a Little Bill", 2614],
    ["V. Advice from a Caterpillar", 2183],
  ],
);

const EMMA = book(
  "book-emma",
  ["Emma", "Jane Austen"],
  [
    ["Volume I, Chapter I", 3217],
    ["Volume I, Chapter II", 1803],
    ["Volume I, Chapter III", 1702],
  ],
);

/** A PDF without bookmarks: sections with no name, called by their number. */
const WONDERLAND = book(
  "book-wonderland",
  ["wonderland", null],
  [
    ["", 3120],
    ["", 3054],
    ["", 2210],
  ],
);

/** The file the dialog returns until a test says otherwise. */
const DEFAULT_PICK = "/home/you/Books/emma.epub";

let books: Book[] = [];
let pick: string | null = DEFAULT_PICK;

try {
  if (new URLSearchParams(globalThis.location.search).get("mock") === "ready") {
    // In the browser the shelf also holds a PDF without bookmarks.
    books = [ALICE, WONDERLAND];
  }
} catch {
  // No location outside a browser: the shelf starts empty.
}

/** An empty shelf, or the one a set-up learner has: one book. */
export function resetMockBooks(seeded: boolean): void {
  books = seeded ? [ALICE] : [];
  pick = DEFAULT_PICK;
}

/** A chapter of any book on the shelf. */
export function findMockChapter(id: string): Chapter | undefined {
  return books
    .flatMap((candidate) => candidate.chapters)
    .find((chapter) => chapter.id === id);
}

/** Records the depth a chapter's words were taken at. */
export function setMockChapterPrepared(id: string, depth: Depth): void {
  books = books.map((candidate) => ({
    ...candidate,
    chapters: candidate.chapters.map((chapter) =>
      chapter.id === id ? { ...chapter, prepared: depth } : chapter,
    ),
  }));
}

/** Every chapter of every book on the shelf. */
export function allMockChapters(): Chapter[] {
  return books.flatMap((candidate) => candidate.chapters);
}

/** Takes every book off the shelf. */
export function clearMockBooks(): void {
  books = [];
}

/**
 * What the file dialog returns next: a path, or null for a cancelled dialog.
 * A file named `drm.epub`, `unreadable.epub` or `scanned.pdf` is refused for
 * that reason; any other `.pdf` is a book without bookmarks.
 */
export function setMockBookPick(path: string | null): void {
  pick = path;
}

function refusalOf(path: string): BookRefusal | null {
  if (path.endsWith("drm.epub")) {
    return "drm";
  }
  if (path.endsWith("scanned.pdf")) {
    return "scanned";
  }
  return path.endsWith("unreadable.epub") ? "unreadable" : null;
}

/** The `invalid` error `import_book` rejects with; its message is the reason. */
class BookRefusedError extends Error {
  readonly kind = "invalid";

  constructor(why: BookRefusal) {
    super(why);
    this.name = "BookRefusedError";
  }
}

/** One named argument of a command, as the caller sent it. */
function text(args: unknown, key: "path" | "id" | "title"): string {
  return String((args as Record<string, unknown>)[key]);
}

type After = <T>(ms: number, value: () => T) => Promise<T>;
/** A chapter as it is sent: with its readiness, counted from its words. */
type Sent = (chapter: Chapter) => Chapter;

export function bookCommands(
  after: After,
  sent: Sent,
): Record<string, (args: unknown) => Promise<unknown>> {
  const sentBook = (shelved: Book): Book => ({
    ...shelved,
    chapters: shelved.chapters.map(sent),
  });
  return {
    pick_book_file: () => after(150, () => pick),
    list_books: () => after(150, () => books.map(sentBook)),
    import_book: (args) =>
      after(900, () => {
        const why = refusalOf(text(args, "path"));
        if (why !== null) {
          throw new BookRefusedError(why);
        }
        const picked = text(args, "path").endsWith(".pdf") ? WONDERLAND : EMMA;
        // The same file again is the book already on the shelf.
        const shelved = books.find((candidate) => candidate.id === picked.id);
        if (shelved === undefined) {
          books = [picked, ...books];
        }
        return sentBook(shelved ?? picked);
      }),
    rename_chapter: (args) =>
      after(200, () => {
        const id = text(args, "id");
        const title = text(args, "title")
          .split(/\s+/u)
          .filter(Boolean)
          .join(" ");
        books = books.map((candidate) => ({
          ...candidate,
          chapters: candidate.chapters.map((chapter) =>
            chapter.id === id ? { ...chapter, title } : chapter,
          ),
        }));
        const renamed = findMockChapter(id);
        return renamed === undefined ? undefined : sent(renamed);
      }),
    delete_book: (args) =>
      after(200, () => {
        const id = text(args, "id");
        books = books.filter((candidate) => candidate.id !== id);
      }),
  };
}
