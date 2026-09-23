import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, BriefcaseBusiness, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FilePenLine, FileSpreadsheet, FileText, History, LoaderCircle, LockKeyhole, MessageCircle, PhoneCall, RefreshCw, Send, UserCircle2, Users, X, XCircle } from "lucide-react";
import { CopyablePhone } from "@/components/CopyablePhone";
import { CATEGORY_LABELS, ROLE_LABELS, categoryShortLabel } from "@/lib/user-form";
import { isValidMsisdn, normalizePhone } from "@/lib/phone";
import { addCampaignClaimMessage, createCampaignClaim, loadAgentInsights, loadCampaignClaimMessages, markCampaignClaimRead, readableSupabaseError, requestCampaignAssignment, reviewCampaignAssignmentRequest, transitionCampaignClaim, updateMyProfile, type AgentInsights, type CampaignAssignment, type CampaignAssignmentRequest, type CampaignClaim, type CampaignClaimMessage, type CampaignClaimStatus, type CampaignRecord, type CampaignSupervisorAssignment, type DailyReport, type UserRecord } from "@/lib/supabase";

type Notice = { kind: "error" | "success"; message: string };

function ViewportModal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

type RoleWorkspaceProps = {
  profile: UserRecord;
  users: UserRecord[];
  superiors: UserRecord[];
  campaigns: CampaignRecord[];
  assignments: CampaignAssignment[];
  campaignSupervisorAssignments: CampaignSupervisorAssignment[];
  assignmentRequests: CampaignAssignmentRequest[];
  campaignClaims: CampaignClaim[];
  onNotice: (notice: Notice) => void;
  onProfileUpdated: (profile: UserRecord) => void;
  onProfileOpen: () => void;
  onRequestReviewed: () => void;
  simulation?: boolean;
};

type AgentDetailProps = {
  agent: UserRecord;
  users: UserRecord[];
  campaigns: CampaignRecord[];
  assignments: CampaignAssignment[];
  campaignSupervisorAssignments: CampaignSupervisorAssignment[];
  assignmentRequests: CampaignAssignmentRequest[];
  canRequest: boolean;
  canExport: boolean;
  canEdit?: boolean;
  onEdit?: () => void;
  onNotice: (notice: Notice) => void;
  onClose: () => void;
};

type UserDetailProps = {
  user: UserRecord;
  users?: UserRecord[];
  superiors: UserRecord[];
  campaigns: CampaignRecord[];
  assignments: CampaignAssignment[];
  campaignSupervisorAssignments: CampaignSupervisorAssignment[];
  assignmentRequests: CampaignAssignmentRequest[];
  requester?: UserRecord;
  canRequest: boolean;
  onNotice: (notice: Notice) => void;
  onClose: () => void;
};

function CampaignPicker({ campaigns, value, onChange }: { campaigns: CampaignRecord[]; value: CampaignRecord | null; onChange: (campaign: CampaignRecord) => void }) {
  const [open, setOpen] = useState(false);
  return <div className={`agent-campaign-picker ${open ? "is-open" : ""}`}><button type="button" className="agent-campaign-picker-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span><BriefcaseBusiness size={14} />{value ? value.name : "Choisir une campagne"}</span><ChevronRight className={`agent-campaign-picker-chevron ${open ? "is-open" : ""}`} size={15} /></button>{open && <><button type="button" className="agent-campaign-picker-backdrop" aria-label="Fermer la liste des campagnes" onClick={() => setOpen(false)} /><div className="agent-campaign-picker-menu" role="listbox">{campaigns.map((campaign) => <button type="button" role="option" aria-selected={campaign.id === value?.id} className={campaign.id === value?.id ? "is-selected" : ""} key={campaign.id} onClick={() => { onChange(campaign); setOpen(false); }}><span><strong>{campaign.name}</strong><small>{campaign.campaign_type === "hostess" ? "Hôtesse" : "Brand Ambassador"} · {campaign.status === "active" ? "Active" : "Brouillon"}</small></span>{campaign.id === value?.id && <CheckCircle2 size={14} />}</button>)}</div></>}</div>;
}

export function Avatar({ user, size = "small" }: { user: UserRecord; size?: "small" | "large" }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [user.avatar_url]);
  return user.avatar_url && !imageFailed ? <img className={`profile-avatar ${size}`} src={user.avatar_url} alt={`${user.full_name} — photo de profil`} loading="lazy" decoding="async" onError={() => setImageFailed(true)} /> : <div className={`avatar ${size === "small" ? "small" : ""}`} aria-label={`${user.full_name} — initiale`}>{user.full_name.slice(0, 1).toUpperCase()}</div>;
}

export function ProfilePhotoPreviewModal({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  return <ViewportModal><div className="modal-layer profile-photo-lightbox"><button className="modal-backdrop" type="button" aria-label="Fermer la photo" onClick={onClose} /><div className="profile-photo-lightbox-card"><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button><Avatar user={user} size="large" /><strong>{user.full_name}</strong><small>{ROLE_LABELS[user.role]}</small></div></div></ViewportModal>;
}

export function UserDetailModal({ user, users = [], superiors, campaigns, assignments, campaignSupervisorAssignments, assignmentRequests, requester, canRequest, onNotice, onClose }: UserDetailProps) {
  const [requestingCampaign, setRequestingCampaign] = useState<string | null>(null);
  const [requestedCampaignIds, setRequestedCampaignIds] = useState<string[]>([]);
  const requesterCategory = requester?.user_category;
  const compatibleCampaigns = requester?.role === "agent"
    ? campaigns.filter((campaign) => (campaign.status === "active" || campaign.status === "draft") && campaign.campaign_type === (requesterCategory === "hostess" ? "hostess" : "brand_ambassador"))
    : [];
  const assignedIds = new Set([
    ...assignments.filter((assignment) => assignment.user_id === requester?.id && assignment.is_active).map((assignment) => assignment.campaign_id),
    ...campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === requester?.id && assignment.is_active).map((assignment) => assignment.campaign_id),
  ]);
  const pendingIds = new Set([...assignmentRequests.filter((request) => request.user_id === requester?.id && request.status === "pending").map((request) => request.campaign_id), ...requestedCampaignIds]);
  const superiorDirectory = users.length ? users : superiors;
  const parentSuperiors: UserRecord[] = [];
  const seenSuperiors = new Set<string>();
  let parentId = user.supervisor_id;
  while (parentId && !seenSuperiors.has(parentId)) {
    const parent = superiorDirectory.find((superior) => superior.id === parentId);
    if (!parent) break;
    parentSuperiors.push(parent);
    seenSuperiors.add(parent.id);
    parentId = parent.supervisor_id;
  }

  async function requestCampaign(campaign: CampaignRecord) {
    if (!requester || !canRequest) return;
    setRequestingCampaign(campaign.id);
    try {
      await requestCampaignAssignment(requester.id, campaign.id);
      setRequestedCampaignIds((current) => [...current, campaign.id]);
      onNotice({ kind: "success", message: `Demande envoyée pour ${campaign.name}. Elle est visible par votre superviseur et le superadmin.` });
    } catch (error) {
      onNotice({ kind: "error", message: error instanceof Error ? error.message : "Demande impossible." });
    } finally {
      setRequestingCampaign(null);
    }
  }

  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={onClose} /><div className="modal-card user-detail-modal"><div className="modal-header"><div className="agent-detail-heading"><Avatar user={user} size="large" /><div><div className="eyebrow"><UserCircle2 size={13} /> Fiche utilisateur</div><h3>{user.full_name}</h3><span>{ROLE_LABELS[user.role]} · {user.user_category ? categoryShortLabel(user.user_category) : "Profil administratif"}</span></div></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div><div className="user-detail-meta"><div><small>MSISDN</small><CopyablePhone value={user.phone} /></div><div><small>Rôle</small><strong>{ROLE_LABELS[user.role]}</strong></div></div><div className="detail-section"><div className="detail-section-title"><span><Users size={14} /> Supérieur{parentSuperiors.length > 1 ? "s" : ""}</span><small>{parentSuperiors.length}</small></div>{parentSuperiors.length ? <div className="user-detail-superiors">{parentSuperiors.map((superior) => <div className="user-detail-superior" key={superior.id}><Avatar user={superior} /><div><strong>{superior.full_name}</strong><small>{ROLE_LABELS[superior.role]} · <CopyablePhone value={superior.phone} /></small></div></div>)}</div> : <div className="workspace-empty">Aucun supérieur direct renseigné.</div>}</div>{requester?.role === "agent" && <div className="detail-section"><div className="detail-section-title"><span><BriefcaseBusiness size={14} /> Campagnes disponibles</span><small>{compatibleCampaigns.length}</small></div><div className="detail-campaigns">{compatibleCampaigns.map((campaign) => { const assigned = assignedIds.has(campaign.id); const pending = pendingIds.has(campaign.id); return <div className={`detail-campaign ${assigned ? "is-assigned" : "is-unassigned"}`} key={campaign.id}><div><strong>{campaign.name}</strong><small>{assigned ? "Déjà affecté" : pending ? "Demande en attente" : campaign.status === "active" ? "Disponible" : "Brouillon"}</small></div>{!assigned && !pending && canRequest && <button type="button" className="button secondary compact" onClick={() => void requestCampaign(campaign)} disabled={requestingCampaign === campaign.id}>{requestingCampaign === campaign.id ? <LoaderCircle className="spin" size={13} /> : <Users size={13} />} Demander</button>}</div>; })}</div>{!compatibleCampaigns.length && <div className="workspace-empty">Aucune campagne compatible disponible.</div>}</div>}</div></div></ViewportModal>;
}

