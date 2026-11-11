import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aboutContent } from "../src/app/about-content";
import { percent } from "../src/app/format";

describe("About content stays anchored to the README", () => {
  it("renders the About content from one source, so README edits never break this test", () => {
    // #59: the About dialog renders `aboutContent` rather than copying its text,
    // and nothing here depends on the live README's wording.
    const dialog = readFileSync(new URL("../src/app/learning-center.tsx", import.meta.url), "utf8");
    expect(dialog).toContain("{aboutContent.tagline}");
    expect(dialog).toContain("{aboutContent.limitation}");
    for (const text of [aboutContent.tagline, aboutContent.problem, aboutContent.limitation]) expect(text.length).toBeGreaterThan(20);
    expect(aboutContent.source).toContain("/blob/main/README.md");
    expect(readFileSync(new URL("../docs/prd.md", import.meta.url), "utf8")).toContain("The scale of the pain is not yet validated");
  });
  it("labels a missing percent change by its cause", () => {
    expect(percent(null, 0)).toBe("new this month");
    expect(percent(null, -50000)).toBe("no % change: September was negative");
    expect(percent(450, 400000)).toBe("+450%");
  });
});
