import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Phone,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  ROLE_LABELS,
  ROLE_OPTIONS,
  buildUserPayload,
  categoryShortLabel,
  defaultPasswordForRole,
  shouldShowShop,
} from "@/lib/user-form";
import { formatPhoneForDisplay, isValidMsisdn, normalizePhone, phoneValidationMessage } from "@/lib/phone";
import {
  findExistingUser,
  getDemoUsers,
  insertUser,
  isSupabaseConfigured,
  isUniquePhoneError,
  loadSupervisors,
  type UserCategory,
  type UserRecord,
  type UserRole,
} from "@/lib/supabase";
import { CopyablePhone } from "@/components/CopyablePhone";
import BrandLogo from "@/components/BrandLogo";

type PhoneState = "idle" | "checking" | "valid" | "invalid" | "duplicate" | "error";
type ToastState = { kind: "success" | "error" | "info"; title: string; message: string; action?: () => void } | null;

function creationErrorMessage(error: unknown): string {
  const candidate = error as { message?: string; details?: string; hint?: string; code?: string } | null;
  const detail = [candidate?.message, candidate?.details, candidate?.hint].filter(Boolean).join(" · ");
  return detail ? `${detail}${candidate?.code ? ` · code ${candidate.code}` : ""}` : "Le serveur n’a pas confirmé la création. Vérifiez que la migration de création superadmin a été exécutée.";
}

type FormState = {
  fullName: string;
  phone: string;
  role: UserRole;
  category: UserCategory;
  supervisorId: string;
  useDefaultPassword: boolean;
  password: string;
  permanentShopId: string;
};

const INITIAL_FORM: FormState = {
  fullName: "",
  phone: "",
  role: "agent",
  category: "hostess",
  supervisorId: "",
  useDefaultPassword: true,
  password: "",
  permanentShopId: "",
};

const SHOP_OPTIONS = [
  { value: "", label: "Aucun shop" },
  { value: "KIN-GOMBE-001", label: "Kinshasa · Gombe 001" },
  { value: "KIN-LIMETE-002", label: "Kinshasa · Limete 002" },
  { value: "LUB-MANIKA-001", label: "Lubumbashi · Manika 001" },
];

