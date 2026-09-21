import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, LogOut, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { ROLE_LABELS } from "@/lib/user-form";
import type { UserRecord, UserRole } from "@/lib/supabase";
import { Avatar } from "@/components/RoleWorkspace";

type SimulationBarProps = {
  masterUser: UserRecord;
  effectiveUser: UserRecord;
  users: UserRecord[];
  onSelectUser: (user: UserRecord) => void;
  onExit: () => void;
};

type ShortcutRole = "agent" | "supervisor" | "admin";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

export function sortUsersForSimulation(users: UserRecord[]) {
  return [...users].sort((left, right) => left.full_name.localeCompare(right.full_name, "fr", { sensitivity: "base" }) || left.id.localeCompare(right.id));
}

function findShortcutUser(users: UserRecord[], role: ShortcutRole) {
  const normalized = users.map((user) => ({ user, name: normalize(user.full_name) }));
  if (role === "agent") return normalized.find(({ user, name }) => user.role === "agent" && name === "agent test")?.user;
  if (role === "supervisor") return normalized.find(({ user, name }) => user.role === "supervisor" && (name === "herve ntalu" || name === "herve ntalu"))?.user;
  return normalized.find(({ user, name }) => user.role === "admin" && name.startsWith("bradley"))?.user;
}

const shortcutLabels: Array<{ role: ShortcutRole; label: string; short: string }> = [
  { role: "agent", label: "Agent", short: "AG" },
  { role: "supervisor", label: "Superviseur", short: "SUP" },
  { role: "admin", label: "Administrateur", short: "ADM" },
];

export default function SimulationBar({ masterUser, effectiveUser, users, onSelectUser, onExit }: SimulationBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sortedUsers = useMemo(() => sortUsersForSimulation(users), [users]);
  const filteredUsers = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return sortedUsers;
    return sortedUsers.filter((user) => normalize(`${user.full_name} ${user.phone} ${ROLE_LABELS[user.role]}`).includes(needle));
  }, [query, sortedUsers]);

  useEffect(() => {
    if (!pickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPickerOpen(false); setQuery(""); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [pickerOpen]);

  const closePicker = () => { setPickerOpen(false); setQuery(""); };
  const chooseUser = (user: UserRecord) => { onSelectUser(user); closePicker(); };
  const isSimulating = effectiveUser.id !== masterUser.id;

  const picker = pickerOpen && typeof document !== "undefined" ? createPortal(
    <div className="simulation-picker-layer" onPointerDown={closePicker}>
      <div className="simulation-picker" onPointerDown={(event) => event.stopPropagation()}>
        <div className="simulation-picker-header">
          <div className="simulation-picker-icon"><UserRound size={16} /></div>
          <div><span className="simulation-kicker">Simulation superadmin</span><strong>{effectiveUser.full_name}</strong></div>
          <button type="button" className="simulation-close" onClick={closePicker} aria-label="Fermer"><X size={16} /></button>
        </div>
        <div className="simulation-search"><Search size={14} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un utilisateur…" aria-label="Rechercher un utilisateur à simuler" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Effacer"><X size={13} /></button>}</div>
        <div className="simulation-user-list">
          {filteredUsers.map((user) => <button type="button" className={`simulation-user-option ${user.id === effectiveUser.id ? "is-selected" : ""}`} key={user.id} onClick={() => chooseUser(user)}><Avatar user={user} /><span><strong>{user.full_name}</strong><small>{ROLE_LABELS[user.role]} · {user.phone}</small></span>{user.id === effectiveUser.id && <span className="simulation-current">Actif</span>}</button>)}
          {!filteredUsers.length && <div className="simulation-empty">Aucun utilisateur trouvé.</div>}
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return <>
    <div className={`simulation-bar ${isSimulating ? "is-active" : ""}`}>
      <div className="simulation-brand"><div className="simulation-brand-icon"><ShieldCheck size={15} /></div><div><span>Simulation superadmin</span><small>Compte réel · {masterUser.full_name}</small></div></div>
      <button type="button" className="simulation-user-select" onClick={() => setPickerOpen(true)} aria-label="Choisir l’utilisateur à simuler" aria-expanded={pickerOpen}><Avatar user={effectiveUser} /><span><strong>{effectiveUser.full_name}</strong><small>{ROLE_LABELS[effectiveUser.role]}</small></span><ChevronDown size={15} /></button>
      <div className="simulation-shortcuts" aria-label="Raccourcis de simulation">{shortcutLabels.map(({ role, label, short }) => { const target = findShortcutUser(users, role); const active = target?.id === effectiveUser.id; return <button type="button" className={`simulation-shortcut ${active ? "is-active" : ""}`} key={role} disabled={!target} onClick={() => target && onSelectUser(target)} title={target ? `Simuler ${target.full_name}` : `Compte ${label} indisponible`} aria-label={target ? `Simuler ${target.full_name}` : `Compte ${label} indisponible`}>{short}</button>; })}</div>
      {isSimulating && <button type="button" className="simulation-exit" onClick={onExit} title="Quitter la simulation" aria-label="Quitter la simulation"><LogOut size={14} /><span>Quitter</span></button>}
    </div>
    {picker}
  </>;
}

export type { SimulationBarProps };
export type { UserRole };
