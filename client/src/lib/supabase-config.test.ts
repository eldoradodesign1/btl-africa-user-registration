import { describe, expect, it } from "vitest";
import { getSupabaseConnection, isSupabaseConfigured } from "./supabase";

describe("Supabase project configuration", () => {
  it("uses the BTL project by default without manual setup", () => {
    const connection = getSupabaseConnection();
    expect(isSupabaseConfigured()).toBe(true);
    expect(connection?.url).toBe("https://upkzlppvwckriuidnyvq.supabase.co");
    expect(connection?.publishableKey).toMatch(/^sb_publishable_/);

    expect(connection?.publishableKey).toMatch(/^sb_publishable_[A-Za-z0-9_-]+$/);
  });
});
