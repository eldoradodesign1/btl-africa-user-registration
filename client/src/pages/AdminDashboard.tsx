import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, BriefcaseBusiness, CheckCircle2, ChevronDown, Clock3, Database, Download, FilePenLine, Filter, LoaderCircle, LogIn, LogOut, PieChart, RefreshCw, Search, ServerCog, ShieldCheck, Trash2, UserCheck, UserPlus, UserCircle2, UserRoundPlus, X, XCircle } from "lucide-react";
import { CopyablePhone } from "@/components/CopyablePhone";
import RoleWorkspace, { AgentDetailModal, ProfileModal } from "@/components/RoleWorkspace";
import SimulationBar from "@/components/SimulationBar";
import { CATEGORY_LABELS, CATEGORY_OPTIONS, ROLE_LABELS, ROLE_OPTIONS, categoryShortLabel } from "@/lib/user-form";
import { isValidMsisdn, normalizePhone } from "@/lib/phone";
import {
  approveRegistrationRequest,
  clearSupabaseConnection,
  configureSupabase,
  createRegistrationRequest,
  deleteUser,
  getAdminContext,
  getSupabaseConnection,
  isPendingRequestConflict,
  isSupabaseConfigured,
  loadCampaignAssignments,
  loadCampaigns,
  loadCampaignAssignmentRequests,
  loadPendingRegistrationRequests,
  loadSupervisors,
  loadUsers,
  rejectRegistrationRequest,
  reviewCampaignAssignmentRequest,
  signInAdmin,
  signOutAdmin,
  setUserCampaignAssignments,
  testSupabaseConnection,
  updateUser,
  type CampaignAssignment,
  type CampaignAssignmentRequest,
  type CampaignRecord,
  type RegistrationRequest,
  type UserCategory,
  type UserRecord,
  type UserRole,
} from "@/lib/supabase";

type Props = { onConnectionChanged: () => void; onRequestCreate: () => void };
type Notice = { kind: "error" | "success"; message: string } | null;
type EditDraft = Pick<UserRecord, "id" | "full_name" | "phone" | "role" | "user_category" | "supervisor_id" | "permanent_shop_id">;
type CustomSelectProps = { value: string; options: Array<{ value: string; label: string }>; placeholder: string; onChange: (value: string) => void; ariaLabel: string };
type LoginMode = "signin" | "signup";

type SignupForm = {
  fullName: string;
  phone: string;
  useDefaultPassword: boolean;
  password: string;
  confirmPassword: string;
  category: UserCategory;
};

const INITIAL_SIGNUP: SignupForm = { fullName: "", phone: "", useDefaultPassword: true, password: "", confirmPassword: "", category: "hostess" };

function readableSupabaseError(error: unknown, fallback: string): string {
  const candidate = error as { message?: string; details?: string; hint?: string; code?: string } | null;
  const message = [candidate?.message, candidate?.details, candidate?.hint].filter(Boolean).join(" · ");
  return message ? `${fallback} (${message}${candidate?.code ? ` · code ${candidate.code}` : ""})` : fallback;
}

function CustomSelect({ value, options, placeholder, onChange, ariaLabel }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label || placeholder;
  return <div className={`custom-select ${open ? "is-open" : ""}`}><button type="button" className="custom-select-trigger" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((state) => !state)}><span>{current}</span><ChevronDown className="select-chevron" size={14} strokeWidth={1.8} /></button>{open && <><button className="select-backdrop" type="button" aria-label="Fermer" onClick={() => setOpen(false)} /><div className="custom-select-menu">{options.map((option) => <button type="button" key={option.value} className={option.value === value ? "is-selected" : ""} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}{option.value === value && <CheckCircle2 size={13} />}</button>)}</div></>}</div>;
}

