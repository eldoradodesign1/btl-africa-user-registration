import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronUp, Eye, Search, Undo2, X } from "lucide-react";
import { Avatar } from "@/components/RoleWorkspace";
import { ROLE_LABELS, categoryShortLabel } from "@/lib/user-form";
import type { UserRecord, UserRole } from "@/lib/supabase";

type SimulationBarProps = {
  masterUser: UserRecord;
  effectiveUser: UserRecord;
  users: UserRecord[];
  onSelectUser: (user: UserRecord) => void;
  onExit: () => void;
};

type ShortcutRole = "agent" | "supervisor" | "admin";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

export function sortUsersForSimulation(users: UserRecord[]) {
  return [...users].sort((left, right) => left.full_name.localeCompare(right.full_name, "fr", { sensitivity: "base" }) || left.id.localeCompare(right.id));
}

function findShortcutUser(users: UserRecord[], role: ShortcutRole) {
  const normalized = users.map((user) => ({ user, name: normalize(user.full_name) }));
  if (role === "agent") return normalized.find(({ user, name }) => user.role === "agent" && name === "agent test")?.user;
  if (role === "supervisor") return normalized.find(({ user, name }) => user.role === "supervisor" && name === "herve ntalu")?.user;
  return normalized.find(({ user, name }) => user.role === "admin" && name.startsWith("bradley"))?.user;
}

const SHORTCUTS: Array<{ role: ShortcutRole; label: string }> = [
  { role: "agent", label: "Agent" },
  { role: "supervisor", label: "Superviseur" },
  { role: "admin", label: "Admin" },
];
const ROLE_ORDER: UserRole[] = ["agent", "supervisor", "sub_admin", "admin", "super_admin"];
const GROUP_LABELS: Record<UserRole, string> = { agent: "Agents", supervisor: "Superviseurs", sub_admin: "Coordination", admin: "Administrateurs", super_admin: "Support IT" };
const RECENTS_KEY = "btl-simulation-recents";

function readRecents(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}

function rememberRecent(id: string) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify([id, ...readRecents().filter((item) => item !== id)].slice(0, 4)));
  } catch {
    // Stockage indisponible (navigation privée…) : pas de récents, sans gêner la simulation.
  }
}

function describe(user: UserRecord): string {
  return user.role === "agent" ? `Agent · ${categoryShortLabel(user.user_category)}` : ROLE_LABELS[user.role];
}

/**
 * « Voir comme » : capsule flottante en bas d'écran (zone du pouce), discrète au repos.
 * En simulation, la capsule passe à l'ambre, montre le visage du compte simulé et un
 * liseré ambré entoure l'écran : le mode reste visible en permanence, et « Revenir »
 * est toujours à un geste.
 */
