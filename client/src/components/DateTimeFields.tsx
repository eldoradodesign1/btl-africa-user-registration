import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
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

type BirthDateFieldProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  min?: string;
  max?: string;
  invalid?: boolean;
  describedBy?: string;
};

type BirthView = "years" | "months" | "days";

const BIRTH_MONTHS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const BIRTH_WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const INVALID_BIRTH_DATE = "Saisissez une date valide au format JJ/MM/AAAA.";

/** Chiffres seuls, barres ajoutées au fil de la saisie : « 15031998 » → « 15/03/1998 ». */
function maskFrenchDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
}

function monthLabel(year: number, month: number): string {
  const label = new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(year, month, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Déplace le focus dans une grille de boutons (flèches, Début, Fin), en sautant les cases désactivées. */
function moveInGrid(event: ReactKeyboardEvent<HTMLDivElement>, columns: number) {
  const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  let target = -1;
  if (event.key in steps) {
    target = index + steps[event.key];
    while (buttons[target]?.disabled) target += steps[event.key];
  } else if (event.key === "Home") target = buttons.findIndex((button) => !button.disabled);
  else if (event.key === "End") target = buttons.length - 1 - [...buttons].reverse().findIndex((button) => !button.disabled);
  else return;
  event.preventDefault();
  buttons[target]?.focus();
}

/**
 * Date de naissance : saisie libre JJ/MM/AAAA ou sélecteur en trois temps
 * (année → mois → jour), comme les sélecteurs natifs Android / iOS. Sur écran
 * tactile, le champ ouvre directement le sélecteur sans clavier.
 */
export function BirthDateField({ id, value, onChange, ariaLabel, min = "1940-01-01", max, invalid, describedBy }: BirthDateFieldProps) {
  const maxIso = max || toIsoDate(new Date());
  const maxDate = toDate(maxIso) || new Date();
  const minDate = toDate(min) || new Date(1940, 0, 1);
  const selected = toDate(value);
  const [draft, setDraft] = useState(() => toFrenchDate(selected));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<BirthView>("years");
  const [cursor, setCursor] = useState(() => ({ year: selected?.getFullYear() ?? maxDate.getFullYear() - 25, month: selected?.getMonth() ?? 0 }));
  const [touch] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(toFrenchDate(toDate(value)));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const target = panelRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]:not(:disabled), [data-focus]:not(:disabled)")
      || panelRef.current?.querySelector<HTMLButtonElement>(".bdf-grid button:not(:disabled)");
    target?.scrollIntoView({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [open, view]);

  function openPicker() {
    setCursor({ year: selected?.getFullYear() ?? maxDate.getFullYear() - 25, month: selected?.getMonth() ?? 0 });
    setView(selected ? "days" : "years");
    setOpen(true);
  }

  function close(focusInput = true) {
    setOpen(false);
    if (focusInput) requestAnimationFrame(() => (touch ? triggerRef : inputRef).current?.focus());
  }

  function typeDraft(raw: string) {
    const next = maskFrenchDate(raw);
    setDraft(next);
    setOpen(false);
    const input = inputRef.current;
    if (!next) { input?.setCustomValidity(""); onChange(""); return; }
    const iso = toIsoFromFrenchDate(next);
    if (!iso || iso < min || iso > maxIso) { input?.setCustomValidity(INVALID_BIRTH_DATE); return; }
    input?.setCustomValidity("");
    onChange(iso);
  }

  function chooseDay(day: number) {
    const date = new Date(cursor.year, cursor.month, day);
    inputRef.current?.setCustomValidity("");
    setDraft(toFrenchDate(date));
    onChange(toIsoDate(date));
    close();
  }

  const outOfRange = (from: Date, to: Date) => to < minDate || from > maxDate;
  const firstYear = minDate.getFullYear();
  const years = Array.from({ length: maxDate.getFullYear() - firstYear + 1 }, (_, index) => firstYear + index);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leadingBlanks = (new Date(cursor.year, cursor.month, 1).getDay() + 6) % 7;
  const canGoBack = view === "days" ? !outOfRange(new Date(cursor.year, cursor.month - 1, 1), new Date(cursor.year, cursor.month, 0)) : cursor.year > firstYear;
  const canGoForward = view === "days" ? !outOfRange(new Date(cursor.year, cursor.month + 1, 1), new Date(cursor.year, cursor.month + 2, 0)) : cursor.year < maxDate.getFullYear();

  function step(direction: 1 | -1) {
    setCursor((current) => view === "days"
      ? { year: current.month + direction < 0 ? current.year - 1 : current.month + direction > 11 ? current.year + 1 : current.year, month: (current.month + direction + 12) % 12 }
      : { ...current, year: current.year + direction });
  }

  return (
    <div className={`bdf${open ? " is-open" : ""}`} ref={rootRef} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); close(); } }}>
      <div className="bdf-control" onClick={touch ? openPicker : undefined}>
        <input
          id={id}
          ref={inputRef}
          type="text"
          inputMode={touch ? "none" : "numeric"}
          readOnly={touch}
          autoComplete="bday"
          maxLength={10}
          placeholder="JJ/MM/AAAA"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={draft}
          onChange={(event) => typeDraft(event.target.value)}
        />
        <button ref={triggerRef} type="button" className="bdf-trigger" aria-label="Choisir dans le calendrier" aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.stopPropagation(); if (open) close(false); else openPicker(); }}>
          <CalendarDays size={20} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="bdf-panel" ref={panelRef} role="dialog" aria-label={ariaLabel}>
          <div className="bdf-head">
            {view !== "years" && <button type="button" className="bdf-nav" aria-label={view === "days" ? "Mois précédent" : "Année précédente"} disabled={!canGoBack} onClick={() => step(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>}
            <div className="bdf-title">
              {view === "years" ? <span className="bdf-caption">Année de naissance</span> : <>
                {view === "days" && <button type="button" className="bdf-title-btn" aria-label={`${monthLabel(cursor.year, cursor.month)}, changer de mois`} onClick={() => setView("months")}>{monthLabel(cursor.year, cursor.month)}</button>}
                <button type="button" className="bdf-title-btn" aria-label={`${cursor.year}, changer d’année`} onClick={() => setView("years")}>{cursor.year}</button>
              </>}
            </div>
            {view !== "years" && <button type="button" className="bdf-nav" aria-label={view === "days" ? "Mois suivant" : "Année suivante"} disabled={!canGoForward} onClick={() => step(1)}><ChevronRight size={20} aria-hidden="true" /></button>}
          </div>
          {view === "years" && (
            <div className="bdf-grid bdf-years" onKeyDown={(event) => moveInGrid(event, 4)}>
              {years.map((year) => <button type="button" key={year} aria-pressed={year === selected?.getFullYear()} data-focus={year === cursor.year ? "" : undefined} onClick={() => { setCursor((current) => ({ ...current, year })); setView("months"); }}>{year}</button>)}
            </div>
          )}
          {view === "months" && (
            <div className="bdf-grid bdf-months" onKeyDown={(event) => moveInGrid(event, 3)}>
              {BIRTH_MONTHS.map((label, month) => <button type="button" key={label} aria-label={monthLabel(cursor.year, month)} aria-pressed={selected?.getFullYear() === cursor.year && selected?.getMonth() === month} data-focus={month === cursor.month ? "" : undefined} disabled={outOfRange(new Date(cursor.year, month, 1), new Date(cursor.year, month + 1, 0))} onClick={() => { setCursor((current) => ({ ...current, month })); setView("days"); }}>{label}</button>)}
            </div>
          )}
          {view === "days" && <>
            <div className="bdf-weekdays" aria-hidden="true">{BIRTH_WEEKDAYS.map((day, index) => <span key={index}>{day}</span>)}</div>
            <div className="bdf-grid bdf-days" onKeyDown={(event) => moveInGrid(event, 7)}>
              {Array.from({ length: leadingBlanks }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
                const date = new Date(cursor.year, cursor.month, day);
                return <button type="button" key={day} aria-label={new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date)} aria-pressed={selected?.getTime() === date.getTime()} disabled={date < minDate || date > maxDate} onClick={() => chooseDay(day)}>{day}</button>;
              })}
            </div>
          </>}
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
