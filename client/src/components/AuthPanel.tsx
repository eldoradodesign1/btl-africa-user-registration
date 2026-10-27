import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, Eye, EyeOff, LoaderCircle, LogIn, UserCheck, X } from "lucide-react";
import AddressFields, { EMPTY_ADDRESS_DRAFT, type AddressDraft } from "@/components/AddressFields";
import { BirthDateField } from "@/components/DateTimeFields";
import { CategoryPicker, PhotoPicker, Switch } from "@/components/FormControls";
import { resizeImage } from "@/lib/image";
import { isValidMpesa, isValidMsisdn, normalizePhone } from "@/lib/phone";
import type { UserCategory } from "@/lib/supabase";

/** Le numéro principal (phone) est le numéro WhatsApp : c'est lui qui sert à se connecter. */
export type SignupForm = {
  fullName: string;
  phone: string;
  mpesaSameAsPhone: boolean;
  mpesaPhone: string;
  dateOfBirth: string;
  addressDetails: AddressDraft;
  avatarUrl: string | null;
  useDefaultPassword: boolean;
  password: string;
  confirmPassword: string;
  category: UserCategory;
};

export const INITIAL_SIGNUP: SignupForm = { fullName: "", phone: "", mpesaSameAsPhone: true, mpesaPhone: "", dateOfBirth: "", addressDetails: { ...EMPTY_ADDRESS_DRAFT }, avatarUrl: null, useDefaultPassword: true, password: "", confirmPassword: "", category: "hostess" };

/** « Même numéro pour M-Pesa » n'est possible que si le WhatsApp est un numéro en 08. */
export function signupMpesaPhone(form: SignupForm): string | null {
  if (form.mpesaSameAsPhone && isValidMpesa(form.phone)) return normalizePhone(form.phone);
  return form.mpesaPhone.trim() ? normalizePhone(form.mpesaPhone) : null;
}

type Mode = "signin" | "signup";
type Notice = { kind: "error" | "success"; message: string } | null;
type ErrorKey = "loginPhone" | "loginPassword" | "fullName" | "phone" | "mpesaPhone" | "dateOfBirth" | "photo" | "password" | "confirmPassword";
type Errors = Partial<Record<ErrorKey, string>>;

type Props = {
  loading: boolean;
  notice: Notice;
  onDismissNotice: () => void;
  onLogin: (phone: string, password: string) => Promise<void>;
  onSignup: (form: SignupForm) => Promise<boolean>;
};

const PHONE_PLACEHOLDER = "081 234 5678";

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}

