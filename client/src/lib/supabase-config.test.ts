import { describe, expect, it } from "vitest";

describe("Supabase project configuration", () => {
  it("accepts the configured publishable key at the REST boundary", async () => {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    expect(url).toBe("https://upkzlppvwckriuidnyvq.supabase.co");
    expect(key).toMatch(/^sb_publishable_/);

    const response = await fetch(`${url}/rest/v1/users?select=id&limit=1`, {
      headers: { apikey: key!, Authorization: `Bearer ${key}` },
    });
    // 2xx means the request was authorized; 403 means the key is valid but RLS denies this probe.
    expect([200, 206, 403]).toContain(response.status);
  }, 15000);
});
