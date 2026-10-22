import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, Eye, EyeOff, ImagePlus, LoaderCircle, LogIn, UserCheck, X } from "lucide-react";
import AddressFields, { EMPTY_ADDRESS_DRAFT, type AddressDraft } from "@/components/AddressFields";
import { DatePickerField } from "@/components/DateTimeFields";
import { isValidMsisdn, normalizePhone } from "@/lib/phone";
import { CATEGORY_LABELS } from "@/lib/user-form";
import type { UserCategory } from "@/lib/supabase";

export type SignupForm = {
  fullName: string;
  phone: string;
  whatsappPhone: string;
  whatsappSameAsPhone: boolean;
  dateOfBirth: string;
  addressDetails: AddressDraft;
  avatarUrl: string | null;
  useDefaultPassword: boolean;
  password: string;
  confirmPassword: string;
  category: UserCategory;
};

export const INITIAL_SIGNUP: SignupForm = { fullName: "", phone: "", whatsappPhone: "", whatsappSameAsPhone: true, dateOfBirth: "", addressDetails: { ...EMPTY_ADDRESS_DRAFT }, avatarUrl: null, useDefaultPassword: true, password: "", confirmPassword: "", category: "hostess" };

/** Catégories proposées à l'inscription : uniquement les catégories agent (« operations » est technique). */
const SIGNUP_CATEGORIES: UserCategory[] = ["hostess", "hostess_polyvalent", "brand_ambassador"];

type Mode = "signin" | "signup";
type Notice = { kind: "error" | "success"; message: string } | null;
type Errors = Partial<Record<"loginPhone" | "loginPassword" | "fullName" | "phone" | "whatsappPhone" | "dateOfBirth" | "photo" | "password" | "confirmPassword", string>>;

type Props = {
  loading: boolean;
  notice: Notice;
  onDismissNotice: () => void;
  onLogin: (phone: string, password: string) => Promise<void>;
  onSignup: (form: SignupForm) => Promise<boolean>;
};

const PHONE_HINT = "10 chiffres commençant par 08 ou 09, ou au format +243.";

/** Réduit la photo côté appareil (max 640 px, JPEG) : les photos de téléphone passent sans limite de poids. */
async function resizeImage(file: File, max = 640): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}

