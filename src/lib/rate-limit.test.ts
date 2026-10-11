import { describe, expect, it } from "vitest";
import { limitSearch } from "./rate-limit";

describe("limitSearch", () => {
  it("runs a few searches at once for one person and turns the rest away without running them", async () => {
    let ran = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = () => {
      ran++;
      return gate.then(() => "hits");
    };
    // One tab firing 46 searches at once, as in the outage.
    const burst = Array.from({ length: 46 }, () => limitSearch("burst-user", slow));
    release();
    const results = await Promise.all(burst);
    expect(ran).toBe(3);
    expect(results.filter((r) => r === "hits")).toHaveLength(3);
    expect(results.filter((r) => r === null)).toHaveLength(43);
    // Someone else is not held up by it.
    expect(await limitSearch("other-user", async () => "ok")).toBe("ok");
  });

  it("frees the slot when a search fails", async () => {
    await expect(limitSearch("failing-user", () => Promise.reject(new Error("db down")))).rejects.toThrow("db down");
    expect(await limitSearch("failing-user", async () => "ok")).toBe("ok");
  });
});
