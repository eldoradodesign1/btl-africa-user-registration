import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { BriefcaseBusiness, CalendarDays, CheckCircle2, Download, FileSpreadsheet, FileText, LoaderCircle, LockKeyhole, UserCircle2, Users, X, XCircle } from "lucide-react";
import { CopyablePhone } from "@/components/CopyablePhone";
import { CATEGORY_LABELS, ROLE_LABELS, categoryShortLabel } from "@/lib/user-form";
import { isValidMsisdn, normalizePhone } from "@/lib/phone";
import { loadAgentInsights, requestCampaignAssignment, reviewCampaignAssignmentRequest, updateMyProfile, type AgentInsights, type CampaignAssignment, type CampaignAssignmentRequest, type CampaignRecord, type UserRecord } from "@/lib/supabase";

type Notice = { kind: "error" | "success"; message: string };

type RoleWorkspaceProps = {
  profile: UserRecord;
  users: UserRecord[];
  superiors: UserRecord[];
  campaigns: CampaignRecord[];
  assignments: CampaignAssignment[];
  assignmentRequests: CampaignAssignmentRequest[];
  onNotice: (notice: Notice) => void;
  onProfileUpdated: (profile: UserRecord) => void;
  onProfileOpen: () => void;
  onRequestReviewed: () => void;
};

type AgentDetailProps = {
  agent: UserRecord;
  campaigns: CampaignRecord[];
  assignments: CampaignAssignment[];
  assignmentRequests: CampaignAssignmentRequest[];
  canRequest: boolean;
  canExport: boolean;
  onNotice: (notice: Notice) => void;
  onClose: () => void;
};

function Avatar({ user, size = "small" }: { user: UserRecord; size?: "small" | "large" }) {
  return user.avatar_url ? <img className={`profile-avatar ${size}`} src={user.avatar_url} alt="" /> : <div className={`avatar ${size === "small" ? "small" : ""}`}>{user.full_name.slice(0, 1).toUpperCase()}</div>;
}

function ProgressChart({ insights }: { insights: AgentInsights }) {
  const max = Math.max(...insights.performance.map((point) => point.value), 1);
  const width = 350;
  const height = 130;
  const points = insights.performance.map((point, index) => `${(index / Math.max(insights.performance.length - 1, 1)) * (width - 20) + 10},${height - 22 - (point.value / max) * (height - 40)}`).join(" ");
  return <div className="progress-chart"><div className="chart-axis"><span>{insights.metricLabel}</span><small>{insights.performance.length} jours renseignés</small></div>{insights.performance.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Courbe de ${insights.metricLabel}`}><polyline points={`${points} ${width - 10},${height - 12} 10,${height - 12}`} fill="rgba(158,233,232,.08)" stroke="none" /><polyline points={points} fill="none" stroke="#9ee9e8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{insights.performance.map((point, index) => { const x = (index / Math.max(insights.performance.length - 1, 1)) * (width - 20) + 10; const y = height - 22 - (point.value / max) * (height - 40); return <circle key={`${point.date}-${index}`} cx={x} cy={y} r="3.5" fill="#b5ef8c"><title>{point.date} · {point.label}</title></circle>; })}</svg> : <div className="workspace-empty">Aucune performance enregistrée pour cette campagne.</div>}</div>;
}

function AttendanceRegistry({ insights }: { insights: AgentInsights }) {
  return <div className="attendance-panel"><div className="chart-axis"><span><CalendarDays size={14} /> Registre de présence</span><small>{insights.presence.length} entrées</small></div>{insights.presence.length ? <div className="attendance-list">{insights.presence.map((entry) => <div className="attendance-row" key={entry.date}><span className={`attendance-status ${entry.status === "closed" || entry.status === "présent" ? "is-present" : "is-other"}`} /><strong>{new Date(`${entry.date}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" })}</strong><span>{entry.checkin_at ? new Date(entry.checkin_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"} → {entry.checkout_at ? new Date(entry.checkout_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span><small>{entry.status}</small></div>)}</div> : <div className="workspace-empty">Aucun pointage enregistré pour cette campagne.</div>}</div>;
}

