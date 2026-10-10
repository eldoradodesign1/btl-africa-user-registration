import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, BriefcaseBusiness, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FilePenLine, FileSpreadsheet, FileText, History, LoaderCircle, LockKeyhole, MessageCircle, PhoneCall, RefreshCw, Send, UserCircle2, Users, X, XCircle } from "lucide-react";
import { CopyablePhone, CopyableValue } from "@/components/CopyablePhone";
import { CATEGORY_LABELS, ROLE_LABELS, campaignTypeLabel, categoryShortLabel, isCampaignCompatibleWithCategory } from "@/lib/user-form";
import { isValidMsisdn, normalizePhone } from "@/lib/phone";
import { createAttendanceClaim, loadAgentInsights, loadDailyReportPdfUrl, readableSupabaseError, requestCampaignAssignment, reviewAttendanceClaim, reviewCampaignAssignmentRequest, updateMyProfile, type AgentInsights, type AttendanceClaim, type CampaignAssignment, type CampaignAssignmentRequest, type CampaignRecord, type CampaignSupervisorAssignment, type DailyReport, type PresenceRecord, type ShopRecord, type UserRecord } from "@/lib/supabase";

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
  shops: ShopRecord[];
  assignments: CampaignAssignment[];
  campaignSupervisorAssignments: CampaignSupervisorAssignment[];
  assignmentRequests: CampaignAssignmentRequest[];
  attendanceClaims: AttendanceClaim[];
  onNotice: (notice: Notice) => void;
  onProfileUpdated: (profile: UserRecord) => void;
  onProfileOpen: () => void;
  onRequestReviewed: () => void;
  simulation?: boolean;
};

type AgentDetailProps = {
  agent: UserRecord;
  password?: string | null;
  users: UserRecord[];
  campaigns: CampaignRecord[];
  shops: ShopRecord[];
  assignments: CampaignAssignment[];
  campaignSupervisorAssignments: CampaignSupervisorAssignment[];
  assignmentRequests: CampaignAssignmentRequest[];
  attendanceClaims: AttendanceClaim[];
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
  return <div className={`agent-campaign-picker ${open ? "is-open" : ""}`}><button type="button" className="agent-campaign-picker-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span><BriefcaseBusiness size={14} />{value ? value.name : "Choisir une campagne"}</span><ChevronRight className={`agent-campaign-picker-chevron ${open ? "is-open" : ""}`} size={15} /></button>{open && <><button type="button" className="agent-campaign-picker-backdrop" aria-label="Fermer la liste des campagnes" onClick={() => setOpen(false)} /><div className="agent-campaign-picker-menu" role="listbox">{campaigns.map((campaign) => <button type="button" role="option" aria-selected={campaign.id === value?.id} className={campaign.id === value?.id ? "is-selected" : ""} key={campaign.id} onClick={() => { onChange(campaign); setOpen(false); }}><span><strong>{campaign.name}</strong><small>{campaignTypeLabel(campaign.campaign_type)} · {campaign.status === "active" ? "Active" : "Brouillon"}</small></span>{campaign.id === value?.id && <CheckCircle2 size={14} />}</button>)}</div></>}</div>;
}

export function Avatar({ user, size = "small" }: { user: UserRecord; size?: "small" | "large" }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [user.avatar_url, user.profile_updated_at]);
  const imageSource = user.avatar_url && /^https?:\/\//i.test(user.avatar_url) ? `${user.avatar_url}${user.avatar_url.includes("?") ? "&" : "?"}v=${encodeURIComponent(user.profile_updated_at || "1")}` : user.avatar_url;
  return imageSource && !imageFailed ? <img className={`profile-avatar ${size}`} src={imageSource} alt={`${user.full_name} — photo de profil`} loading="lazy" decoding="async" onError={() => setImageFailed(true)} /> : <div className={`avatar ${size === "small" ? "small" : ""}`} aria-label={`${user.full_name} — initiale`}>{user.full_name.slice(0, 1).toUpperCase()}</div>;
}

export function ProfilePhotoPreviewModal({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  const [photoRatio, setPhotoRatio] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setPhotoRatio(1); setImageFailed(false); }, [user.avatar_url, user.profile_updated_at]);
  const imageSource = user.avatar_url && /^https?:\/\//i.test(user.avatar_url) ? `${user.avatar_url}${user.avatar_url.includes("?") ? "&" : "?"}v=${encodeURIComponent(user.profile_updated_at || "1")}` : user.avatar_url;
  return <ViewportModal><div className="modal-layer profile-photo-lightbox"><button className="modal-backdrop" type="button" aria-label="Fermer la photo" onClick={onClose} /><div className="profile-photo-lightbox-card"><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button><div className="profile-photo-lightbox-media" style={{ "--photo-ratio": photoRatio } as React.CSSProperties}>{imageSource && !imageFailed ? <img className="profile-photo-lightbox-image" src={imageSource} alt={`Photo de profil de ${user.full_name}`} loading="eager" decoding="async" onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setPhotoRatio(image.naturalWidth / image.naturalHeight); }} onError={() => setImageFailed(true)} /> : <Avatar user={user} size="large" />}</div><strong>{user.full_name}</strong><small>{ROLE_LABELS[user.role]}</small></div></div></ViewportModal>;
}