function ProgressChart({ insights }: { insights: AgentInsights }) {
  const max = Math.max(...insights.performance.map((point) => point.value), 1);
  const width = 350;
  const height = 130;
  const points = insights.performance.map((point, index) => `${(index / Math.max(insights.performance.length - 1, 1)) * (width - 20) + 10},${height - 22 - (point.value / max) * (height - 40)}`).join(" ");
  return <div className="progress-chart"><div className="chart-axis"><span>{insights.metricLabel}</span><small>{insights.performance.length} jours renseignés</small></div>{insights.performance.length ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Courbe de ${insights.metricLabel}`}><defs><linearGradient id="performance-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#22a8e8" stopOpacity=".35" /><stop offset="100%" stopColor="#22a8e8" stopOpacity="0" /></linearGradient><linearGradient id="performance-line" x1="0" x2="1"><stop offset="0%" stopColor="#32c5f4" /><stop offset="100%" stopColor="#b7ef72" /></linearGradient></defs>{[.25, .5, .75].map((ratio) => <line key={ratio} x1="10" x2={width - 10} y1={height - 22 - ratio * (height - 40)} y2={height - 22 - ratio * (height - 40)} stroke="rgba(188,220,228,.13)" strokeDasharray="3 6" />)}<polyline points={`${points} ${width - 10},${height - 12} 10,${height - 12}`} fill="url(#performance-fill)" stroke="none" /><polyline points={points} fill="none" stroke="url(#performance-line)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{insights.performance.map((point, index) => { const x = (index / Math.max(insights.performance.length - 1, 1)) * (width - 20) + 10; const y = height - 22 - (point.value / max) * (height - 40); return <circle className="performance-point" key={`${point.date}-${index}`} cx={x} cy={y} r="4" fill="#b7ef72" stroke="#102126" strokeWidth="2"><title>{point.date} · {point.label}</title></circle>; })}</svg> : <div className="workspace-empty">Aucune performance enregistrée pour cette campagne.</div>}</div>;
}

function formatClock(value: string | null) {
  if (!value) return "•";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const match = value.match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "•";
}

function ReportModal({ report, onClose }: { report: DailyReport; onClose: () => void }) {
  const hasComment = Boolean(report.comment?.trim());
  const hasSubmission = hasComment;
  const metricTotal = (report.amount ?? 0) || (report.priv ?? 0) + (report.roam ?? 0) + (report.bund ?? 0);
  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer le rapport" onClick={onClose} /><div className={`modal-card daily-report-modal ${hasSubmission ? "" : "report-not-submitted"}`}><div className="modal-header"><div><div className="eyebrow"><CalendarDays size={13} /> Rapport du jour</div><h3>{formatExportDate(report.date)}</h3><span>{report.source === "attendance" ? "Registre de présence" : "Rapport journalier d’activité"}</span></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div>{!hasSubmission && <div className="report-missing-banner"><XCircle size={16} /><div><strong>Rapport non envoyé</strong><span>Aucun commentaire ou document de clôture n’a été enregistré pour cette journée.</span></div></div>}<div className="report-summary-grid"><div><small>Statut</small><strong>{report.status || (hasSubmission ? "Envoyé" : "Non envoyé")}</strong></div><div><small>Horaires</small><strong>{formatClock(report.checkinAt)} → {formatClock(report.checkoutAt)}</strong></div><div><small>Total</small><strong>{metricTotal || "—"}</strong></div></div><div className="report-detail-grid">{report.agentName && <div><small>Agent</small><strong>{report.agentName}</strong></div>}{report.shopName && <div><small>Point de vente</small><strong>{report.shopName}{report.shopId ? ` · ${report.shopId}` : ""}</strong></div>}{report.comment && <div className="report-comment"><small>Commentaire de clôture</small><p>{report.comment}</p></div>}{report.pdfUrl && <a className="button secondary compact" href={report.pdfUrl} target="_blank" rel="noreferrer"><FileText size={13} /> Ouvrir le PDF</a>}</div><div className="report-metrics"><span><b>{report.priv ?? 0}</b> Priv</span><span><b>{report.roam ?? 0}</b> Roam</span><span><b>{report.bund ?? 0}</b> Bund</span></div><div className="modal-actions"><button type="button" className="button primary" onClick={onClose}>Fermer</button></div></div></div></ViewportModal>;
}

const CLAIM_STATUS_LABELS: Record<CampaignClaimStatus, string> = { pending: "Nouveau", acknowledged: "Pris en compte", in_review: "En cours d’analyse", awaiting_agent: "Informations attendues", resolved: "Résolu", rejected: "Rejeté" };
const CLAIM_PRIORITY_LABELS: Record<CampaignClaim["priority"], string> = { low: "Faible", normal: "Normale", high: "Haute", critical: "Critique" };
const CLAIM_CATEGORY_LABELS: Record<CampaignClaim["category"], string> = { attendance: "Présence / pointage", payment: "Paiement", performance: "Performance", technical: "Problème technique", assignment: "Affectation", other: "Autre" };

function ClaimChoice<T extends string>({ value, options, onChange, label }: { value: T; options: Record<T, string>; onChange: (value: T) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(options) as Array<[T, string]>;
  return <div className={`claim-choice ${open ? "is-open" : ""}`}><span>{label}</span><button type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>{options[value]} <ChevronDown size={13} /></button>{open && <><button type="button" className="claim-choice-backdrop" aria-label="Fermer les options" onClick={() => setOpen(false)} /><div className="claim-choice-menu" role="listbox">{entries.map(([option, text]) => <button type="button" role="option" aria-selected={option === value} key={option} onClick={() => { onChange(option); setOpen(false); }}>{text}{option === value && <CheckCircle2 size={12} />}</button>)}</div></>}</div>;
}

export function CampaignClaimCaseModal({ claim, viewer, agent, campaign, users, canManage, onNotice, onChanged, onClose }: { claim: CampaignClaim; viewer: UserRecord; agent?: UserRecord; campaign?: CampaignRecord; users: UserRecord[]; canManage: boolean; onNotice: (notice: Notice) => void; onChanged?: (claim: CampaignClaim) => void; onClose: () => void }) {
  const [messages, setMessages] = useState<CampaignClaimMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [transitioning, setTransitioning] = useState<CampaignClaimStatus | null>(null);
  const [internal, setInternal] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const terminal = claim.status === "resolved" || claim.status === "rejected";

  useEffect(() => {
    let cancelled = false;
    setLoadingMessages(true);
    setHistoryError(null);
    void loadCampaignClaimMessages(viewer.id, claim.id).then((next) => { if (!cancelled) setMessages(next); }).catch((error) => { if (!cancelled) { const message = readableSupabaseError(error, "Impossible de charger l’historique du dossier."); setHistoryError(message); onNotice({ kind: "error", message }); } }).finally(() => { if (!cancelled) setLoadingMessages(false); });
    if (!canManage && claim.unread_count) void markCampaignClaimRead(viewer.id, claim.id).catch(() => undefined);
    return () => { cancelled = true; };
  }, [claim.id, claim.unread_count, canManage, historyAttempt, onNotice, viewer.id]);

  function authorName(authorId: string) { return users.find((user) => user.id === authorId)?.full_name || (authorId === viewer.id ? viewer.full_name : "Équipe BTL"); }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || terminal) return;
    setSending(true);
    try {
      const message = await addCampaignClaimMessage(viewer.id, claim.id, body, canManage && internal ? "internal" : "shared", canManage && claim.status === "awaiting_agent" ? "request_information" : "message");
      setMessages((current) => [...current, message]); setBody("");
      onNotice({ kind: "success", message: message.visibility === "internal" ? "Note interne ajoutée au dossier." : "Réponse ajoutée au dossier." });
      onChanged?.({ ...claim, updated_at: message.created_at, last_message_at: message.created_at, status: claim.status === "awaiting_agent" && !canManage ? "in_review" : claim.status });
    } catch (error) { onNotice({ kind: "error", message: readableSupabaseError(error, "Impossible d’ajouter le message.") }); } finally { setSending(false); }
  }

  async function transition(status: CampaignClaimStatus) {
    if (["awaiting_agent", "resolved", "rejected"].includes(status) && body.trim().length < 3) {
      onNotice({ kind: "error", message: status === "awaiting_agent" ? "Précisez les informations attendues de l’agent." : "Ajoutez une courte justification avant de clôturer le dossier." });
      return;
    }
    setTransitioning(status);
    try { const updated = await transitionCampaignClaim(claim.id, status, body); setBody(""); onChanged?.(updated); onNotice({ kind: "success", message: `Dossier ${CLAIM_STATUS_LABELS[updated.status].toLowerCase()}.` }); if (status === "resolved" || status === "rejected") onClose(); } catch (error) { onNotice({ kind: "error", message: readableSupabaseError(error, "Impossible de mettre à jour le dossier.") }); } finally { setTransitioning(null); }
  }

  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer le dossier" onClick={onClose} /><div className="modal-card claim-case-modal"><div className="modal-header"><div><div className="eyebrow"><FileText size={13} /> Dossier de réclamation</div><h3>{campaign?.name || "Campagne"}</h3><span>{agent?.full_name || "Agent"} · ouvert le {new Date(claim.created_at).toLocaleDateString("fr-FR")}</span></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div><div className="claim-case-meta"><span className={`claim-status status-${claim.status}`}><Clock3 size={12} /> {CLAIM_STATUS_LABELS[claim.status]}</span><span className={`claim-priority priority-${claim.priority}`}><AlertTriangle size={12} /> {CLAIM_PRIORITY_LABELS[claim.priority]}</span><span>{CLAIM_CATEGORY_LABELS[claim.category]}</span></div><div className="claim-case-original"><small>Réclamation initiale</small><p>{claim.description}</p></div>{canManage && !terminal && <div className="claim-case-actions"><div className="claim-case-note"><strong>Actions du dossier</strong><small>Rédigez votre réponse dans le champ unique situé sous l’historique, puis choisissez l’action à appliquer.</small><div className="claim-case-buttons"><button type="button" className="button secondary compact" onClick={() => void transition("in_review")} disabled={Boolean(transitioning)}>{transitioning === "in_review" ? <LoaderCircle className="spin" size={13} /> : <History size={13} />} Prendre en charge</button><button type="button" className="button secondary compact" onClick={() => void transition("awaiting_agent")} disabled={Boolean(transitioning)}>{transitioning === "awaiting_agent" ? <LoaderCircle className="spin" size={13} /> : <MessageCircle size={13} />} Demander des infos</button><button type="button" className="button primary compact" onClick={() => void transition("resolved")} disabled={Boolean(transitioning)}>{transitioning === "resolved" ? <LoaderCircle className="spin" size={13} /> : <CheckCircle2 size={13} />} Résoudre</button><button type="button" className="button danger-button compact" onClick={() => void transition("rejected")} disabled={Boolean(transitioning)}>{transitioning === "rejected" ? <LoaderCircle className="spin" size={13} /> : <XCircle size={13} />} Rejeter</button></div></div></div>}<div className="claim-thread"><div className="detail-section-title"><span><MessageCircle size={14} /> Historique du dossier</span><small>{messages.length} message{messages.length > 1 ? "s" : ""}</small></div>{loadingMessages ? <div className="workspace-loading"><LoaderCircle className="spin" size={16} /> Chargement de l’historique…</div> : historyError ? <div className="claim-history-error"><strong>Historique indisponible</strong><span>{historyError}</span><button type="button" className="button secondary compact" onClick={() => setHistoryAttempt((attempt) => attempt + 1)}><RefreshCw size={13} /> Réessayer</button></div> : messages.length ? <div className="claim-thread-list">{messages.map((message) => <article className={`claim-message ${message.visibility === "internal" ? "is-internal" : ""}`} key={message.id}><div className="claim-message-head"><strong>{authorName(message.author_id)}</strong><small>{message.visibility === "internal" ? "Note interne" : message.message_type === "request_information" ? "Informations demandées" : "Réponse"} · {new Date(message.created_at).toLocaleString("fr-FR")}</small></div><p>{message.body}</p></article>)}</div> : <div className="workspace-empty">Aucun échange supplémentaire.</div>}</div>{!terminal && <form className="claim-reply-form" onSubmit={sendMessage}><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={canManage ? "Réponse partagée, demande d’information ou justification…" : "Répondre à l’équipe…"} rows={3} required />{canManage && <label className="claim-internal-toggle"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /><span className="toggle-visual"><CheckCircle2 size={11} /></span><span>Note interne, invisible pour l’agent</span></label>}<div className="claim-reply-actions"><button type="submit" className="button primary compact" disabled={sending || !body.trim()}>{sending ? <LoaderCircle className="spin" size={13} /> : <Send size={13} />} Envoyer la réponse</button></div></form>}</div></div></ViewportModal>;
}

function AttendanceCalendar({ insights }: { insights: AgentInsights }) {
  const dayKey = (value: string | null | undefined) => value ? value.slice(0, 10) : null;
  const firstDate = dayKey(insights.presence[0]?.date) || dayKey(insights.campaignStart) || new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(`${firstDate.slice(0, 7)}-01`);
  const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);
  const monthDate = new Date(`${month}T00:00:00`);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const offset = (monthDate.getDay() + 6) % 7;
  const presence = new Map(insights.presence.map((entry) => [entry.date.slice(0, 10), entry]));
  const isPause = (date: string) => insights.pauses.some((pause) => { const start = dayKey(pause.starts_on); const end = dayKey(pause.ends_on) || start; return Boolean(start && date >= start && date <= end!); });
  const isInCampaign = (date: string) => (!dayKey(insights.campaignStart) || date >= dayKey(insights.campaignStart)!) && (!dayKey(insights.campaignEnd) || date <= dayKey(insights.campaignEnd)!) && !isPause(date);
  const calendarDays = Array.from({ length: offset + daysInMonth }, (_, index) => index < offset ? null : index - offset + 1);
  const moveMonth = (delta: number) => { const next = new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1); setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`); };
  const stats = insights.presence.reduce((result, entry) => { if (!isInCampaign(dayKey(entry.date) || "")) return result; if (entry.status === "closed" || entry.status === "présent" || entry.status === "rapport") result.green += 1; else result.blue += 1; return result; }, { green: 0, blue: 0 });
  const activePresenceCount = insights.presence.filter((entry) => isInCampaign(dayKey(entry.date) || "")).length;
  return <><div className="attendance-panel custom-calendar"><div className="calendar-heading"><span><CalendarDays size={14} /> Registre de présence</span><div className="calendar-nav"><button type="button" onClick={() => moveMonth(-1)} aria-label="Mois précédent"><ChevronLeft size={14} /></button><strong>{monthDate.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</strong><button type="button" onClick={() => moveMonth(1)} aria-label="Mois suivant"><ChevronRight size={14} /></button></div></div><div className="calendar-weekdays">{["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{calendarDays.map((day, index) => { if (!day) return <span className="calendar-day is-empty" key={`empty-${index}`} />; const date = `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`; const entry = presence.get(date); const inCampaign = isInCampaign(date); const missingReport = Boolean(inCampaign && entry?.report && !entry.report.comment?.trim()); const state = !inCampaign ? "is-off" : !entry ? "is-absent" : entry.status === "closed" || entry.status === "présent" || entry.status === "rapport" ? "is-closed" : "is-open"; return <button type="button" className={`calendar-day ${state} ${entry?.report ? "has-report" : ""} ${missingReport ? "report-missing" : ""}`} key={date} title={`${date} · ${!inCampaign ? isPause(date) ? "Campagne en pause / non active" : "Hors campagne" : entry ? entry.report?.comment ? "Ouvrir le rapport" : "Rapport non envoyé" : "Aucun travail enregistré"}`} onClick={() => inCampaign && entry?.report && setSelectedReport(entry.report)} disabled={!inCampaign || !entry?.report}><strong>{day}</strong>{entry && <small>{formatClock(entry.checkin_at)}</small>}{entry?.report && <i aria-hidden="true" />}</button>; })}</div><div className="calendar-legend"><span><i className="legend-dot is-off" /> Non active / hors campagne</span><span><i className="legend-dot is-closed" /> Travail clôturé</span><span><i className="legend-dot is-open" /> Travail non clôturé</span><span><i className="legend-dot is-absent" /> Non travaillé</span></div><div className="calendar-summary"><span><b>{stats.green}</b> clôturés</span><span><b>{stats.blue}</b> ouverts</span><span><b>{activePresenceCount}</b> pointages actifs</span></div></div>{selectedReport && <ReportModal report={selectedReport} onClose={() => setSelectedReport(null)} />}</>;
}

function safeFilePart(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "rapport";
}

function formatExportDate(value: string | null | undefined) {
  if (!value) return "—";
  const normalized = value.slice(0, 10);
  const date = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("fr-FR");
}

function formatExportClock(value: string | null | undefined) {
  if (!value) return "—";
  return formatClock(value);
}

async function exportXlsx(agent: UserRecord, campaign: CampaignRecord, insights: AgentInsights) {
  const XLSX = await import("xlsx-js-style");
  const closed = insights.presence.filter((entry) => ["closed", "présent", "rapport"].includes(entry.status)).length;
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: `Suivi ${agent.full_name} — ${campaign.name}`, Subject: "Performance et présence", Author: "BTL Africa", Company: "BTL Africa", CreatedDate: new Date() };
  const headerStyle = { fill: { fgColor: { rgb: "12383F" } }, font: { color: { rgb: "FFFFFF" }, bold: true, sz: 11 }, alignment: { vertical: "center" } };
  const sectionStyle = { fill: { fgColor: { rgb: "9EE9E8" } }, font: { color: { rgb: "082126" }, bold: true }, alignment: { vertical: "center" } };
  const labelStyle = { fill: { fgColor: { rgb: "E8F4F3" } }, font: { color: { rgb: "12383F" }, bold: true } };
  const addSheet = (name: string, rows: (string | number)[][], widths: number[], merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = []) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    sheet["!merges"] = merges;
    sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
    return sheet;
  };

  const summary = addSheet("Synthèse", [
    ["BTL AFRICA · RAPPORT DE SUIVI", "", ""],
    ["Agent", agent.full_name, ""],
    ["Téléphone", agent.phone, ""],
    ["Campagne", campaign.name, campaign.code],
    ["Période", `${formatExportDate(insights.campaignStart)} → ${formatExportDate(insights.campaignEnd)}`, ""],
    [],
    ["INDICATEURS CLÉS", "Valeur", ""],
    ["Jours de performance", insights.performance.length, ""],
    ["Pointages enregistrés", insights.presence.length, ""],
    ["Jours clôturés", closed, ""],
    ["Jours ouverts", Math.max(insights.presence.length - closed, 0), ""],
    [],
    ["LÉGENDE", "", ""],
    ["Vert", "Travail clôturé", ""],
    ["Bleu", "Travail non clôturé", ""],
    ["Rouge", "Non travaillé", ""],
    ["Gris", "Hors campagne ou pause", ""],
  ], [28, 38, 22], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, { s: { r: 6, c: 0 }, e: { r: 6, c: 2 } }, { s: { r: 12, c: 0 }, e: { r: 12, c: 2 } }]);
  summary["A1"].s = headerStyle;
  ["A7", "A13"].forEach((cell) => { summary[cell].s = sectionStyle; });
  ["A2", "A3", "A4", "A5"].forEach((cell) => { summary[cell].s = labelStyle; });

  const performance = addSheet("Performances", [["PERFORMANCES", "", ""], ["Date", "Valeur", "Libellé"], ...insights.performance.map((point) => [formatExportDate(point.date), point.value, point.label])], [18, 16, 42], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]);
  performance["A1"].s = headerStyle;
  performance["A2"].s = sectionStyle; performance["B2"].s = sectionStyle; performance["C2"].s = sectionStyle;
  performance["!autofilter"] = { ref: `A2:C${Math.max(insights.performance.length + 2, 2)}` };

  const attendance = addSheet("Présence", [["REGISTRE DE PRÉSENCE", "", "", "", ""], ["Date", "Statut", "Arrivée", "Départ", "Note"], ...insights.presence.map((entry) => [formatExportDate(entry.date), entry.status, formatExportClock(entry.checkin_at), formatExportClock(entry.checkout_at), entry.note || "—"])], [18, 20, 14, 14, 42], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }]);
  attendance["A1"].s = headerStyle;
  ["A2", "B2", "C2", "D2", "E2"].forEach((cell) => { attendance[cell].s = sectionStyle; });
  attendance["!autofilter"] = { ref: `A2:E${Math.max(insights.presence.length + 2, 2)}` };

  XLSX.writeFile(workbook, `${safeFilePart(agent.full_name)}-${safeFilePart(campaign.code)}-suivi.xlsx`, { bookType: "xlsx", compression: true });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function exportPdf(agent: UserRecord, campaign: CampaignRecord, insights: AgentInsights) {
  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) return;
  const closed = insights.presence.filter((entry) => ["closed", "présent", "rapport"].includes(entry.status)).length;
  popup.document.write(`<html><head><title>Suivi ${escapeHtml(agent.full_name)} — ${escapeHtml(campaign.name)}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#17343a;margin:0;font-size:11px}header{padding:22px 24px;border-radius:14px;background:#12383f;color:#fff}header .brand{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#9ee9e8;font-weight:700}h1{font-size:26px;margin:12px 0 5px;letter-spacing:-.04em}header p{margin:0;color:#c7e2e2;font-size:11px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.meta div,.kpi{padding:12px;border:1px solid #dce9e8;border-radius:10px;background:#f7fbfa}.meta b,.kpi b{display:block;margin-bottom:5px;color:#6c8588;font-size:8px;text-transform:uppercase;letter-spacing:.08em}.meta span{font-weight:700}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 24px}.kpi strong{font-size:20px;color:#12383f}.section-title{display:flex;align-items:center;gap:8px;margin:22px 0 8px;padding-bottom:7px;border-bottom:2px solid #9ee9e8;color:#12383f;font-size:14px}.section-title:before{content:"";width:6px;height:6px;border-radius:50%;background:#b5ef8c}table{width:100%;border-collapse:collapse;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th{padding:8px 9px;background:#12383f;color:#fff;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.05em}td{padding:8px 9px;border-bottom:1px solid #e2eded;color:#385257}tbody tr:nth-child(even){background:#f7fbfa}.footer{margin-top:25px;padding-top:9px;border-top:1px solid #dce9e8;color:#789095;font-size:9px;text-align:right}@media print{header{-webkit-print-color-adjust:exact;print-color-adjust:exact}th{ -webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><header><div class="brand">BTL Africa · Rapport de suivi</div><h1>${escapeHtml(agent.full_name)}</h1><p>${escapeHtml(campaign.name)} · ${escapeHtml(campaign.code)}</p></header><div class="meta"><div><b>Téléphone</b><span>${escapeHtml(agent.phone)}</span></div><div><b>Période</b><span>${escapeHtml(formatExportDate(insights.campaignStart))} → ${escapeHtml(formatExportDate(insights.campaignEnd))}</span></div><div><b>Indicateur</b><span>${escapeHtml(insights.metricLabel)}</span></div></div><div class="kpis"><div class="kpi"><b>Performances</b><strong>${insights.performance.length}</strong></div><div class="kpi"><b>Pointages</b><strong>${insights.presence.length}</strong></div><div class="kpi"><b>Clôturés</b><strong>${closed}</strong></div></div><div class="section-title">${escapeHtml(insights.metricLabel)}</div><table><thead><tr><th>Date</th><th>Valeur</th><th>Détail</th></tr></thead><tbody>${insights.performance.map((point) => `<tr><td>${escapeHtml(formatExportDate(point.date))}</td><td>${escapeHtml(point.value)}</td><td>${escapeHtml(point.label)}</td></tr>`).join("") || '<tr><td colspan="3">Aucune performance enregistrée.</td></tr>'}</tbody></table><div class="section-title">Registre de présence</div><table><thead><tr><th>Date</th><th>Statut</th><th>Arrivée</th><th>Départ</th><th>Note</th></tr></thead><tbody>${insights.presence.map((entry) => `<tr><td>${escapeHtml(formatExportDate(entry.date))}</td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(formatExportClock(entry.checkin_at))}</td><td>${escapeHtml(formatExportClock(entry.checkout_at))}</td><td>${escapeHtml(entry.note || "—")}</td></tr>`).join("") || '<tr><td colspan="5">Aucun pointage enregistré.</td></tr>'}</tbody></table><div class="footer">Généré le ${escapeHtml(new Date().toLocaleString("fr-FR"))} · BTL Africa</div></body></html>`);
  popup.document.close(); popup.focus(); window.setTimeout(() => popup.print(), 250);
}

