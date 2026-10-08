import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, placeholders } from "./whatsapp";
import { DOC_HEADER_KEYS, metaTemplateName, toMetaTemplate, VAR_EXAMPLES } from "./wa-meta";

describe("templates for Meta", () => {
  it("numbers the variables in the order they first appear, and a repeated one keeps its number", () => {
    const t = toMetaTemplate("x", "Hi {{member_name}}, {{amount}} due. Thanks {{member_name}}, bye")!;
    expect(t.text).toBe("Hi {{1}}, {{2}} due. Thanks {{1}}, bye");
    expect(t.vars).toEqual(["member_name", "amount"]);
    expect(t.examples).toEqual([VAR_EXAMPLES.member_name, VAR_EXAMPLES.amount]);
  });

  it("never ends (or starts) the body with a variable, which Meta rejects", () => {
    expect(toMetaTemplate("x", "Hello\n\n{{gym_name}}")!.text.endsWith("}}.")).toBe(true);
    expect(toMetaTemplate("x", "{{member_name}} hello")!.text).toBe("Hi, {{1}} hello");
  });

  it("a custom message is never a template", () => {
    expect(toMetaTemplate("campaign", "Hi {{member_name}}, ")).toBeNull();
  });

  it("names, categories and the invoice document header", () => {
    expect(metaTemplateName("exp7")).toBe("fitron_exp7");
    expect(toMetaTemplate("birthday", "Happy birthday {{member_name}}!")!.category).toBe("MARKETING");
    expect(toMetaTemplate("exp7", "x {{member_name}} y")!.category).toBe("UTILITY");
    for (const k of DOC_HEADER_KEYS) expect(toMetaTemplate(k, DEFAULT_TEMPLATES.find((t) => t.key === k)!.body)!.docHeader).toBe(true);
    expect(toMetaTemplate("due", "x {{member_name}} y")!.docHeader).toBe(false);
  });

  it("every default template converts, with a sample for every variable and parameters in the order sending uses", () => {
    for (const d of DEFAULT_TEMPLATES) {
      const t = toMetaTemplate(d.key, d.body);
      if (d.key === "campaign") continue;
      expect(t, d.key).not.toBeNull();
      expect(t!.vars).toEqual(placeholders(d.body));
      expect(t!.text, d.key).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/);
      expect(t!.examples.every((e) => e !== "sample"), d.key).toBe(true);
      expect(t!.name).toMatch(/^[a-z0-9_]+$/);
    }
  });
});
