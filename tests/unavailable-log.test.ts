import { afterEach, describe, expect, it, vi } from "vitest";
import { logDemoUnavailable } from "../src/server/db/unavailable-log";

describe("logDemoUnavailable", () => {
  afterEach(() => vi.restoreAllMocks());

  const logged = (error: unknown) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logDemoUnavailable(error);
    return spy.mock.calls.at(-1)?.[0];
  };

  it("includes a fixed startup validation reason", () => {
    expect(logged(new Error("Neon host required"))).toEqual({
      name: "DemoUnavailable", errorClass: "Error", reason: "Neon host required",
    });
  });

  it("includes only a well-formed SQLSTATE", () => {
    const error = Object.assign(new Error("Database query failed"), { sqlstate: "42501" });
    expect(logged(error)).toEqual({ name: "DemoUnavailable", errorClass: "Error", code: "42501" });
    const malformed = Object.assign(new Error("x"), { sqlstate: "postgresql://user:pw@host" });
    expect(logged(malformed)).toEqual({ name: "DemoUnavailable", errorClass: "Error" });
  });

  it("never logs an unrecognized message", () => {
    const secret = "connect failed postgresql://user:pw@host/db";
    expect(JSON.stringify(logged(new Error(secret)))).not.toContain("postgresql");
  });

  it("handles non-Error values", () => {
    expect(logged("boom")).toEqual({ name: "DemoUnavailable", errorClass: "NonError" });
  });
});