export function UserDetailModal({ user, users = [], superiors, campaigns, assignments, campaignSupervisorAssignments, assignmentRequests, requester, canRequest, onNotice, onClose }: UserDetailProps) {
  const [requestingCampaign, setRequestingCampaign] = useState<string | null>(null);
  const [requestedCampaignIds, setRequestedCampaignIds] = useState<string[]>([]);
  const requesterCategory = requester?.user_category;
  const compatibleCampaigns = requester?.role === "agent"
    ? campaigns.filter((campaign) => (campaign.status === "active" || campaign.status === "draft") && isCampaignCompatibleWithCategory(campaign.campaign_type, requesterCategory || null))
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
  const [pdfUrl, setPdfUrl] = useState(report.pdfUrl);
  const hasComment = Boolean(report.comment?.trim());
  const hasSubmission = hasComment;
  const metricTotal = (report.amount ?? 0) || (report.priv ?? 0) + (report.roam ?? 0) + (report.bund ?? 0);
  useEffect(() => {
    let cancelled = false;
    if (pdfUrl || report.source !== "daily_report" || !report.id) return () => { cancelled = true; };
    void loadDailyReportPdfUrl(report.id).then((url) => { if (!cancelled) setPdfUrl(url); }).catch(() => { /* Le rapport reste consultable sans son lien PDF. */ });
    return () => { cancelled = true; };
  }, [pdfUrl, report.id, report.source]);
  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer le rapport" onClick={onClose} /><div className={`modal-card daily-report-modal ${hasSubmission ? "" : "report-not-submitted"}`}><div className="modal-header"><div><div className="eyebrow"><CalendarDays size={13} /> Rapport du jour</div><h3>{formatExportDate(report.date)}</h3><span>{report.source === "attendance" ? "Registre de présence" : "Rapport journalier d’activité"}</span></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div>{!hasSubmission && <div className="report-missing-banner"><XCircle size={16} /><div><strong>Rapport non envoyé</strong><span>Aucun commentaire ou document de clôture n’a été enregistré pour cette journée.</span></div></div>}<div className="report-summary-grid"><div><small>Statut</small><strong>{report.status || (hasSubmission ? "Envoyé" : "Non envoyé")}</strong></div><div><small>Horaires</small><strong>{formatClock(report.checkinAt)} → {formatClock(report.checkoutAt)}</strong></div><div><small>Activations</small><strong>{report.activationCount || metricTotal || "—"}</strong></div></div><div className="report-detail-grid">{report.agentName && <div><small>Agent</small><strong>{report.agentName}</strong></div>}{report.shopName && <div><small>Point de vente</small><strong>{report.shopName}{report.shopId ? ` · ${report.shopId}` : ""}</strong></div>}{report.activationDetails && <div className="report-comment"><small>Détail des activations</small><p>{report.activationDetails}</p></div>}{report.comment && <div className="report-comment"><small>Commentaire de clôture</small><p>{report.comment}</p></div>}{pdfUrl && <a className="button secondary compact" href={pdfUrl} target="_blank" rel="noreferrer"><FileText size={13} /> Ouvrir le PDF</a>}</div><div className="report-metrics"><span><b>{report.priv ?? 0}</b> Priv</span><span><b>{report.roam ?? 0}</b> Roam</span><span><b>{report.bund ?? 0}</b> Bund</span></div><div className="modal-actions"><button type="button" className="button primary" onClick={onClose}>Fermer</button></div></div></div></ViewportModal>;
}

const ATTENDANCE_CLAIM_STATUS_LABELS: Record<AttendanceClaim["status"], string> = { pending: "En attente", approved: "Acceptée", rejected: "Rejetée" };

function ShopChoice({ value, shops, onChange }: { value: string; shops: ShopRecord[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = shops.find((shop) => shop.id === value)?.name || "Choisir un shop";
  return <div className={`claim-choice ${open ? "is-open" : ""}`}><span>Shop concerné <small>(facultatif)</small></span><button type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>{label}<ChevronDown size={13} /></button>{open && <><button type="button" className="claim-choice-backdrop" aria-label="Fermer les shops" onClick={() => setOpen(false)} /><div className="claim-choice-menu" role="listbox"><button type="button" role="option" onClick={() => { onChange(""); setOpen(false); }}>Aucun shop</button>{shops.map((shop) => <button type="button" role="option" aria-selected={shop.id === value} key={shop.id} onClick={() => { onChange(shop.id); setOpen(false); }}>{shop.name}{shop.id === value && <CheckCircle2 size={12} />}</button>)}</div></>}</div>;
}

export function AttendanceClaimFormModal({ agent, campaign, date, shops, onNotice, onCreated, onClose }: { agent: UserRecord; campaign: CampaignRecord; date: string; shops: ShopRecord[]; onNotice: (notice: Notice) => void; onCreated: (claim: AttendanceClaim) => void; onClose: () => void }) {
  const [arrivalTime, setArrivalTime] = useState("08:00");
  const [departureTime, setDepartureTime] = useState("17:00");
  const [activationCount, setActivationCount] = useState("0");
  const [activationDetails, setActivationDetails] = useState("");
  const [closingComment, setClosingComment] = useState("");
  const [shopId, setShopId] = useState(agent.permanent_shop_id || "");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const count = Number.parseInt(activationCount, 10);
    if (!Number.isInteger(count) || count < 0 || activationDetails.trim().length < 3 || closingComment.trim().length < 3) {
      onNotice({ kind: "error", message: "Renseignez un nombre d’activations valide, leur détail et le commentaire de clôture." });
      return;
    }
    if (departureTime <= arrivalTime) {
      onNotice({ kind: "error", message: "L’heure de départ doit être postérieure à l’heure d’arrivée." });
      return;
    }
    setSaving(true);
    try {
      const claim = await createAttendanceClaim({ userId: agent.id, campaignId: campaign.id, date, arrivalTime, departureTime, activationCount: count, activationDetails, closingComment, shopId: shopId || null });
      onCreated(claim);
      onNotice({ kind: "success", message: `Demande envoyée pour le ${formatExportDate(date)}. Elle sera vérifiée par les responsables autorisés.` });
      onClose();
    } catch (error) {
      onNotice({ kind: "error", message: readableSupabaseError(error, "Impossible d’envoyer la demande de présence.") });
    } finally { setSaving(false); }
  }
  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer la demande" onClick={onClose} /><form className="modal-card attendance-claim-modal" onSubmit={submit}><div className="modal-header"><div><div className="eyebrow"><CalendarDays size={13} /> Demander la validation d’une journée</div><h3>{formatExportDate(date)}</h3><span>{agent.full_name} · {campaign.name}</span></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div><p className="modal-helper">Cette demande créera les pointages et le rapport uniquement après acceptation par un administrateur ou le superviseur opérationnel de cette campagne.</p><div className="attendance-claim-time-grid"><label>Heure d’arrivée<input type="time" value={arrivalTime} onChange={(event) => setArrivalTime(event.target.value)} required /></label><label>Heure de départ<input type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} required /></label></div><ShopChoice value={shopId} shops={shops} onChange={setShopId} /><label>Nombre total d’activations<input type="number" min="0" step="1" value={activationCount} onChange={(event) => setActivationCount(event.target.value)} required /></label><label>Détail des activations<textarea value={activationDetails} onChange={(event) => setActivationDetails(event.target.value)} placeholder="Précisez les activations réalisées…" rows={3} required /></label><label>Commentaire de clôture<textarea value={closingComment} onChange={(event) => setClosingComment(event.target.value)} placeholder="Expliquez la journée et les éventuelles difficultés…" rows={3} required /></label><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Annuler</button><button type="submit" className="button primary" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} Envoyer la demande</button></div></form></div></ViewportModal>;
}

export function AttendanceClaimReviewModal({ claim, agent, campaign, shops, canReview, onNotice, onChanged, onClose }: { claim: AttendanceClaim; agent?: UserRecord; campaign?: CampaignRecord; shops: ShopRecord[]; canReview: boolean; onNotice: (notice: Notice) => void; onChanged?: (claim: AttendanceClaim) => void; onClose: () => void }) {
  const [reviewNote, setReviewNote] = useState(claim.review_note || "");
  const [shopId, setShopId] = useState(claim.shop_id || agent?.permanent_shop_id || "");
  const [saving, setSaving] = useState(false);
  async function review(status: "approved" | "rejected") {
    if (status === "rejected" && reviewNote.trim().length < 3) { onNotice({ kind: "error", message: "Ajoutez une justification avant de rejeter la demande." }); return; }
    setSaving(true);
    try {
      const updated = await reviewAttendanceClaim(claim.id, status, reviewNote, shopId || null);
      onChanged?.(updated);
      onNotice({ kind: "success", message: status === "approved" ? "La présence a été acceptée et générée." : "La demande de présence a été rejetée." });
      onClose();
    } catch (error) { onNotice({ kind: "error", message: readableSupabaseError(error, "Impossible de traiter la demande de présence.") }); } finally { setSaving(false); }
  }
  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer la demande" onClick={onClose} /><div className="modal-card attendance-claim-review-modal"><div className="modal-header"><div><div className="eyebrow"><CalendarDays size={13} /> Demande de présence</div><h3>{formatExportDate(claim.claim_date)}</h3><span>{agent?.full_name || "Agent"} · {campaign?.name || "Campagne"}</span></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div><div className={`attendance-claim-status is-${claim.status}`}><strong>{ATTENDANCE_CLAIM_STATUS_LABELS[claim.status]}</strong><span>{claim.reviewed_at ? `Traitée le ${new Date(claim.reviewed_at).toLocaleDateString("fr-FR")}` : "En attente de vérification"}</span></div><div className="report-summary-grid"><div><small>Horaires demandés</small><strong>{claim.arrival_time} → {claim.departure_time}</strong></div><div><small>Activations</small><strong>{claim.activation_count}</strong></div><div><small>Shop</small><strong>{shops.find((shop) => shop.id === (shopId || claim.shop_id))?.name || "—"}</strong></div></div><div className="attendance-claim-detail"><div><small>Détail des activations</small><p>{claim.activation_details}</p></div><div><small>Commentaire de clôture</small><p>{claim.closing_comment}</p></div></div>{claim.review_note && <div className="attendance-claim-note"><small>Note du responsable</small><p>{claim.review_note}</p></div>}{canReview && claim.status === "pending" && <div className="attendance-claim-review-form"><ShopChoice value={shopId} shops={shops} onChange={setShopId} /><label>Complément ou justification <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Facultatif pour accepter, obligatoire pour rejeter…" rows={3} /></label><div className="modal-actions"><button type="button" className="button danger-button" onClick={() => void review("rejected")} disabled={saving}><XCircle size={14} /> Rejeter</button><button type="button" className="button primary" onClick={() => void review("approved")} disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} Accepter et générer</button></div></div>}{!canReview && claim.status === "pending" && <div className="workspace-empty">Vous pouvez consulter cette demande, mais seul l’administrateur ou le superviseur opérationnel de l’agent peut la traiter.</div>}</div></div></ViewportModal>;
}

