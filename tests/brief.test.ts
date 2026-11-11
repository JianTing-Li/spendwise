import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aboutContent } from "../src/app/about-content";
import { percent } from "../src/app/format";

describe("About content stays anchored to the README", () => {
  it("keeps the displayed About excerpts anchored to the authoritative checked-in README", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const text of [aboutContent.tagline, aboutContent.problem, aboutContent.limitation]) expect(readme).toContain(text);
    expect(aboutContent.source).toContain("/blob/main/README.md");
    expect(readFileSync(new URL("../docs/prd.md", import.meta.url), "utf8")).toContain("The scale of the pain is not yet validated");
  });
  it("labels a missing percent change by its cause", () => {
    expect(percent(null, 0)).toBe("new this month");
    expect(percent(null, -50000)).toBe("no % change: September was negative");
    expect(percent(450, 400000)).toBe("+450%");
  });
});
