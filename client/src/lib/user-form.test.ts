import { describe, expect, it } from "vitest";
import { campaignTypeLabel, isCampaignCompatibleWithCategory } from "./user-form";

describe("campaign compatibility", () => {
  it("allows hostess agents on hostess and event campaigns", () => {
    expect(isCampaignCompatibleWithCategory("hostess", "hostess")).toBe(true);
    expect(isCampaignCompatibleWithCategory("event", "hostess")).toBe(true);
  });

  it("keeps brand ambassador campaigns scoped to BA categories", () => {
    expect(isCampaignCompatibleWithCategory("brand_ambassador", "brand_ambassador")).toBe(true);
    expect(isCampaignCompatibleWithCategory("event", "brand_ambassador")).toBe(false);
    expect(isCampaignCompatibleWithCategory("hostess", "brand_ambassador")).toBe(false);
  });

  it("labels event campaigns explicitly", () => {
    expect(campaignTypeLabel("event")).toBe("Event");
  });
});