function AttendanceCalendar({ insights, claims = [], canClaim = false, onRequestClaim, onOpenClaim }: { insights: AgentInsights; claims?: AttendanceClaim[]; canClaim?: boolean; onRequestClaim?: (date: string) => void; onOpenClaim?: (claim: AttendanceClaim) => void }) {
  const firstDate = dayKey(insights.presence[0]?.date) || dayKey(insights.campaignStart) || new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(`${firstDate.slice(0, 7)}-01`);
  const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);
  const monthDate = new Date(`${month}T00:00:00`);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const offset = (monthDate.getDay() + 6) % 7;
  const presence = insights.presence.reduce((byDate, entry) => {
    const date = dayKey(entry.date);
    if (!date) return byDate;
    const previous = byDate.get(date);
    if (!previous || (hasPointage(entry) && !hasPointage(previous))) byDate.set(date, entry);
    return byDate;
  }, new Map<string, PresenceRecord>());
  const claimsByDate = new Map(claims.map((claim) => [dayKey(claim.claim_date), claim] as const));
  const isPause = (date: string) => insights.pauses.some((pause) => { const start = dayKey(pause.starts_on); const end = dayKey(pause.ends_on) || start; return Boolean(start && date >= start && date <= end!); });
  const isInCampaign = (date: string) => (!dayKey(insights.campaignStart) || date >= dayKey(insights.campaignStart)!) && (!dayKey(insights.campaignEnd) || date <= dayKey(insights.campaignEnd)!) && !isPause(date);
  const calendarDays = Array.from({ length: offset + daysInMonth }, (_, index) => index < offset ? null : index - offset + 1);
  const moveMonth = (delta: number) => { const next = new Date(monthDate.getFullYear(), monthDate.getMonth() + delta, 1); setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`); };
  const metrics = getAttendanceCalendarMetrics(insights);
  return <><div className="attendance-panel custom-calendar"><div className="calendar-heading"><span><CalendarDays size={14} /> Registre de présence</span><div className="calendar-nav"><button type="button" onClick={() => moveMonth(-1)} aria-label="Mois précédent"><ChevronLeft size={14} /></button><strong>{monthDate.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</strong><button type="button" onClick={() => moveMonth(1)} aria-label="Mois suivant"><ChevronRight size={14} /></button></div></div><div className="calendar-weekdays">{["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{calendarDays.map((day, index) => { if (!day) return <span className="calendar-day is-empty" key={`empty-${index}`} />; const date = `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`; const entry = presence.get(date); const claim = claimsByDate.get(date); const inCampaign = isInCampaign(date); const state = !inCampaign ? "is-off" : !entry || !hasPointage(entry) ? "is-absent" : isClosedPresence(entry) ? "is-closed" : "is-open"; const canOpenReport = Boolean(inCampaign && entry?.report); const canOpenClaim = Boolean(claim && onOpenClaim); const canCreateClaim = Boolean(canClaim && inCampaign && state === "is-absent" && !claim && onRequestClaim); return <button type="button" className={`calendar-day ${state} ${entry?.report ? "has-report" : ""} ${claim ? `claim-${claim.status}` : ""}`} key={date} title={claim ? `Demande de présence · ${ATTENDANCE_CLAIM_STATUS_LABELS[claim.status]}` : `${date} · ${!inCampaign ? isPause(date) ? "Campagne en pause / non active" : "Hors campagne" : entry && hasPointage(entry) ? entry.report?.comment ? "Ouvrir le rapport" : isClosedPresence(entry) ? "Clôture non commentée" : "Pointage ouvert · clôture manquante" : canCreateClaim ? "Cliquer pour demander la validation de cette journée" : "Aucun pointage enregistré"}`} onClick={() => { if (canOpenClaim) onOpenClaim?.(claim!); else if (canCreateClaim) onRequestClaim?.(date); else if (canOpenReport) setSelectedReport(entry!.report!); }} disabled={!canOpenClaim && !canCreateClaim && !canOpenReport}><strong>{day}</strong>{entry && <small>{formatClock(entry.checkin_at)}</small>}{claim && <i aria-hidden="true" />}{canCreateClaim && <span className="calendar-claim-mark" aria-hidden="true">+</span>}</button>; })}</div><div className="calendar-legend"><span><i className="legend-dot is-off" /> Non active / hors campagne</span><span><i className="legend-dot is-closed" /> Travail clôturé</span><span><i className="legend-dot is-open" /> Travail non clôturé</span><span><i className="legend-dot is-absent" /> Non travaillé</span><span><i className="legend-dot is-claim" /> Demande de présence</span></div><div className="calendar-summary"><span><b>{metrics.totalCampaignDays}</b> jours campagne</span><span><b>{metrics.workedDays}</b> travaillés</span><span><b>{metrics.closedDays}</b> clôturés</span><span><b>{metrics.openDays}</b> ouverts</span><span><b>{metrics.absentDays}</b> non travaillés</span><span><b>{claims.filter((claim) => claim.status === "pending").length}</b> demandes en attente</span></div>{canClaim && <p className="calendar-claim-hint">Un jour rouge sans pointage peut être sélectionné pour envoyer une demande de validation.</p>}</div>{selectedReport && <ReportModal report={selectedReport} onClose={() => setSelectedReport(null)} />}</>;
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

type AttendanceCalendarState = "off" | "absent" | "closed" | "open";
type AttendanceCalendarDay = { date: string; state: AttendanceCalendarState; entry: PresenceRecord | null };
type AttendanceCalendarMonth = { key: string; label: string; offset: number; days: AttendanceCalendarDay[] };

export const ATTENDANCE_STATE_LABELS: Record<AttendanceCalendarState, string> = {
  off: "Non active / hors campagne",
  absent: "Non travaillé",
  closed: "Travail clôturé",
  open: "Travail non clôturé",
};

function dayKey(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function hasPointage(entry: PresenceRecord) {
  return Boolean(entry.checkin_at || entry.checkout_at || entry.report?.checkinPhotoPath);
}

function isClosedPresence(entry: PresenceRecord) {
  return Boolean(entry.checkout_at) || ["closed", "présent", "rapport"].includes(entry.status);
}

export function buildAttendanceCalendar(insights: AgentInsights): AttendanceCalendarMonth[] {
  const presence = insights.presence.reduce((byDate, entry) => {
    const date = dayKey(entry.date);
    if (!date) return byDate;
    const previous = byDate.get(date);
    if (!previous || (hasPointage(entry) && !hasPointage(previous))) byDate.set(date, entry);
    return byDate;
  }, new Map<string, PresenceRecord>());
  const isPause = (date: string) => insights.pauses.some((pause) => {
    const start = dayKey(pause.starts_on);
    const end = dayKey(pause.ends_on) || start;
    return Boolean(start && date >= start && date <= end!);
  });
  const sortedDates = Array.from(presence.keys()).sort();
  const campaignStart = dayKey(insights.campaignStart) || sortedDates[0];
  const campaignEnd = dayKey(insights.campaignEnd) || sortedDates.at(-1) || campaignStart;
  if (!campaignStart || !campaignEnd || campaignStart > campaignEnd) return [];
  const months: AttendanceCalendarMonth[] = [];
  const cursor = new Date(`${campaignStart.slice(0, 7)}-01T00:00:00`);
  const lastMonth = new Date(`${campaignEnd.slice(0, 7)}-01T00:00:00`);
  while (cursor <= lastMonth) {
    const year = cursor.getFullYear();
    const monthIndex = cursor.getMonth();
    const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, "0")}`;
      const entry = presence.get(date) || null;
      const inCampaign = date >= campaignStart && date <= campaignEnd && !isPause(date);
      const state: AttendanceCalendarState = !inCampaign ? "off" : !entry || !hasPointage(entry) ? "absent" : isClosedPresence(entry) ? "closed" : "open";
      return { date, state, entry };
    });
    months.push({ key: month, label: cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), offset, days });
    cursor.setMonth(monthIndex + 1);
  }
  return months;
}

