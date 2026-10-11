import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// React calls whatever an effect returns as its cleanup. An arrow with an expression body returns that expression, so
// `useEffect(() => el.scrollIntoView())` hands React the call's result: undefined in older browsers, a promise in newer
// Chrome, which React then "calls" on the next render ("TypeError: i is not a function", the whole page down). Effects
// use a block body; the only expression allowed is a bare name, which is the cleanup function itself.

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "generated" ? [] : files(p)) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

describe("React effects", () => {
  it("never return the value of an expression by accident", () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname))) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const m = line.match(/use(?:Layout)?Effect\(\s*\(\)\s*=>\s*([^\s{][^,)]*)/);
          if (m && !/^[A-Za-z_$][\w$]*$/.test(m[1]!.trim())) bad.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
