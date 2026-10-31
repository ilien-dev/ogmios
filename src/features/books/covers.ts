import { bookCover, bookPdf, saveBookCover } from "@/lib/ipc";

/** Where a book's cover can come from. */
export interface CoverSources {
  kept: (id: string) => Promise<ArrayBuffer>;
  pdf: (id: string) => Promise<ArrayBuffer>;
  draw: (file: ArrayBuffer) => Promise<ArrayBuffer>;
  save: (id: string, image: ArrayBuffer) => Promise<void>;
}

/**
 * The book's cover: the one kept for it, or else the first page of its PDF,
 * drawn here and kept for the next time. Null when there is neither, for any
 * reason: a book without a cover shows its opening instead of an error.
 */
export async function findCover(
  id: string,
  sources: CoverSources,
): Promise<ArrayBuffer | null> {
  try {
    const kept = await sources.kept(id);
    if (kept.byteLength > 0) {
      return kept;
    }
    const pdf = await sources.pdf(id);
    if (pdf.byteLength === 0) {
      return null;
    }
    const image = await sources.draw(pdf);
    await sources.save(id, image);
    return image;
  } catch {
    return null;
  }
}

const SOURCES: CoverSources = {
  kept: bookCover,
  pdf: bookPdf,
  draw: async (file) => {
    const { drawFirstPage } = await import("./firstPage");
    return drawFirstPage(file);
  },
  save: saveBookCover,
};

/** Each book is looked for once a session, however many screens show it. */
const urls: Map<string, Promise<string | null>> = new Map();

/** A URL for the book's cover, or null when it has none. */
export function coverUrl(id: string): Promise<string | null> {
  const known = urls.get(id);
  if (known !== undefined) {
    return known;
  }
  const url = findCover(id, SOURCES).then((image) =>
    image === null ? null : URL.createObjectURL(new Blob([image])),
  );
  urls.set(id, url);
  return url;
}
