import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, LoaderCircle, MapPin, Navigation } from "lucide-react";
import { loadAddressCommunes, loadAddressProvinces, loadAddressQuartiers, type AddressCommune, type AddressProvince, type AddressQuartier } from "@/lib/supabase";

export type AddressDraft = {
  provinceId: string;
  provinceName: string;
  commune: string;
  quartier: string;
  avenue: string;
  number: string;
  latitude: number | null;
  longitude: number | null;
};

export const EMPTY_ADDRESS_DRAFT: AddressDraft = {
  provinceId: "",
  provinceName: "",
  commune: "",
  quartier: "",
  avenue: "",
  number: "",
  latitude: null,
  longitude: null,
};

export function addressLabel(address: AddressDraft): string | null {
  const parts = [address.avenue, address.number, address.quartier, address.commune, address.provinceName].filter((value): value is string => Boolean(value?.trim()));
  return parts.length ? parts.join(", ") : null;
}

export function addressCompletionPercent(address: Pick<AddressDraft, "provinceId" | "commune" | "quartier" | "avenue" | "number">): number {
  const filled = [address.provinceId, address.commune, address.quartier, address.avenue, address.number].filter((value) => Boolean(value?.trim())).length;
  return Math.round((filled / 5) * 100);
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function findLocationName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function AddressSelect({ value, options, placeholder, onChange, disabled, loading, ariaLabel }: { value: string; options: Array<{ value: string; label: string }>; placeholder: string; onChange: (value: string) => void; disabled?: boolean; loading?: boolean; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label || (value && !options.some((option) => option.value === value) ? value : placeholder);
  return <div className={`address-select ${open ? "is-open" : ""}`}><button type="button" className="select-trigger address-select-trigger" aria-label={ariaLabel} aria-expanded={open} disabled={disabled} onClick={() => setOpen((state) => !state)}><span>{loading ? "Chargement…" : current}</span>{loading ? <LoaderCircle className="spin" size={14} /> : <ChevronDown size={14} />}</button>{open && <><button type="button" className="select-backdrop" aria-label="Fermer" onClick={() => setOpen(false)} /><div className="select-menu address-select-menu">{options.map((option) => <button type="button" className={`select-option ${option.value === value ? "is-selected" : ""}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}{option.value === value && <Check size={14} />}</button>)}</div></>}</div>;
}

export default function AddressFields({ value, onChange, enableLocationSuggestion = true }: { value: AddressDraft; onChange: (value: AddressDraft) => void; enableLocationSuggestion?: boolean }) {
  const [provinces, setProvinces] = useState<AddressProvince[]>([]);
  const [communes, setCommunes] = useState<AddressCommune[]>([]);
  const [quartiers, setQuartiers] = useState<AddressQuartier[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(true);
  const [loadingCommunes, setLoadingCommunes] = useState(false);
  const [loadingQuartiers, setLoadingQuartiers] = useState(false);
  const [locationState, setLocationState] = useState<"idle" | "loading" | "found" | "denied" | "unavailable">("idle");
  const [manualCommune, setManualCommune] = useState(false);
  const [manualQuartier, setManualQuartier] = useState(false);

  useEffect(() => {
    let active = true;
    void loadAddressProvinces().then((rows) => { if (active) setProvinces(rows); }).catch(() => undefined).finally(() => { if (active) setLoadingProvinces(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const provinceKey = provinces.find((item) => item.id === value.provinceId || normalize(item.name) === normalize(value.provinceName || value.provinceId))?.id || value.provinceId;
    if (!provinceKey) { setCommunes([]); return () => { active = false; }; }
    setLoadingCommunes(true);
    void loadAddressCommunes(provinceKey).then((rows) => { if (active) setCommunes(rows); }).catch(() => { if (active) setCommunes([]); }).finally(() => { if (active) setLoadingCommunes(false); });
    return () => { active = false; };
  }, [provinces, value.provinceId, value.provinceName]);

  useEffect(() => {
    let active = true;
    const provinceKey = provinces.find((item) => item.id === value.provinceId || normalize(item.name) === normalize(value.provinceName || value.provinceId))?.id || value.provinceId;
    if (!provinceKey || !value.commune || manualCommune) { setQuartiers([]); return () => { active = false; }; }
    setLoadingQuartiers(true);
    void loadAddressQuartiers(provinceKey, value.commune).then((rows) => { if (active) setQuartiers(rows); }).catch(() => { if (active) setQuartiers([]); }).finally(() => { if (active) setLoadingQuartiers(false); });
    return () => { active = false; };
  }, [provinces, value.provinceId, value.provinceName, value.commune, manualCommune]);

  async function suggestFromLocation(position: GeolocationPosition) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=fr`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("reverse geocoding unavailable");
      const data = await response.json() as { address?: Record<string, unknown> };
      const location = data.address || {};
      const provinceText = findLocationName(location.state) || findLocationName(location.province);
      const communeText = findLocationName(location.city) || findLocationName(location.town) || findLocationName(location.municipality);
      const quartierText = findLocationName(location.suburb) || findLocationName(location.neighbourhood) || findLocationName(location.village);
      const province = provinces.find((item) => normalize(item.name) === normalize(provinceText) || normalize(provinceText).includes(normalize(item.name)) || normalize(item.name).includes(normalize(provinceText)));
      const nextProvince = province?.id || value.provinceId;
      setManualCommune(false);
      setManualQuartier(false);
      onChange({ ...value, provinceId: nextProvince, provinceName: province?.name || value.provinceName || provinceText, commune: communeText || value.commune, quartier: quartierText || value.quartier, latitude, longitude });
      setLocationState("found");
    } catch {
      setLocationState("unavailable");
    }
  }

  function locate() {
    if (!navigator.geolocation) { setLocationState("unavailable"); return; }
    setLocationState("loading");
    navigator.geolocation.getCurrentPosition((position) => { void suggestFromLocation(position); }, () => setLocationState("denied"), { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 });
  }

  const provinceOptions = useMemo(() => provinces.map((province) => ({ value: province.id, label: province.name })), [provinces]);
  const communeOptions = useMemo(() => [...communes.map((commune) => ({ value: commune.name, label: commune.name })), { value: "__manual__", label: "Autre commune non répertoriée" }], [communes]);
  const quartierOptions = useMemo(() => [...quartiers.map((quartier) => ({ value: quartier.name, label: quartier.name })), { value: "__manual__", label: "Autre quartier non répertorié" }], [quartiers]);
  const communeIsManual = manualCommune || (communes.length > 0 && Boolean(value.commune) && !communes.some((item) => normalize(item.name) === normalize(value.commune)));
  const quartierIsManual = manualQuartier || (quartiers.length > 0 && Boolean(value.quartier) && !quartiers.some((item) => normalize(item.name) === normalize(value.quartier)));
  const communeValue = communeIsManual ? "__manual__" : value.commune;
  const quartierValue = quartierIsManual ? "__manual__" : value.quartier;

  return <div className="address-fields">
    <div className="address-fields-heading"><div><span className="mini-label"><MapPin size={12} /> ADRESSE RDC</span><small>Ajoutez les éléments connus pour améliorer les statistiques locales.</small></div>{enableLocationSuggestion && <button type="button" className="button secondary compact address-gps-button" onClick={locate} disabled={locationState === "loading"}><Navigation size={13} />{locationState === "loading" ? "Localisation…" : "Suggérer ma position"}</button>}</div>
    {locationState === "found" && <span className="field-status valid"><Check size={13} /> Suggestion GPS appliquée, vérifiez-la avant d’enregistrer.</span>}
    {locationState === "denied" && <span className="field-hint">La localisation n’a pas été autorisée. Vous pouvez remplir l’adresse manuellement.</span>}
    {locationState === "unavailable" && <span className="field-hint">Suggestion GPS indisponible. Les listes restent utilisables manuellement.</span>}
    <div className="field-grid two-columns address-select-grid">
      <div className="field"><label>Province</label><AddressSelect value={value.provinceId} options={provinceOptions} placeholder="Choisir une province" onChange={(provinceId) => { const province = provinces.find((item) => item.id === provinceId); onChange({ ...value, provinceId, provinceName: province?.name || "", commune: "", quartier: "" }); setManualCommune(false); setManualQuartier(false); }} loading={loadingProvinces} ariaLabel="Province de résidence" /></div>
      <div className="field"><label>Commune</label><AddressSelect value={communeValue} options={communeOptions} placeholder={value.provinceId ? "Choisir une commune" : "Choisir d’abord une province"} onChange={(commune) => { if (commune === "__manual__") { setManualCommune(true); setManualQuartier(true); onChange({ ...value, commune: "", quartier: "" }); } else { setManualCommune(false); setManualQuartier(false); onChange({ ...value, commune, quartier: "" }); } }} disabled={!value.provinceId} loading={loadingCommunes} ariaLabel="Commune de résidence" />{communeIsManual && <input value={value.commune} onChange={(event) => onChange({ ...value, commune: event.target.value, quartier: "" })} placeholder="Écrire la commune" autoComplete="address-level2" />}</div>
    </div>
    <div className="field-grid two-columns address-select-grid">
      <div className="field"><label>Quartier</label><AddressSelect value={quartierValue} options={quartierOptions} placeholder={value.commune ? "Choisir un quartier" : "Choisir d’abord une commune"} onChange={(quartier) => { if (quartier === "__manual__") { setManualQuartier(true); onChange({ ...value, quartier: "" }); } else { setManualQuartier(false); onChange({ ...value, quartier }); } }} disabled={!value.commune} loading={loadingQuartiers} ariaLabel="Quartier de résidence" />{quartierIsManual && <input value={value.quartier} onChange={(event) => onChange({ ...value, quartier: event.target.value })} placeholder="Écrire le quartier" autoComplete="address-level3" />}</div>
      <div className="address-street-grid"><div className="field"><label htmlFor="addressAvenue">Avenue</label><input id="addressAvenue" value={value.avenue} onChange={(event) => onChange({ ...value, avenue: event.target.value })} placeholder="Ex. Avenue des Écoles" autoComplete="street-address" /></div><div className="field"><label htmlFor="addressNumber">Numéro</label><input id="addressNumber" value={value.number} onChange={(event) => onChange({ ...value, number: event.target.value })} placeholder="N° de parcelle" inputMode="text" /></div></div>
    </div>
  </div>;
}
