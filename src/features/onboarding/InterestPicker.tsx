import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { TextInput } from "@/components/ui/TextInput";
import { INTEREST_KEYS } from "@/lib/languages";

interface InterestPickerProps {
  value: string[];
  onChange: (interests: string[]) => void;
}

/** Suggested interests as toggles, plus the learner's own in free text. */
export function InterestPicker({
  value,
  onChange,
}: InterestPickerProps): ReactNode {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const suggested: string[] = INTEREST_KEYS.map((key) => t(`interests.${key}`));
  const own = value.filter((interest) => !suggested.includes(interest));

  const toggle = (label: string): void => {
    onChange(
      value.includes(label)
        ? value.filter((interest) => interest !== label)
        : [...value, label],
    );
  };

  const add = (): void => {
    const label = draft.trim();
    if (label !== "" && !value.includes(label)) {
      onChange([...value, label]);
    }
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {suggested.map((label) => (
          <Chip
            key={label}
            selected={value.includes(label)}
            onClick={() => {
              toggle(label);
            }}
          >
            {label}
          </Chip>
        ))}
        {own.map((label) => (
          <Chip
            key={label}
            selected
            aria-label={t("onboarding.interests.remove", { label })}
            onClick={() => {
              toggle(label);
            }}
          >
            {label}
            <X aria-hidden className="size-3.5" />
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="interest-own" className="sr-only">
          {t("onboarding.interests.add")}
        </label>
        <TextInput
          id="interest-own"
          placeholder={t("onboarding.interests.add")}
          value={draft}
          maxLength={40}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          className="h-11"
          disabled={draft.trim() === ""}
          icon={<Plus aria-hidden className="size-4" />}
          onClick={add}
        >
          {t("onboarding.interests.addButton")}
        </Button>
      </div>
    </div>
  );
}
