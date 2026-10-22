import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";

type DatePickerFieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  required?: boolean;
  min?: string;
  max?: string;
  native?: boolean;
};

function toDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : undefined;
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toFrenchDate(date: Date | undefined): string {
  return date ? new Intl.DateTimeFormat("fr-FR").format(date) : "";
}

function toIsoFromFrenchDate(value: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return undefined;
  const date = toDate(`${match[3]}-${match[2]}-${match[1]}`);
  return date ? toIsoDate(date) : undefined;
}

export function DatePickerField({ id, value, onChange, ariaLabel, required, min, max, native = false }: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toFrenchDate(toDate(value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = toDate(value);

  useEffect(() => {
    setDraft(toFrenchDate(toDate(value)));
  }, [value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || !draft.trim()) return;
    const iso = toIsoFromFrenchDate(draft);
    if (!iso) {
      input.setCustomValidity("Saisissez une date valide au format JJ/MM/AAAA.");
    } else if ((min && iso < min) || (max && iso > max)) {
      input.setCustomValidity("Cette date est en dehors de la période autorisée.");
    } else {
      input.setCustomValidity("");
    }
  }, [draft, min, max]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function updateDraft(next: string) {
    setDraft(next);
    const iso = toIsoFromFrenchDate(next);
    const input = inputRef.current;
    if (!iso) {
      if (input) input.setCustomValidity(next.trim() ? "Saisissez une date valide au format JJ/MM/AAAA." : "");
      if (!next.trim()) onChange("");
      return;
    }
    if ((min && iso < min) || (max && iso > max)) {
      if (input) input.setCustomValidity("Cette date est en dehors de la période autorisée.");
      return;
    }
    if (input) input.setCustomValidity("");
    onChange(iso);
  }

  function chooseDate(date: Date | undefined) {
    if (!date) return;
    const iso = toIsoDate(date);
    onChange(iso);
    setDraft(toFrenchDate(date));
    if (inputRef.current) inputRef.current.setCustomValidity("");
    setOpen(false);
  }

  if (native) {
    return (
      <div className="custom-date-picker custom-date-picker-native">
        <div className="custom-date-picker-control">
          <CalendarDays size={15} aria-hidden="true" />
          <input
            id={id}
            type="date"
            value={value}
            min={min}
            max={max}
            required={required}
            aria-label={ariaLabel}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="custom-date-picker" ref={rootRef}>
      <div className="custom-date-picker-control">
        <CalendarDays size={15} aria-hidden="true" />
        <input
          id={id}
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
          placeholder="JJ/MM/AAAA"
          aria-label={ariaLabel}
          value={draft}
          required={required}
          onChange={(event) => updateDraft(event.target.value)}
          onFocus={() => setOpen(true)}
        />
        <button type="button" className="date-picker-trigger" aria-label={`Ouvrir le calendrier : ${ariaLabel}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="custom-date-picker-popover" role="dialog" aria-label={`Calendrier : ${ariaLabel}`}>
          <Calendar
            mode="single"
            selected={selected}
            onSelect={chooseDate}
            disabled={(date) => {
              const iso = toIsoDate(date);
              return Boolean((min && iso < min) || (max && iso > max));
            }}
            weekStartsOn={1}
            formatters={{
              formatCaption: (date) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date),
              formatWeekdayName: (date) => new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(date),
            }}
            labels={{
              labelDayButton: (date) => `Choisir le ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date)}`,
              labelNext: () => "Mois suivant",
              labelPrevious: () => "Mois précédent",
            }}
            className="custom-date-calendar"
          />
        </div>
      )}
    </div>
  );
}

type TimeFieldProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  required?: boolean;
};

export function TimeField({ value, onChange, ariaLabel, required }: TimeFieldProps) {
  return (
    <div className="custom-time-field">
      <Clock3 size={15} aria-hidden="true" />
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
        placeholder="HH:MM"
        aria-label={ariaLabel}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9:]/g, "").slice(0, 5))}
      />
    </div>
  );
}
