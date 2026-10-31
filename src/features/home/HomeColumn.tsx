import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Tilt } from "@/components/motion/Tilt";
import { Orb } from "@/components/ui/Orb";
import type { Entry, Place } from "@/app/places";
import type { Section } from "@/app/routes";
import { cn } from "@/lib/cn";

const ICON = {
  conversation: "bg-you-soft text-you",
  book: "bg-book-soft text-book",
};
const TITLE = { conversation: "text-ink-soft", book: "text-book" };
/** Under the `nav` width, Book's six keep to the three rows of the other side. */
const PLACES = { conversation: "grid-cols-1", book: "grid-cols-2" };

export type EntryData = Partial<Record<Entry, string | null>>;

interface EntryCardProps {
  place: Place;
  section: Section;
  datum: string | null;
  onOpen: (entry: Entry) => void;
}

function EntryCard({
  place: { entry, icon: Icon },
  section,
  datum,
  onOpen,
}: EntryCardProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Tilt>
      <button
        type="button"
        onClick={() => {
          onOpen(entry);
        }}
        className="flex min-h-11 w-full items-center gap-2 rounded-md bg-surface px-2 py-1 text-left text-ink shadow-card transition-control nav:min-h-14 nav:gap-3 nav:px-3 nav:py-2"
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full nav:size-9",
            ICON[section],
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 nav:flex-col nav:justify-center nav:gap-0">
          <span className="shrink-0 text-sm font-semibold">
            {t(`nav.entries.${entry}`)}
          </span>
          <Presence>
            {datum !== null && (
              <Reveal
                key="datum"
                as="span"
                kind="fade"
                index={0}
                className="min-w-0 truncate text-xs text-ink-soft nav:max-w-full"
              >
                {datum}
              </Reveal>
            )}
          </Presence>
        </span>
      </button>
    </Tilt>
  );
}

interface HomeColumnProps {
  section: Section;
  places: readonly Place[];
  /** What is known of each place; most have nothing to say. */
  data: EntryData;
  onOpen: (entry: Entry) => void;
  className?: string;
}

/** One section's places, each as a card that leads there. */
export function HomeColumn({
  section,
  places,
  data,
  onOpen,
  className,
}: HomeColumnProps): ReactNode {
  const { t } = useTranslation();
  const titleId = `home-${section}`;
  return (
    <Reveal
      as="section"
      aria-labelledby={titleId}
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      <div className="flex min-h-8 items-center gap-2 pl-1">
        {section === "book" && <Orb size="xs" section="book" />}
        <h2
          id={titleId}
          className={cn("text-sm font-semibold", TITLE[section])}
        >
          {t(`nav.groups.${section}`)}
        </h2>
      </div>
      <div className={cn("grid gap-2 nav:grid-cols-1", PLACES[section])}>
        {places.map((place) => (
          <EntryCard
            key={place.entry}
            place={place}
            section={section}
            datum={data[place.entry] ?? null}
            onOpen={onOpen}
          />
        ))}
      </div>
    </Reveal>
  );
}
