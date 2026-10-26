import { describe, expect, it } from "vitest";
import { isValidMpesa, isValidMsisdn, normalizePhone } from "./phone";

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

describe("M-Pesa number", () => {
  it("accepts 08 numbers in local or +243 format", () => {
    expect(isValidMpesa("0812345678")).toBe(true);
    expect(isValidMpesa("+243 82 123 4567")).toBe(true);
  });

  it("rejects 09 numbers, even though they are valid MSISDN", () => {
    expect(isValidMsisdn("0971234567")).toBe(true);
    expect(isValidMpesa("0971234567")).toBe(false);
    expect(isValidMpesa("+243971234567")).toBe(false);
  });

  it("rejects empty and incomplete values", () => {
    expect(isValidMpesa("")).toBe(false);
    expect(isValidMpesa("08123")).toBe(false);
  });
});