function Field({ id, label, optional, hint, error, children }: { id: string; label: string; optional?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return <div className={`auth-field${error ? " has-error" : ""}`}>
    <label htmlFor={id}>{label}{optional && <span className="auth-opt"> (facultatif)</span>}</label>
    {children}
    {hint && !error && <p id={`${id}-hint`} className="auth-hint">{hint}</p>}
    {error && <p id={`${id}-error`} className="auth-error"><AlertCircle size={14} aria-hidden="true" />{error}</p>}
  </div>;
}

function PasswordInput({ id, value, onChange, autoComplete, error }: { id: string; value: string; onChange: (value: string) => void; autoComplete: string; error?: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-input-wrap">
    <input id={id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} required aria-invalid={Boolean(error)} aria-describedby={describedBy(id, undefined, error)} />
    <button type="button" className="auth-eye" onClick={() => setVisible((state) => !state)} aria-pressed={visible} aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
  </div>;
}

export default function AuthPanel({ loading, notice, onDismissNotice, onLogin, onSignup }: Props) {
  const uid = useId();
  const [mode, setMode] = useState<Mode>("signin");
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [form, setForm] = useState<SignupForm>(INITIAL_SIGNUP);
  const [errors, setErrors] = useState<Errors>({});
  const [success, setSuccess] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ signin: null, signup: null });
  const successRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const loginRef = useRef<HTMLFormElement>(null);

  useEffect(() => { if (success) successRef.current?.focus(); }, [success]);

  function switchMode(next: Mode, focusTab = false) {
    setMode(next);
    setErrors({});
    setSuccess(false);
    onDismissNotice();
    if (focusTab) requestAnimationFrame(() => tabRefs.current[next]?.focus());
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next: Mode = event.key === "Home" ? "signin" : event.key === "End" ? "signup" : mode === "signin" ? "signup" : "signin";
      switchMode(next, true);
    }
  }

  function clearError(key: ErrorKey) {
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function update<K extends keyof SignupForm>(key: K, value: SignupForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "useDefaultPassword") { clearError("password"); clearError("confirmPassword"); }
    else if (key === "mpesaSameAsPhone") clearError("mpesaPhone");
    else if (key in errors) clearError(key as ErrorKey);
  }

  function focusFirstError(root: HTMLFormElement | null, next: Errors) {
    const first = Object.keys(next)[0];
    if (!first || !root) return;
    requestAnimationFrame(() => root.querySelector<HTMLElement>(`[data-field="${first}"] input, #${CSS.escape(`${uid}-${first}`)}`)?.focus());
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const next: Errors = {};
    if (!isValidMsisdn(normalizePhone(loginPhone))) next.loginPhone = loginPhone.trim() ? "Ce numéro n’est pas valide." : "Saisissez votre numéro WhatsApp.";
    if (!loginPassword) next.loginPassword = "Saisissez votre mot de passe.";
    setErrors(next);
    if (Object.keys(next).length) { focusFirstError(loginRef.current, next); return; }
    onDismissNotice();
    await onLogin(loginPhone, loginPassword);
  }

  const phoneValid = isValidMsisdn(normalizePhone(form.phone));
  const mpesaEligible = isValidMpesa(form.phone);
  const mpesaSame = form.mpesaSameAsPhone && mpesaEligible;
  const showMpesaField = phoneValid && !mpesaSame;

  async function submitSignup(event: FormEvent) {
    event.preventDefault();
    if (loading || photoBusy) return;
    const next: Errors = {};
    if (form.fullName.trim().length < 2) next.fullName = "Saisissez votre nom complet.";
    if (!phoneValid) next.phone = form.phone.trim() ? "Ce numéro n’est pas valide." : "Saisissez votre numéro WhatsApp.";
    if (showMpesaField && form.mpesaPhone.trim() && !isValidMpesa(form.mpesaPhone)) next.mpesaPhone = "Un numéro M-Pesa commence par 08.";
    const dob = formRef.current?.querySelector<HTMLInputElement>(`#${CSS.escape(`${uid}-dateOfBirth`)}`);
    if (dob && dob.value.trim() && !dob.validity.valid) next.dateOfBirth = "Date invalide (JJ/MM/AAAA).";
    if (!form.useDefaultPassword) {
      if (form.password.length < 6) next.password = "Au moins 6 caractères.";
      else if (form.password !== form.confirmPassword) next.confirmPassword = "Les deux mots de passe ne correspondent pas.";
    }
    setErrors(next);
    if (Object.keys(next).length) { focusFirstError(formRef.current, next); return; }
    onDismissNotice();
    if (await onSignup(form)) { setForm(INITIAL_SIGNUP); setSuccess(true); }
  }

  async function pickPhoto(file: File) {
    if (!file.type.startsWith("image/")) { setErrors((current) => ({ ...current, photo: "Choisissez une image." })); return; }
    setPhotoBusy(true);
    try {
      update("avatarUrl", await resizeImage(file));
      clearError("photo");
    } catch {
      setErrors((current) => ({ ...current, photo: "Image illisible, essayez une autre photo." }));
    } finally {
      setPhotoBusy(false);
    }
  }

  const id = (name: string) => `${uid}-${name}`;
  const errorCount = Object.keys(errors).length;

  return <section className="auth-screen" aria-labelledby={id("title")}>
    <div className="auth-stage">
      <span className="auth-orb auth-orb-a" aria-hidden="true" />
      <span className="auth-orb auth-orb-b" aria-hidden="true" />
      <div className="auth-card">
        <header className="auth-head">
          <p className="auth-eyebrow">Beyond The Line · BTL Africa</p>
          <h1 id={id("title")}>{mode === "signin" ? "Connexion" : "Créer un compte"}</h1>
          <p className="auth-sub">{mode === "signin" ? "Avec votre numéro WhatsApp." : "Activé après validation par l’équipe."}</p>
        </header>

        <div className="auth-seg" role="tablist" aria-label="Connexion ou création de compte">
          {(["signin", "signup"] as Mode[]).map((value) => <button key={value} ref={(node) => { tabRefs.current[value] = node; }} id={id(`tab-${value}`)} type="button" role="tab" aria-selected={mode === value} aria-controls={id(`panel-${value}`)} tabIndex={mode === value ? 0 : -1} className={mode === value ? "is-active" : ""} onClick={() => switchMode(value)} onKeyDown={onTabKey}>{value === "signin" ? "Se connecter" : "Créer un compte"}</button>)}
        </div>

        <div aria-live="polite" className="auth-live">{notice && <div className={`auth-notice is-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}<span>{notice.message}</span><button type="button" onClick={onDismissNotice} aria-label="Fermer le message"><X size={16} aria-hidden="true" /></button></div>}</div>

        {mode === "signin" ? <div id={id("panel-signin")} role="tabpanel" aria-labelledby={id("tab-signin")}><form ref={loginRef} className="auth-form" noValidate onSubmit={submitLogin}>
          <div data-field="loginPhone"><Field id={id("loginPhone")} label="Numéro WhatsApp" error={errors.loginPhone}>
            <input id={id("loginPhone")} type="tel" inputMode="tel" autoComplete="username" placeholder={PHONE_PLACEHOLDER} value={loginPhone} onChange={(event) => { setLoginPhone(event.target.value); clearError("loginPhone"); }} required aria-invalid={Boolean(errors.loginPhone)} aria-describedby={describedBy(id("loginPhone"), undefined, errors.loginPhone)} />
          </Field></div>
          <div data-field="loginPassword"><Field id={id("loginPassword")} label="Mot de passe" error={errors.loginPassword}>
            <PasswordInput id={id("loginPassword")} value={loginPassword} onChange={(value) => { setLoginPassword(value); clearError("loginPassword"); }} autoComplete="current-password" error={errors.loginPassword} />
          </Field></div>
          <button className="auth-cta" type="submit" aria-busy={loading} aria-disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <LogIn size={18} aria-hidden="true" />}{loading ? "Connexion…" : "Se connecter"}</button>
          <p className="auth-switch-line">Pas encore de compte ? <button type="button" className="auth-link" onClick={() => switchMode("signup", true)}>Créer un compte</button></p>
        </form></div> : <div id={id("panel-signup")} role="tabpanel" aria-labelledby={id("tab-signup")}><form ref={formRef} className="auth-form" noValidate onSubmit={submitSignup}>
          {success ? <div ref={successRef} tabIndex={-1} className="auth-success" role="status">
            <span className="auth-success-icon" aria-hidden="true"><Clock3 size={24} /></span>
            <h2>Demande envoyée</h2>
            <p>Vous pourrez vous connecter dès que l’équipe aura validé votre compte.</p>
            <button type="button" className="auth-cta" onClick={() => switchMode("signin", true)}>Retour à la connexion</button>
          </div> : <>
            <fieldset className="auth-group">
              <legend>Identité</legend>
              <div data-field="fullName"><Field id={id("fullName")} label="Nom complet" error={errors.fullName}>
                <input id={id("fullName")} value={form.fullName} onChange={(event) => update("fullName", event.target.value)} placeholder="Ex. Grâce Mbuyi" autoComplete="name" autoCapitalize="words" required aria-invalid={Boolean(errors.fullName)} aria-describedby={describedBy(id("fullName"), undefined, errors.fullName)} />
              </Field></div>
              <div className="auth-profile-row">
                <PhotoPicker id={id("photo")} value={form.avatarUrl} busy={photoBusy} error={errors.photo} onPick={(file) => void pickPhoto(file)} onRemove={() => update("avatarUrl", null)} />
                <CategoryPicker name={id("category")} value={form.category} onChange={(category) => update("category", category)} />
              </div>
              <div data-field="dateOfBirth"><Field id={id("dateOfBirth")} label="Date de naissance" optional error={errors.dateOfBirth}>
                <BirthDateField id={id("dateOfBirth")} ariaLabel="Date de naissance" value={form.dateOfBirth} invalid={Boolean(errors.dateOfBirth)} describedBy={describedBy(id("dateOfBirth"), undefined, errors.dateOfBirth)} onChange={(value) => update("dateOfBirth", value)} />
              </Field></div>
            </fieldset>

            <fieldset className="auth-group">
              <legend>Contact</legend>
              <div data-field="phone"><Field id={id("phone")} label="Numéro WhatsApp" hint="Il vous servira à vous connecter." error={errors.phone}>
                <input id={id("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder={PHONE_PLACEHOLDER} value={form.phone} onChange={(event) => update("phone", event.target.value)} required aria-invalid={Boolean(errors.phone)} aria-describedby={describedBy(id("phone"), errors.phone ? undefined : "hint", errors.phone)} />
              </Field></div>
              <Switch checked={mpesaSame} disabled={!mpesaEligible} onChange={(checked) => update("mpesaSameAsPhone", checked)} title="Même numéro pour M-Pesa" detail={phoneValid && !mpesaEligible ? "M-Pesa : numéro en 08 uniquement." : undefined} detailId={id("mpesa-why")} />
              {showMpesaField && <div data-field="mpesaPhone"><Field id={id("mpesaPhone")} label="M-Pesa" optional error={errors.mpesaPhone}>
                <input id={id("mpesaPhone")} type="tel" inputMode="tel" autoComplete="off" placeholder={PHONE_PLACEHOLDER} value={form.mpesaPhone} onChange={(event) => update("mpesaPhone", event.target.value)} aria-invalid={Boolean(errors.mpesaPhone)} aria-describedby={describedBy(id("mpesaPhone"), undefined, errors.mpesaPhone)} />
              </Field></div>}
            </fieldset>

            <fieldset className="auth-group auth-group-address">
              <legend>Adresse <span className="auth-opt">(facultatif)</span></legend>
              <AddressFields value={form.addressDetails} onChange={(addressDetails) => update("addressDetails", addressDetails)} />
            </fieldset>

            <fieldset className="auth-group">
              <legend>Mot de passe</legend>
              <Switch checked={form.useDefaultPassword} onChange={(checked) => { update("useDefaultPassword", checked); setForm((current) => ({ ...current, password: "", confirmPassword: "" })); }} title="Mot de passe par défaut" detail={<><code>password</code>, modifiable dans votre profil</>} />
              {!form.useDefaultPassword && <>
                <div data-field="password"><Field id={id("password")} label="Mot de passe" hint="6 caractères minimum." error={errors.password}>
                  <PasswordInput id={id("password")} value={form.password} onChange={(value) => update("password", value)} autoComplete="new-password" error={errors.password} />
                </Field></div>
                <div data-field="confirmPassword"><Field id={id("confirmPassword")} label="Confirmer" error={errors.confirmPassword}>
                  <PasswordInput id={id("confirmPassword")} value={form.confirmPassword} onChange={(value) => update("confirmPassword", value)} autoComplete="new-password" error={errors.confirmPassword} />
                </Field></div>
              </>}
            </fieldset>

            {errorCount > 0 && <p className="auth-summary" role="alert"><AlertCircle size={16} aria-hidden="true" />{errorCount === 1 ? "Un champ est à corriger." : `${errorCount} champs sont à corriger.`}</p>}
            <button className="auth-cta" type="submit" aria-busy={loading} aria-disabled={loading || photoBusy}>{loading ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <UserCheck size={18} aria-hidden="true" />}{loading ? "Envoi…" : "Envoyer la demande"}</button>
          </>}
        </form></div>}
      </div>
    </div>
  </section>;
}
