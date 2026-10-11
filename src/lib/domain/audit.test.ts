import { describe, expect, it } from "vitest";
import { entitiesOf, moduleOf, severityOf } from "./audit";

describe("audit severity and modules", () => {
  it("groups support tickets under Settings as low severity", () => {
    expect(moduleOf("SupportTicket")).toBe("Settings");
    expect(severityOf("support.ticket.create")).toBe("Low");
    expect(severityOf("support.ticket.resolve")).toBe("Low");
  });

  it("rates reversals, deletions and unlocks high, edits medium, the rest low", () => {
    expect(severityOf("payment.reverse")).toBe("High");
    expect(severityOf("member.delete")).toBe("High");
    expect(severityOf("month.unlock")).toBe("High");
    expect(severityOf("member.update")).toBe("Medium");
    expect(severityOf("month.lock")).toBe("Medium");
    expect(severityOf("member.create")).toBe("Low");
    expect(severityOf("export.members", "Member")).toBe("Low");
  });
  it("rates a restore high, as the prototype does, and files backups under Settings", () => {
    expect(severityOf("backup.restore")).toBe("High");
    expect(severityOf("member.restore")).toBe("High");
    expect(severityOf("backup.create")).toBe("Low");
    expect(severityOf("backup.prune")).toBe("Low");
    expect(moduleOf("Backup")).toBe("Settings");
  });
  it("groups record types into the prototype's modules", () => {
    expect(moduleOf("Payment")).toBe("Payments");
    expect(moduleOf("MembershipPlan")).toBe("Settings");
    expect(moduleOf("Expense")).toBe("Accounts");
    expect(moduleOf("Something")).toBe("Other");
    expect(entitiesOf("Invoices")).toEqual(["Invoice"]);
  });

  it("rates role changes and branch close or delete high, and files branches under Settings", () => {
    expect(severityOf("branch.deactivate")).toBe("High");
    expect(severityOf("branch.delete")).toBe("High");
    expect(severityOf("staff.role")).toBe("High");
    expect(moduleOf("Branch")).toBe("Settings");
  });
});

import { AUDIT_MODULES, changedFields, changeSummary, deviceLabel, describeAudit, humaniseKey, isKnownAction } from "./audit";

