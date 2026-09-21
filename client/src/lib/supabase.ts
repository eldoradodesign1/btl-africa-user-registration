import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidMsisdn, normalizePhone } from "./phone";

export type UserRole = "agent" | "supervisor" | "sub_admin" | "admin" | "super_admin";
export type UserCategory = "hostess" | "brand_ambassador" | "brand_ambassador_youth" | "operations";
export type RegistrationRequestStatus = "pending" | "approved" | "rejected";

export type UserRecord = {
  id: string;
  full_name: string;
  phone: string;
  password_hash: string | null;
  role: UserRole;
  user_category: UserCategory | null;
  supervisor_id: string | null;
  permanent_shop_id: string | null;
  avatar_url: string | null;
  profile_updated_at: string | null;
};

export type UserInsert = Omit<UserRecord, "password_hash" | "avatar_url" | "profile_updated_at"> & { password_hash: string; avatar_url?: string | null; profile_updated_at?: string | null };
export type CampaignRecord = {
  id: string;
  code: string;
  name: string;
  campaign_type: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
};
export type CampaignAssignment = {
  id: string;
  user_id: string;
  campaign_id: string;
  is_active: boolean;
  assigned_at: string;
  assigned_by: string | null;
};
export type CampaignAssignmentRequest = {
  id: string;
  user_id: string;
  campaign_id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
};
export type CampaignRun = { id: string; campaign_id: string; name: string; starts_on: string; ends_on: string | null; status: string };
export type CampaignPause = { starts_on: string; ends_on: string; reason: string | null };
export type PerformancePoint = { date: string; value: number; label: string };
export type PresenceRecord = { date: string; status: string; checkin_at: string | null; checkout_at: string | null; note: string | null };
export type AgentInsights = { performance: PerformancePoint[]; presence: PresenceRecord[]; metricLabel: string; campaignStart: string | null; campaignEnd: string | null; pauses: CampaignPause[] };
export type RegistrationRequest = {
  id: string;
  full_name: string;
  phone: string;
  role: "agent";
  user_category: UserCategory | null;
  status: RegistrationRequestStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
};
export type SupabaseConnection = { url: string; publishableKey: string };
export type AdminContext = { profile: UserRecord };

const runtimeKey = "btl-supabase-connection";
const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const envKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

