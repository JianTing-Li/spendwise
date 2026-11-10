import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { excerpt } from "../src/app/brief";
import { aboutContent } from "../src/app/about-content";

describe("UI-03 honest short reading view", () => {
  it("bounds long text without paraphrasing, removing the full saved text, or implying a complete summary", () => {
    const original = Array.from({ length: 180 }, (_, i) => `word${i}`).join(" ") + " This does not confirm a duplicate.";
    const brief = excerpt(original, 75);
    expect(brief.shortened).toBe(true);
    expect(brief.text.split(/\s+/)).toHaveLength(75);
    expect(brief.text).toBe(original.split(/\s+/).slice(0, 75).join(" ") + "…");
    expect(original.endsWith("This does not confirm a duplicate.")).toBe(true);
  });
  it("keeps short text, punctuation, qualifiers and untrusted markup unchanged as inert text", () => {
    const text = '<img src=x onerror="alert(1)"> $3,000 is unconfirmed.\nNo payment approval.';
    expect(excerpt(text, 75)).toEqual({ text, shortened: false });
  });
  it("keeps the displayed About excerpts anchored to the authoritative checked-in README", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const text of [aboutContent.tagline, aboutContent.problem, aboutContent.limitation]) expect(readme).toContain(text);
    expect(aboutContent.source).toContain("/blob/main/README.md");
    expect(readFileSync(new URL("../docs/prd.md", import.meta.url), "utf8")).toContain("The scale of the pain is not yet validated");
  });
});
