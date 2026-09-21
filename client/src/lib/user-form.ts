import type { UserCategory, UserInsert, UserRole } from "./supabase";

export const ROLE_LABELS: Record<UserRole, string> = {
  agent: "Agent",
  supervisor: "Superviseur",
  sub_admin: "Coordination",
  admin: "Administrateur",
  super_admin: "Support IT",
};

export const CATEGORY_LABELS: Record<UserCategory, string> = {
  hostess: "Hôtesse — campagne Vodacom Privilège",
  brand_ambassador: "Brand Ambassador — campagne Merchant Educational",
  brand_ambassador_youth: "Brand Ambassador Youth — campagne Youth F2F",
  operations: "Opérations",
};

export const ROLE_OPTIONS: UserRole[] = ["agent", "supervisor", "sub_admin", "admin", "super_admin"];
export const CATEGORY_OPTIONS: UserCategory[] = ["hostess", "brand_ambassador", "brand_ambassador_youth", "operations"];

export function defaultPasswordForRole(role: UserRole): string {
  if (role === "agent") return "password";
  if (role === "supervisor") return "test";
  return "admin";
}

export function buildUserPayload(input: {
  id: string;
  fullName: string;
  phone: string;
  password: string;
  role: UserRole;
  category: UserCategory | null;
  supervisorId: string | null;
  permanentShopId: string | null;
}): UserInsert {
  return {
    id: input.id,
    full_name: input.fullName.trim(),
    phone: input.phone,
    password_hash: input.password,
    role: input.role,
    user_category: input.category || null,
    supervisor_id: input.supervisorId || null,
    permanent_shop_id: input.permanentShopId || null,
  };
}

export function shouldShowShop(role: UserRole, category: UserCategory | null): boolean {
  return role === "agent" && category === "hostess";
}

export function categoryShortLabel(category: UserCategory | null): string {
  if (!category) return "Aucune catégorie";
  return CATEGORY_LABELS[category].split(" — ")[0];
}