function readRuntimeConnection(): SupabaseConnection | null {
  try {
    const raw = sessionStorage.getItem(runtimeKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SupabaseConnection>;
    return parsed.url && parsed.publishableKey ? { url: parsed.url, publishableKey: parsed.publishableKey } : null;
  } catch {
    return null;
  }
}

function createConfiguredClient(connection: SupabaseConnection): SupabaseClient {
  return createClient(connection.url, connection.publishableKey);
}

let activeConnection: SupabaseConnection | null = readRuntimeConnection() || (envUrl && envKey ? { url: envUrl, publishableKey: envKey } : null);
let supabaseClient: SupabaseClient | null = activeConnection ? createConfiguredClient(activeConnection) : null;
let activeProfile: UserRecord | null = null;

export function getSupabaseConnection(): SupabaseConnection | null { return activeConnection; }
export function isSupabaseConfigured(): boolean { return Boolean(activeConnection && supabaseClient); }

export function configureSupabase(url: string, publishableKey: string): SupabaseConnection {
  const normalizedUrl = url.trim().replace(/\/$/, "");
  const normalizedKey = publishableKey.trim();
  if (!/^https:\/\/[^\s]+\.supabase\.co$/i.test(normalizedUrl)) throw new Error("L’URL Supabase doit ressembler à https://votre-projet.supabase.co.");
  if (normalizedKey.length < 20 || normalizedKey.toLowerCase().includes("service_role")) throw new Error("Utilisez uniquement la clé publishable/anon, jamais la clé service_role.");
  activeConnection = { url: normalizedUrl, publishableKey: normalizedKey };
  supabaseClient = createConfiguredClient(activeConnection);
  activeProfile = null;
  sessionStorage.setItem(runtimeKey, JSON.stringify(activeConnection));
  return activeConnection;
}

export function clearSupabaseConnection(): void {
  activeConnection = null;
  supabaseClient = null;
  activeProfile = null;
  sessionStorage.removeItem(runtimeKey);
}

export async function testSupabaseConnection(url: string, publishableKey: string): Promise<void> {
  const normalizedUrl = url.trim().replace(/\/$/, "");
  const key = publishableKey.trim();
  if (!normalizedUrl || !key) throw new Error("Renseignez l’URL et la clé publishable.");
  const response = await fetch(`${normalizedUrl}/rest/v1/users?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (response.status === 401) throw new Error("Clé Supabase refusée.");
  if (![200, 206, 403].includes(response.status)) throw new Error(`Connexion refusée (${response.status}).`);
}

const demoUsers: UserRecord[] = [
  { id: "b7d7aef4-2e2b-4a7e-9f12-1d5ce8481b0a", full_name: "Patrick Kabeya", phone: "0812345678", password_hash: null, role: "supervisor", user_category: null, supervisor_id: null, permanent_shop_id: null, avatar_url: null, profile_updated_at: null },
  { id: "e6a5f5f0-3f88-4fd9-a3a5-11e8c18d8a5c", full_name: "Grâce Mbuyi", phone: "0998765432", password_hash: null, role: "admin", user_category: null, supervisor_id: null, permanent_shop_id: null, avatar_url: null, profile_updated_at: null },
];
let demoUsersCache = [...demoUsers];
const safeUserColumns = "id, full_name, phone, role, user_category, supervisor_id, permanent_shop_id, avatar_url, profile_updated_at";
const safeCampaignColumns = "id, code, name, campaign_type, status, starts_on, ends_on";
const safeAssignmentColumns = "id, user_id, campaign_id, is_active, assigned_at, assigned_by";

export function getDemoUsers(): UserRecord[] { return [...demoUsersCache]; }

function phoneCandidates(phone: string): string[] {
  const normalized = normalizePhone(phone);
  if (!isValidMsisdn(normalized)) return [phone.trim()];
  return Array.from(new Set([normalized, `+243${normalized.slice(1)}`]));
}

function assertSuperAdmin(): UserRecord {
  if (!activeProfile) throw new Error("Connexion administrateur requise avant cette opération.");
  if (activeProfile.role !== "super_admin") throw new Error("Cette opération est réservée au super_admin.");
  return activeProfile;
}

function mapRequest(data: unknown): RegistrationRequest {
  return data as RegistrationRequest;
}

export async function getAdminContext(): Promise<AdminContext | null> {
  return activeProfile ? { profile: activeProfile } : null;
}

export async function signInAdmin(phone: string, password: string): Promise<AdminContext> {
  if (!supabaseClient) throw new Error("Configurez Supabase avant de vous connecter.");
  let lastError: unknown = null;
  for (const candidate of phoneCandidates(phone)) {
    const { data, error } = await supabaseClient.rpc("authenticate_user", { p_phone: candidate, p_password: password });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row) {
      const profile = { ...row, password_hash: null } as UserRecord;
      activeProfile = profile;
      return { profile };
    }
    lastError = error;
  }
  if (lastError) throw lastError;
  throw new Error("MSISDN ou mot de passe incorrect.");
}

export async function signOutAdmin(): Promise<void> { activeProfile = null; }

export async function loadUsers(): Promise<UserRecord[]> {
  if (!supabaseClient) return getDemoUsers();
  const { data, error } = await supabaseClient.from("users").select(safeUserColumns).order("full_name");
  if (error) throw error;
  return (data || []).map((user) => ({ ...user, password_hash: null })) as UserRecord[];
}

export async function loadCampaigns(): Promise<CampaignRecord[]> {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient.from("campaigns").select(safeCampaignColumns).order("name");
  if (error) throw error;
  return (data || []) as CampaignRecord[];
}

export async function loadCampaignAssignments(): Promise<CampaignAssignment[]> {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient.from("user_campaign_assignments").select(safeAssignmentColumns).eq("is_active", true);
  if (error) throw error;
  return (data || []) as CampaignAssignment[];
}

export async function loadSupervisors(): Promise<UserRecord[]> {
  if (!supabaseClient) return demoUsersCache.filter((user) => ["supervisor", "admin", "sub_admin", "super_admin"].includes(user.role));
  const { data, error } = await supabaseClient.from("users").select(safeUserColumns).in("role", ["supervisor", "admin", "sub_admin", "super_admin"]).order("full_name");
  if (error) throw error;
  return (data || []).map((user) => ({ ...user, password_hash: null })) as UserRecord[];
}

export async function loadAgentInsights(user: UserRecord, campaign: CampaignRecord): Promise<AgentInsights> {
  if (!supabaseClient) return { performance: [], presence: [], metricLabel: "Performance", campaignStart: campaign.starts_on, campaignEnd: campaign.ends_on, pauses: [] };
  const { data: pausesData, error: pausesError } = await supabaseClient.from("campaign_pauses").select("starts_on, ends_on, reason").eq("campaign_id", campaign.id).order("starts_on");
  if (pausesError) throw pausesError;
  const pauses = (pausesData || []) as CampaignPause[];
  if (user.user_category === "hostess") {
    const { data, error } = await supabaseClient.from("daily_reports").select("date, amount, priv, roam, bund, arrival_time, departure_time, pointage_photo, comment").eq("agent_id", user.id).order("date");
    if (error) throw error;
    const rows = (data || []) as Array<{ date: string; amount: number | null; priv: number | null; roam: number | null; bund: number | null; arrival_time: string | null; departure_time: string | null; pointage_photo: string | null; comment: string | null }>;
    return {
      metricLabel: "Activations",
      performance: rows.map((row) => ({ date: row.date, value: Number(row.amount ?? ((row.priv || 0) + (row.roam || 0) + (row.bund || 0))), label: `${Number(row.amount ?? ((row.priv || 0) + (row.roam || 0) + (row.bund || 0)))} activations` })),
      presence: rows.map((row) => ({ date: row.date, status: row.arrival_time || row.departure_time || row.pointage_photo ? "présent" : "rapport", checkin_at: row.arrival_time, checkout_at: row.departure_time, note: row.comment })),
      campaignStart: campaign.starts_on,
      campaignEnd: campaign.ends_on,
      pauses,
    };
  }

  const { data: runsData, error: runsError } = await supabaseClient.from("campaign_runs").select("id").eq("campaign_id", campaign.id);
  if (runsError) throw runsError;
  const runIds = ((runsData || []) as Array<{ id: string }>).map((run) => run.id);
  if (!runIds.length) return { performance: [], presence: [], metricLabel: "Heures terrain", campaignStart: campaign.starts_on, campaignEnd: campaign.ends_on, pauses };
  const { data, error } = await supabaseClient.from("ba_daily_attendance").select("activity_date, status, checkin_at, checkout_at, closing_comment").eq("ba_id", user.id).in("campaign_run_id", runIds).order("activity_date");
  if (error) throw error;
  const rows = (data || []) as Array<{ activity_date: string; status: string; checkin_at: string | null; checkout_at: string | null; closing_comment: string | null }>;
  return {
    metricLabel: "Heures terrain",
    performance: rows.map((row) => { const hours = row.checkin_at && row.checkout_at ? Math.max(0, (new Date(row.checkout_at).getTime() - new Date(row.checkin_at).getTime()) / 3600000) : row.status === "closed" ? 1 : 0; return { date: row.activity_date, value: Number(hours.toFixed(1)), label: `${Number(hours.toFixed(1))} h` }; }),
    presence: rows.map((row) => ({ date: row.activity_date, status: row.status, checkin_at: row.checkin_at, checkout_at: row.checkout_at, note: row.closing_comment })),
    campaignStart: campaign.starts_on,
    campaignEnd: campaign.ends_on,
    pauses,
  };
}

export async function requestCampaignAssignment(userId: string, campaignId: string): Promise<CampaignAssignmentRequest> {
  if (!supabaseClient) throw new Error("Configurez Supabase avant de demander une affectation.");
  const { data, error } = await supabaseClient.rpc("request_campaign_assignment", { p_user_id: userId, p_campaign_id: campaignId });
  if (error) throw error;
  const request = Array.isArray(data) ? data[0] : data;
  if (!request) throw new Error("La demande d’affectation n’a pas été créée.");
  return request as CampaignAssignmentRequest;
}

export async function loadCampaignAssignmentRequests(): Promise<CampaignAssignmentRequest[]> {
  const manager = assertCampaignManager();
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient.rpc("list_campaign_assignment_requests", { p_manager_id: manager.id });
  if (error) throw error;
  return (data || []) as CampaignAssignmentRequest[];
}

export async function reviewCampaignAssignmentRequest(requestId: string, approve: boolean, note = ""): Promise<CampaignAssignmentRequest> {
  const manager = assertCampaignManager();
  if (!supabaseClient) throw new Error("Configurez Supabase avant de traiter la demande.");
  const { data, error } = await supabaseClient.rpc("review_campaign_assignment_request", { p_request_id: requestId, p_manager_id: manager.id, p_approve: approve, p_review_note: note || null });
  if (error) throw error;
  const request = Array.isArray(data) ? data[0] : data;
  if (!request) throw new Error("La demande n’a pas pu être traitée.");
  return request as CampaignAssignmentRequest;
}

export async function updateMyProfile(input: { fullName: string; phone: string; currentPassword: string; password?: string; avatarUrl?: string | null }): Promise<UserRecord> {
  if (!activeProfile || !supabaseClient) throw new Error("Connexion requise avant de modifier votre profil.");
  const normalizedPhone = normalizePhone(input.phone);
  if (!isValidMsisdn(normalizedPhone)) throw new Error("Le MSISDN fourni est invalide.");
  if (!input.currentPassword) throw new Error("Le mot de passe actuel est requis pour confirmer cette modification.");
  const { data, error } = await supabaseClient.rpc("update_my_profile", { p_user_id: activeProfile.id, p_full_name: input.fullName.trim(), p_phone: normalizedPhone, p_password: input.password || null, p_avatar_url: input.avatarUrl ?? activeProfile.avatar_url, p_current_password: input.currentPassword });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Le profil n’a pas pu être mis à jour.");
  activeProfile = { ...activeProfile, ...row, password_hash: null } as UserRecord;
  return activeProfile;
}

export async function findExistingUser(normalizedPhone: string): Promise<UserRecord | null> {
  if (!supabaseClient) return demoUsersCache.find((user) => user.phone === normalizedPhone) || null;
  const { data, error } = await supabaseClient.from("users").select(safeUserColumns).eq("phone", normalizedPhone).maybeSingle();
  if (error) throw error;
  return data ? ({ ...data, password_hash: null } as UserRecord) : null;
}

export async function insertUser(payload: UserInsert): Promise<UserRecord> {
  if (!supabaseClient) {
    const duplicate = demoUsersCache.find((user) => user.phone === payload.phone);
    if (duplicate) { const error = new Error("duplicate key value violates unique constraint users_phone_key"); Object.assign(error, { code: "23505" }); throw error; }
    const created: UserRecord = { ...payload, password_hash: null, avatar_url: payload.avatar_url || null, profile_updated_at: payload.profile_updated_at || null };
    demoUsersCache = [created, ...demoUsersCache];
    return created;
  }
  if (!activeProfile) throw new Error("Connexion administrateur requise avant la création.");
  if (activeProfile.role !== "super_admin") throw new Error("Seul un super_admin peut créer un utilisateur.");
  const { data, error } = await supabaseClient.rpc("create_user_by_super_admin", { p_creator_id: activeProfile.id, p_id: payload.id, p_full_name: payload.full_name, p_phone: payload.phone, p_password: payload.password_hash, p_role: payload.role, p_user_category: payload.user_category, p_supervisor_id: payload.supervisor_id, p_permanent_shop_id: payload.permanent_shop_id });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("La création de l’utilisateur n’a pas été confirmée.");
  return { ...row, password_hash: null } as UserRecord;
}

export async function createRegistrationRequest(input: { fullName: string; phone: string; password: string; category: UserCategory }): Promise<RegistrationRequest> {
  if (!supabaseClient) throw new Error("Configurez Supabase avant de créer une demande.");
  const normalizedPhone = normalizePhone(input.phone);
  if (!isValidMsisdn(normalizedPhone)) throw new Error("Le MSISDN fourni est invalide.");
  const id = crypto.randomUUID();
  const { data, error } = await supabaseClient.rpc("create_registration_request", {
    p_request_id: id,
    p_full_name: input.fullName.trim(),
    p_phone: normalizedPhone,
    p_password_hash: input.password,
    p_user_category: input.category,
  });
  if (error) throw error;
  const request = Array.isArray(data) ? data[0] : data;
  return request ? mapRequest(request) : { id, full_name: input.fullName.trim(), phone: normalizedPhone, role: "agent", user_category: input.category, status: "pending", created_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null, review_note: null };
}

export async function loadPendingRegistrationRequests(): Promise<RegistrationRequest[]> {
  const reviewer = assertSuperAdmin();
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient.rpc("list_pending_registration_requests", { p_reviewer_id: reviewer.id });
  if (error) throw error;
  return (data || []).map(mapRequest);
}

export async function approveRegistrationRequest(requestId: string): Promise<UserRecord> {
  const reviewer = assertSuperAdmin();
  if (!supabaseClient) throw new Error("Configurez Supabase avant d’approuver une demande.");
  const { data, error } = await supabaseClient.rpc("approve_registration_request", { p_request_id: requestId, p_reviewer_id: reviewer.id });
  if (error) throw error;
  const approved = Array.isArray(data) ? data[0] : data;
  if (!approved) throw new Error("La demande n’a pas pu être approuvée.");
  return { ...approved, password_hash: null } as UserRecord;
}

export async function rejectRegistrationRequest(requestId: string, note = "Demande rejetée par le super_admin."): Promise<void> {
  const reviewer = assertSuperAdmin();
  if (!supabaseClient) throw new Error("Configurez Supabase avant de rejeter une demande.");
  const { error } = await supabaseClient.rpc("reject_registration_request", { p_request_id: requestId, p_reviewer_id: reviewer.id, p_review_note: note });
  if (error) throw error;
}

function assertCampaignManager(): UserRecord {
  if (!activeProfile) throw new Error("Connexion requise avant de gérer les campagnes.");
  if (!["admin", "super_admin", "supervisor"].includes(activeProfile.role)) throw new Error("Seuls les administrateurs et superviseurs peuvent affecter une campagne.");
  return activeProfile;
}

export async function setUserCampaignAssignments(userId: string, campaignIds: string[]): Promise<CampaignAssignment[]> {
  const manager = assertCampaignManager();
  if (!supabaseClient) throw new Error("Configurez Supabase avant de gérer les campagnes.");
  const { data, error } = await supabaseClient.rpc("set_user_campaign_assignments", { p_user_id: userId, p_campaign_ids: campaignIds, p_manager_id: manager.id });
  if (error) throw error;
  return (data || []) as CampaignAssignment[];
}

function assertManagePermission(): void {
  if (!activeProfile) throw new Error("Connexion administrateur requise avant cette opération.");
  if (!["admin", "super_admin"].includes(activeProfile.role)) throw new Error("Cette opération est réservée aux rôles admin et super_admin.");
}

export async function updateUser(id: string, patch: Partial<Pick<UserRecord, "full_name" | "phone" | "role" | "user_category" | "supervisor_id" | "permanent_shop_id">>): Promise<UserRecord> {
  if (!supabaseClient) throw new Error("Configurez Supabase avant de modifier un utilisateur.");
  assertManagePermission();
  const { data, error } = await supabaseClient.from("users").update(patch).eq("id", id).select(safeUserColumns).single();
  if (error) throw error;
  return { ...data, password_hash: null } as UserRecord;
}

export async function deleteUser(id: string): Promise<void> {
  if (!supabaseClient) throw new Error("Configurez Supabase avant de supprimer un utilisateur.");
  assertManagePermission();
  if (activeProfile?.id === id) throw new Error("Vous ne pouvez pas supprimer votre propre compte actif.");
  const { error } = await supabaseClient.from("users").delete().eq("id", id);
  if (error) throw error;
}

export function isUniquePhoneError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === "23505" || Boolean(candidate?.message?.toLowerCase().includes("phone"));
}

export function isPendingRequestConflict(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  const message = candidate?.message?.toLowerCase() || "";
  return candidate?.code === "23505" && (message.includes("registration") || message.includes("pending") || message.includes("phone"));
}