describe("audit change detail", () => {
  it("rates a remote door opening high and names the device", () => {
    expect(severityOf("device.open-door", "Device")).toBe("High");
    // A file imported in parts: each part says its own count and part, the last also the file's total.
    expect(describeAudit({ action: "import.members", entity: "Import", entityId: "members", after: { file: "m.csv", part: "1/2", rows: 40, imported: 20 } })).toBe("Imported 20 members from m.csv (part 1 of 2)");
    expect(describeAudit({ action: "import.members", entity: "Import", entityId: "members", after: { file: "m.csv", part: "2/2", rows: 40, imported: 20, total: 40 } })).toBe("Imported 20 members from m.csv (part 2 of 2; 40 members from this file in all)");
    expect(describeAudit({ action: "import.payments", entity: "Import", entityId: "payments", after: { file: "p.csv", part: "1/1", rows: 30, imported: 28, total: 28 } })).toBe("Imported 28 payments from p.csv (2 skipped)");
    expect(describeAudit({ action: "import.expenses", entity: "Import", entityId: "expenses", after: { file: "e.csv", rows: 1, imported: 1, total: 1 } })).toBe("Imported 1 expense from e.csv");
    // Entries written before the import said how many it brought in read as they always did.
    expect(describeAudit({ action: "import.members", entity: "Import", entityId: "members", after: { file: "old.csv", rows: 12 } })).toBe("Imported 12 members from old.csv");
    expect(describeAudit({ action: "device.open-door", entity: "Device", entityId: "dev1", after: { name: "Main door", serial: "ABC123", branch: "Andheri" } })).toBe("Opened the door remotely on device Main door (Andheri)");
    expect(describeAudit({ action: "device.open-door", entity: "Device", entityId: "dev1" })).toBe("Opened the door remotely on device dev1");
    expect(describeAudit({ action: "device.sync", entity: "Device", entityId: "dev1", after: { name: "Main door", members: 12, allowed: 10, removed: 2, commands: 14 } })).toBe("Synced device Main door: 10 of 12 members loaded, 2 removed (14 commands)");
    expect(severityOf("device.sync", "Device")).toBe("Low");
  });
  it("humanises keys and lists old → new for settings", () => {
    expect(humaniseKey("idleMinutes")).toBe("idle minutes");
    expect(humaniseKey("gstin")).toBe("GSTIN");
    expect(humaniseKey("upi_id")).toBe("UPI ID");
    expect(describeAudit({ action: "setting.update", entity: "Setting", entityId: "gym", before: { name: "Iron", tagline: "A", gstin: "27AAA" }, after: { name: "Iron", tagline: "B", gstin: "" } })).toBe("Changed settings › Gym: tagline 'A' → 'B', GSTIN removed");
    expect(describeAudit({ action: "setting.update", entity: "Setting", entityId: "security", before: null, after: { idleMinutes: 30 } })).toBe("Changed settings › Security: idle minutes set to 30");
    expect(describeAudit({ action: "setting.update", entity: "Setting", entityId: "access", before: { blockDues: false }, after: { blockDues: true } })).toBe("Changed settings › Entry rules: block dues off → on");
    expect(describeAudit({ action: "setting.update", entity: "Setting", entityId: "gym", before: { a: 1 }, after: { a: 1 } })).toBe("Changed settings › Gym");
  });
  it("masks secrets and walks nested objects to their changed leaves", () => {
    expect(changedFields({ whatsappToken: "old", other: 1 }, { whatsappToken: "new", other: 1 })).toEqual([{ path: "whatsappToken", label: "whatsapp token", text: "updated" }]);
    expect(changedFields({ apiKey: "x" }, { apiKey: null })).toEqual([{ path: "apiKey", label: "API key", text: "removed" }]);
    expect(changedFields({ reminders: { days: [3, 1], enabled: true, text: "hi" } }, { reminders: { days: [7, 3, 1], enabled: true, text: "hi" } })).toEqual([{ path: "reminders.days", label: "reminders › days", text: "[3, 1] → [7, 3, 1]" }]);
    expect(changeSummary({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, { a: 9, b: 9, c: 9, d: 9, e: 9, f: 9 })).toBe("a 1 → 9, b 2 → 9, c 3 → 9, d 4 → 9 and 2 more");
    expect(changedFields({ updatedAt: "x", name: "A" }, { updatedAt: "y", name: "A" })).toEqual([]);
  });
});

describe("audit modules, devices and sentences", () => {
  it("lists the prototype's modules in order", () => {
    expect(AUDIT_MODULES).toEqual(["Access", "Members", "Invoices", "Payments", "Accounts", "WhatsApp", "POS", "Attendance", "Staff & devices", "Settings", "Other"]);
    expect(moduleOf("Session", "auth.login")).toBe("Access");
    expect(moduleOf("User", "profile.password")).toBe("Access");
    expect(moduleOf("Setting", "whatsapp.automation.run")).toBe("WhatsApp");
    expect(moduleOf("Setting", "setting.update")).toBe("Settings");
    expect(moduleOf("Lead", "lead.create")).toBe("Members");
    expect(moduleOf("AiProposal", "ai.proposal.send")).toBe("Other");
  });
  it("rates sign-ins medium and password changes high", () => {
    expect(severityOf("profile.password")).toBe("High");
    expect(severityOf("auth.login")).toBe("Medium");
    expect(severityOf("auth.logout")).toBe("Low");
    expect(severityOf("staff.role")).toBe("High");
  });
  it("labels devices", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120 Safari/537", "1.2.3.4")).toBe("Chrome · Windows · 1.2.3.4");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17) AppleWebKit Version/17 Mobile Safari/604", "1.2.3.4")).toBe("Safari · iPhone · 1.2.3.4");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120", "1.2.3.4")).toBe("Edge · Windows · 1.2.3.4");
    expect(deviceLabel(null, null, "SYSTEM")).toBe("Automatic");
  });
  it("writes readable sentences", () => {
    expect(describeAudit({ action: "payment.create", entity: "Payment", entityId: "x", after: { code: "PAY-5001", amount: 200000, method: "UPI", invoiceNumber: "INV-1024" } })).toBe("Recorded payment PAY-5001 of ₹2,000 (UPI) against INV-1024");
    expect(describeAudit({ action: "invoice.cancel", entity: "Invoice", entityId: "x", after: { number: "INV-1", cancelReason: "typo" } })).toMatch(/· reason: typo$/);
    expect(describeAudit({ action: "month.lock", entity: "MonthLock", entityId: "br:2026-09" })).toBe("Locked accounting month Sep 2026");
    expect(describeAudit({ action: "member.create", entity: "Member", entityId: "x", after: { name: "Asha", code: "PHG-1001" } })).toBe("Added a new member Asha (PHG-1001)");
    expect(describeAudit({ action: "billing.utr-rejected", entity: "BranchSubscription", entityId: "x", after: { reviewedBy: "team@fitron.in", rejectReason: "No payment with this UTR" } })).toBe(
      "FITRON could not match the bank transfer (checked by team@fitron.in) · reason: No payment with this UTR",
    );
    expect(describeAudit({ action: "billing.utr-rejected", entity: "BranchSubscription", entityId: "x" })).toBe("FITRON could not match the bank transfer");
  });
  it("knows every action key the app writes", () => {
    const keys = `ai.proposal.send ai.proposal.confirm asset.create asset.remove asset.undo-disposal asset.update asset.sold asset.scrapped attendance.override attendance.remove auth.idle-signout auth.login auth.logout autopay.create autopay.charged autopay.pause autopay.approve-demo backup.create backup.download backup.prune backup.restore billing.utr-submitted billing.utr-rejected billing.plan-paid billing.branch-paid booking.attendedAll booking.create booking.promote booking.status branch.activate branch.create branch.deactivate branch.delete branch.update class.create class.update class.activate class.deactivate demo.clear device.add device.update device.open-door device.remove diet.create diet.update document.delete document.replace document.upload document.view expense.create expense.import expense.update expense.void export.expenses export.members gym.logo gym.logo.remove import.members import.expenses import.products invoice.cancel invoice.create lead.create lead.stage lead.update lead.won lead.call lead.message member.biometric-consent member.biometric-enrol member.biometric-erase member.create member.delete member.erase member.export member.import member.programs member.restore member.transfer member.update member.suspend member.resume membership.freeze membership.unfreeze membership.create membership.renew month.lock month.unlock offer.create offer.pause offer.activate payment.create payment.reverse payroll.advance payroll.advance.settle payroll.pay plan.create plan.delete plan.update plan.activate plan.deactivate pos.sale product.create product.import product.stock product.update product.activate product.deactivate profile.password profile.photo profile.photo.remove profile.update purchase.cancel purchase.create purchase.pay setting.update staff.create staff.role staff.role-password-failed staff.salary staff.update staff.activate staff.deactivate support.ticket.create support.ticket.resolve whatsapp.automation.run whatsapp.campaign whatsapp.link whatsapp.unlink whatsapp.rule whatsapp.template workout.create workout.update`.split(/\s+/);
    for (const k of keys) expect(isKnownAction(k), k).toBe(true);
    expect(isKnownAction("something.else")).toBe(false);
  });
});