function exportXls(agent: UserRecord, campaign: CampaignRecord, insights: AgentInsights) {
  const rows = [["Agent", agent.full_name], ["Téléphone", agent.phone], ["Campagne", campaign.name], [], ["Date", insights.metricLabel], ...insights.performance.map((point) => [point.date, point.value]), [], ["Date", "Statut", "Arrivée", "Départ"], ...insights.presence.map((entry) => [entry.date, entry.status, entry.checkin_at || "", entry.checkout_at || ""])];
  const html = `<table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")}</table>`;
  const blob = new Blob([`<html><meta charset="utf-8"><body>${html}</body></html>`], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${agent.full_name}-${campaign.code}-suivi.xls`; anchor.click(); URL.revokeObjectURL(url);
}

function exportPdf(agent: UserRecord, campaign: CampaignRecord, insights: AgentInsights) {
  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) return;
  popup.document.write(`<html><head><title>Suivi ${agent.full_name} — ${campaign.name}</title><style>body{font-family:Arial,sans-serif;color:#14252b;padding:32px}h1{font-size:22px}h2{font-size:15px;margin-top:26px;border-bottom:1px solid #d9e4e6;padding-bottom:8px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #d9e4e6;padding:7px;text-align:left}small{color:#60767e}</style></head><body><h1>${agent.full_name}</h1><small>${agent.phone} · ${campaign.name}</small><h2>${insights.metricLabel}</h2><table><tr><th>Date</th><th>Valeur</th></tr>${insights.performance.map((point) => `<tr><td>${point.date}</td><td>${point.label}</td></tr>`).join("")}</table><h2>Présence</h2><table><tr><th>Date</th><th>Statut</th><th>Arrivée</th><th>Départ</th></tr>${insights.presence.map((entry) => `<tr><td>${entry.date}</td><td>${entry.status}</td><td>${entry.checkin_at || "—"}</td><td>${entry.checkout_at || "—"}</td></tr>`).join("")}</table></body></html>`);
  popup.document.close(); popup.focus(); popup.print();
}

export function AgentDetailModal({ agent, campaigns, assignments, assignmentRequests, canRequest, canExport, onNotice, onClose }: AgentDetailProps) {
  const assigned = campaigns.filter((campaign) => assignments.some((assignment) => assignment.user_id === agent.id && assignment.campaign_id === campaign.id));
  const compatible = campaigns.filter((campaign) => (campaign.status === "active" || campaign.status === "draft") && campaign.campaign_type === (agent.user_category === "hostess" ? "hostess" : "brand_ambassador"));
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(assigned[0] || null);
  const [insights, setInsights] = useState<AgentInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const pendingIds = new Set(assignmentRequests.filter((request) => request.user_id === agent.id && request.status === "pending").map((request) => request.campaign_id));

  useEffect(() => {
    let cancelled = false;
    if (!selectedCampaign) { setInsights(null); return () => { cancelled = true; }; }
    setLoadingInsights(true);
    void loadAgentInsights(agent, selectedCampaign).then((data) => { if (!cancelled) setInsights(data); }).catch((error) => { if (!cancelled) onNotice({ kind: "error", message: error instanceof Error ? error.message : "Impossible de charger le suivi." }); }).finally(() => { if (!cancelled) setLoadingInsights(false); });
    return () => { cancelled = true; };
  }, [agent, selectedCampaign, onNotice]);

  async function requestAssignment(campaign: CampaignRecord) {
    setRequesting(campaign.id);
    try { await requestCampaignAssignment(agent.id, campaign.id); onNotice({ kind: "success", message: `Demande d’affectation envoyée pour ${campaign.name}.` }); } catch (error) { onNotice({ kind: "error", message: error instanceof Error ? error.message : "Demande impossible." }); } finally { setRequesting(null); }
  }

  return <div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={onClose} /><div className="modal-card agent-detail-modal"><div className="modal-header"><div className="agent-detail-heading"><Avatar user={agent} size="large" /><div><div className="eyebrow"><UserCircle2 size={13} /> Fiche agent</div><h3>{agent.full_name}</h3><span>{CATEGORY_LABELS[agent.user_category || "operations"] || "Agent"}</span></div></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div><div className="agent-contact"><CopyablePhone value={agent.phone} /><span className="role-badge">{ROLE_LABELS[agent.role]}</span></div><div className="detail-section"><div className="detail-section-title"><span><BriefcaseBusiness size={14} /> Campagnes d’affectation</span><small>{assigned.length} active{assigned.length > 1 ? "s" : ""}</small></div><div className="detail-campaigns">{compatible.map((campaign) => { const isAssigned = assigned.some((item) => item.id === campaign.id); const isPending = pendingIds.has(campaign.id); return <div className={`detail-campaign ${isAssigned ? "is-assigned" : "is-unassigned"}`} key={campaign.id}><button type="button" onClick={() => isAssigned && setSelectedCampaign(campaign)} disabled={!isAssigned}><span>{campaign.name}</span><small>{isAssigned ? "Affecté · voir le suivi" : isPending ? "Demande en attente" : "Non affecté"}</small></button>{!isAssigned && canRequest && !isPending && <button type="button" className="button secondary compact" onClick={() => void requestAssignment(campaign)} disabled={requesting === campaign.id}>{requesting === campaign.id ? <LoaderCircle className="spin" size={13} /> : <Users size={13} />} Demander</button>}</div>; })}</div>{!compatible.length && <div className="workspace-empty">Aucune campagne compatible disponible.</div>}</div>{selectedCampaign && <div className="detail-section"><div className="selected-campaign-title"><strong>{selectedCampaign.name}</strong><span>Suivi sélectionné</span></div>{loadingInsights ? <div className="workspace-loading"><LoaderCircle className="spin" size={18} /> Chargement du suivi…</div> : insights && <><ProgressChart insights={insights} /><AttendanceRegistry insights={insights} />{canExport && <div className="export-actions"><button type="button" className="button secondary compact" onClick={() => exportXls(agent, selectedCampaign, insights)}><FileSpreadsheet size={13} /> Exporter XLS</button><button type="button" className="button secondary compact" onClick={() => exportPdf(agent, selectedCampaign, insights)}><FileText size={13} /> Exporter PDF</button></div>}</>}</div>}</div></div>;
}

export function ProfileModal({ profile, onClose, onSaved }: { profile: UserRecord; onClose: () => void; onSaved: (profile: UserRecord) => void }) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone);
  const [password, setPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    if (fullName.trim().length < 2 || !isValidMsisdn(normalizePhone(phone))) { setError("Renseignez un nom et un MSISDN valides."); return; }
    setSaving(true);
    try { onSaved(await updateMyProfile({ fullName, phone, password: password || undefined, avatarUrl })); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "Impossible de mettre à jour le profil."); } finally { setSaving(false); }
  }
  function choosePhoto(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; if (file.size > 520000) { setError("La photo doit faire moins de 500 Ko."); return; } const reader = new FileReader(); reader.onload = () => setAvatarUrl(String(reader.result)); reader.readAsDataURL(file); }
  return <div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={onClose} /><form className="modal-card profile-modal" onSubmit={save}><div className="modal-header"><div><div className="eyebrow"><UserCircle2 size={13} /> Mon profil</div><h3>Informations personnelles</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div><div className="profile-photo-editor">{avatarUrl ? <img className="profile-avatar large" src={avatarUrl} alt="Aperçu" /> : <Avatar user={profile} size="large" />}<label className="button secondary compact"><Download size={13} /> Choisir une photo<input type="file" accept="image/*" onChange={choosePhoto} hidden /></label></div><label>Nom complet<input value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label><label>Numéro de téléphone<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" required /></label><label>Nouveau mot de passe <small>Laisser vide pour conserver l’actuel</small><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} autoComplete="new-password" /></label>{error && <div className="connection-test">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button type="submit" className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <LockKeyhole size={14} />} Enregistrer</button></div></form></div>;
}

