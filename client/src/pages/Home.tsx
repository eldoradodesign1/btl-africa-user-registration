import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import {
  ROLE_LABELS,
  ROLE_OPTIONS,
  buildUserPayload,
  categoryShortLabel,
  defaultPasswordForRole,
  shouldShowShop,
} from "@/lib/user-form";
import { resizeImage } from "@/lib/image";
import { formatPhoneForDisplay, isValidMpesa, isValidMsisdn, normalizePhone, phoneValidationMessage } from "@/lib/phone";
import {
  findExistingUser,
  insertUser,
  isSupabaseConfigured,
  isUniquePhoneError,
  loadShops,
  loadSupervisors,
  type ShopRecord,
  type UserCategory,
  type UserRecord,
  type UserRole,
} from "@/lib/supabase";
import { CopyablePhone } from "@/components/CopyablePhone";
import BrandLogo from "@/components/BrandLogo";
import AddressFields, { addressLabel, EMPTY_ADDRESS_DRAFT, type AddressDraft } from "@/components/AddressFields";
import { BirthDateField } from "@/components/DateTimeFields";

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
  mpesaPhone: string;
  mpesaSameAsPhone: boolean;
  dateOfBirth: string;
  addressDetails: AddressDraft;
  avatarUrl: string | null;
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
  mpesaPhone: "",
  mpesaSameAsPhone: true,
  dateOfBirth: "",
  addressDetails: { ...EMPTY_ADDRESS_DRAFT },
  avatarUrl: null,
  role: "agent",
  category: "hostess",
  supervisorId: "",
  useDefaultPassword: true,
  password: "",
  permanentShopId: "",
};

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

function CategoryChoice({ value, onChange }: { value: UserCategory; onChange: (value: UserCategory) => void }) {
  const isHostess = value === "hostess" || value === "hostess_polyvalent";
  const isPolyvalent = value === "hostess_polyvalent";
  const isAmbassador = value === "brand_ambassador";

  return (
    <fieldset className="category-choice category-choice--compact">
      <legend>Catégorie utilisateur <span aria-hidden="true">*</span></legend>
      <div className="category-choice-grid" role="group" aria-label="Catégorie de l’agent">
        <div className="category-choice-top-row">
          <button
            type="button"
            aria-pressed={isHostess}
            className={`category-choice-option ${isHostess ? "is-selected" : ""}`}
            onClick={() => onChange("hostess")}
          >
            <span className="category-choice-mark category-choice-mark--round" aria-hidden="true">{isHostess ? <Check size={12} /> : null}</span>
            <span className="category-choice-copy"><strong>Hôtesse</strong></span>
          </button>
          <label className="category-choice-polyvalent" title="Hôtesse polyvalente : campagnes Hôtesses, BA et Events">
            <input
              type="checkbox"
              checked={isPolyvalent}
              onChange={(event) => onChange(event.target.checked ? "hostess_polyvalent" : "hostess")}
              aria-label="Hôtesse polyvalente"
            />
            <span className="category-choice-polyvalent-check" aria-hidden="true">{isPolyvalent && <Check size={12} />}</span>
            <span>Polyv.</span>
          </label>
        </div>
        <button
          type="button"
          aria-pressed={isAmbassador}
          className={`category-choice-option ${isAmbassador ? "is-selected" : ""}`}
          onClick={() => onChange("brand_ambassador")}
        >
          <span className="category-choice-mark category-choice-mark--round" aria-hidden="true">{isAmbassador ? <Check size={12} /> : null}</span>
          <span className="category-choice-copy"><strong>Brand Ambassador</strong></span>
        </button>
      </div>
    </fieldset>
  );
}