export function AgentDetailModal({ agent, users, campaigns, assignments, campaignSupervisorAssignments, assignmentRequests, canRequest, canExport, canEdit, onEdit, onNotice, onClose }: AgentDetailProps) {
  const assignedIds = new Set([
    ...assignments.filter((assignment) => assignment.user_id === agent.id && assignment.is_active).map((assignment) => assignment.campaign_id),
    ...campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === agent.id && assignment.is_active).map((assignment) => assignment.campaign_id),
  ]);
  const assigned = campaigns.filter((campaign) => assignedIds.has(campaign.id));
  const compatible = campaigns.filter((campaign) => (campaign.status === "active" || campaign.status === "draft") && campaign.campaign_type === (agent.user_category === "hostess" ? "hostess" : "brand_ambassador"));
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(assigned[0] || null);
  const [insights, setInsights] = useState<AgentInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const pendingIds = new Set(assignmentRequests.filter((request) => request.user_id === agent.id && request.status === "pending").map((request) => request.campaign_id));
  const supervisorName = agent.supervisor_id ? users.find((user) => user.id === agent.supervisor_id)?.full_name || "—" : "—";

  useEffect(() => {
    let cancelled = false;
    if (!selectedCampaign) { setInsights(null); return () => { cancelled = true; }; }
    setLoadingInsights(true);
    void loadAgentInsights(agent, selectedCampaign).then((data) => { if (!cancelled) setInsights(data); }).catch((error) => { if (!cancelled) onNotice({ kind: "error", message: error instanceof Error ? error.message : "Impossible de charger le suivi." }); }).finally(() => { if (!cancelled) setLoadingInsights(false); });
    return () => { cancelled = true; };
  }, [agent, selectedCampaign, onNotice]);

  useEffect(() => {
    if (!canExport || !selectedCampaign || !insights) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "x") { event.preventDefault(); void exportXlsx(agent, selectedCampaign, insights); }
      if (event.key.toLowerCase() === "p") { event.preventDefault(); exportPdf(agent, selectedCampaign, insights); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [agent, canExport, insights, selectedCampaign]);

  async function requestAssignment(campaign: CampaignRecord) {
    setRequesting(campaign.id);
    try { await requestCampaignAssignment(agent.id, campaign.id); onNotice({ kind: "success", message: `Demande d’affectation envoyée pour ${campaign.name}.` }); } catch (error) { onNotice({ kind: "error", message: error instanceof Error ? error.message : "Demande impossible." }); } finally { setRequesting(null); }
  }

  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={onClose} /><div className="modal-card agent-detail-modal"><div className="modal-header"><div className="agent-detail-heading"><Avatar user={agent} size="large" /><div><div className="eyebrow"><UserCircle2 size={13} /> Fiche agent</div><h3>{agent.full_name}</h3><span>{CATEGORY_LABELS[agent.user_category || "operations"] || "Agent"}</span></div></div><div className="modal-header-actions">{canEdit && onEdit && <button type="button" className="button secondary compact" onClick={onEdit}><FilePenLine size={13} /> Modifier</button>}<button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div></div><div className="agent-contact"><CopyablePhone value={agent.phone} /><a className="button secondary compact call-agent-button" href={`tel:${agent.phone}`}><PhoneCall size={13} /> Appeler</a><span className="agent-supervisor-label"><small>Lime</small><strong>{supervisorName}</strong></span></div><div className="detail-section"><div className="detail-section-title"><span><BriefcaseBusiness size={14} /> Campagnes d’affectation</span><small>{assigned.length} active{assigned.length > 1 ? "s" : ""}</small></div><div className="detail-campaigns">{compatible.map((campaign) => { const isAssigned = assigned.some((item) => item.id === campaign.id); const isPending = pendingIds.has(campaign.id); const campaignSupervisors = campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === agent.id && assignment.campaign_id === campaign.id && assignment.is_active).map((assignment) => users.find((user) => user.id === assignment.supervisor_id)?.full_name).filter((name): name is string => Boolean(name)); return <div className={`detail-campaign ${isAssigned ? "is-assigned" : "is-unassigned"}`} key={campaign.id}><button type="button" onClick={() => isAssigned && setSelectedCampaign(campaign)} disabled={!isAssigned}><span>{campaign.name}</span><small>{isAssigned ? "Affecté · voir le suivi" : isPending ? "Demande en attente" : "Non affecté"}</small>{campaignSupervisors.length > 0 && <em className="detail-campaign-supervisors">Superviseurs : {campaignSupervisors.join(" · ")}</em>}</button>{!isAssigned && canRequest && !isPending && <button type="button" className="button secondary compact" onClick={() => void requestAssignment(campaign)} disabled={requesting === campaign.id}>{requesting === campaign.id ? <LoaderCircle className="spin" size={13} /> : <Users size={13} />} Demander</button>}</div>; })}</div>{!compatible.length && <div className="workspace-empty">Aucune campagne compatible disponible.</div>}</div>{selectedCampaign && <div className="detail-section"><div className="selected-campaign-title"><strong>{selectedCampaign.name}</strong><span>Suivi sélectionné</span></div>{loadingInsights ? <div className="workspace-loading"><LoaderCircle className="spin" size={18} /> Chargement du suivi…</div> : insights && <><ProgressChart insights={insights} /><AttendanceCalendar insights={insights} />{canExport && <div className="export-actions"><button type="button" className="button secondary compact" onClick={() => void exportXlsx(agent, selectedCampaign, insights)} aria-keyshortcuts="X"><FileSpreadsheet size={13} /> Exporter XLSX <kbd>X</kbd></button><button type="button" className="button secondary compact" onClick={() => exportPdf(agent, selectedCampaign, insights)} aria-keyshortcuts="P"><FileText size={13} /> Exporter PDF <kbd>P</kbd></button></div>}</>}</div>}</div></div></ViewportModal>;
}