export function getAttendanceCalendarMetrics(insights: AgentInsights) {
  const days = buildAttendanceCalendar(insights).flatMap((month) => month.days);
  const count = (state: AttendanceCalendarState) => days.filter((day) => day.state === state).length;
  const closedDays = count("closed");
  const openDays = count("open");
  const absentDays = count("absent");
  return {
    totalCampaignDays: closedDays + openDays + absentDays,
    workedDays: closedDays + openDays,
    closedDays,
    openDays,
    absentDays,
    inactiveDays: count("off"),
  };
}

export function renderAttendanceCalendarHtml(insights: AgentInsights) {
  const months = buildAttendanceCalendar(insights);
  if (!months.length) return '<div class="calendar-empty">Aucune période de campagne exploitable.</div>';
  const metrics = getAttendanceCalendarMetrics(insights);
  const legend = Object.entries(ATTENDANCE_STATE_LABELS).map(([state, label]) => `<span><i class="calendar-dot state-${state}"></i>${escapeHtml(label)}</span>`).join("");
  const monthHtml = months.map((month) => {
    const emptyCells = Array.from({ length: month.offset }, () => '<span class="calendar-cell empty"></span>').join("");
    const cells = month.days.map((day) => {
      const time = day.entry?.checkin_at ? `<small>${escapeHtml(formatExportClock(day.entry.checkin_at))}</small>` : "";
      const report = day.entry?.report ? (day.entry.report.comment?.trim() ? "Rapport envoyé" : "Rapport non envoyé") : "";
      const title = `${formatExportDate(day.date)} · ${ATTENDANCE_STATE_LABELS[day.state]}${report ? ` · ${report}` : ""}`;
      return `<div class="calendar-cell state-${day.state}" title="${escapeHtml(title)}"><strong>${Number(day.date.slice(-2))}</strong>${time}${report ? `<em>${escapeHtml(report)}</em>` : ""}</div>`;
    }).join("");
    return `<section class="attendance-month"><h3>${escapeHtml(month.label)}</h3><div class="calendar-weekdays"><span>Lun</span><span>Mar</span><span>Mer</span><span>Jeu</span><span>Ven</span><span>Sam</span><span>Dim</span></div><div class="calendar-grid">${emptyCells}${cells}</div></section>`;
  }).join("");
  const summary = `<div class="calendar-export-summary"><span><b>${metrics.totalCampaignDays}</b> jours campagne</span><span><b>${metrics.workedDays}</b> travaillés</span><span><b>${metrics.closedDays}</b> clôturés</span><span><b>${metrics.openDays}</b> ouverts</span><span><b>${metrics.absentDays}</b> non travaillés</span><span><b>${metrics.inactiveDays}</b> hors campagne / pause</span></div>`;
  return `<div class="attendance-export-calendar"><div class="calendar-export-legend">${legend}</div>${summary}<div class="attendance-months">${monthHtml}</div></div>`;
}

