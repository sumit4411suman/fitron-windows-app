import { describe, expect, it } from "vitest";
import { publicCompany } from "./company";

describe("publicCompany", () => {
  it("shows nothing until an address or GSTIN is set, even with the installer's pre-filled name", () => {
    expect(publicCompany({})).toBeNull();
    expect(publicCompany({ FITRON_LEGAL_NAME: "Fitron Technologies" })).toBeNull();
    expect(publicCompany({ FITRON_LEGAL_NAME: "Fitron Technologies", FITRON_ADDRESS: "  ", FITRON_GSTIN: "" })).toBeNull();
  });

  it("shows the details that are set, tidied", () => {
    expect(publicCompany({ FITRON_LEGAL_NAME: " Fitron  Technologies Pvt Ltd ", FITRON_ADDRESS: "12 MG Road,\n Bokaro 827004", FITRON_GSTIN: "20abcde1234f1z5" })).toEqual({
      name: "Fitron Technologies Pvt Ltd",
      address: "12 MG Road, Bokaro 827004",
      gstin: "20ABCDE1234F1Z5",
    });
  });

  it("works with just one of address or GSTIN, and falls back to the brand name", () => {
    expect(publicCompany({ FITRON_ADDRESS: "12 MG Road, Bokaro" })).toEqual({ name: "FITRON", address: "12 MG Road, Bokaro", gstin: "" });
    expect(publicCompany({ FITRON_GSTIN: "20ABCDE1234F1Z5" })).toEqual({ name: "FITRON", address: "", gstin: "20ABCDE1234F1Z5" });
  });
});
