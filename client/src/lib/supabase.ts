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
};

export type UserInsert = Omit<UserRecord, "password_hash"> & { password_hash: string };
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
  { id: "b7d7aef4-2e2b-4a7e-9f12-1d5ce8481b0a", full_name: "Patrick Kabeya", phone: "0812345678", password_hash: null, role: "supervisor", user_category: null, supervisor_id: null, permanent_shop_id: null },
  { id: "e6a5f5f0-3f88-4fd9-a3a5-11e8c18d8a5c", full_name: "Grâce Mbuyi", phone: "0998765432", password_hash: null, role: "admin", user_category: null, supervisor_id: null, permanent_shop_id: null },
];
let demoUsersCache = [...demoUsers];
const safeUserColumns = "id, full_name, phone, role, user_category, supervisor_id, permanent_shop_id";

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
    const { data, error } = await supabaseClient.from("users").select(`${safeUserColumns}, password_hash`).eq("phone", candidate).eq("password_hash", password).maybeSingle();
    if (!error && data) {
      const profile = { ...data, password_hash: null } as UserRecord;
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

export async function loadSupervisors(): Promise<UserRecord[]> {
  if (!supabaseClient) return demoUsersCache.filter((user) => ["supervisor", "admin", "sub_admin", "super_admin"].includes(user.role));
  const { data, error } = await supabaseClient.from("users").select(safeUserColumns).in("role", ["supervisor", "admin", "sub_admin", "super_admin"]).order("full_name");
  if (error) throw error;
  return (data || []).map((user) => ({ ...user, password_hash: null })) as UserRecord[];
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
    const created: UserRecord = { ...payload, password_hash: null };
    demoUsersCache = [created, ...demoUsersCache];
    return created;
  }
  if (!activeProfile) throw new Error("Connexion administrateur requise avant la création.");
  if (activeProfile.role !== "super_admin") throw new Error("Seul un super_admin peut créer un utilisateur.");
  const { data, error } = await supabaseClient.from("users").insert(payload).select(safeUserColumns).single();
  if (error) throw error;
  return { ...data, password_hash: null } as UserRecord;
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