function Field({ id, label, required, hint, error, children }: { id: string; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return <div className={`auth-field${error ? " has-error" : ""}`}>
    <label htmlFor={id}>{label}{required ? <span className="auth-req" aria-hidden="true"> *</span> : <span className="auth-opt"> (facultatif)</span>}</label>
    {children}
    {hint && <p id={`${id}-hint`} className="auth-hint">{hint}</p>}
    {error && <p id={`${id}-error`} className="auth-error"><AlertCircle size={14} aria-hidden="true" />{error}</p>}
  </div>;
}

function PasswordInput({ id, value, onChange, autoComplete, error, hint, required = true }: { id: string; value: string; onChange: (value: string) => void; autoComplete: string; error?: string; hint?: string; required?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-input-wrap">
    <input id={id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} required={required} aria-required={required} aria-invalid={Boolean(error)} aria-describedby={describedBy(id, hint, error)} />
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

  function update<K extends keyof SignupForm>(key: K, value: SignupForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    const errorKey = key === "useDefaultPassword" ? "password" : key === "whatsappSameAsPhone" ? "whatsappPhone" : key;
    if (errorKey in errors) setErrors((current) => { const next = { ...current }; delete next[errorKey as keyof Errors]; return next; });
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
    if (!isValidMsisdn(normalizePhone(loginPhone))) next.loginPhone = loginPhone.trim() ? "Ce numéro n’est pas valide." : "Saisissez votre numéro de téléphone.";
    if (!loginPassword) next.loginPassword = "Saisissez votre mot de passe.";
    setErrors(next);
    if (Object.keys(next).length) { focusFirstError(loginRef.current, next); return; }
    onDismissNotice();
    await onLogin(loginPhone, loginPassword);
  }

  async function submitSignup(event: FormEvent) {
    event.preventDefault();
    if (loading || photoBusy) return;
    const next: Errors = {};
    if (form.fullName.trim().length < 2) next.fullName = "Saisissez votre nom complet.";
    if (!isValidMsisdn(normalizePhone(form.phone))) next.phone = form.phone.trim() ? "Ce numéro n’est pas valide." : "Saisissez votre numéro M-Pesa.";
    if (!form.whatsappSameAsPhone && !isValidMsisdn(normalizePhone(form.whatsappPhone))) next.whatsappPhone = form.whatsappPhone.trim() ? "Ce numéro WhatsApp n’est pas valide." : "Saisissez votre numéro WhatsApp.";
    const dob = formRef.current?.querySelector<HTMLInputElement>(`#${CSS.escape(`${uid}-dateOfBirth`)}`);
    if (dob && dob.value.trim() && !dob.validity.valid) next.dateOfBirth = "Saisissez une date valide au format JJ/MM/AAAA.";
    if (!form.useDefaultPassword) {
      if (form.password.length < 6) next.password = "Au moins 6 caractères.";
      else if (form.password !== form.confirmPassword) next.confirmPassword = "Les deux mots de passe ne correspondent pas.";
    }
    setErrors(next);
    if (Object.keys(next).length) { focusFirstError(formRef.current, next); return; }
    onDismissNotice();
    if (await onSignup(form)) { setForm(INITIAL_SIGNUP); setSuccess(true); }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErrors((current) => ({ ...current, photo: "Choisissez une image (JPEG, PNG ou WebP)." })); return; }
    setPhotoBusy(true);
    try {
      update("avatarUrl", await resizeImage(file));
      setErrors((current) => { const next = { ...current }; delete next.photo; return next; });
    } catch {
      setErrors((current) => ({ ...current, photo: "Cette image n’a pas pu être lue. Essayez une autre photo." }));
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
          <h1 id={id("title")}>{mode === "signin" ? "Connexion" : "Créer un compte agent"}</h1>
          <p className="auth-sub">{mode === "signin" ? "Connectez-vous avec votre numéro et votre mot de passe." : "Votre demande sera validée par l’équipe avant l’accès."}</p>
        </header>

        <div className="auth-seg" role="tablist" aria-label="Connexion ou création de compte">
          {(["signin", "signup"] as Mode[]).map((value) => <button key={value} ref={(node) => { tabRefs.current[value] = node; }} id={id(`tab-${value}`)} type="button" role="tab" aria-selected={mode === value} aria-controls={id(`panel-${value}`)} tabIndex={mode === value ? 0 : -1} className={mode === value ? "is-active" : ""} onClick={() => switchMode(value)} onKeyDown={onTabKey}>{value === "signin" ? "Se connecter" : "Créer un compte"}</button>)}
        </div>

        <div aria-live="polite" className="auth-live">{notice && <div className={`auth-notice is-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}<span>{notice.message}</span><button type="button" onClick={onDismissNotice} aria-label="Fermer le message"><X size={16} aria-hidden="true" /></button></div>}</div>

        {mode === "signin" ? <div id={id("panel-signin")} role="tabpanel" aria-labelledby={id("tab-signin")}><form ref={loginRef} className="auth-form" noValidate onSubmit={submitLogin}>
          <div data-field="loginPhone"><Field id={id("loginPhone")} label="Numéro de téléphone" required hint={PHONE_HINT} error={errors.loginPhone}>
            <input id={id("loginPhone")} type="tel" inputMode="tel" autoComplete="username" placeholder="081 234 5678" value={loginPhone} onChange={(event) => { setLoginPhone(event.target.value); if (errors.loginPhone) setErrors((current) => ({ ...current, loginPhone: undefined })); }} required aria-required="true" aria-invalid={Boolean(errors.loginPhone)} aria-describedby={describedBy(id("loginPhone"), PHONE_HINT, errors.loginPhone)} />
          </Field></div>
          <div data-field="loginPassword"><Field id={id("loginPassword")} label="Mot de passe" required error={errors.loginPassword}>
            <PasswordInput id={id("loginPassword")} value={loginPassword} onChange={(value) => { setLoginPassword(value); if (errors.loginPassword) setErrors((current) => ({ ...current, loginPassword: undefined })); }} autoComplete="current-password" error={errors.loginPassword} />
          </Field></div>
          <button className="auth-cta" type="submit" aria-busy={loading} aria-disabled={loading}>{loading ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <LogIn size={18} aria-hidden="true" />}{loading ? "Connexion…" : "Se connecter"}</button>
          <p className="auth-switch-line">Pas encore de compte ? <button type="button" className="auth-link" onClick={() => switchMode("signup", true)}>Créer un compte</button></p>
        </form></div> : <div id={id("panel-signup")} role="tabpanel" aria-labelledby={id("tab-signup")}><form ref={formRef} className="auth-form" noValidate onSubmit={submitSignup}>
          {success ? <div ref={successRef} tabIndex={-1} className="auth-success" role="status">
            <span className="auth-success-icon" aria-hidden="true"><Clock3 size={24} /></span>
            <h2>Demande envoyée</h2>
            <p>Un responsable doit valider votre compte. Vous pourrez ensuite vous connecter avec votre numéro.</p>
            <button type="button" className="auth-cta" onClick={() => switchMode("signin", true)}>Retour à la connexion</button>
          </div> : <>
            <p className="auth-note">Les champs marqués <span aria-hidden="true">*</span><span className="sr-only">d’un astérisque</span> sont obligatoires.</p>

            <fieldset className="auth-group">
              <legend>Identité</legend>
              <div data-field="fullName"><Field id={id("fullName")} label="Nom complet" required error={errors.fullName}>
                <input id={id("fullName")} value={form.fullName} onChange={(event) => update("fullName", event.target.value)} placeholder="Ex. Grâce Mbuyi" autoComplete="name" autoCapitalize="words" required aria-required="true" aria-invalid={Boolean(errors.fullName)} aria-describedby={describedBy(id("fullName"), undefined, errors.fullName)} />
              </Field></div>
              <div data-field="dateOfBirth"><Field id={id("dateOfBirth")} label="Date de naissance" hint="Format JJ/MM/AAAA." error={errors.dateOfBirth}>
                <DatePickerField id={id("dateOfBirth")} ariaLabel="Date de naissance, format JJ/MM/AAAA" value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(value) => update("dateOfBirth", value)} />
              </Field></div>
              <div className={`auth-field${errors.photo ? " has-error" : ""}`} data-field="photo">
                <span className="auth-label" id={id("photo-label")}>Photo de profil<span className="auth-opt"> (facultatif)</span></span>
                <div className="auth-photo">
                  {form.avatarUrl ? <img src={form.avatarUrl} alt="Aperçu de votre photo de profil" /> : <span className="auth-photo-empty" aria-hidden="true"><ImagePlus size={22} /></span>}
                  <div className="auth-photo-actions">
                    <input id={id("photo")} className="auth-file-input" type="file" accept="image/*" aria-labelledby={`${id("photo-label")} ${id("photo-btn")}`} aria-describedby={errors.photo ? `${id("photo")}-error` : undefined} onChange={(event) => { void pickPhoto(event.target.files?.[0]); event.target.value = ""; }} />
                    <label htmlFor={id("photo")} id={id("photo-btn")} className="auth-file-btn">{photoBusy ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}{photoBusy ? "Préparation…" : form.avatarUrl ? "Changer la photo" : "Choisir une photo"}</label>
                    {form.avatarUrl && <button type="button" className="auth-link" onClick={() => update("avatarUrl", null)}>Retirer</button>}
                  </div>
                </div>
                {errors.photo && <p id={`${id("photo")}-error`} className="auth-error"><AlertCircle size={14} aria-hidden="true" />{errors.photo}</p>}
              </div>
            </fieldset>

            <fieldset className="auth-group">
              <legend>Contact</legend>
              <div data-field="phone"><Field id={id("phone")} label="Numéro M-Pesa" required hint={PHONE_HINT} error={errors.phone}>
                <input id={id("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="081 234 5678" value={form.phone} onChange={(event) => update("phone", event.target.value)} required aria-required="true" aria-invalid={Boolean(errors.phone)} aria-describedby={describedBy(id("phone"), PHONE_HINT, errors.phone)} />
              </Field></div>
              <label className="auth-toggle">
                <input type="checkbox" role="switch" checked={form.whatsappSameAsPhone} onChange={(event) => { update("whatsappSameAsPhone", event.target.checked); if (event.target.checked) update("whatsappPhone", ""); }} />
                <span className="auth-toggle-track" aria-hidden="true" />
                <span className="auth-toggle-text"><strong>Même numéro pour WhatsApp</strong><small>Désactivez si votre WhatsApp utilise un autre numéro.</small></span>
              </label>
              {!form.whatsappSameAsPhone && <div data-field="whatsappPhone"><Field id={id("whatsappPhone")} label="Numéro WhatsApp" required hint={PHONE_HINT} error={errors.whatsappPhone}>
                <input id={id("whatsappPhone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="081 234 5678" value={form.whatsappPhone} onChange={(event) => update("whatsappPhone", event.target.value)} required aria-required="true" aria-invalid={Boolean(errors.whatsappPhone)} aria-describedby={describedBy(id("whatsappPhone"), PHONE_HINT, errors.whatsappPhone)} />
              </Field></div>}
            </fieldset>

            <fieldset className="auth-group">
              <legend>Catégorie<span className="auth-req" aria-hidden="true"> *</span></legend>
              <div className="auth-choices">
                {SIGNUP_CATEGORIES.map((category) => { const [title, detail] = CATEGORY_LABELS[category].split(" — "); return <label key={category} className="auth-choice">
                  <input type="radio" name={id("category")} value={category} checked={form.category === category} onChange={() => update("category", category)} />
                  <span className="auth-choice-body"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
                  <CheckCircle2 className="auth-choice-check" size={18} aria-hidden="true" />
                </label>; })}
              </div>
            </fieldset>

            <fieldset className="auth-group auth-group-address">
              <legend>Adresse <span className="auth-opt">(facultatif)</span></legend>
              <AddressFields value={form.addressDetails} onChange={(addressDetails) => update("addressDetails", addressDetails)} />
            </fieldset>

            <fieldset className="auth-group">
              <legend>Mot de passe</legend>
              <label className="auth-toggle">
                <input type="checkbox" role="switch" checked={form.useDefaultPassword} onChange={(event) => { update("useDefaultPassword", event.target.checked); setForm((current) => ({ ...current, password: "", confirmPassword: "" })); }} />
                <span className="auth-toggle-track" aria-hidden="true" />
                <span className="auth-toggle-text"><strong>Utiliser le mot de passe par défaut</strong><small>Mot de passe : <code>password</code>. Vous pourrez le changer depuis votre profil.</small></span>
              </label>
              {!form.useDefaultPassword && <>
                <div data-field="password"><Field id={id("password")} label="Mot de passe" required hint="Au moins 6 caractères." error={errors.password}>
                  <PasswordInput id={id("password")} value={form.password} onChange={(value) => update("password", value)} autoComplete="new-password" hint="Au moins 6 caractères." error={errors.password} />
                </Field></div>
                <div data-field="confirmPassword"><Field id={id("confirmPassword")} label="Confirmer le mot de passe" required error={errors.confirmPassword}>
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
