import { useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextInput } from "@/components/ui/TextInput";
import { errorMessage } from "@/lib/errors";
import { saveWordNote } from "@/lib/ipc";

interface WordNoteProps {
  /** The word's key. */
  wordId: string;
  /** The note the learner wrote for it before. */
  note: string | null;
}

/**
 * Under the verdict on a word that keeps slipping: the learner's own trick
 * to remember it, there to read and to rewrite. Writing it is theirs to do
 * or not: the run goes on either way.
 */
export function WordNote({ wordId, note }: WordNoteProps): ReactNode {
  const { t } = useTranslation();
  const [text, setText] = useState(note ?? "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await saveWordNote(wordId, text);
      setSaved(true);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="mt-8 flex flex-col gap-3 border-t border-line pt-6"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink">{t("recall.note.title")}</p>
        <p className="text-sm text-ink-soft">{t("recall.note.hint")}</p>
      </div>
      <label htmlFor="word-note" className="sr-only">
        {t("recall.note.label")}
      </label>
      <div className="flex items-center gap-2">
        <TextInput
          id="word-note"
          autoComplete="off"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSaved(false);
          }}
        />
        <Button type="submit" variant="ghost" size="sm" disabled={busy}>
          {t("recall.note.save")}
        </Button>
      </div>
      {saved && (
        <p role="status" className="text-sm text-ink-faint">
          {t("recall.note.saved")}
        </p>
      )}
      {failure !== null && (
        <Notice tone="danger">{t("common.error", { message: failure })}</Notice>
      )}
    </form>
  );
}