export default function SimulationBar({ masterUser, effectiveUser, users, onSelectUser, onExit }: SimulationBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState(readRecents);
  const [touch] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches));
  const capsuleRef = useRef<HTMLButtonElement>(null);
  const isSimulating = effectiveUser.id !== masterUser.id;
  const needle = normalize(query);
  const sortedUsers = useMemo(() => sortUsersForSimulation(users), [users]);
  const matches = useMemo(() => needle ? sortedUsers.filter((user) => normalize(`${user.full_name} ${user.phone} ${ROLE_LABELS[user.role]} ${categoryShortLabel(user.user_category)}`).includes(needle)) : sortedUsers, [needle, sortedUsers]);
  const groups = ROLE_ORDER.map((role) => ({ role, members: matches.filter((user) => user.role === role) })).filter((group) => group.members.length > 0);
  const recentUsers = recents.map((id) => users.find((user) => user.id === id)).filter((user): user is UserRecord => Boolean(user) && user?.id !== masterUser.id);
  const shortcuts = SHORTCUTS.map((shortcut) => ({ ...shortcut, user: findShortcutUser(users, shortcut.role) })).filter((shortcut): shortcut is typeof shortcut & { user: UserRecord } => Boolean(shortcut.user));

  useEffect(() => {
    document.body.classList.add("has-sim-capsule");
    return () => document.body.classList.remove("has-sim-capsule");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("is-simulating", isSimulating);
    return () => document.body.classList.remove("is-simulating");
  }, [isSimulating]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => capsuleRef.current?.focus());
  }

  function choose(user: UserRecord) {
    if (user.id !== masterUser.id) {
      rememberRecent(user.id);
      setRecents(readRecents());
    }
    onSelectUser(user);
    close();
  }

  const row = (user: UserRecord) => <button type="button" key={user.id} className={`sim-row${user.id === effectiveUser.id ? " is-current" : ""}`} aria-current={user.id === effectiveUser.id || undefined} onClick={() => choose(user)}>
    <Avatar user={user} />
    <span><strong>{user.full_name}{user.id === masterUser.id && <em> · vous</em>}</strong><small>{describe(user)}</small></span>
    {user.id === effectiveUser.id && <Check size={16} aria-hidden="true" />}
  </button>;

  const section = (title: string, content: ReactNode, count?: number) => <div className="sim-section">
    <h4>{title}{count !== undefined && <small>{count}</small>}</h4>
    {content}
  </div>;

  const sheet = open ? <div className="sim-layer" onPointerDown={close}>
    <section className="sim-sheet" role="dialog" aria-modal="true" aria-label="Voir l’appli comme un autre compte" onPointerDown={(event) => event.stopPropagation()}>
      <header className="sim-sheet-head">
        <div><span className="sim-kicker">Voir l’appli comme</span><strong>{isSimulating ? effectiveUser.full_name : "Choisissez un compte"}</strong></div>
        <button type="button" className="sim-close" onClick={close} aria-label="Fermer"><X size={18} /></button>
      </header>
      <label className="sim-search">
        <Search size={16} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, rôle ou numéro" aria-label="Rechercher un compte" autoFocus={!touch} />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="Effacer la recherche"><X size={14} /></button>}
      </label>
      <div className="sim-scroll">
        {!needle && isSimulating && <button type="button" className="sim-row is-self" onClick={() => choose(masterUser)}>
          <Avatar user={masterUser} />
          <span><strong>Revenir à mon compte</strong><small>{masterUser.full_name}</small></span>
          <Undo2 size={16} aria-hidden="true" />
        </button>}
        {!needle && shortcuts.length > 0 && section("Accès rapide", <div className="sim-chips">{shortcuts.map(({ role, label, user }) => <button type="button" key={role} className={`sim-chip${user.id === effectiveUser.id ? " is-current" : ""}`} onClick={() => choose(user)}>
          <Avatar user={user} />
          <span><strong>{label}</strong><small>{user.full_name}</small></span>
        </button>)}</div>)}
        {!needle && recentUsers.length > 0 && section("Récents", recentUsers.map(row))}
        {groups.map((group) => <div key={group.role}>{section(GROUP_LABELS[group.role], group.members.map(row), group.members.length)}</div>)}
        {!matches.length && <p className="sim-empty">Aucun compte ne correspond.</p>}
      </div>
    </section>
  </div> : null;

  const capsule = <div className={`sim-capsule${isSimulating ? " is-active" : ""}`} role="region" aria-label="Voir l’appli comme un autre compte">
    {isSimulating ? <>
      <button ref={capsuleRef} type="button" className="sim-capsule-main" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Vous voyez l’appli comme ${effectiveUser.full_name}. Changer de compte`}>
        <Avatar user={effectiveUser} />
        <span className="sim-capsule-text"><small>Vous voyez l’appli comme</small><strong>{effectiveUser.full_name}</strong></span>
        <ChevronUp size={16} aria-hidden="true" />
      </button>
      <button type="button" className="sim-capsule-exit" onClick={onExit} aria-label="Revenir à mon compte"><Undo2 size={16} aria-hidden="true" />Revenir</button>
    </> : <button ref={capsuleRef} type="button" className="sim-capsule-main" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label="Voir l’appli comme un autre compte">
      <Eye size={18} aria-hidden="true" />
      <span className="sim-capsule-text"><strong>Voir comme…</strong></span>
    </button>}
  </div>;

  return createPortal(<>
    {isSimulating && <div className="sim-ring" aria-hidden="true" />}
    {capsule}
    {sheet}
    <span className="sr-only" aria-live="polite">{isSimulating ? `Vous voyez l’appli comme ${effectiveUser.full_name}.` : ""}</span>
  </>, document.body);
}

export type { SimulationBarProps };
export type { UserRole };