function CustomSelect<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
  helper,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  helper?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field select-field">
      <div className="field-label-row">
        <label>{label}</label>
        {helper && <span className="field-helper">{helper}</span>}
      </div>
      <button
        type="button"
        className={`select-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{labels[value]}</span>
        <ChevronDown size={16} strokeWidth={2.5} />
      </button>
      {open && (
        <div className="select-menu" role="listbox">
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option === value}
              className={`select-option ${option === value ? "is-selected" : ""}`}
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              <span>{labels[option]}</span>
              {option === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserRoleBadge({ role }: { role: UserRole }) {
  return <span className={`role-badge role-${role}`}>{ROLE_LABELS[role]}</span>;
}

function Home({ onUserCreated, onNavigateDashboard }: { onUserCreated?: (user: UserRecord) => void; onNavigateDashboard?: () => void }) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [supervisors, setSupervisors] = useState<UserRecord[]>([]);
  const [recentUsers, setRecentUsers] = useState<UserRecord[]>(() => isSupabaseConfigured() ? [] : getDemoUsers());
  const [phoneState, setPhoneState] = useState<PhoneState>("idle");
  const [existingUser, setExistingUser] = useState<UserRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingSupervisors, setLoadingSupervisors] = useState(true);
  const [supervisorError, setSupervisorError] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [successSummary, setSuccessSummary] = useState<UserRecord | null>(null);
  const lookupSequence = useRef(0);

  const normalizedPhone = normalizePhone(form.phone);
  const fullNameError = form.fullName.length > 0 && form.fullName.trim().length < 2 ? "Saisissez au moins 2 caractères." : "";
  const phoneError = phoneValidationMessage(form.phone);
  const isPhoneValid = isValidMsisdn(form.phone);
  const showShop = shouldShowShop(form.role, form.category);

  const supervisorOptions = useMemo(
    () => supervisors.filter((user) => ["supervisor", "admin", "sub_admin", "super_admin"].includes(user.role)),
    [supervisors],
  );

  useEffect(() => {
    let active = true;
    setLoadingSupervisors(true);
    loadSupervisors()
      .then((users) => {
        if (active) {
          setSupervisors(users);
          setSupervisorError(false);
        }
      })
      .catch(() => {
        if (active) setSupervisorError(true);
      })
      .finally(() => {
        if (active) setLoadingSupervisors(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const currentSequence = ++lookupSequence.current;
    setExistingUser(null);
    if (!form.phone.trim()) {
      setPhoneState("idle");
      return;
    }
    if (!isPhoneValid) {
      setPhoneState("invalid");
      return;
    }

    setPhoneState("checking");
    const timeout = window.setTimeout(async () => {
      try {
        const user = await findExistingUser(normalizedPhone);
        if (currentSequence !== lookupSequence.current) return;
        setExistingUser(user);
        setPhoneState(user ? "duplicate" : "valid");
      } catch {
        if (currentSequence !== lookupSequence.current) return;
        setPhoneState("error");
        setToast({
          kind: "error",
          title: "Vérification interrompue",
          message: "Impossible de vérifier ce numéro pour le moment.",
          action: () => void runPhoneLookup(),
        });
      }
    }, 420);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.phone, isPhoneValid, normalizedPhone]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), toast.action ? 9000 : 5200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function runPhoneLookup() {
    if (!isValidMsisdn(form.phone)) return;
    const currentSequence = ++lookupSequence.current;
    setPhoneState("checking");
    setExistingUser(null);
    try {
      const user = await findExistingUser(normalizePhone(form.phone));
      if (currentSequence !== lookupSequence.current) return;
      setExistingUser(user);
      setPhoneState(user ? "duplicate" : "valid");
      setToast(null);
    } catch {
      setPhoneState("error");
      setToast({ kind: "error", title: "Vérification impossible", message: "Réessayez dans quelques instants.", action: () => void runPhoneLookup() });
    }
  }

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleRoleChange(role: UserRole) {
    setForm((current) => ({
      ...current,
      role,
      category: role === "agent" ? current.category || "hostess" : "hostess",
      permanentShopId: role === "agent" && current.category === "hostess" ? current.permanentShopId : "",
    }));
  }

  function resetForm() {
    setForm({ ...INITIAL_FORM });
    setPhoneState("idle");
    setExistingUser(null);
    setSuccessSummary(null);
    setToast(null);
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmedName = form.fullName.trim();
    if (!trimmedName) {
      setToast({ kind: "error", title: "Nom requis", message: "Le nom complet est obligatoire." });
      return;
    }
    if (trimmedName.length < 2 || !isPhoneValid) {
      setToast({ kind: "error", title: "Vérifiez les champs", message: "Corrigez les champs signalés avant de continuer." });
      return;
    }
    if (phoneState === "checking") {
      setToast({ kind: "info", title: "Vérification en cours", message: "Le numéro est encore en cours de contrôle." });
      return;
    }
    if (existingUser) {
      setPhoneState("duplicate");
      return;
    }

    setSubmitting(true);
    try {
      const latestExistingUser = await findExistingUser(normalizedPhone);
      if (latestExistingUser) {
        setExistingUser(latestExistingUser);
        setPhoneState("duplicate");
        setSubmitting(false);
        return;
      }

      const payload = buildUserPayload({
        id: crypto.randomUUID(),
        fullName: trimmedName,
        phone: normalizedPhone,
        password: form.useDefaultPassword ? defaultPasswordForRole(form.role) : form.password,
        role: form.role,
        category: form.role === "agent" ? form.category : "operations",
        supervisorId: form.supervisorId || null,
        permanentShopId: showShop ? form.permanentShopId || null : null,
      });
      const created = await insertUser(payload);
      const safeCreated = { ...created, password_hash: null };
      setRecentUsers((current) => [safeCreated, ...current.filter((user) => user.id !== safeCreated.id)]);
      if (["supervisor", "admin", "sub_admin", "super_admin"].includes(created.role)) {
        setSupervisors((current) => [safeCreated, ...current.filter((user) => user.id !== safeCreated.id)]);
      }
      setSuccessSummary(safeCreated);
      setForm({ ...INITIAL_FORM });
      setPhoneState("idle");
      setExistingUser(null);
      setToast({ kind: "success", title: "Utilisateur créé avec succès", message: "Le nouvel accès est prêt à être utilisé." });
      onUserCreated?.(safeCreated);
    } catch (error) {
      if (isUniquePhoneError(error)) {
        const latestExistingUser = await findExistingUser(normalizedPhone).catch(() => null);
        setExistingUser(latestExistingUser);
        setPhoneState("duplicate");
        setToast({ kind: "error", title: "Numéro déjà utilisé", message: "Une autre création vient d’utiliser ce MSISDN. Aucun utilisateur n’a été écrasé." });
      } else {
        setToast({ kind: "error", title: "Création impossible", message: creationErrorMessage(error), action: () => void handleSubmit() });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = Boolean(form.fullName.trim().length >= 2 && isPhoneValid && (form.useDefaultPassword || form.password.length >= 6) && phoneState !== "checking" && phoneState !== "duplicate" && phoneState !== "error" && !submitting);

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand-lockup">
          <BrandLogo />
          <div>
            <span className="brand-name">BTL Africa</span>
            <span className="brand-context">Privilege Tracker · Administration</span>
          </div>
        </div>
        <div className="topbar-actions">
        <div className={`environment-chip ${isSupabaseConfigured() ? "is-live" : "is-demo"}`}>
          <span className="environment-dot" />
          {isSupabaseConfigured() ? "Connexion Supabase active" : "Mode démo actif"}
        </div>
        {onNavigateDashboard && <button type="button" className="nav-action" onClick={onNavigateDashboard}><ServerCog size={14} /> Dashboard</button>}
        </div>
      </header>

      <main className="page-content">
        <section className="page-intro">
          <div>
            <div className="eyebrow"><Sparkles size={13} /> Workspace sécurisé · Création d’accès</div>
            <h1>Nouvel utilisateur<span>.</span></h1>
            <p>Créez un accès opérationnel en quelques secondes, avec une vérification MSISDN intégrée et une traçabilité prête pour le terrain.</p>
          </div>
          <div className="intro-metrics">
            <div><span className="metric-value">03</span><span className="metric-label">contrôles avant création</span></div>
            <div><span className="metric-value">UUID</span><span className="metric-label">identité PostgreSQL</span></div>
          </div>
        </section>

        <div className="workspace-grid">
          <form className="form-card glass-card" onSubmit={handleSubmit}>
            <div className="card-heading">
              <div className="heading-icon"><UserPlus size={19} /></div>
              <div>
                <h2>Profil d’accès</h2>
                <p>Les champs marqués d’un astérisque sont obligatoires.</p>
              </div>
              <span className="step-count">01 <span>/ 03</span></span>
            </div>

            <div className="section-block">
              <div className="section-title"><span>01</span><div><h3>Identité</h3><p>Les informations visibles dans l’application.</p></div></div>
              <div className="field-grid two-columns">
                <div className="field">
                  <label htmlFor="fullName">Nom complet <b>*</b></label>
                  <div className={`input-wrap ${fullNameError ? "has-error" : form.fullName.trim().length >= 2 ? "is-valid" : ""}`}>
                    <UsersRound size={17} />
                    <input id="fullName" value={form.fullName} onChange={(event) => updateForm("fullName", event.target.value)} placeholder="Ex. Grâce Mbuyi" autoComplete="name" />
                    {form.fullName.trim().length >= 2 && <CheckCircle2 className="input-state-icon" size={16} />}
                  </div>
                  {fullNameError && <span className="field-error"><AlertCircle size={13} />{fullNameError}</span>}
                  {!fullNameError && <span className="field-hint">Les accents sont conservés.</span>}
                </div>
                <div className="field phone-field">
                  <div className="field-label-row"><label htmlFor="phone">Téléphone / MSISDN <b>*</b></label><span className="field-helper">10 chiffres local</span></div>
                  <div className={`input-wrap phone-input ${phoneState === "valid" ? "is-valid" : phoneState === "duplicate" || phoneState === "invalid" || phoneState === "error" ? "has-error" : ""}`}>
                    <Phone size={17} />
                    <input id="phone" value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} placeholder="081 234 5678" inputMode="tel" autoComplete="tel" />
                    {phoneState === "checking" && <LoaderCircle className="spin input-state-icon" size={16} />}
                    {phoneState === "valid" && <CheckCircle2 className="input-state-icon" size={16} />}
                    {(phoneState === "duplicate" || phoneState === "invalid" || phoneState === "error") && <AlertCircle className="input-state-icon" size={16} />}
                  </div>
                  {phoneState === "checking" && <span className="field-status checking"><LoaderCircle className="spin" size={13} /> Vérification du numéro…</span>}
                  {phoneState === "valid" && <span className="field-status valid"><CheckCircle2 size={13} /> Numéro disponible · normalisé {normalizedPhone}</span>}
                  {phoneState === "duplicate" && <span className="field-status invalid"><AlertCircle size={13} /> Ce numéro est déjà utilisé</span>}
                  {(phoneState === "invalid" || phoneState === "error") && <span className="field-error"><AlertCircle size={13} />{phoneError || "Vérification indisponible. Réessayez."}</span>}
                  {phoneState === "idle" && <span className="field-hint">Formats acceptés : 081…, +24381… ou 24381…</span>}
                </div>
              </div>
            </div>

            <div className="section-block role-block">
              <div className="section-title"><span>02</span><div><h3>Rôle & rattachement</h3><p>Définissez le périmètre de l’utilisateur.</p></div></div>
              <div className="field-grid two-columns">
                <CustomSelect label="Rôle" value={form.role} options={ROLE_OPTIONS} labels={ROLE_LABELS} onChange={handleRoleChange} helper="Accès applicatif" />
                <div className="field select-field">
                  <div className="field-label-row"><label>Superviseur</label><span className="field-helper">Optionnel</span></div>
                  <div className="supervisor-shell">
                    <Search size={16} />
                    <select value={form.supervisorId} onChange={(event) => updateForm("supervisorId", event.target.value)} disabled={loadingSupervisors || supervisorError}>
                      <option value="">Aucun rattachement</option>
                      {supervisorOptions.map((user) => <option value={user.id} key={user.id}>{user.full_name}</option>)}
                    </select>
                    {loadingSupervisors ? <LoaderCircle className="spin" size={15} /> : <ChevronDown size={15} />}
                  </div>
                  {supervisorError ? <span className="field-error"><AlertCircle size={13} />Impossible de charger les superviseurs.</span> : <span className="field-hint">Seuls les rôles d’encadrement sont proposés.</span>}
                </div>
              </div>
              {form.role === "agent" && (
                <div className="conditional-panel">
                  <div className="conditional-label"><BriefcaseBusiness size={15} /><div><strong>Campagne / catégorie</strong><span>Les catégories Merchant et Youth F2F restent distinctes.</span></div></div>
                  <CustomSelect label="Catégorie utilisateur" value={form.category} options={CATEGORY_OPTIONS} labels={CATEGORY_LABELS} onChange={(value) => setForm((current) => ({ ...current, category: value, permanentShopId: value === "hostess" ? current.permanentShopId : "" }))} />
                </div>
              )}
              {showShop && (
                <div className="shop-row">
                  <div className="shop-copy"><span className="mini-label">SHOP PERMANENT</span><strong>Point de rattachement</strong><span>« Aucun shop » sera enregistré comme <code>null</code>.</span></div>
                  <select value={form.permanentShopId} onChange={(event) => updateForm("permanentShopId", event.target.value)}>
                    {SHOP_OPTIONS.map((shop) => <option value={shop.value} key={shop.value}>{shop.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="section-block security-block">
              <div className="section-title"><span>03</span><div><h3>Accès initial</h3><p>Le secret reste confidentiel et n’est jamais affiché après création.</p></div></div>
              <label className="password-toggle">
                <input type="checkbox" checked={form.useDefaultPassword} onChange={(event) => updateForm("useDefaultPassword", event.target.checked)} />
                <span className="toggle-visual"><Check size={13} /></span>
                <span><strong>Utiliser le mot de passe par défaut</strong><small>{ROLE_LABELS[form.role]} : <code>{defaultPasswordForRole(form.role)}</code> · modifiable si nécessaire</small></span>
              </label>
              {!form.useDefaultPassword && (
                <div className="field password-field">
                  <label htmlFor="password">Mot de passe initial <b>*</b></label>
                  <div className={`input-wrap ${form.password.length >= 6 ? "is-valid" : form.password.length > 0 ? "has-error" : ""}`}>
                    <KeyRound size={17} />
                    <input id="password" type="password" value={form.password} onChange={(event) => updateForm("password", event.target.value)} placeholder="Au moins 6 caractères" autoComplete="new-password" />
                  </div>
                  {form.password.length > 0 && form.password.length < 6 && <span className="field-error"><AlertCircle size={13} />Le mot de passe doit contenir au moins 6 caractères.</span>}
                </div>
              )}
              <div className="security-note"><LockKeyhole size={15} /><span>La clé <code>service_role</code> n’est jamais utilisée côté navigateur. La clé publishable/anon suffit pour les opérations autorisées par vos politiques RLS.</span></div>
            </div>

            <div className="form-actions">
              <button type="button" className="button secondary" onClick={resetForm}><RefreshCw size={16} /> Réinitialiser</button>
              <button type="submit" className="button primary" disabled={!canSubmit}>
                {submitting ? <><LoaderCircle className="spin" size={17} /> Création…</> : <>Créer l’utilisateur <ArrowRight size={17} /></>}
              </button>
            </div>
            <p className="required-note"><span>*</span> Le bouton reste désactivé tant que le nom, le MSISDN ou le contrôle anti-doublon n’est pas valide.</p>
          </form>

          <aside className="side-column">
            {existingUser ? (
              <section className="duplicate-card side-card">
                <div className="alert-topline"><div className="alert-icon"><X size={17} /></div><span>Contrôle anti-doublon</span></div>
                <h2>Ce numéro est déjà attribué.</h2>
                <p>La création est bloquée pour protéger l’utilisateur existant.</p>
                <div className="existing-user">
                  <div className="avatar">{existingUser.full_name.slice(0, 1).toUpperCase()}</div>
                  <div><strong>{existingUser.full_name}</strong><CopyablePhone value={existingUser.phone}>{formatPhoneForDisplay(existingUser.phone)}</CopyablePhone></div>
                  <UserRoleBadge role={existingUser.role} />
                </div>
                <div className="existing-meta"><span>Catégorie</span><strong>{categoryShortLabel(existingUser.user_category)}</strong></div>
                <div className="alert-actions"><button type="button" className="button secondary compact" onClick={() => updateForm("phone", "")}><RefreshCw size={14} /> Corriger le numéro</button></div>
              </section>
            ) : (
              <section className="side-card guide-card">
                <div className="card-kicker"><BadgeCheck size={15} /> Parcours contrôlé</div>
                <h2>Prêt pour le terrain.</h2>
                <p>Chaque création passe par trois garde-fous avant d’atteindre <code>public.users</code>.</p>
                <div className="guardrail-list">
                  <div><span className="guardrail-number">01</span><span><strong>Validation locale</strong><small>Nettoyage et format MSISDN</small></span><CheckCircle2 size={16} /></div>
                  <div><span className="guardrail-number">02</span><span><strong>Lookup ciblé</strong><small>Recherche sur phone uniquement</small></span><CheckCircle2 size={16} /></div>
                  <div><span className="guardrail-number">03</span><span><strong>Contrainte unique</strong><small>La base reste la dernière ligne</small></span><CheckCircle2 size={16} /></div>
                </div>
                <div className="tip-box"><Info size={15} /><span>Astuce : <strong>+243 81 234 5678</strong> devient automatiquement <strong>0812345678</strong>.</span></div>
              </section>
            )}

            {successSummary && (
              <section className="success-card side-card">
                <div className="success-icon"><CheckCircle2 size={20} /></div>
                <div className="card-kicker success-kicker">Création confirmée</div>
                <h2>Accès enregistré.</h2>
                <p>Le profil est disponible dans la liste locale, sans rechargement.</p>
                <div className="summary-grid"><div><span>Nom</span><strong>{successSummary.full_name}</strong></div><div><span>MSISDN</span><CopyablePhone value={successSummary.phone}>{successSummary.phone}</CopyablePhone></div><div><span>Rôle</span><strong>{ROLE_LABELS[successSummary.role]}</strong></div><div><span>Campagne</span><strong>{categoryShortLabel(successSummary.user_category)}</strong></div></div>
              </section>
            )}

            <section className="side-card activity-card">
              <div className="activity-heading"><div><div className="card-kicker"><UsersRound size={15} /> Activité locale</div><h2>Derniers accès</h2></div><span className="activity-count">{recentUsers.length}</span></div>
              <div className="activity-list">
                {recentUsers.slice(0, 3).map((user) => <div className="activity-item" key={user.id}><div className="avatar small">{user.full_name.slice(0, 1).toUpperCase()}</div><div><strong>{user.full_name}</strong><CopyablePhone value={user.phone}>{user.phone}</CopyablePhone></div><UserRoleBadge role={user.role} /></div>)}
              </div>
              <div className="activity-footer"><span><span className={`tiny-dot ${isSupabaseConfigured() ? "live" : ""}`} />{isSupabaseConfigured() ? "Synchronisé avec Supabase" : "Données simulées uniquement"}</span><CircleHelp size={14} /></div>
            </section>
          </aside>
        </div>
      </main>

      <footer className="app-credit">Design · Eldorado_design</footer>

      {toast && <div className={`toast toast-${toast.kind}`} role="status"><div className="toast-icon">{toast.kind === "success" ? <CheckCircle2 size={17} /> : toast.kind === "info" ? <Info size={17} /> : <AlertCircle size={17} />}</div><div><strong>{toast.title}</strong><span>{toast.message}</span></div>{toast.action && <button type="button" onClick={toast.action}><RefreshCw size={14} /> Réessayer</button>}<button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="Fermer"><X size={15} /></button></div>}
    </div>
  );
}

export default Home;
