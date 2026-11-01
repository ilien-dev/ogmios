import type { ReactNode } from "react";
import { Reveal } from "@/components/motion/Reveal";
import { Presence } from "@/components/motion/Presence";
import { useEffect, useState } from "react";
import type { Book } from "@shared/domain";
import { coverUrl } from "./covers";

interface BookCoverProps {
  book: Book;
  /** Its width; the height follows, and so does everything in it. */
  className?: string;
}

/**
 * A book's cover, or the page it opens with when it has none, so every book
 * has one. A picture, not content: the title always stands beside it.
 */
export function BookCover({ book, className = "" }: BookCoverProps): ReactNode {
  // Undefined while looking, so a cover never flashes the page it replaces.
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void coverUrl(book.id).then((found) => {
      if (live) {
        setUrl(found);
      }
    });
    return () => {
      live = false;
    };
  }, [book.id]);

  return (
    <span
      aria-hidden
      className={`@container block aspect-2/3 shrink-0 overflow-hidden rounded-sm bg-book-soft shadow-cover ${className}`}
    >
      <Presence>
        {url === null && (
          <Reveal
            key="drawn"
            as="span"
            kind="fade"
            className="flex size-full flex-col gap-cover p-cover font-serif text-cover text-book-ink"
          >
            <span className="text-cover-title font-medium">{book.title}</span>
            {book.author !== null && <span>{book.author}</span>}
            <span className="mt-cover line-clamp-12">{book.opening}</span>
          </Reveal>
        )}
        {typeof url === "string" && (
          <Reveal key="scan" as="span" kind="fade" className="block size-full">
            <img
              src={url}
              alt=""
              className="size-full object-cover object-top"
            />
          </Reveal>
        )}
      </Presence>
    </span>
  );
}
