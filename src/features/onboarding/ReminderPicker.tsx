import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Field } from "@/components/ui/Field";
import { TextInput } from "@/components/ui/TextInput";

interface ReminderPickerProps {
  value: string | null;
  onChange: (time: string | null) => void;
  legend?: string;
}

const DEFAULT_TIME = "19:00";

/** A daily reminder time, or none. Native `<input type="time">`. */
export function ReminderPicker({
  value,
  onChange,
  legend,
}: ReminderPickerProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <ChoiceGroup<"at" | "none">
        legend={legend ?? t("onboarding.reminder.title")}
        hideLegend={legend === undefined}
        columns={2}
        value={value === null ? "none" : "at"}
        onChange={(choice) => {
          onChange(choice === "none" ? null : DEFAULT_TIME);
        }}
        choices={[
          { value: "at", label: t("onboarding.reminder.at") },
          { value: "none", label: t("onboarding.reminder.none") },
        ]}
      />
      {value !== null && (
        <Field
          id="reminder-time"
          label={t("onboarding.reminder.field")}
          className="max-w-40"
        >
          <TextInput
            id="reminder-time"
            type="time"
            value={value}
            onChange={(event) => {
              onChange(event.target.value === "" ? null : event.target.value);
            }}
          />
        </Field>
      )}
    </div>
  );
}
