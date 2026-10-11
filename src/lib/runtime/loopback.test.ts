import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "./loopback";

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "127.0.0.1:51234", "localhost:3000", "LOCALHOST", "[::1]:8080", "[::1]", "127.1.2.3:80"])("accepts %s", (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });
  it.each([null, undefined, "", "fitron.in", "attacker.example:51234", "127.0.0.1.attacker.example", "localhost.attacker.example:80", "192.168.1.5:3000", "0.0.0.0:3000", "[::2]:80", "127.0.0.1:80:80", "127.0.0.256", "[::1]x"])("refuses %s", (h) => {
    expect(isLoopbackHost(h)).toBe(false);
  });
});