async function exportXlsx(agent: UserRecord, campaign: CampaignRecord, insights: AgentInsights) {
  const XLSX = await import("xlsx-js-style");
  const calendarMetrics = getAttendanceCalendarMetrics(insights);
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
    ["Jours campagne", calendarMetrics.totalCampaignDays, ""],
    ["Jours travaillés", calendarMetrics.workedDays, ""],
    ["Jours clôturés", calendarMetrics.closedDays, ""],
    ["Jours ouverts", calendarMetrics.openDays, ""],
    ["Jours non travaillés", calendarMetrics.absentDays, ""],
    ["Jours hors campagne / pause", calendarMetrics.inactiveDays, ""],
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

  const attendance = addSheet("Présence", [["REGISTRE DE PRÉSENCE", "", "", "", "", "", ""], ["Date", "Statut", "Arrivée", "Départ", "Activations", "Détail des activations", "Note"], ...insights.presence.map((entry) => [formatExportDate(entry.date), entry.status, formatExportClock(entry.checkin_at), formatExportClock(entry.checkout_at), entry.report?.activationCount ?? 0, entry.report?.activationDetails || "—", entry.note || "—"])], [18, 20, 14, 14, 14, 42, 42], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }]);
  attendance["A1"].s = headerStyle;
  ["A2", "B2", "C2", "D2", "E2", "F2", "G2"].forEach((cell) => { attendance[cell].s = sectionStyle; });
  attendance["!autofilter"] = { ref: `A2:G${Math.max(insights.presence.length + 2, 2)}` };

  XLSX.writeFile(workbook, `${safeFilePart(agent.full_name)}-${safeFilePart(campaign.code)}-suivi.xlsx`, { bookType: "xlsx", compression: true });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function exportPdf(agent: UserRecord, campaign: CampaignRecord, insights: AgentInsights) {
  const popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) return;
  const closed = insights.presence.filter((entry) => ["closed", "présent", "rapport"].includes(entry.status)).length;
  popup.document.write(`<html><head><title>Suivi ${escapeHtml(agent.full_name)} — ${escapeHtml(campaign.name)}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#17343a;margin:0;font-size:11px}header{padding:22px 24px;border-radius:14px;background:#12383f;color:#fff}header .brand{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#9ee9e8;font-weight:700}h1{font-size:26px;margin:12px 0 5px;letter-spacing:-.04em}header p{margin:0;color:#c7e2e2;font-size:11px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.meta div,.kpi{padding:12px;border:1px solid #dce9e8;border-radius:10px;background:#f7fbfa}.meta b,.kpi b{display:block;margin-bottom:5px;color:#6c8588;font-size:8px;text-transform:uppercase;letter-spacing:.08em}.meta span{font-weight:700}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 24px}.kpi strong{font-size:20px;color:#12383f}.section-title{display:flex;align-items:center;gap:8px;margin:22px 0 8px;padding-bottom:7px;border-bottom:2px solid #9ee9e8;color:#12383f;font-size:14px}.section-title:before{content:"";width:6px;height:6px;border-radius:50%;background:#b5ef8c}table{width:100%;border-collapse:collapse;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th{padding:8px 9px;background:#12383f;color:#fff;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.05em}td{padding:8px 9px;border-bottom:1px solid #e2eded;color:#385257}tbody tr:nth-child(even){background:#f7fbfa}.attendance-export-calendar{margin-top:10px}.calendar-export-legend{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;padding:9px;border:1px solid #dce9e8;border-radius:10px;background:#f7fbfa}.calendar-export-legend span{display:inline-flex;align-items:center;gap:5px;color:#526d72;font-size:8px}.calendar-export-summary{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 12px;padding:9px;border:1px solid #dce9e8;border-radius:10px;background:#f7fbfa}.calendar-export-summary span{color:#526d72;font-size:8px}.calendar-export-summary b{margin-right:3px;color:#12383f;font-size:10px}.calendar-dot{width:8px;height:8px;display:inline-block;border-radius:50%}.calendar-dot.state-off{background:#a9b9bb}.calendar-dot.state-absent{background:#e27670}.calendar-dot.state-closed{background:#73b96b}.calendar-dot.state-open{background:#5ca9dd}.attendance-month{margin:0 0 18px;break-inside:avoid;page-break-inside:avoid}.attendance-month h3{margin:0 0 7px;padding:7px 9px;border-radius:8px;color:#12383f;background:#e8f4f3;font-size:12px;text-transform:capitalize}.calendar-weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.calendar-weekdays{margin-bottom:3px}.calendar-weekdays span{padding:3px;color:#789095;font-size:7px;text-align:center}.calendar-cell{min-height:42px;padding:4px;border:1px solid #dce9e8;border-radius:5px;background:#fff}.calendar-cell.empty{border-color:transparent;background:transparent}.calendar-cell strong,.calendar-cell small,.calendar-cell em{display:block}.calendar-cell strong{color:#17343a;font-size:9px}.calendar-cell small{margin-top:3px;color:#526d72;font-size:7px}.calendar-cell em{margin-top:3px;color:#789095;font-size:6px;font-style:normal;line-height:1.1}.calendar-cell.state-off{background:#eef2f2;border-color:#d9e0e0}.calendar-cell.state-absent{background:#fff1ef;border-color:#f0bbb5}.calendar-cell.state-closed{background:#eff9eb;border-color:#b8dcae}.calendar-cell.state-open{background:#eef7fd;border-color:#b3d5eb}.calendar-cell.state-closed strong{color:#2f7130}.calendar-cell.state-open strong{color:#2c6e9c}.calendar-cell.state-absent strong{color:#a64942}.calendar-empty{padding:14px;border:1px dashed #c8d9d8;border-radius:10px;color:#789095;text-align:center}.footer{margin-top:25px;padding-top:9px;border-top:1px solid #dce9e8;color:#789095;font-size:9px;text-align:right}@media print{header{-webkit-print-color-adjust:exact;print-color-adjust:exact}th{ -webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><header><div class="brand">BTL Africa · Rapport de suivi</div><h1>${escapeHtml(agent.full_name)}</h1><p>${escapeHtml(campaign.name)} · ${escapeHtml(campaign.code)}</p></header><div class="meta"><div><b>Téléphone</b><span>${escapeHtml(agent.phone)}</span></div><div><b>Période</b><span>${escapeHtml(formatExportDate(insights.campaignStart))} → ${escapeHtml(formatExportDate(insights.campaignEnd))}</span></div><div><b>Indicateur</b><span>${escapeHtml(insights.metricLabel)}</span></div></div><div class="kpis"><div class="kpi"><b>Performances</b><strong>${insights.performance.length}</strong></div><div class="kpi"><b>Pointages</b><strong>${insights.presence.length}</strong></div><div class="kpi"><b>Clôturés</b><strong>${closed}</strong></div></div><div class="section-title">${escapeHtml(insights.metricLabel)}</div><table><thead><tr><th>Date</th><th>Valeur</th><th>Détail</th></tr></thead><tbody>${insights.performance.map((point) => `<tr><td>${escapeHtml(formatExportDate(point.date))}</td><td>${escapeHtml(point.value)}</td><td>${escapeHtml(point.label)}</td></tr>`).join("") || '<tr><td colspan="3">Aucune performance enregistrée.</td></tr>'}</tbody></table><div class="section-title">Calendrier des présences</div>${renderAttendanceCalendarHtml(insights)}<div class="footer">Généré le ${escapeHtml(new Date().toLocaleString("fr-FR"))} · BTL Africa</div></body></html>`);
  popup.document.close(); popup.focus(); window.setTimeout(() => popup.print(), 250);
}

