import { useEffect, useRef, type ReactNode } from "react";
import { AlertCircle, Check, ImagePlus, LoaderCircle, X } from "lucide-react";
import type { UserCategory } from "@/lib/supabase";

/**
 * Contrôles partagés par l'écran d'accès, la création admin et le profil :
 * même matière Sapphire partout (styles .auth-* dans auth-glass.css).
 */

/** Ferme un menu ouvert au toucher en dehors ou avec Échap ; renvoie la ref du conteneur. */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) closeRef.current(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return ref;
}

/** Interrupteur (checkbox role=switch) avec titre et précision facultative. */
export function Switch({ checked, onChange, disabled, title, detail, detailId }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; title: ReactNode; detail?: ReactNode; detailId?: string }) {
  return <label className="auth-toggle">
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={detail && detailId ? detailId : undefined} onChange={(event) => onChange(event.target.checked)} />
    <span className="auth-toggle-track" aria-hidden="true" />
    <span className="auth-toggle-text"><strong>{title}</strong>{detail && <small id={detailId}>{detail}</small>}</span>
  </label>;
}

/** Tuile photo : choisir, aperçu, retirer. */
export function PhotoPicker({ id, value, busy, error, onPick, onRemove }: { id: string; value: string | null; busy?: boolean; error?: string; onPick: (file: File) => void; onRemove: () => void }) {
  return <div className={`auth-photo-field${error ? " has-error" : ""}`} data-field="photo">
    <span className="auth-label" id={`${id}-label`}>Photo</span>
    <div className="auth-photo-box">
      <input id={id} className="auth-file-input" type="file" accept="image/*" aria-labelledby={`${id}-label`} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onPick(file); }} />
      <label htmlFor={id} className={`auth-photo-tile${value ? " has-photo" : ""}`}>
        {value ? <img src={value} alt="Photo choisie" /> : <>{busy ? <LoaderCircle className="spin" size={24} aria-hidden="true" /> : <ImagePlus size={24} aria-hidden="true" />}<span>{busy ? "Préparation…" : "Choisir une photo"}</span></>}
      </label>
      {value && <button type="button" className="auth-photo-remove" onClick={onRemove} aria-label="Retirer la photo"><X size={14} aria-hidden="true" /></button>}
    </div>
    {error && <p id={`${id}-error`} className="auth-error"><AlertCircle size={14} aria-hidden="true" />{error}</p>}
  </div>;
}

/** Catégorie : Hôtesse (+ case « Polyv. ») ou Brand Ambassador. */
export function CategoryPicker({ name, value, onChange }: { name: string; value: UserCategory; onChange: (value: UserCategory) => void }) {
  const isHostess = value === "hostess" || value === "hostess_polyvalent";
  const isPolyvalent = value === "hostess_polyvalent";
  return <fieldset className="auth-cat">
    <legend className="auth-label">Catégorie</legend>
    <div className="auth-cat-row">
      <label className="auth-cat-opt">
        <input type="radio" name={name} checked={isHostess} onChange={() => onChange(isPolyvalent ? "hostess_polyvalent" : "hostess")} />
        <span className="auth-cat-dot" aria-hidden="true" />Hôtesse
      </label>
      <label className="auth-cat-poly" title="Hôtesse polyvalente : campagnes Hôtesses, BA et Events">
        <input type="checkbox" checked={isPolyvalent} onChange={(event) => onChange(event.target.checked ? "hostess_polyvalent" : "hostess")} />
        <span className="auth-cat-box" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>Polyv.<span className="sr-only"> (hôtesse polyvalente)</span>
      </label>
    </div>
    <label className="auth-cat-opt">
      <input type="radio" name={name} checked={value === "brand_ambassador"} onChange={() => onChange("brand_ambassador")} />
      <span className="auth-cat-dot" aria-hidden="true" />Brand Ambassador
    </label>
  </fieldset>;
}