export function ProfileModal({ profile, onClose, onSaved }: { profile: UserRecord; onClose: () => void; onSaved: (profile: UserRecord) => void }) {
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    if (fullName.trim().length < 2 || !isValidMsisdn(normalizePhone(phone))) { setError("Renseignez un nom et un MSISDN valides."); return; }
    setSaving(true);
    try { onSaved(await updateMyProfile({ fullName, phone, currentPassword, password: password || undefined, avatarUrl, avatarChanged: photoChanged })); onClose(); } catch (err) { setError(err instanceof Error ? err.message : "Impossible de mettre à jour le profil."); } finally { setSaving(false); }
  }
  function choosePhoto(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; if (!file.type.startsWith("image/")) { setError("Choisissez un fichier image."); return; } if (file.size > 520000) { setError("La photo doit faire moins de 500 Ko."); return; } const reader = new FileReader(); reader.onload = () => { setAvatarUrl(String(reader.result)); setPhotoChanged(true); setError(""); }; reader.readAsDataURL(file); }
  function removePhoto() { setAvatarUrl(null); setPhotoChanged(true); }
  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={onClose} /><form className="modal-card profile-modal" onSubmit={save}><div className="modal-header"><div><div className="eyebrow"><UserCircle2 size={13} /> Mon profil</div><h3>Informations personnelles</h3></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div><div className="profile-photo-editor"><div className="profile-photo-preview">{avatarUrl ? <img className="profile-avatar large" src={avatarUrl} alt="Aperçu de la photo de profil" /> : <Avatar user={profile} size="large" />}{avatarUrl && <button type="button" className="profile-photo-remove" onClick={removePhoto} aria-label="Supprimer la photo" title="Supprimer la photo"><XCircle size={13} /></button>}</div><div className="profile-photo-actions"><label className="button secondary compact"><Download size={13} /> Choisir une photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={choosePhoto} hidden /></label><small>JPG, PNG ou WebP · 500 Ko maximum · enregistrée dans le profil</small></div></div><label>Nom complet<input value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label><label>Numéro de téléphone<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" required /></label><label>Mot de passe actuel <small>Requis pour confirmer la modification</small><input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" autoComplete="current-password" required /></label><label>Nouveau mot de passe <small>Laisser vide pour conserver l’actuel</small><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} autoComplete="new-password" /></label>{error && <div className="connection-test">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button type="submit" className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <LockKeyhole size={14} />} Enregistrer</button></div></form></div></ViewportModal>;
}