export function AgentDetailModal({ agent, password, users, campaigns, shops, assignments, campaignSupervisorAssignments, assignmentRequests, attendanceClaims, canRequest, canExport, canEdit, onEdit, onNotice, onClose }: AgentDetailProps) {
  const assignedIds = new Set([
    ...assignments.filter((assignment) => assignment.user_id === agent.id && assignment.is_active).map((assignment) => assignment.campaign_id),
    ...campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === agent.id && assignment.is_active).map((assignment) => assignment.campaign_id),
  ]);
  const assigned = campaigns.filter((campaign) => assignedIds.has(campaign.id));
  const compatible = campaigns.filter((campaign) => (campaign.status === "active" || campaign.status === "draft") && isCampaignCompatibleWithCategory(campaign.campaign_type, agent.user_category));
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(assigned[0] || null);
  const [insights, setInsights] = useState<AgentInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [selectedAttendanceClaim, setSelectedAttendanceClaim] = useState<AttendanceClaim | null>(null);
  const pendingIds = new Set(assignmentRequests.filter((request) => request.user_id === agent.id && request.status === "pending").map((request) => request.campaign_id));
  const limeName = agent.supervisor_id ? users.find((user) => user.id === agent.supervisor_id)?.full_name || "—" : "—";

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

  const selectedClaims = attendanceClaims.filter((claim) => claim.user_id === agent.id && claim.campaign_id === selectedCampaign?.id);
  return <ViewportModal><div className="modal-layer"><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={onClose} /><div className="modal-card agent-detail-modal"><div className="modal-header"><div className="agent-detail-heading"><Avatar user={agent} size="large" /><div><div className="eyebrow"><UserCircle2 size={13} /> Fiche agent</div><h3>{agent.full_name}</h3><span>{CATEGORY_LABELS[agent.user_category || "operations"] || "Agent"}</span></div></div><div className="modal-header-actions">{canEdit && onEdit && <button type="button" className="button secondary compact" onClick={onEdit}><FilePenLine size={13} /> Modifier</button>}<button type="button" className="modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button></div></div><div className="agent-contact"><CopyablePhone value={agent.phone} /><a className="button secondary compact call-agent-button" href={`tel:${agent.phone}`}><PhoneCall size={13} /> Appeler</a><span className="agent-supervisor-label"><small>Lime</small><strong>{limeName}</strong></span>{password !== undefined && <span className="agent-password-label"><small>Mot de passe assistance</small>{password ? <CopyableValue value={password} label={`le mot de passe de ${agent.full_name}`} /> : <strong>Non renseigné</strong>}</span>}</div><div className="detail-section"><div className="detail-section-title"><span><BriefcaseBusiness size={14} /> Campagnes d’affectation</span><small>{assigned.length} active{assigned.length > 1 ? "s" : ""}</small></div><div className="detail-campaigns">{compatible.map((campaign) => { const isAssigned = assigned.some((item) => item.id === campaign.id); const isPending = pendingIds.has(campaign.id); const campaignSupervisors = campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === agent.id && assignment.campaign_id === campaign.id && assignment.is_active).map((assignment) => users.find((user) => user.id === assignment.supervisor_id)?.full_name).filter((name): name is string => Boolean(name)); return <div className={`detail-campaign ${isAssigned ? "is-assigned" : "is-unassigned"}`} key={campaign.id}><button type="button" onClick={() => isAssigned && setSelectedCampaign(campaign)} disabled={!isAssigned}><span>{campaign.name}</span><small>{isAssigned ? "Affecté · voir le suivi" : isPending ? "Demande en attente" : "Non affecté"}</small>{campaignSupervisors.length > 0 && <em className="detail-campaign-supervisors">Superviseurs : {campaignSupervisors.join(" · ")}</em>}</button>{!isAssigned && canRequest && !isPending && <button type="button" className="button secondary compact" onClick={() => void requestAssignment(campaign)} disabled={requesting === campaign.id}>{requesting === campaign.id ? <LoaderCircle className="spin" size={13} /> : <Users size={13} />} Demander</button>}</div>; })}</div>{!compatible.length && <div className="workspace-empty">Aucune campagne compatible disponible.</div>}</div>{selectedCampaign && <div className="detail-section"><div className="selected-campaign-title"><strong>{selectedCampaign.name}</strong><span>Suivi sélectionné</span></div>{loadingInsights ? <div className="workspace-loading"><LoaderCircle className="spin" size={18} /> Chargement du suivi…</div> : insights && <><ProgressChart insights={insights} /><AttendanceCalendar insights={insights} claims={selectedClaims} onOpenClaim={setSelectedAttendanceClaim} />{canExport && <div className="export-actions"><button type="button" className="button secondary compact" onClick={() => void exportXlsx(agent, selectedCampaign, insights)} aria-keyshortcuts="X"><FileSpreadsheet size={13} /> Exporter XLSX <kbd>X</kbd></button><button type="button" className="button secondary compact" onClick={() => exportPdf(agent, selectedCampaign, insights)} aria-keyshortcuts="P"><FileText size={13} /> Exporter PDF <kbd>P</kbd></button></div>}</>}</div>}</div></div>{selectedAttendanceClaim && <AttendanceClaimReviewModal claim={selectedAttendanceClaim} agent={agent} campaign={selectedCampaign || undefined} shops={shops} canReview={selectedAttendanceClaim.can_review === true} onNotice={onNotice} onChanged={() => {}} onClose={() => setSelectedAttendanceClaim(null)} />}</ViewportModal>;
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