function CustomOptionSelect({ label, value, options, onChange, helper, disabled = false, ariaLabel }: { label?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; helper?: string; disabled?: boolean; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label || options[0]?.label || "Sélectionner";
  return <div className="field select-field">
    {(label || helper) && <div className="field-label-row">{label && <label>{label}</label>}{helper && <span className="field-helper">{helper}</span>}</div>}
    <button type="button" className={`select-trigger ${open ? "is-open" : ""}`} aria-label={ariaLabel || label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((state) => !state)}><span>{current}</span><ChevronDown size={16} strokeWidth={2.5} /></button>
    {open && <div className="select-menu" role="listbox">{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={`select-option ${option.value === value ? "is-selected" : ""}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check size={15} />}</button>)}</div>}
  </div>;
}

function Home({ onUserCreated, onNavigateDashboard, agentsOnly = false }: { onUserCreated?: (user: UserRecord) => void; onNavigateDashboard?: () => void; agentsOnly?: boolean }) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [supervisors, setSupervisors] = useState<UserRecord[]>([]);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [recentUsers, setRecentUsers] = useState<UserRecord[]>([]);
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
  // Le numéro de connexion est le WhatsApp ; « même numéro pour M-Pesa » exige un numéro en 08.
  const mpesaEligible = isValidMpesa(form.phone);
  const mpesaSame = form.mpesaSameAsPhone && mpesaEligible;
  const showShop = shouldShowShop(form.role, form.category);

  const supervisorOptions = useMemo(
    () => supervisors.filter((user) => ["supervisor", "admin", "sub_admin", "super_admin"].includes(user.role)),
    [supervisors],
  );
  const shopOptions = useMemo(
    () => [{ value: "", label: "Aucun shop" }, ...shops.map((shop) => ({ value: shop.id, label: shop.name }))],
    [shops],
  );

  useEffect(() => {
    let active = true;
    setLoadingSupervisors(true);
    Promise.all([loadSupervisors(), loadShops().catch(() => [])])
      .then(([users, loadedShops]) => {
        if (active) {
          setSupervisors(users);
          setShops(loadedShops);
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
    const normalizedMpesaPhone = mpesaSame ? normalizedPhone : form.mpesaPhone.trim() ? normalizePhone(form.mpesaPhone) : null;
    if (!trimmedName) {
      setToast({ kind: "error", title: "Nom requis", message: "Le nom complet est obligatoire." });
      return;
    }
    if (trimmedName.length < 2 || !isPhoneValid) {
      setToast({ kind: "error", title: "Vérifiez les champs", message: "Corrigez les champs signalés avant de continuer." });
      return;
    }
    if (normalizedMpesaPhone && !isValidMpesa(normalizedMpesaPhone)) {
      setToast({ kind: "error", title: "M-Pesa invalide", message: "Un numéro M-Pesa commence par 08. Laissez le champ vide s’il n’est pas connu." });
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

      const creationRole = agentsOnly ? "agent" : form.role;
      const payload = buildUserPayload({
        id: crypto.randomUUID(),
        fullName: trimmedName,
        phone: normalizedPhone,
        whatsappPhone: normalizedPhone,
        whatsappSameAsPhone: true,
        mpesaPhone: normalizedMpesaPhone,
        dateOfBirth: form.dateOfBirth || null,
        address: addressLabel(form.addressDetails),
        addressProvince: form.addressDetails.provinceName || null,
        addressCommune: form.addressDetails.commune || null,
        addressQuartier: form.addressDetails.quartier || null,
        addressAvenue: form.addressDetails.avenue || null,
        addressNumber: form.addressDetails.number || null,
        addressLatitude: form.addressDetails.latitude,
        addressLongitude: form.addressDetails.longitude,
        avatarUrl: form.avatarUrl,
        password: form.useDefaultPassword ? defaultPasswordForRole(creationRole) : form.password,
        role: creationRole,
        category: creationRole === "agent" ? form.category : "operations",
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
        setToast({ kind: "error", title: "Numéro déjà utilisé", message: "Ce numéro vient d’être utilisé pour un autre compte. Aucun utilisateur n’a été écrasé." });
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
        {!isSupabaseConfigured() && <div className="environment-chip is-demo"><span className="environment-dot" />Connexion requise</div>}
        {onNavigateDashboard && <button type="button" className="nav-action" onClick={onNavigateDashboard}><ServerCog size={14} /> Tableau de bord</button>}
        </div>
      </header>

      <main className="page-content">
        <section className="page-intro">
          <div>
            <h1>{agentsOnly ? "Nouvel agent" : "Nouvel utilisateur"}<span>.</span></h1>
          </div>
        </section>

        <div className="workspace-grid">
          <form className="form-card glass-card" onSubmit={handleSubmit}>
            <div className="section-block">
              <div className="section-title"><span>01</span><div><h3>Identité</h3></div></div>
              <div className="field-grid two-columns">
                <div className="field">
                  <label htmlFor="fullName">Nom complet <b>*</b></label>
                  <div className={`input-wrap ${fullNameError ? "has-error" : form.fullName.trim().length >= 2 ? "is-valid" : ""}`}>
                    <UsersRound size={17} />
                    <input id="fullName" value={form.fullName} onChange={(event) => updateForm("fullName", event.target.value)} placeholder="Ex. Grâce Mbuyi" autoComplete="name" />
                    {form.fullName.trim().length >= 2 && <CheckCircle2 className="input-state-icon" size={16} />}
                  </div>
                  {fullNameError && <span className="field-error"><AlertCircle size={13} />{fullNameError}</span>}
                </div>
                <div className="field phone-field">
                  <div className="field-label-row"><label htmlFor="phone">Numéro WhatsApp <b>*</b></label><span className="field-helper">Sert à se connecter</span></div>
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
                </div>
              </div>
              <label className={`password-toggle signup-whatsapp-toggle${mpesaEligible ? "" : " is-disabled"}`}><input type="checkbox" checked={mpesaSame} disabled={!mpesaEligible} onChange={(event) => updateForm("mpesaSameAsPhone", event.target.checked)} /><span className="toggle-visual"><Check size={13} /></span><span><strong>Même numéro pour M-Pesa</strong><small>{isPhoneValid && !mpesaEligible ? "M-Pesa : numéro en 08 uniquement" : "Le WhatsApp sert aussi au M-Pesa"}</small></span></label>
              {isPhoneValid && !mpesaSame && <div className="field-grid two-columns"><div className="field"><label htmlFor="mpesaPhone">Numéro M-Pesa <span className="optional-label">facultatif</span></label><input id="mpesaPhone" value={form.mpesaPhone} onChange={(event) => updateForm("mpesaPhone", event.target.value)} placeholder="081 234 5678" type="tel" inputMode="tel" autoComplete="off" /></div></div>}
              <div className="field-grid two-columns profile-extra-fields"><div className="field"><label htmlFor="dateOfBirth">Date de naissance <span className="optional-label">facultatif</span></label><BirthDateField id="dateOfBirth" ariaLabel="Date de naissance" value={form.dateOfBirth} onChange={(value) => updateForm("dateOfBirth", value)} /></div></div>
              <AddressFields value={form.addressDetails} onChange={(addressDetails) => updateForm("addressDetails", addressDetails)} />
              <div className="profile-photo-category-row">
                <div className="field profile-photo-field">
                  <label htmlFor="profilePhoto" className="profile-photo-caption">Photo de profil</label>
                  <label className={`file-input-control profile-photo-tile ${form.avatarUrl ? "has-photo" : ""}`}>
                    {form.avatarUrl ? <img src={form.avatarUrl} alt="Aperçu de la photo sélectionnée" className="profile-photo-preview" /> : <><ImagePlus size={16} /><span>Choisir une photo</span></>}
                    <input id="profilePhoto" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (!file.type.startsWith("image/")) { setToast({ kind: "error", title: "Photo invalide", message: "Choisissez une image." }); return; } void resizeImage(file).then((url) => updateForm("avatarUrl", url)).catch(() => setToast({ kind: "error", title: "Photo invalide", message: "Cette image n’a pas pu être lue." })); }} />
                  </label>
                </div>
                {form.role === "agent" && <CategoryChoice value={form.category} onChange={(value) => setForm((current) => ({ ...current, category: value, permanentShopId: value === "hostess" ? current.permanentShopId : "" }))} />}
              </div>
            </div>

            <div className="section-block role-block">
              <div className="section-title"><span>02</span><div><h3>Rôle & rattachement</h3></div></div>
              <div className="field-grid two-columns">
                {agentsOnly ? <div className="field select-field"><div className="field-label-row"><label>Rôle</label></div><div className="role-fixed-value"><span className="role-badge role-agent">Agent</span></div></div> : <CustomSelect label="Rôle" value={form.role} options={ROLE_OPTIONS} labels={ROLE_LABELS} onChange={handleRoleChange} />}
                <div>
                  <CustomOptionSelect label="Superviseur" value={form.supervisorId} options={[{ value: "", label: "Aucun rattachement" }, ...supervisorOptions.map((user) => ({ value: user.id, label: user.full_name }))]} onChange={(value) => updateForm("supervisorId", value)} helper="facultatif" disabled={loadingSupervisors || supervisorError} />
                  {supervisorError && <span className="field-error"><AlertCircle size={13} />Impossible de charger les superviseurs.</span>}
                </div>
              </div>
              {showShop && (
                <div className="shop-row">
                  <div className="shop-copy"><strong>Shop permanent</strong></div>
                  <CustomOptionSelect ariaLabel="Point de rattachement" value={form.permanentShopId} options={shopOptions} onChange={(value) => updateForm("permanentShopId", value)} />
                </div>
              )}
            </div>

            <div className="section-block security-block">
              <div className="section-title"><span>03</span><div><h3>Mot de passe</h3></div></div>
              <label className="password-toggle">
                <input type="checkbox" checked={form.useDefaultPassword} onChange={(event) => updateForm("useDefaultPassword", event.target.checked)} />
                <span className="toggle-visual"><Check size={13} /></span>
                <span><strong>Mot de passe par défaut</strong><small><code>{defaultPasswordForRole(form.role)}</code>, modifiable ensuite</small></span>
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
            </div>

            <div className="form-actions">
              <button type="button" className="button secondary" onClick={resetForm}><RefreshCw size={16} /> Réinitialiser</button>
              <button type="submit" className="button primary" disabled={!canSubmit}>
                {submitting ? <><LoaderCircle className="spin" size={17} /> Création…</> : <>{agentsOnly ? "Créer l’agent" : "Créer l’utilisateur"} <ArrowRight size={17} /></>}
              </button>
            </div>
          </form>

          <aside className="side-column">
            {existingUser && (
              <section className="duplicate-card side-card">
                <div className="alert-topline"><div className="alert-icon"><X size={17} /></div></div>
                <h2>Ce numéro est déjà utilisé.</h2>
                <div className="existing-user">
                  <div className="avatar">{existingUser.full_name.slice(0, 1).toUpperCase()}</div>
                  <div><strong>{existingUser.full_name}</strong><CopyablePhone value={existingUser.phone}>{formatPhoneForDisplay(existingUser.phone)}</CopyablePhone></div>
                  <UserRoleBadge role={existingUser.role} />
                </div>
                <div className="existing-meta"><span>Catégorie</span><strong>{categoryShortLabel(existingUser.user_category)}</strong></div>
                <div className="alert-actions"><button type="button" className="button secondary compact" onClick={() => updateForm("phone", "")}><RefreshCw size={14} /> Corriger le numéro</button></div>
              </section>
            )}

            {successSummary && (
              <section className="success-card side-card">
                <div className="success-icon"><CheckCircle2 size={20} /></div>
                <h2>Compte créé.</h2>
                <div className="summary-grid"><div><span>Nom</span><strong>{successSummary.full_name}</strong></div><div><span>WhatsApp</span><CopyablePhone value={successSummary.phone}>{successSummary.phone}</CopyablePhone></div><div><span>Rôle</span><strong>{ROLE_LABELS[successSummary.role]}</strong></div><div><span>Catégorie</span><strong>{categoryShortLabel(successSummary.user_category)}</strong></div></div>
              </section>
            )}

            <section className="side-card activity-card">
              <div className="activity-heading"><div><h2>Derniers comptes créés</h2></div><span className="activity-count">{recentUsers.length}</span></div>
              <div className="activity-list">
                {recentUsers.slice(0, 3).map((user) => <div className="activity-item" key={user.id}><div className="avatar small">{user.full_name.slice(0, 1).toUpperCase()}</div><div><strong>{user.full_name}</strong><CopyablePhone value={user.phone}>{user.phone}</CopyablePhone></div><UserRoleBadge role={user.role} /></div>)}
              </div>
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