export default function RoleWorkspace({ profile, users, superiors, campaigns, assignments, assignmentRequests, onNotice, onProfileUpdated, onProfileOpen, onRequestReviewed }: RoleWorkspaceProps) {
  const [selectedAgent, setSelectedAgent] = useState<UserRecord | null>(null);
  const isAgent = profile.role === "agent";
  const agents = users.filter((user) => user.role === "agent");
  const assignedCampaigns = campaigns.filter((campaign) => assignments.some((assignment) => assignment.user_id === profile.id && assignment.campaign_id === campaign.id));
  const visibleCampaigns = campaigns.filter((campaign) => campaign.status === "active" || campaign.status === "draft");
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(assignedCampaigns[0] || null);
  const [insights, setInsights] = useState<AgentInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [requestingCampaign, setRequestingCampaign] = useState<string | null>(null);
  const [reviewingRequest, setReviewingRequest] = useState<string | null>(null);
  useEffect(() => { if (!isAgent || !selectedCampaign) return; let cancelled = false; setLoadingInsights(true); void loadAgentInsights(profile, selectedCampaign).then((data) => { if (!cancelled) setInsights(data); }).catch((error) => onNotice({ kind: "error", message: error instanceof Error ? error.message : "Impossible de charger le suivi." })).finally(() => { if (!cancelled) setLoadingInsights(false); }); return () => { cancelled = true; }; }, [isAgent, profile, selectedCampaign, onNotice]);
  const requestIds = new Set(assignmentRequests.filter((request) => request.user_id === profile.id && request.status === "pending").map((request) => request.campaign_id));

  async function requestAssignment(campaign: CampaignRecord) {
    setRequestingCampaign(campaign.id);
    try { await requestCampaignAssignment(profile.id, campaign.id); onNotice({ kind: "success", message: `Demande envoyée pour ${campaign.name}.` }); } catch (error) { onNotice({ kind: "error", message: error instanceof Error ? error.message : "Demande impossible." }); } finally { setRequestingCampaign(null); }
  }

  async function reviewRequest(request: CampaignAssignmentRequest, approve: boolean) {
    setReviewingRequest(request.id);
    try { await reviewCampaignAssignmentRequest(request.id, approve); onRequestReviewed(); onNotice({ kind: "success", message: approve ? "Demande approuvée." : "Demande rejetée." }); } catch (error) { onNotice({ kind: "error", message: error instanceof Error ? error.message : "Impossible de traiter la demande." }); } finally { setReviewingRequest(null); }
  }

  return <section className="role-workspace"><div className="workspace-hero"><div className="workspace-identity"><Avatar user={profile} size="large" /><div><div className="eyebrow">{isAgent ? "Espace agent" : "Espace superviseur"}</div><h2>Bonjour, {profile.full_name}</h2><p>{isAgent ? "Suivez vos affectations, vos performances et votre présence." : "Consultez les équipes, les campagnes et les suivis terrain."}</p></div></div><button type="button" className="button secondary compact" onClick={onProfileOpen}><UserCircle2 size={14} /> Profil</button></div><div className="workspace-grid"><section className="workspace-card superiors-card"><div className="workspace-card-heading"><span><Users size={15} /> Équipe de coordination</span><small>{superiors.length}</small></div><div className="superior-list">{superiors.map((superior) => <div className="superior-row" key={superior.id}><Avatar user={superior} /><div><strong>{superior.full_name}</strong><small>{ROLE_LABELS[superior.role]} · <CopyablePhone value={superior.phone} /></small></div></div>)}</div>{!superiors.length && <div className="workspace-empty">Aucun responsable disponible.</div>}</section>{isAgent ? <section className="workspace-card campaign-workspace-card"><div className="workspace-card-heading"><span><BriefcaseBusiness size={15} /> Mes campagnes</span><small>{assignedCampaigns.length} affectée{assignedCampaigns.length > 1 ? "s" : ""}</small></div><div className="agent-campaign-buttons">{visibleCampaigns.map((campaign) => { const assigned = assignedCampaigns.some((item) => item.id === campaign.id); const pending = requestIds.has(campaign.id); return <div className="agent-campaign-item" key={campaign.id}><button type="button" className={`agent-campaign-button ${assigned ? "is-assigned" : "is-unassigned"}`} onClick={() => assigned && setSelectedCampaign(campaign)} disabled={!assigned}><span><strong>{campaign.name}</strong><small>{assigned ? "Ouvrir le suivi" : pending ? "Demande en attente" : "Non affecté"}</small></span>{assigned ? <CheckCircle2 size={15} /> : <span className="campaign-request-dot" />}</button>{!assigned && !pending && <button type="button" className="button secondary compact campaign-request-button" onClick={() => void requestAssignment(campaign)} disabled={requestingCampaign === campaign.id}>{requestingCampaign === campaign.id ? <LoaderCircle className="spin" size={13} /> : <Users size={13} />} Demander</button>}</div>; })}</div></section> : <section className="workspace-card agents-card"><div className="workspace-card-heading"><span><Users size={15} /> Agents</span><small>{agents.length}</small></div><div className="agent-list">{agents.map((agent) => <button type="button" className="agent-list-row" key={agent.id} onClick={() => setSelectedAgent(agent)}><Avatar user={agent} /><span><strong>{agent.full_name}</strong><small>{categoryShortLabel(agent.user_category)} · {assignments.filter((assignment) => assignment.user_id === agent.id).length} campagne(s)</small></span><span className="agent-list-arrow">›</span></button>)}</div></section>}</div><div>{!isAgent && assignmentRequests.length > 0 && <section className="workspace-card request-queue"><div className="workspace-card-heading"><span><BriefcaseBusiness size={15} /> Demandes d’affectation</span><small>{assignmentRequests.length}</small></div><div className="request-queue-list">{assignmentRequests.map((request) => { const agent = users.find((user) => user.id === request.user_id); const campaign = campaigns.find((item) => item.id === request.campaign_id); if (!agent || !campaign) return null; return <div className="request-queue-row" key={request.id}><div><strong>{agent.full_name}</strong><small>{campaign.name} · {new Date(request.requested_at).toLocaleDateString("fr-FR")}</small></div><div className="request-queue-actions"><button type="button" className="icon-action approve" onClick={() => void reviewRequest(request, true)} disabled={reviewingRequest === request.id} aria-label="Approuver"><CheckCircle2 size={14} /></button><button type="button" className="icon-action delete" onClick={() => void reviewRequest(request, false)} disabled={reviewingRequest === request.id} aria-label="Rejeter"><XCircle size={14} /></button></div></div>; })}</div></section>}</div>{isAgent && selectedCampaign && <section className="workspace-card selected-followup"><div className="workspace-card-heading"><span><BriefcaseBusiness size={15} /> {selectedCampaign.name}</span><small>Suivi de campagne</small></div>{loadingInsights ? <div className="workspace-loading"><LoaderCircle className="spin" size={18} /> Chargement…</div> : insights && <><ProgressChart insights={insights} /><AttendanceRegistry insights={insights} /></>}</section>}{selectedAgent && <AgentDetailModal agent={selectedAgent} campaigns={campaigns} assignments={assignments} assignmentRequests={assignmentRequests} canRequest={false} canExport onNotice={onNotice} onClose={() => setSelectedAgent(null)} />}</section>;
}
