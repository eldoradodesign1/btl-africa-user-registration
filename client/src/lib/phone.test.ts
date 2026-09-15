import { describe, expect, it } from "vitest";
import { isValidMsisdn, normalizePhone } from "./phone";

describe("MSISDN normalization", () => {
  it("accepts a local number", () => {
    expect(isValidMsisdn("0812345678")).toBe(true);
  });

  it("normalizes the international +243 format", () => {
    expect(normalizePhone("+243812345678")).toBe("0812345678");
  });

  it("removes spaces, dashes, points and parentheses", () => {
    expect(normalizePhone("+243 81-234.5678")).toBe("0812345678");
  });

  it("rejects an invalid number", () => {
    expect(isValidMsisdn("0712345678")).toBe(false);
  });
});