export default function RoleWorkspace({ profile, users, superiors, campaigns, shops, assignments, campaignSupervisorAssignments, assignmentRequests, attendanceClaims, onNotice, onProfileUpdated, onProfileOpen, onRequestReviewed, simulation = false }: RoleWorkspaceProps) {
  const [selectedAgent, setSelectedAgent] = useState<UserRecord | null>(null);
  const [selectedSuperior, setSelectedSuperior] = useState<UserRecord | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(null);
  const [insights, setInsights] = useState<AgentInsights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [requestingCampaign, setRequestingCampaign] = useState<string | null>(null);
  const [reviewingRequest, setReviewingRequest] = useState<string | null>(null);
  const [claimDate, setClaimDate] = useState<string | null>(null);
  const [selectedAttendanceClaim, setSelectedAttendanceClaim] = useState<AttendanceClaim | null>(null);
  const [photoPreview, setPhotoPreview] = useState(false);
  const isAgent = profile.role === "agent";
  const agents = users.filter((user) => user.role === "agent");
  const assignedCampaignIds = new Set([
    ...assignments.filter((assignment) => assignment.user_id === profile.id && assignment.is_active).map((assignment) => assignment.campaign_id),
    ...campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === profile.id && assignment.is_active).map((assignment) => assignment.campaign_id),
  ]);
  const assignedCampaigns = campaigns.filter((campaign) => assignedCampaignIds.has(campaign.id));
  const operationalSuperiorIds = new Set(campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === profile.id && assignment.is_active).map((assignment) => assignment.supervisor_id));
  const superiorDirectory = Array.from(new Map([...superiors, ...users.filter((user) => ["supervisor", "sub_admin", "admin", "super_admin"].includes(user.role))].map((user) => [user.id, user])).values()).filter((user) => ["supervisor", "sub_admin", "admin", "super_admin"].includes(user.role)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const hierarchicalSuperiorIds = new Set(operationalSuperiorIds);
  const knownUsers = new Map(users.map((user) => [user.id, user]));
  let parentId = profile.supervisor_id;
  while (parentId && !hierarchicalSuperiorIds.has(parentId)) {
    hierarchicalSuperiorIds.add(parentId);
    parentId = knownUsers.get(parentId)?.supervisor_id || null;
  }
  const visibleCampaigns = campaigns.filter((campaign) => campaign.status === "active" || campaign.status === "draft");
  const selectedCampaignAssigned = Boolean(selectedCampaign && assignedCampaigns.some((campaign) => campaign.id === selectedCampaign.id));
  const requestIds = new Set(assignmentRequests.filter((request) => request.user_id === profile.id && request.status === "pending").map((request) => request.campaign_id));
  const ownAttendanceClaims = attendanceClaims.filter((claim) => claim.user_id === profile.id);

  useEffect(() => {
    if (!isAgent) return;
    const visibleAssignedCampaigns = assignedCampaigns.filter((campaign) => campaign.status === "active" || campaign.status === "draft");
    const activeAssignedCampaigns = visibleAssignedCampaigns
      .filter((campaign) => campaign.status === "active")
      .sort((left, right) => {
        const leftStart = left.starts_on ? new Date(left.starts_on).getTime() : 0;
        const rightStart = right.starts_on ? new Date(right.starts_on).getTime() : 0;
        return rightStart - leftStart || right.name.localeCompare(left.name);
      });
    const fallbackCampaign = activeAssignedCampaigns[0] || visibleAssignedCampaigns[0] || null;
    setSelectedCampaign((current) => {
      if (current && visibleCampaigns.some((campaign) => campaign.id === current.id)) return current;
      return fallbackCampaign;
    });
  }, [isAgent, profile.id, campaigns, assignments, campaignSupervisorAssignments]);

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
    setClaimDate(null);
  }

  async function requestAssignment(campaign: CampaignRecord) {
    if (simulation) { onNotice({ kind: "error", message: "La simulation est en lecture seule. Quittez-la pour demander une affectation." }); return; }
    setRequestingCampaign(campaign.id);
    try { await requestCampaignAssignment(profile.id, campaign.id); onNotice({ kind: "success", message: `Demande envoyée pour ${campaign.name}.` }); } catch (error) { onNotice({ kind: "error", message: error instanceof Error ? error.message : "Demande impossible." }); } finally { setRequestingCampaign(null); }
  }

  async function reviewRequest(request: CampaignAssignmentRequest, approve: boolean) {
    if (simulation) { onNotice({ kind: "error", message: "La simulation est en lecture seule. Quittez-la pour traiter une demande." }); return; }
    setReviewingRequest(request.id);
    try { await reviewCampaignAssignmentRequest(request.id, approve); onRequestReviewed(); onNotice({ kind: "success", message: approve ? "Demande approuvée." : "Demande rejetée." }); } catch (error) { onNotice({ kind: "error", message: error instanceof Error ? error.message : "Impossible de traiter la demande." }); } finally { setReviewingRequest(null); }
  }

  return <section className="role-workspace">
    <div className="workspace-hero"><div className="workspace-identity"><div className="workspace-profile-hero"><button type="button" className="workspace-profile-photo-button" onClick={() => setPhotoPreview(true)} aria-label="Agrandir ma photo de profil"><Avatar user={profile} size="large" /></button><button type="button" className="workspace-profile-edit" onClick={onProfileOpen} aria-label="Modifier mon profil" title="Modifier mon profil"><FilePenLine size={11} /></button></div><div><div className="eyebrow">{isAgent ? "Espace agent" : "Espace superviseur"}</div><h2>Bonjour, {profile.full_name}</h2><p>{isAgent ? "Sélectionnez une campagne pour consulter votre performance et votre présence." : "Consultez les équipes, les campagnes et les suivis terrain."}</p></div></div></div>
    <div className="workspace-grid">
      <section className="workspace-card superiors-card"><div className="workspace-card-heading"><span><Users size={15} /> Équipe de coordination</span><small>{superiorDirectory.length}</small></div><div className="superior-list">{superiorDirectory.map((superior) => { const superiorCampaigns = campaigns.filter((campaign) => campaignSupervisorAssignments.some((assignment) => assignment.agent_id === profile.id && assignment.supervisor_id === superior.id && assignment.campaign_id === campaign.id && assignment.is_active)); const isClickable = isAgent && hierarchicalSuperiorIds.has(superior.id); const content = <><Avatar user={superior} /><div><strong>{superior.full_name}</strong><small>{ROLE_LABELS[superior.role]}{isAgent ? "" : <> · <CopyablePhone value={superior.phone} /></>}</small>{isAgent && superiorCampaigns.length > 0 && <span className="superior-campaigns">{superiorCampaigns.map((campaign) => campaign.name).join(" · ")}</span>}</div>{isClickable && <span className="superior-open">Voir la fiche</span>}</>; return isClickable ? <button type="button" className="superior-row is-clickable" key={superior.id} onClick={() => setSelectedSuperior(superior)} aria-label={`Ouvrir la fiche de ${superior.full_name}`}>{content}</button> : <div className="superior-row" key={superior.id}>{content}</div>; })}</div>{!superiorDirectory.length && <div className="workspace-empty">Aucun responsable disponible.</div>}</section>
      {!isAgent && <section className="workspace-card agents-card"><div className="workspace-card-heading"><span><Users size={15} /> Agents</span><small>{agents.length}</small></div><div className="agent-list">{agents.map((agent) => { const campaignCount = new Set([...assignments.filter((assignment) => assignment.user_id === agent.id && assignment.is_active).map((assignment) => assignment.campaign_id), ...campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === agent.id && assignment.is_active).map((assignment) => assignment.campaign_id)]).size; return <button type="button" className="agent-list-row" key={agent.id} onClick={() => setSelectedAgent(agent)}><Avatar user={agent} /><span><strong>{agent.full_name}</strong><small>{categoryShortLabel(agent.user_category)} · {campaignCount} campagne(s)</small></span><span className="agent-list-arrow">›</span></button>; })}</div></section>}
    </div>
    {!isAgent && assignmentRequests.length > 0 && <section className="workspace-card request-queue"><div className="workspace-card-heading"><span><BriefcaseBusiness size={15} /> Demandes d’affectation</span><small>{assignmentRequests.length}</small></div><div className="request-queue-list">{assignmentRequests.map((request) => { const agent = users.find((user) => user.id === request.user_id); const campaign = campaigns.find((item) => item.id === request.campaign_id); if (!agent || !campaign) return null; return <div className="request-queue-row" key={request.id}><div><strong>{agent.full_name}</strong><small>{campaign.name} · {new Date(request.requested_at).toLocaleDateString("fr-FR")}</small></div><div className="request-queue-actions"><button type="button" className="icon-action approve" onClick={() => void reviewRequest(request, true)} disabled={reviewingRequest === request.id} aria-label="Approuver"><CheckCircle2 size={14} /></button><button type="button" className="icon-action delete" onClick={() => void reviewRequest(request, false)} disabled={reviewingRequest === request.id} aria-label="Rejeter"><XCircle size={14} /></button></div></div>; })}</div></section>}
    {!isAgent && attendanceClaims.length > 0 && <section className="workspace-card request-queue attendance-claim-queue"><div className="workspace-card-heading"><span><CalendarDays size={15} /> Demandes de présence</span><small>{attendanceClaims.filter((claim) => claim.status === "pending").length} en attente</small></div><div className="request-queue-list">{attendanceClaims.map((claim) => { const agent = users.find((user) => user.id === claim.user_id); const campaign = campaigns.find((item) => item.id === claim.campaign_id); if (!agent || !campaign) return null; return <button type="button" className="request-queue-row" key={claim.id} onClick={() => setSelectedAttendanceClaim(claim)}><div><strong>{agent.full_name} · {campaign.name}</strong><small>{ATTENDANCE_CLAIM_STATUS_LABELS[claim.status]} · {formatExportDate(claim.claim_date)}</small><span>{claim.arrival_time} → {claim.departure_time} · {claim.activation_count} activations</span></div><div className="request-queue-actions"><span className="button secondary compact">Ouvrir</span></div></button>; })}</div></section>}
    {isAgent && <section className="workspace-card selected-followup agent-followup"><div className="workspace-card-heading"><span><BriefcaseBusiness size={15} /> Performance & présence</span><small>{assignedCampaigns.length} affectée{assignedCampaigns.length > 1 ? "s" : ""}</small></div><CampaignPicker campaigns={visibleCampaigns} value={selectedCampaign} onChange={selectCampaign} />{!selectedCampaign && <div className="workspace-empty followup-empty">Aucune campagne disponible pour le moment.</div>}{selectedCampaign && !selectedCampaignAssigned && <div className="followup-unassigned"><div><strong>Vous n’êtes pas affecté(e) à cette campagne.</strong><small>Vous pouvez demander votre affectation à l’équipe de coordination.</small></div>{!requestIds.has(selectedCampaign.id) ? <button type="button" className="button secondary compact" onClick={() => void requestAssignment(selectedCampaign)} disabled={requestingCampaign === selectedCampaign.id}>{requestingCampaign === selectedCampaign.id ? <LoaderCircle className="spin" size={13} /> : <Users size={13} />} Demander</button> : <span className="pending-pill">Demande en attente</span>}</div>}{selectedCampaign && selectedCampaignAssigned && <div className="campaign-supervisor-strip"><span>Supervision opérationnelle</span><div>{Array.from(new Set(campaignSupervisorAssignments.filter((assignment) => assignment.agent_id === profile.id && assignment.campaign_id === selectedCampaign.id && assignment.is_active).map((assignment) => assignment.supervisor_id))).map((supervisorId) => users.find((user) => user.id === supervisorId)).filter((user): user is UserRecord => Boolean(user)).map((supervisor) => <button type="button" key={supervisor.id} onClick={() => setSelectedSuperior(supervisor)}>{supervisor.full_name}</button>)}</div></div>}{selectedCampaign && selectedCampaignAssigned && (loadingInsights ? <div className="workspace-loading"><LoaderCircle className="spin" size={18} /> Chargement du suivi…</div> : insights ? <><ProgressChart insights={insights} /><AttendanceCalendar insights={insights} claims={ownAttendanceClaims.filter((claim) => claim.campaign_id === selectedCampaign.id)} canClaim={!simulation} onRequestClaim={(date) => setClaimDate(date)} onOpenClaim={setSelectedAttendanceClaim} /></> : <div className="workspace-empty">Aucun suivi disponible pour cette campagne.</div>)}</section>}
    {selectedAgent && <AgentDetailModal agent={selectedAgent} users={users} campaigns={campaigns} shops={shops} assignments={assignments} campaignSupervisorAssignments={campaignSupervisorAssignments} assignmentRequests={assignmentRequests} attendanceClaims={attendanceClaims} canRequest={false} canExport onNotice={onNotice} onClose={() => setSelectedAgent(null)} />}{selectedSuperior && <UserDetailModal user={selectedSuperior} users={users} superiors={superiorDirectory} campaigns={campaigns} assignments={assignments} campaignSupervisorAssignments={campaignSupervisorAssignments} assignmentRequests={assignmentRequests} requester={profile} canRequest={isAgent && !simulation} onNotice={onNotice} onClose={() => setSelectedSuperior(null)} />}{claimDate && selectedCampaign && <AttendanceClaimFormModal agent={profile} campaign={selectedCampaign} date={claimDate} shops={shops} onNotice={onNotice} onCreated={(claim) => { onRequestReviewed(); setClaimDate(null); setSelectedAttendanceClaim(claim); }} onClose={() => setClaimDate(null)} />}{selectedAttendanceClaim && <AttendanceClaimReviewModal claim={selectedAttendanceClaim} agent={users.find((user) => user.id === selectedAttendanceClaim.user_id)} campaign={campaigns.find((campaign) => campaign.id === selectedAttendanceClaim.campaign_id)} shops={shops} canReview={selectedAttendanceClaim.can_review === true && !simulation} onNotice={onNotice} onChanged={() => onRequestReviewed()} onClose={() => setSelectedAttendanceClaim(null)} />}{photoPreview && <ProfilePhotoPreviewModal user={profile} onClose={() => setPhotoPreview(false)} />}
  </section>;
}