export default function RoleWorkspace({ profile, users, superiors, campaigns, assignments, campaignSupervisorAssignments, assignmentRequests, campaignClaims, onNotice, onProfileUpdated, onProfileOpen, onRequestReviewed, simulation = false }: RoleWorkspaceProps) {
  const [selectedAgent, setSelectedAgent] = useState<UserRecord | null>(null);
  const [selectedSuperior, setSelectedSuperior] = useState<UserRecord | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(null);
  const [insights, setInsights] = useState<AgentInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [requestingCampaign, setRequestingCampaign] = useState<string | null>(null);
  const [reviewingRequest, setReviewingRequest] = useState<string | null>(null);
  const [claimText, setClaimText] = useState("");
  const [claimPriority, setClaimPriority] = useState<CampaignClaim["priority"]>("normal");
  const [claimCategory, setClaimCategory] = useState<CampaignClaim["category"]>("other");
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimSending, setClaimSending] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<CampaignClaim | null>(null);
  const [photoPreview, setPhotoPreview] = useState(false);
  const isAgent = profile.role === "agent";
  const scopedAgentIds = new Set(campaignSupervisorAssignments.filter((assignment) => assignment.supervisor_id === profile.id && assignment.is_active).map((assignment) => assignment.agent_id));
  const agents = users.filter((user) => user.role === "agent" && (profile.role !== "supervisor" || scopedAgentIds.has(user.id)));
  const assignedCampaignIds = new Set([
    ...assignments.filter((assignment) => assignment.user_id === profile.id && assignment.is_active).map((assignment) => assignment.campaign_id),
    ...campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === profile.id && assignment.is_active).map((assignment) => assignment.campaign_id),
  ]);
  const assignedCampaigns = campaigns.filter((campaign) => assignedCampaignIds.has(campaign.id));
  const operationalSuperiorIds = new Set(campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === profile.id && assignment.is_active).map((assignment) => assignment.supervisor_id));
  const superiorDirectory = Array.from(new Map([...superiors, ...users.filter((user) => ["supervisor", "sub_admin", "admin", "super_admin"].includes(user.role))].map((user) => [user.id, user])).values()).filter((user) => !isAgent || operationalSuperiorIds.has(user.id) || user.id === profile.supervisor_id).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const visibleCampaigns = campaigns.filter((campaign) => campaign.status === "active" || campaign.status === "draft");
  const selectedCampaignAssigned = Boolean(selectedCampaign && assignedCampaigns.some((campaign) => campaign.id === selectedCampaign.id));
  const requestIds = new Set(assignmentRequests.filter((request) => request.user_id === profile.id && request.status === "pending").map((request) => request.campaign_id));
  const ownClaims = campaignClaims.filter((claim) => claim.user_id === profile.id);

  useEffect(() => {
    if (!isAgent || !selectedCampaign || !selectedCampaignAssigned) {
      setInsights(null);
      setLoadingInsights(false);
      return;
    }
    let cancelled = false;
    setLoadingInsights(true);
    void loadAgentInsights(profile, selectedCampaign)
      .then((data) => { if (!cancelled) setInsights(data); })
      .catch((error) => { if (!cancelled) onNotice({ kind: "error", message: error instanceof Error ? error.message : "Impossible de charger le suivi." }); })
      .finally(() => { if (!cancelled) setLoadingInsights(false); });
    return () => { cancelled = true; };
  }, [isAgent, profile, selectedCampaign, selectedCampaignAssigned, onNotice]);

  function selectCampaign(campaign: CampaignRecord) {
    setSelectedCampaign(campaign);
    setInsights(null);
    setClaimOpen(false);
    setClaimText("");
  }

  async function requestAssignment(campaign: CampaignRecord) {
    if (simulation) { onNotice({ kind: "error", message: "La simulation est en lecture seule. Quittez-la pour demander une affectation." }); return; }
    setRequestingCampaign(campaign.id);
    try { await requestCampaignAssignment(profile.id, campaign.id); onNotice({ kind: "success", message: `Demande envoyée pour ${campaign.name}.` }); } catch (error) { onNotice({ kind: "error", message: error instanceof Error ? error.message : "Demande impossible." }); } finally { setRequestingCampaign(null); }
  }

  async function submitClaim(event: FormEvent) {
    event.preventDefault();
    if (!selectedCampaign || !selectedCampaignAssigned) return;
    if (simulation) { onNotice({ kind: "error", message: "La simulation est en lecture seule. Quittez-la pour envoyer une réclamation." }); return; }
    if (claimText.trim().length < 3) { onNotice({ kind: "error", message: "Décrivez brièvement votre réclamation." }); return; }
    setClaimSending(true);
    try {
      await createCampaignClaim(profile.id, selectedCampaign.id, claimText, claimPriority, claimCategory);
      setClaimText(""); setClaimPriority("normal"); setClaimCategory("other");
      setClaimOpen(false);
      onNotice({ kind: "success", message: `Réclamation envoyée pour ${selectedCampaign.name}.` });
    } catch (error) {
      onNotice({ kind: "error", message: readableSupabaseError(error, "Impossible d’envoyer la réclamation.") });
    } finally { setClaimSending(false); }
  }

  async function reviewRequest(request: CampaignAssignmentRequest, approve: boolean) {
    if (simulation) { onNotice({ kind: "error", message: "La simulation est en lecture seule. Quittez-la pour traiter une demande." }); return; }
    setReviewingRequest(request.id);
    try { await reviewCampaignAssignmentRequest(request.id, approve); onRequestReviewed(); onNotice({ kind: "success", message: approve ? "Demande approuvée." : "Demande rejetée." }); } catch (error) { onNotice({ kind: "error", message: error instanceof Error ? error.message : "Impossible de traiter la demande." }); } finally { setReviewingRequest(null); }
  }

  return <section className="role-workspace">
    <div className="workspace-hero"><div className="workspace-identity"><div className="workspace-profile-hero"><button type="button" className="workspace-profile-photo-button" onClick={() => setPhotoPreview(true)} aria-label="Agrandir ma photo de profil"><Avatar user={profile} size="large" /></button><button type="button" className="workspace-profile-edit" onClick={onProfileOpen} aria-label="Modifier mon profil" title="Modifier mon profil"><FilePenLine size={11} /></button></div><div><div className="eyebrow">{isAgent ? "Espace agent" : "Espace superviseur"}</div><h2>Bonjour, {profile.full_name}</h2><p>{isAgent ? "Sélectionnez une campagne pour consulter votre performance et votre présence." : "Consultez les équipes, les campagnes et les suivis terrain."}</p></div></div></div>
    <div className="workspace-grid">
      <section className="workspace-card superiors-card"><div className="workspace-card-heading"><span><Users size={15} /> Équipe de coordination</span><small>{superiorDirectory.length}</small></div><div className="superior-list">{superiorDirectory.map((superior) => { const isOperational = isAgent && operationalSuperiorIds.has(superior.id); const superiorCampaigns = campaigns.filter((campaign) => campaignSupervisorAssignments.some((assignment) => assignment.agent_id === profile.id && assignment.supervisor_id === superior.id && assignment.campaign_id === campaign.id && assignment.is_active)); const isClickable = isAgent && (isOperational || superior.id === profile.supervisor_id); const content = <><Avatar user={superior} /><div><strong>{superior.full_name}</strong><small>{ROLE_LABELS[superior.role]}{isAgent ? "" : <> · <CopyablePhone value={superior.phone} /></>}</small>{isAgent && superiorCampaigns.length > 0 && <span className="superior-campaigns">{superiorCampaigns.map((campaign) => campaign.name).join(" · ")}</span>}</div>{isClickable && <span className="superior-open">Voir la fiche</span>}</>; return isClickable ? <button type="button" className="superior-row is-clickable" key={superior.id} onClick={() => setSelectedSuperior(superior)} aria-label={`Ouvrir la fiche de ${superior.full_name}`}>{content}</button> : <div className="superior-row" key={superior.id}>{content}</div>; })}</div>{!superiorDirectory.length && <div className="workspace-empty">Aucun responsable disponible.</div>}</section>
      {!isAgent && <section className="workspace-card agents-card"><div className="workspace-card-heading"><span><Users size={15} /> Agents</span><small>{agents.length}</small></div><div className="agent-list">{agents.map((agent) => { const campaignCount = new Set([...assignments.filter((assignment) => assignment.user_id === agent.id && assignment.is_active).map((assignment) => assignment.campaign_id), ...campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === agent.id && assignment.is_active).map((assignment) => assignment.campaign_id)]).size; return <button type="button" className="agent-list-row" key={agent.id} onClick={() => setSelectedAgent(agent)}><Avatar user={agent} /><span><strong>{agent.full_name}</strong><small>{categoryShortLabel(agent.user_category)} · {campaignCount} campagne(s)</small></span><span className="agent-list-arrow">›</span></button>; })}</div></section>}
    </div>
    {!isAgent && assignmentRequests.length > 0 && <section className="workspace-card request-queue"><div className="workspace-card-heading"><span><BriefcaseBusiness size={15} /> Demandes d’affectation</span><small>{assignmentRequests.length}</small></div><div className="request-queue-list">{assignmentRequests.map((request) => { const agent = users.find((user) => user.id === request.user_id); const campaign = campaigns.find((item) => item.id === request.campaign_id); if (!agent || !campaign) return null; return <div className="request-queue-row" key={request.id}><div><strong>{agent.full_name}</strong><small>{campaign.name} · {new Date(request.requested_at).toLocaleDateString("fr-FR")}</small></div><div className="request-queue-actions"><button type="button" className="icon-action approve" onClick={() => void reviewRequest(request, true)} disabled={reviewingRequest === request.id} aria-label="Approuver"><CheckCircle2 size={14} /></button><button type="button" className="icon-action delete" onClick={() => void reviewRequest(request, false)} disabled={reviewingRequest === request.id} aria-label="Rejeter"><XCircle size={14} /></button></div></div>; })}</div></section>}
    {!isAgent && campaignClaims.length > 0 && <section className="workspace-card request-queue claim-queue"><div className="workspace-card-heading"><span><FileText size={15} /> Réclamations campagne</span><small>{campaignClaims.length}</small></div><div className="request-queue-list">{campaignClaims.map((claim) => { const agent = users.find((user) => user.id === claim.user_id); const campaign = campaigns.find((item) => item.id === claim.campaign_id); if (!agent || !campaign) return null; return <button type="button" className="request-queue-row claim-queue-row" key={claim.id} onClick={() => setSelectedClaim(claim)}><div><strong>{agent.full_name} · {campaign.name}</strong><small>{CLAIM_STATUS_LABELS[claim.status]} · {CLAIM_PRIORITY_LABELS[claim.priority]} · {new Date(claim.updated_at || claim.created_at).toLocaleDateString("fr-FR")}</small><span>{claim.description}</span></div><div className="request-queue-actions"><span className="button secondary compact">Ouvrir le dossier</span></div></button>; })}</div></section>}
    {isAgent && <section className="workspace-card selected-followup agent-followup"><div className="workspace-card-heading"><span><BriefcaseBusiness size={15} /> Performance & présence</span><small>{assignedCampaigns.length} affectée{assignedCampaigns.length > 1 ? "s" : ""}</small></div><CampaignPicker campaigns={visibleCampaigns} value={selectedCampaign} onChange={selectCampaign} />{!selectedCampaign && <div className="workspace-empty followup-empty">Aucune campagne disponible pour le moment.</div>}{selectedCampaign && !selectedCampaignAssigned && <div className="followup-unassigned"><div><strong>Vous n’êtes pas affecté(e) à cette campagne.</strong><small>Vous pouvez demander votre affectation à l’équipe de coordination.</small></div>{!requestIds.has(selectedCampaign.id) ? <button type="button" className="button secondary compact" onClick={() => void requestAssignment(selectedCampaign)} disabled={requestingCampaign === selectedCampaign.id}>{requestingCampaign === selectedCampaign.id ? <LoaderCircle className="spin" size={13} /> : <Users size={13} />} Demander</button> : <span className="pending-pill">Demande en attente</span>}</div>}{selectedCampaign && selectedCampaignAssigned && <div className="campaign-supervisor-strip"><span>Supervision opérationnelle</span><div>{Array.from(new Set(campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === profile.id && assignment.campaign_id === selectedCampaign.id && assignment.is_active).map((assignment) => assignment.supervisor_id))).map((supervisorId) => users.find((user) => user.id === supervisorId)).filter((user): user is UserRecord => Boolean(user)).map((supervisor) => <button type="button" key={supervisor.id} onClick={() => setSelectedSuperior(supervisor)}>{supervisor.full_name}</button>)}</div></div>}{selectedCampaign && selectedCampaignAssigned && (loadingInsights ? <div className="workspace-loading"><LoaderCircle className="spin" size={18} /> Chargement du suivi…</div> : insights ? <><ProgressChart insights={insights} /><AttendanceCalendar insights={insights} /><div className="claim-area"><div className="claim-area-heading"><div><strong>Un problème sur cette campagne ?</strong><small>Signalez une erreur de pointage, de paiement ou de suivi.</small></div>{!claimOpen && <button type="button" className="button secondary compact" onClick={() => setClaimOpen(true)} disabled={simulation}><FileText size={13} /> Nouvelle réclamation</button>}</div>{ownClaims.filter((claim) => claim.campaign_id === selectedCampaign.id && !["resolved", "rejected"].includes(claim.status)).map((claim) => <button type="button" className="claim-own-card" key={claim.id} onClick={() => setSelectedClaim(claim)}><span><strong>{CLAIM_STATUS_LABELS[claim.status]}</strong><small>{claim.unread_count ? `${claim.unread_count} nouvelle${claim.unread_count > 1 ? "s" : ""} réponse${claim.unread_count > 1 ? "s" : ""}` : "Ouvrir le dossier et voir l’historique"}</small></span><ChevronRight size={14} /></button>)}{claimOpen && <form className="claim-form" onSubmit={submitClaim}><textarea value={claimText} onChange={(event) => setClaimText(event.target.value)} placeholder="Décrivez votre réclamation…" rows={3} autoFocus /><div className="claim-choice-row"><ClaimChoice label="Type" value={claimCategory} options={CLAIM_CATEGORY_LABELS} onChange={setClaimCategory} /><ClaimChoice label="Priorité" value={claimPriority} options={CLAIM_PRIORITY_LABELS} onChange={setClaimPriority} /></div><div><button type="button" className="button secondary compact" onClick={() => { setClaimOpen(false); setClaimText(""); }}>Annuler</button><button type="submit" className="button primary compact" disabled={claimSending}>{claimSending ? <LoaderCircle className="spin" size={13} /> : <CheckCircle2 size={13} />} Envoyer</button></div></form>}</div></> : <div className="workspace-empty">Aucun suivi disponible pour cette campagne.</div>)}</section>}
    {selectedAgent && <AgentDetailModal agent={selectedAgent} users={users} campaigns={campaigns} assignments={assignments} campaignSupervisorAssignments={campaignSupervisorAssignments} assignmentRequests={assignmentRequests} canRequest={false} canExport onNotice={onNotice} onClose={() => setSelectedAgent(null)} />}{selectedSuperior && <UserDetailModal user={selectedSuperior} users={users} superiors={superiorDirectory} campaigns={campaigns} assignments={assignments} campaignSupervisorAssignments={campaignSupervisorAssignments} assignmentRequests={assignmentRequests} requester={profile} canRequest={isAgent && !simulation} onNotice={onNotice} onClose={() => setSelectedSuperior(null)} />}{selectedClaim && <CampaignClaimCaseModal claim={selectedClaim} viewer={profile} agent={users.find((user) => user.id === selectedClaim.user_id)} campaign={campaigns.find((campaign) => campaign.id === selectedClaim.campaign_id)} users={users} canManage={!isAgent} onNotice={onNotice} onChanged={(updated) => { setSelectedClaim(updated); onRequestReviewed(); }} onClose={() => setSelectedClaim(null)} />}{photoPreview && <ProfilePhotoPreviewModal user={profile} onClose={() => setPhotoPreview(false)} />}
  </section>;
}
