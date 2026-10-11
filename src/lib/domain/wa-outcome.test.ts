import { describe, expect, it } from "vitest";
import { count, emptyTally, sendOutcome, tallyText } from "./wa-outcome";

describe("WhatsApp outcomes in words", () => {
  it("calls only a message the provider took sent", () => {
    expect(sendOutcome("Payment reminder", { status: "Sent" })).toBe("Payment reminder sent on WhatsApp.");
    expect(sendOutcome("Payment reminder", { status: "Logged" })).toMatch(/^Payment reminder saved, not sent: WhatsApp is not linked/);
    expect(sendOutcome("Payment reminder", { status: "Queued" })).toBe("Payment reminder queued on the linked phone.");
    expect(sendOutcome("Payment reminder", { status: "Failed", error: "This feature requires an internet connection." })).toBe("Payment reminder not sent: This feature requires an internet connection.");
    expect(sendOutcome("Payment reminder", null, "Not sent: this member was reminded recently.")).toBe("Not sent: this member was reminded recently.");
  });

  it("counts a batch by what happened, and never adds failures to the sent", () => {
    const t = emptyTally();
    for (const m of [{ status: "Sent" }, { status: "Read" }, { status: "Failed", error: "x" }, { status: "Logged" }, { status: "Queued" }, null]) count(t, m);
    expect(t).toEqual({ sent: 2, queued: 1, logged: 1, failed: 1, skipped: 1 });
    expect(tallyText(t)).toBe(
      "2 reminders sent on WhatsApp · 1 reminder queued on the linked phone · 1 reminder saved, not sent (WhatsApp is not linked: demo mode) · 1 not sent (failed: see WhatsApp › Failed) · 1 skipped (reminded recently or no number).",
    );
    expect(tallyText(emptyTally())).toBe("No reminders to send.");
  });
});
