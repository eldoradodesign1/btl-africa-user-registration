import { describe, expect, it } from "vitest";
import { getSupabaseConnection, isSupabaseConfigured } from "./supabase";

describe("Supabase project configuration", () => {
  it("uses the BTL project by default without manual setup", async () => {
    const connection = getSupabaseConnection();
    expect(isSupabaseConfigured()).toBe(true);
    expect(connection?.url).toBe("https://upkzlppvwckriuidnyvq.supabase.co");
    expect(connection?.publishableKey).toMatch(/^sb_publishable_/);

    const response = await fetch(`${connection?.url}/rest/v1/users?select=id&limit=1`, {
      headers: { apikey: connection?.publishableKey || "", Authorization: `Bearer ${connection?.publishableKey || ""}` },
    });
    // 2xx means the request was authorized; 403 means the key is valid but RLS denies this probe.
    expect([200, 206, 403]).toContain(response.status);
  }, 15000);
});