function escapeCsv(value: unknown): string { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

function ModalLayer({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className="modal-layer">{children}</div>, document.body);
}

function AdminDashboard({ onConnectionChanged, onRequestCreate }: Props) {
  const [configured, setConfigured] = useState(isSupabaseConfigured());
  const [profile, setProfile] = useState<UserRecord | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [superiors, setSuperiors] = useState<UserRecord[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [campaignAssignments, setCampaignAssignments] = useState<CampaignAssignment[]>([]);
  const [assignmentRequests, setAssignmentRequests] = useState<CampaignAssignmentRequest[]>([]);
  const [pendingRequests, setPendingRequests] = useState<RegistrationRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showConfig, setShowConfig] = useState(!configured);
  const [setupUrl, setSetupUrl] = useState(getSupabaseConnection()?.url || "");
  const [setupKey, setSetupKey] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>("signin");
  const [signup, setSignup] = useState<SignupForm>(INITIAL_SIGNUP);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [connectionTest, setConnectionTest] = useState<Notice>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [selectedAgentProfile, setSelectedAgentProfile] = useState<UserRecord | null>(null);
  const [campaignDraft, setCampaignDraft] = useState<UserRecord | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [campaignSelection, setCampaignSelection] = useState<string[]>([]);
  const [deleteCandidate, setDeleteCandidate] = useState<UserRecord | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [simulatedUser, setSimulatedUser] = useState<UserRecord | null>(null);
  const isAuthenticated = Boolean(profile);
  const isSimulation = Boolean(profile?.role === "super_admin" && simulatedUser && simulatedUser.id !== profile.id);
  const effectiveProfile = simulatedUser || profile;
  const canManage = effectiveProfile?.role === "admin" || effectiveProfile?.role === "super_admin";
  const canManageCampaigns = effectiveProfile?.role === "admin" || effectiveProfile?.role === "super_admin" || effectiveProfile?.role === "supervisor" || effectiveProfile?.role === "sub_admin";
  const isReadOnly = Boolean(effectiveProfile && !canManage && !canManageCampaigns);
  const simulationControl = profile?.role === "super_admin" && effectiveProfile ? <SimulationBar masterUser={profile} effectiveUser={effectiveProfile} users={users} onSelectUser={handleSimulationSelect} onExit={handleSimulationExit} /> : null;

  async function refreshRequests() {
    if (profile?.role !== "super_admin") return;
    setLoadingRequests(true);
    try {
      setPendingRequests(await loadPendingRegistrationRequests());
    } catch (error) {
      setNotice({ kind: "error", message: readableSupabaseError(error, "Impossible de charger les demandes d’inscription.") });
    } finally {
      setLoadingRequests(false);
    }
  }

  async function refreshUsers(currentProfile: UserRecord | null = profile) {
    setLoading(true);
    try {
      const [nextUsers, nextSuperiors, nextCampaigns, nextAssignments, nextRequests] = await Promise.all([loadUsers(), loadSupervisors(), loadCampaigns(), loadCampaignAssignments(), currentProfile && ["admin", "super_admin", "sub_admin", "supervisor"].includes(currentProfile.role) ? loadCampaignAssignmentRequests() : Promise.resolve([])]);
      setUsers(nextUsers);
      setSuperiors(nextSuperiors);
      setCampaigns(nextCampaigns);
      setCampaignAssignments(nextAssignments);
      setAssignmentRequests(nextRequests as CampaignAssignmentRequest[]);
      setNotice(null);
    } catch (error) {
      setNotice({ kind: "error", message: readableSupabaseError(error, "Impossible de charger les utilisateurs, campagnes ou affectations. Vérifiez les politiques RLS.") });
    } finally {
      setLoading(false);
    }
  }

  async function refreshSession() {
    if (!isSupabaseConfigured()) return;
    try {
      const current = await getAdminContext();
      setProfile(current?.profile || null);
      if (current) {
        await refreshUsers(current.profile);
        if (current.profile.role === "super_admin") {
          setLoadingRequests(true);
          try {
            setPendingRequests(await loadPendingRegistrationRequests());
          } catch (error) {
            setNotice({ kind: "error", message: readableSupabaseError(error, "Impossible de charger les demandes d’inscription.") });
          } finally {
            setLoadingRequests(false);
          }
        }
      }
    } catch (error) {
      setProfile(null);
      setNotice({ kind: "error", message: readableSupabaseError(error, "Session indisponible.") });
    }
  }

  useEffect(() => { void refreshSession(); }, []);

  useEffect(() => {
    if (simulatedUser && !users.some((user) => user.id === simulatedUser.id)) setSimulatedUser(null);
  }, [simulatedUser, users]);

  async function handleSetup(event: FormEvent) {
    event.preventDefault();
    try {
      configureSupabase(setupUrl, setupKey);
      setConfigured(true);
      setSetupKey("");
      setShowConfig(false);
      setConnectionTest(null);
      setNotice({ kind: "success", message: "Supabase est configuré." });
      onConnectionChanged();
      await refreshSession();
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Configuration Supabase invalide." });
    }
  }

  async function handleTestConnection() {
    setTestingConnection(true);
    setConnectionTest(null);
    try {
      await testSupabaseConnection(setupUrl, setupKey);
      setConnectionTest({ kind: "success", message: "Connexion valide." });
    } catch (error) {
      setConnectionTest({ kind: "error", message: error instanceof Error ? error.message : "Connexion impossible." });
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const current = await signInAdmin(phone, password);
      setProfile(current.profile);
      setPhone("");
      setPassword("");
      await refreshUsers(current.profile);
      if (current.profile.role === "super_admin") {
        setLoadingRequests(true);
        try { setPendingRequests(await loadPendingRegistrationRequests()); } finally { setLoadingRequests(false); }
      }
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "MSISDN ou mot de passe incorrect." });
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(event: FormEvent) {
    event.preventDefault();
    const fullName = signup.fullName.trim();
    const normalizedPhone = normalizePhone(signup.phone);
    if (fullName.length < 2 || !isValidMsisdn(normalizedPhone)) {
      setNotice({ kind: "error", message: "Renseignez un nom complet et un MSISDN local valide." });
      return;
    }
    const requestPassword = signup.useDefaultPassword ? "password" : signup.password;
    if (requestPassword.length < 6 || (!signup.useDefaultPassword && signup.password !== signup.confirmPassword)) {
      setNotice({ kind: "error", message: "Le mot de passe doit contenir au moins 6 caractères et les deux saisies doivent correspondre." });
      return;
    }
    setLoading(true);
    try {
      await createRegistrationRequest({ fullName, phone: normalizedPhone, password: requestPassword, category: signup.category });
      setSignup(INITIAL_SIGNUP);
      setSignupSuccess(true);
      setNotice({ kind: "success", message: "Votre demande a été envoyée. Un super_admin doit encore la valider." });
    } catch (error) {
      setNotice({ kind: "error", message: isPendingRequestConflict(error) ? "Ce numéro possède déjà un compte ou une demande en attente." : readableSupabaseError(error, "Impossible d’envoyer la demande.") });
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await signOutAdmin();
    setProfile(null);
    setSimulatedUser(null);
    setUsers([]);
    setSuperiors([]);
    setCampaigns([]);
    setCampaignAssignments([]);
    setAssignmentRequests([]);
    setPendingRequests([]);
  }

  function handleSimulationSelect(user: UserRecord) {
    if (profile?.role !== "super_admin") return;
    setSelectedAgentProfile(null);
    setEditDraft(null);
    setCampaignDraft(null);
    setProfileOpen(false);
    setSimulatedUser(user.id === profile.id ? null : user);
    setNotice({ kind: "success", message: user.id === profile.id ? "Compte superadmin restauré." : `Simulation active : ${user.full_name}.` });
  }

  function handleSimulationExit() {
    setSelectedAgentProfile(null);
    setEditDraft(null);
    setCampaignDraft(null);
    setProfileOpen(false);
    setSimulatedUser(null);
    setNotice({ kind: "success", message: "Vous êtes revenu au compte superadmin réel." });
  }

  function handleProfileSaved(updated: UserRecord) {
    setProfile(updated);
    setUsers((current) => current.map((user) => user.id === updated.id ? updated : user));
    setSuperiors((current) => current.map((user) => user.id === updated.id ? updated : user));
    setNotice({ kind: "success", message: "Votre profil a été mis à jour." });
  }

  function handleDisconnect() {
    clearSupabaseConnection();
    setConfigured(false);
    setProfile(null);
    setUsers([]);
    setSuperiors([]);
    setCampaigns([]);
    setCampaignAssignments([]);
    setAssignmentRequests([]);
    setPendingRequests([]);
    setShowConfig(true);
    setSetupKey("");
    onConnectionChanged();
  }

  async function handleApprove(request: RegistrationRequest) {
    setRequestActionId(request.id);
    try {
      const approved = await approveRegistrationRequest(request.id);
      setUsers((current) => [approved, ...current.filter((user) => user.id !== approved.id)].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setPendingRequests((current) => current.filter((item) => item.id !== request.id));
      setNotice({ kind: "success", message: `${request.full_name} est maintenant visible dans la liste des agents.` });
    } catch (error) {
      setNotice({ kind: "error", message: readableSupabaseError(error, "Approbation impossible.") });
    } finally {
      setRequestActionId(null);
    }
  }

  async function handleReject(request: RegistrationRequest) {
    setRequestActionId(request.id);
    try {
      await rejectRegistrationRequest(request.id);
      setPendingRequests((current) => current.filter((item) => item.id !== request.id));
      setNotice({ kind: "success", message: `La demande de ${request.full_name} a été rejetée.` });
    } catch (error) {
      setNotice({ kind: "error", message: readableSupabaseError(error, "Rejet impossible.") });
    } finally {
      setRequestActionId(null);
    }
  }

  async function handleCampaignRequestReview(request: CampaignAssignmentRequest, approve: boolean) {
    if (isSimulation) { setNotice({ kind: "error", message: "La simulation est en lecture seule. Quittez-la pour traiter une demande." }); return; }
    setRequestActionId(request.id);
    try {
      await reviewCampaignAssignmentRequest(request.id, approve);
      await refreshUsers(profile);
      setNotice({ kind: "success", message: approve ? "Demande d’affectation approuvée." : "Demande d’affectation rejetée." });
    } catch (error) {
      setNotice({ kind: "error", message: readableSupabaseError(error, "Impossible de traiter la demande d’affectation.") });
    } finally {
      setRequestActionId(null);
    }
  }

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const normalizedQuery = normalizePhone(search);
    return users.filter((user) => (!query || user.full_name.toLowerCase().includes(query) || user.phone.includes(normalizedQuery) || user.phone.includes(query)) && (roleFilter === "all" || user.role === roleFilter) && (categoryFilter === "all" || user.user_category === categoryFilter));
  }, [users, search, roleFilter, categoryFilter]);
  const categoryStats = useMemo(() => CATEGORY_OPTIONS.map((category) => ({ category, count: users.filter((user) => user.user_category === category).length })).filter((item) => item.count > 0), [users]);
  const donutGradient = useMemo(() => { const colors = ["#9ee9e8", "#b5ef8c", "#d3b5ff", "#ffca8a"]; const total = Math.max(users.length, 1); let cursor = 0; return `conic-gradient(${categoryStats.length ? categoryStats.map((item, index) => { const start = cursor; cursor += (item.count / total) * 100; return `${colors[index % colors.length]} ${start}% ${cursor}%`; }).join(", ") : "#29444b 0 100%"})`; }, [categoryStats, users.length]);
  const campaignStats = useMemo(() => campaigns.map((campaign) => ({ campaign, count: new Set(campaignAssignments.filter((assignment) => assignment.campaign_id === campaign.id && users.some((user) => user.id === assignment.user_id)).map((assignment) => assignment.user_id)).size })).filter((item) => item.count > 0), [campaigns, campaignAssignments, users]);
  const campaignDonutGradient = useMemo(() => { const colors = ["#9ee9e8", "#b5ef8c", "#d3b5ff", "#ffca8a", "#f5cd78", "#ff9a8a"]; const total = Math.max(campaignStats.reduce((sum, item) => sum + item.count, 0), 1); let cursor = 0; return `conic-gradient(${campaignStats.length ? campaignStats.map((item, index) => { const start = cursor; cursor += (item.count / total) * 100; return `${colors[index % colors.length]} ${start}% ${cursor}%`; }).join(", ") : "#29444b 0 100%"})`; }, [campaignStats]);

  function exportCsv() {
    const headers = ["id", "full_name", "phone", "role", "user_category", "supervisor_id", "permanent_shop_id"];
    const rows = filteredUsers.map((user) => [user.id, user.full_name, user.phone, user.role, user.user_category || "", user.supervisor_id || "", user.permanent_shop_id || ""].map(escapeCsv).join(","));
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `btl-users-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function beginEdit(user: UserRecord) {
    if (!canManage) return;
    if (isSimulation) { setNotice({ kind: "error", message: "La simulation est en lecture seule. Quittez-la pour modifier les données." }); return; }
    setEditDraft({ id: user.id, full_name: user.full_name, phone: user.phone, role: user.role, user_category: user.user_category, supervisor_id: user.supervisor_id, permanent_shop_id: user.permanent_shop_id });
  }

  function handleUserRowClick(user: UserRecord) {
    if (user.role === "agent") setSelectedAgentProfile(user);
    else beginEdit(user);
  }

  function beginCampaignAssignment(user: UserRecord) {
    if (!canManageCampaigns || user.role !== "agent") return;
    if (isSimulation) { setNotice({ kind: "error", message: "La simulation est en lecture seule. Quittez-la pour gérer les affectations." }); return; }
    setCampaignDraft(user);
    setCampaignSelection(campaignAssignments.filter((assignment) => assignment.user_id === user.id).map((assignment) => assignment.campaign_id));
  }

  async function saveCampaignAssignment(event: FormEvent) {
    event.preventDefault();
    if (!campaignDraft) return;
    setActionLoading(true);
    try {
      const nextAssignments = await setUserCampaignAssignments(campaignDraft.id, campaignSelection);
      setCampaignAssignments((current) => [...current.filter((assignment) => assignment.user_id !== campaignDraft.id), ...nextAssignments]);
      setCampaignDraft(null);
      setNotice({ kind: "success", message: `Les campagnes de ${campaignDraft.full_name} ont été mises à jour.` });
    } catch (error) {
      setNotice({ kind: "error", message: readableSupabaseError(error, "Affectation impossible.") });
    } finally {
      setActionLoading(false);
    }
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editDraft) return;
    setActionLoading(true);
    try {
      const updated = await updateUser(editDraft.id, { full_name: editDraft.full_name.trim(), phone: normalizePhone(editDraft.phone), role: editDraft.role, user_category: editDraft.user_category, supervisor_id: editDraft.supervisor_id || null, permanent_shop_id: editDraft.permanent_shop_id || null });
      setUsers((current) => current.map((user) => user.id === updated.id ? updated : user));
      setEditDraft(null);
      setNotice({ kind: "success", message: `${updated.full_name} a été mis à jour.` });
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Modification impossible." });
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteCandidate) return;
    setActionLoading(true);
    try {
      await deleteUser(deleteCandidate.id);
      setUsers((current) => current.filter((user) => user.id !== deleteCandidate.id));
      setNotice({ kind: "success", message: `${deleteCandidate.full_name} a été supprimé.` });
      setDeleteCandidate(null);
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : "Suppression impossible." });
    } finally {
      setActionLoading(false);
    }
  }

  if (effectiveProfile && (effectiveProfile.role === "agent" || effectiveProfile.role === "supervisor" || effectiveProfile.role === "sub_admin")) {
    return <section className="admin-dashboard glass-card role-dashboard">{simulationControl}<div className="dashboard-header"><div className="dashboard-title"><div className="heading-icon"><ServerCog size={19} /></div><div><div className="eyebrow"><ShieldCheck size={13} /> Console sécurisée</div><h2>Tableau de bord</h2></div></div><div className="dashboard-actions"><span className="session-chip"><span className="session-dot" />{effectiveProfile.full_name} · {ROLE_LABELS[effectiveProfile.role]}</span><button className="icon-button" type="button" onClick={() => void handleLogout()} aria-label="Se déconnecter" title="Se déconnecter"><LogOut size={15} /></button></div></div>{notice && <div className={`dashboard-notice ${notice.kind}`}><span>{notice.kind === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}</span>{notice.message}<button type="button" onClick={() => setNotice(null)} aria-label="Fermer"><X size={14} /></button></div>}<RoleWorkspace profile={effectiveProfile} users={users} superiors={superiors} campaigns={campaigns} assignments={campaignAssignments} assignmentRequests={assignmentRequests} onNotice={(next) => setNotice(next)} onProfileUpdated={handleProfileSaved} onProfileOpen={() => isSimulation ? setNotice({ kind: "error", message: "Le profil est indisponible pendant une simulation." }) : setProfileOpen(true)} onRequestReviewed={() => void refreshUsers(profile)} simulation={isSimulation} />{profileOpen && !isSimulation && profile && <ProfileModal profile={profile} onClose={() => setProfileOpen(false)} onSaved={handleProfileSaved} />}</section>;
  }

  return <section className="admin-dashboard glass-card">{simulationControl}
    <div className="dashboard-header"><div className="dashboard-title"><div className="heading-icon"><ServerCog size={19} /></div><div><div className="eyebrow"><ShieldCheck size={13} /> Console sécurisée</div><h2>Tableau de bord administrateur</h2></div></div><div className="dashboard-actions">{effectiveProfile && <span className="session-chip"><span className="session-dot" />{effectiveProfile.full_name} · {effectiveProfile.role === "super_admin" ? "Super-administrateur" : ROLE_LABELS[effectiveProfile.role]}</span>}{profile && <button className="icon-button" type="button" onClick={() => isSimulation ? setNotice({ kind: "error", message: "Le profil est indisponible pendant une simulation." }) : setProfileOpen(true)} aria-label="Ouvrir mon profil" title="Mon profil"><UserCircle2 size={15} /></button>}{profile && <button className="icon-button" type="button" onClick={() => void handleLogout()} aria-label="Se déconnecter" title="Se déconnecter"><LogOut size={15} /></button>}{profile?.role === "super_admin" && !isSimulation && <button className="icon-button primary-icon" type="button" onClick={onRequestCreate} aria-label="Nouvel utilisateur" title="Nouvel utilisateur"><UserPlus size={16} /></button>}{configured && profile?.role === "super_admin" && !isSimulation && <button className="icon-button" type="button" onClick={() => setShowConfig(true)} aria-label="Configurer la base de données" title="Configurer la base de données"><Database size={16} /></button>}</div></div>
    {notice && <div className={`dashboard-notice ${notice.kind}`}><span>{notice.kind === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}</span>{notice.message}<button type="button" onClick={() => setNotice(null)} aria-label="Fermer"><X size={14} /></button></div>}
    {!configured && !showConfig && <div className="dashboard-empty"><ServerCog size={27} /><strong>Connectez votre projet Supabase</strong><button className="button primary compact" type="button" onClick={() => setShowConfig(true)}><Database size={14} /> Configurer</button></div>}
    {configured && !isAuthenticated && !showConfig && <>
      <div className="auth-tabs" role="tablist" aria-label="Authentification"><button type="button" role="tab" aria-selected={loginMode === "signin"} className={loginMode === "signin" ? "is-active" : ""} onClick={() => { setLoginMode("signin"); setSignupSuccess(false); }}>Se connecter</button><button type="button" role="tab" aria-selected={loginMode === "signup"} className={loginMode === "signup" ? "is-active" : ""} onClick={() => { setLoginMode("signup"); setSignupSuccess(false); }}>Créer un compte</button></div>
      {loginMode === "signin" ? <form className="admin-login" onSubmit={handleLogin}><div className="login-icon"><LogIn size={19} /></div><div className="login-copy"><strong>Connexion par MSISDN</strong><span>Les données réelles sont verrouillées jusqu’à l’identification.</span></div><input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" placeholder="081 234 5678" aria-label="MSISDN de connexion" inputMode="tel" required /><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Mot de passe" aria-label="Mot de passe" required /><button className="button primary compact" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={14} /> : <LogIn size={14} />} Se connecter</button></form> : <form className="signup-card" onSubmit={handleSignup}>{signupSuccess ? <div className="signup-success"><div className="success-icon"><Clock3 size={20} /></div><div><strong>Demande en attente de validation</strong><span>Un super_admin doit approuver votre compte avant qu’il n’apparaisse dans les listes d’agents.</span></div><button type="button" className="button secondary compact" onClick={() => { setSignupSuccess(false); setLoginMode("signin"); }}>Retour à la connexion</button></div> : <><div className="signup-heading"><div className="login-icon"><UserRoundPlus size={19} /></div><div><strong>Créer un accès agent</strong><span>Votre compte sera visible uniquement après approbation.</span></div></div><div className="signup-fields"><label>Nom complet<input value={signup.fullName} onChange={(event) => setSignup((current) => ({ ...current, fullName: event.target.value }))} placeholder="Ex. Grâce Mbuyi" autoComplete="name" required /></label><label>MSISDN<input value={signup.phone} onChange={(event) => setSignup((current) => ({ ...current, phone: event.target.value }))} placeholder="081 234 5678" type="tel" inputMode="tel" autoComplete="tel" required /></label><label className="password-toggle signup-password-toggle"><input type="checkbox" checked={signup.useDefaultPassword} onChange={(event) => setSignup((current) => ({ ...current, useDefaultPassword: event.target.checked, password: "", confirmPassword: "" }))} /><span className="toggle-visual"><CheckCircle2 size={12} /></span><span><strong>Utiliser le mot de passe par défaut</strong><small>Agent : <code>password</code></small></span></label>{!signup.useDefaultPassword && <><label>Mot de passe<input value={signup.password} onChange={(event) => setSignup((current) => ({ ...current, password: event.target.value }))} placeholder="Au moins 6 caractères" type="password" autoComplete="new-password" required /></label><label>Confirmer le mot de passe<input value={signup.confirmPassword} onChange={(event) => setSignup((current) => ({ ...current, confirmPassword: event.target.value }))} placeholder="Répétez le mot de passe" type="password" autoComplete="new-password" required /></label></>}<div className="signup-category"><span>Catégorie agent</span><CustomSelect value={signup.category} onChange={(value) => setSignup((current) => ({ ...current, category: value as UserCategory }))} ariaLabel="Catégorie agent" placeholder="Catégorie" options={CATEGORY_OPTIONS.map((category) => ({ value: category, label: categoryShortLabel(category) }))} /></div></div><button className="button primary signup-submit" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={14} /> : <UserCheck size={14} />} Envoyer la demande</button></>}</form>}
    </>}
    {configured && isAuthenticated && <>{isReadOnly && <div className="readonly-banner"><ShieldCheck size={15} /><span><strong>Lecture seule</strong> · {ROLE_LABELS[profile!.role]}</span></div>}
      {profile?.role === "super_admin" && !isSimulation && <section className="pending-panel"><div className="pending-heading"><div><div className="card-kicker"><Clock3 size={14} /> Validation requise</div><h3>Demandes d’inscription</h3><p>Les agents restent absents des listes tant qu’ils ne sont pas approuvés.</p></div><span className="pending-count">{pendingRequests.length}</span><button type="button" className="icon-button" onClick={() => void refreshRequests()} disabled={loadingRequests} aria-label="Actualiser les demandes" title="Actualiser les demandes">{loadingRequests ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button></div>{pendingRequests.length ? <div className="pending-list">{pendingRequests.map((request) => <div className="pending-item" key={request.id}><div className="avatar small">{request.full_name.slice(0, 1).toUpperCase()}</div><div className="pending-identity"><strong>{request.full_name}</strong><CopyablePhone value={request.phone} /> <small>{categoryShortLabel(request.user_category)} · {new Date(request.created_at).toLocaleDateString("fr-FR")}</small></div><span className="role-badge">En attente</span><div className="pending-actions"><button type="button" className="icon-action approve" onClick={() => void handleApprove(request)} disabled={requestActionId === request.id} aria-label={`Approuver ${request.full_name}`} title="Approuver">{requestActionId === request.id ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}</button><button type="button" className="icon-action delete" onClick={() => void handleReject(request)} disabled={requestActionId === request.id} aria-label={`Rejeter ${request.full_name}`} title="Rejeter"><XCircle size={14} /></button></div></div>)}</div> : <div className="pending-empty"><CheckCircle2 size={16} /> Aucune demande en attente.</div>}</section>}
      {canManageCampaigns && assignmentRequests.length > 0 && <section className="pending-panel campaign-request-panel"><div className="pending-heading"><div><div className="card-kicker"><BriefcaseBusiness size={14} /> Affectations à valider</div><h3>Demandes de campagne</h3><p>Les agents ont demandé à rejoindre une campagne.</p></div><span className="pending-count">{assignmentRequests.length}</span></div><div className="pending-list">{assignmentRequests.map((request) => { const agent = users.find((user) => user.id === request.user_id); const campaign = campaigns.find((item) => item.id === request.campaign_id); if (!agent || !campaign) return null; return <div className="pending-item" key={request.id}><div className="avatar small">{agent.full_name.slice(0, 1).toUpperCase()}</div><div className="pending-identity"><strong>{agent.full_name}</strong><small>{campaign.name} · {new Date(request.requested_at).toLocaleDateString("fr-FR")}</small></div><div className="pending-actions"><button type="button" className="icon-action approve" onClick={() => void handleCampaignRequestReview(request, true)} disabled={requestActionId === request.id} aria-label="Approuver"><CheckCircle2 size={14} /></button><button type="button" className="icon-action delete" onClick={() => void handleCampaignRequestReview(request, false)} disabled={requestActionId === request.id} aria-label="Rejeter"><XCircle size={14} /></button></div></div>; })}</div></section>}
      <div className="dashboard-toolbar"><div className="history-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un MSISDN ou un nom…" aria-label="Rechercher dans l’historique" /></div><div className="filter-control"><Filter size={14} /><CustomSelect value={roleFilter} onChange={setRoleFilter} ariaLabel="Filtrer par rôle" placeholder="Tous les rôles" options={[{ value: "all", label: "Tous les rôles" }, ...ROLE_OPTIONS.map((role) => ({ value: role, label: ROLE_LABELS[role] }))]} /></div><div className="filter-control"><CustomSelect value={categoryFilter} onChange={setCategoryFilter} ariaLabel="Filtrer par catégorie" placeholder="Toutes les catégories" options={[{ value: "all", label: "Toutes les catégories" }, ...CATEGORY_OPTIONS.map((category) => ({ value: category, label: categoryShortLabel(category) }))]} /></div><button className="icon-button" type="button" onClick={() => void refreshUsers()} disabled={loading} aria-label="Actualiser" title="Actualiser">{loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button><button className="icon-button primary-icon" type="button" onClick={exportCsv} disabled={!filteredUsers.length} aria-label="Exporter CSV" title="Exporter CSV"><Download size={15} /></button></div>
      <div className="dashboard-stats"><span><strong>{filteredUsers.length}</strong> résultat{filteredUsers.length > 1 ? "s" : ""}</span><span><strong>{users.length}</strong> utilisateur{users.length > 1 ? "s" : ""}</span><span className="secure-label"><ShieldCheck size={13} /> Sans password_hash</span></div>
      <div className="dashboard-insights"><div className="donut-card"><div className="donut-heading"><span><PieChart size={14} /> Répartition campagne</span><small>{users.length} total</small></div><div className="donut-content"><div className="donut" style={{ "--donut": donutGradient } as CSSProperties}><div><strong>{users.length}</strong><small>profils</small></div></div><div className="donut-legend">{categoryStats.length ? categoryStats.map((item, index) => <div key={item.category}><i style={{ background: ["#9ee9e8", "#b5ef8c", "#d3b5ff", "#ffca8a"][index % 4] }} /> <span>{categoryShortLabel(item.category)}</span><b>{item.count}</b></div>) : <span className="muted-note">Aucune catégorie renseignée</span>}</div></div></div><div className="role-summary"><div className="donut-heading"><span><ShieldCheck size={14} /> Rôles actifs</span><small>{users.length} profils</small></div>{ROLE_OPTIONS.map((role) => { const count = users.filter((user) => user.role === role).length; return count ? <div className="role-line" key={role}><span>{ROLE_LABELS[role]}</span><b>{count}</b><div><i style={{ width: `${Math.max(8, (count / Math.max(users.length, 1)) * 100)}%` }} /></div></div> : null; })}</div><div className="donut-card campaign-donut-card"><div className="donut-heading"><span><BriefcaseBusiness size={14} /> Effectifs par campagne</span><small>{campaignStats.reduce((sum, item) => sum + item.count, 0)} affectations</small></div><div className="donut-content"><div className="donut" style={{ "--donut": campaignDonutGradient } as CSSProperties}><div><strong>{campaignStats.reduce((sum, item) => sum + item.count, 0)}</strong><small>affectés</small></div></div><div className="donut-legend">{campaignStats.length ? campaignStats.map((item, index) => <div key={item.campaign.id}><i style={{ background: ["#9ee9e8", "#b5ef8c", "#d3b5ff", "#ffca8a", "#f5cd78", "#ff9a8a"][index % 6] }} /> <span title={item.campaign.name}>{item.campaign.name}</span><b>{item.count}</b></div>) : <span className="muted-note">Aucune affectation</span>}</div></div></div></div>
      <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Utilisateur</th><th>MSISDN</th><th>Rôle</th><th>Catégorie</th><th>Campagnes</th><th>Superviseur</th><th>Shop</th>{(canManage || canManageCampaigns) && <th aria-label="Actions" />}</tr></thead><tbody>{filteredUsers.map((user) => { const userCampaigns = campaignAssignments.filter((assignment) => assignment.user_id === user.id).map((assignment) => campaigns.find((campaign) => campaign.id === assignment.campaign_id)).filter((campaign): campaign is CampaignRecord => Boolean(campaign)); const canAssign = canManageCampaigns && user.role === "agent" && ["hostess", "brand_ambassador", "brand_ambassador_youth"].includes(user.user_category || ""); return <tr key={user.id} className={canManage ? "row-clickable" : ""} onClick={() => handleUserRowClick(user)}><td><div className="table-user"><div className="avatar small">{user.full_name.slice(0, 1).toUpperCase()}</div><div><strong>{user.full_name}</strong><small>{user.id}</small></div></div></td><td><CopyablePhone value={user.phone} className="mono-value" /></td><td><span className={`role-badge role-${user.role}`}>{ROLE_LABELS[user.role]}</span></td><td>{user.user_category ? CATEGORY_LABELS[user.user_category].split(" — ")[0] : "—"}</td><td><div className="campaign-pills">{userCampaigns.length ? userCampaigns.map((campaign) => <span className="campaign-pill" key={campaign.id} title={campaign.name}>{campaign.name}</span>) : <span className="muted-note">Aucune</span>}</div></td><td>{user.supervisor_id ? <span className="mono-value">{user.supervisor_id.slice(0, 8)}…</span> : "—"}</td><td>{user.permanent_shop_id || "—"}</td>{(canManage || canManageCampaigns) && <td><div className="row-actions">{canManage && user.role === "agent" && <button type="button" className="icon-action profile-action" aria-label={`Ouvrir la fiche de ${user.full_name}`} title="Ouvrir la fiche agent" onClick={(event) => { event.stopPropagation(); setSelectedAgentProfile(user); }}><UserCircle2 size={14} /></button>}{canAssign && <button type="button" className="icon-action campaign-action" aria-label={`Affecter ${user.full_name} à une campagne`} title="Affecter aux campagnes" onClick={(event) => { event.stopPropagation(); beginCampaignAssignment(user); }}><BriefcaseBusiness size={14} /></button>}{canManage && <button type="button" className="icon-action edit" aria-label={`Modifier ${user.full_name}`} title="Modifier" onClick={(event) => { event.stopPropagation(); beginEdit(user); }}><FilePenLine size={14} /></button>}{canManage && <button type="button" className="icon-action delete" aria-label={`Supprimer ${user.full_name}`} title="Supprimer" onClick={(event) => { event.stopPropagation(); setDeleteCandidate(user); }}><Trash2 size={14} /></button>}</div></td>}</tr>; })}</tbody></table>{!filteredUsers.length && <div className="table-empty"><Search size={22} /><strong>Aucun utilisateur trouvé</strong><span>Essayez un MSISDN ou élargissez vos filtres.</span></div>}</div>
    </>}
    {showConfig && <ModalLayer><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={() => configured && setShowConfig(false)} /><form className="modal-card config-modal" onSubmit={handleSetup}><div className="modal-header"><div><div className="eyebrow"><Database size={13} /> Connexion</div><h3>Base Supabase</h3></div>{configured && <button type="button" className="modal-close" onClick={() => setShowConfig(false)} aria-label="Fermer"><X size={16} /></button>}</div><label>URL du projet<input value={setupUrl} onChange={(event) => setSetupUrl(event.target.value)} placeholder="https://votre-projet.supabase.co" required /></label><label>Clé publishable<input value={setupKey} onChange={(event) => setSetupKey(event.target.value)} placeholder="Clé publishable / anon" type="password" autoComplete="off" required /></label>{connectionTest && <div className={`connection-test ${connectionTest.kind}`}><span>{connectionTest.kind === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}</span>{connectionTest.message}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => void handleTestConnection()} disabled={testingConnection}>{testingConnection ? <LoaderCircle className="spin" size={14} /> : <Database size={14} />} Tester</button><button type="submit" className="button primary" disabled={testingConnection}><CheckCircle2 size={14} /> Enregistrer</button></div>{configured && <button type="button" className="text-button danger config-disconnect" onClick={handleDisconnect}>Déconnecter ce projet</button>}</form></ModalLayer>}
    {deleteCandidate && <ModalLayer><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={() => setDeleteCandidate(null)} /><div className="modal-card confirm-card"><div className="danger-icon"><Trash2 size={19} /></div><h3>Supprimer cet utilisateur ?</h3><p><strong>{deleteCandidate.full_name}</strong> · <CopyablePhone value={deleteCandidate.phone} />La ligne sera supprimée définitivement de <code>public.users</code>.</p><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setDeleteCandidate(null)}>Annuler</button><button type="button" className="button danger-button" onClick={() => void confirmDelete()} disabled={actionLoading}>{actionLoading ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} Confirmer</button></div></div></ModalLayer>}
    {campaignDraft && <ModalLayer><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={() => setCampaignDraft(null)} /><form className="modal-card campaign-modal" onSubmit={saveCampaignAssignment}><div className="modal-header"><div><div className="eyebrow"><BriefcaseBusiness size={13} /> Affectation</div><h3>Campagnes de {campaignDraft.full_name}</h3></div><button type="button" className="modal-close" onClick={() => setCampaignDraft(null)} aria-label="Fermer"><X size={16} /></button></div><p className="modal-helper">Sélectionnez une ou plusieurs campagnes. Les campagnes non sélectionnées seront désactivées pour cet agent.</p><div className="campaign-options">{campaigns.filter((campaign) => (campaign.status === "active" || campaign.status === "draft") && campaign.campaign_type === (campaignDraft.user_category === "hostess" ? "hostess" : "brand_ambassador")).map((campaign) => { const selected = campaignSelection.includes(campaign.id); return <button type="button" className={`campaign-option ${selected ? "is-selected" : ""}`} aria-pressed={selected} key={campaign.id} onClick={() => setCampaignSelection((current) => selected ? current.filter((id) => id !== campaign.id) : [...current, campaign.id])}><span className="campaign-option-mark">{selected ? <CheckCircle2 size={15} /> : <span />}</span><span><strong>{campaign.name}</strong><small>{campaign.campaign_type === "hostess" ? "Hôtesse" : "Brand Ambassador"} · {campaign.status === "active" ? "Active" : "Brouillon"}</small></span></button>; })}</div>{!campaigns.length && <div className="table-empty"><BriefcaseBusiness size={20} /><strong>Aucune campagne disponible</strong></div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setCampaignDraft(null)}>Annuler</button><button type="submit" className="button primary" disabled={actionLoading}>{actionLoading ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} Enregistrer</button></div></form></ModalLayer>}
    {editDraft && <ModalLayer><button className="modal-backdrop" type="button" aria-label="Fermer" onClick={() => setEditDraft(null)} /><form className="modal-card edit-modal" onSubmit={saveEdit}><div className="modal-header"><div><div className="eyebrow"><ShieldCheck size={13} /> Modification</div><h3>Modifier l’utilisateur</h3></div><button type="button" className="modal-close" onClick={() => setEditDraft(null)} aria-label="Fermer"><X size={16} /></button></div><label>Nom complet<input value={editDraft.full_name} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, full_name: event.target.value } : draft)} required /></label><label>MSISDN<input value={editDraft.phone} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, phone: event.target.value } : draft)} type="tel" inputMode="tel" required /></label><div className="filter-control"><CustomSelect value={editDraft.role} onChange={(value) => setEditDraft((draft) => draft ? { ...draft, role: value as UserRole } : draft)} ariaLabel="Rôle" placeholder="Rôle" options={ROLE_OPTIONS.map((role) => ({ value: role, label: ROLE_LABELS[role] }))} /></div><div className="filter-control"><CustomSelect value={editDraft.user_category || ""} onChange={(value) => setEditDraft((draft) => draft ? { ...draft, user_category: (value || null) as UserCategory | null } : draft)} ariaLabel="Catégorie" placeholder="Catégorie" options={[{ value: "", label: "Aucune catégorie" }, ...CATEGORY_OPTIONS.map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))]} /></div><label>Superviseur (ID, optionnel)<input value={editDraft.supervisor_id || ""} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, supervisor_id: event.target.value || null } : draft)} placeholder="Aucun" /></label><label>Shop permanent (optionnel)<input value={editDraft.permanent_shop_id || ""} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, permanent_shop_id: event.target.value || null } : draft)} placeholder="Aucun shop" /></label><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEditDraft(null)}>Annuler</button><button type="submit" className="button primary" disabled={actionLoading}>{actionLoading ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} Enregistrer</button></div></form></ModalLayer>}
    {selectedAgentProfile && <AgentDetailModal agent={selectedAgentProfile} campaigns={campaigns} assignments={campaignAssignments} assignmentRequests={assignmentRequests} canRequest={false} canExport canEdit={canManage} onEdit={() => { if (selectedAgentProfile) beginEdit(selectedAgentProfile); setSelectedAgentProfile(null); }} onNotice={(next) => setNotice(next)} onClose={() => setSelectedAgentProfile(null)} />}
    {profileOpen && profile && <ProfileModal profile={profile} onClose={() => setProfileOpen(false)} onSaved={handleProfileSaved} />}
  </section>;
}

export default AdminDashboard;
