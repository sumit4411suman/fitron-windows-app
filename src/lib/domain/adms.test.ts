import { describe, expect, it } from "vitest";
import { cmd, parseAcks, parseAttlog, parseTemplates, verifyMethod } from "./adms";

describe("ADMS protocol", () => {
  it("parses punches and skips junk lines", () => {
    const body = "1046\t2026-09-28 06:31:12\t0\t15\t0\t0\n\nbad line\n1047\t2026-09-28 06:40\t0\t1\r\nabc\t2026-09-28 06:41:00\t0\t1\n";
    expect(parseAttlog(body)).toEqual([
      { pin: "1046", time: "2026-09-28 06:31:12", verify: 15 },
      { pin: "1047", time: "2026-09-28 06:40:00", verify: 1 },
    ]);
    expect(verifyMethod(15)).toBe("Face");
    expect(verifyMethod(1)).toBe("Fingerprint");
    expect(verifyMethod(4)).toBe("Card");
  });

  it("reads fingerprint and face templates and gives them back in the device's own form", () => {
    const body = "USER PIN=1046\tName=Asha\nFP PIN=1046\tFID=6\tSize=1024\tValid=1\tTMP=AAAB\nBIODATA Pin=1046\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=ZZZ";
    const t = parseTemplates(body);
    expect(t.map((x) => [x.pin, x.type, x.slot])).toEqual([
      ["1046", "FP", 6],
      ["1046", "FACE", 0],
    ]);
    expect(cmd.restoreTemplate(t[0]!)).toBe("DATA UPDATE FINGERTMP PIN=1046\tFID=6\tSize=1024\tValid=1\tTMP=AAAB");
    expect(cmd.restoreTemplate(t[1]!)).toMatch(/^DATA UPDATE BIODATA Pin=1046/);
  });

  it("reads command results and formats commands safely", () => {
    expect(parseAcks("ID=3&Return=0&CMD=DATA\nID=4&Return=-1002&CMD=ENROLL_FP")).toEqual([
      { cmdNo: 3, ret: "0", cmd: "DATA" },
      { cmdNo: 4, ret: "-1002", cmd: "ENROLL_FP" },
    ]);
    expect(cmd.addUser("1046", "Asha\tVerma=x")).toContain("Name=Asha Verma x\t");
    expect(cmd.addUser("1001", "Asha", "0044123")).toContain("Card=0044123\tGrp=1");
    expect(cmd.addUser("1001", "Asha")).toContain("Card=\tGrp=1");
    expect(cmd.openDoor(5)).toBe("CONTROL DEVICE 01010500");
  });
});
