import { describe, expect, it } from "vitest";
import { isUniquePhoneError } from "./supabase";

describe("duplicate phone protection", () => {
  it("recognizes PostgreSQL unique-phone races", () => {
    expect(isUniquePhoneError({ code: "23505", message: "users_phone_key" })).toBe(true);
    expect(isUniquePhoneError({ code: "23505", message: "duplicate key" })).toBe(true);
    expect(isUniquePhoneError({ code: "PGRST116", message: "not found" })).toBe(false);
  });
});
