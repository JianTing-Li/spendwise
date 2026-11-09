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

  it("uses the error's name, which survives minified class names", () => {
    class h extends Error {
      driverCode = "28P01";
      constructor() { super("Database unavailable"); this.name = "DatabaseUnavailable"; }
    }
    expect(logged(new h())).toEqual({ name: "DemoUnavailable", errorClass: "DatabaseUnavailable", driverCode: "28P01" });
  });

  it("drops an unsafe driver code or name", () => {
    const error = Object.assign(new Error("x"), { driverCode: "pw=secret value", name: "has spaces and :" });
    expect(logged(error)).toEqual({ name: "DemoUnavailable", errorClass: "Error" });
  });

  it("handles non-Error values", () => {
    expect(logged("boom")).toEqual({ name: "DemoUnavailable", errorClass: "NonError" });
  });
});
