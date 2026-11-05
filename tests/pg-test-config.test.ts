import { describe, expect, it } from "vitest";
import { localConnection } from "./helpers/pg-local-config";

const explicit = { PG_TEST_ALLOW_LOCAL: "1", PG_TEST_DATABASE: "spendwise_app01_test", PG_TEST_USER: "tester" };
describe("explicit local integration test configuration", () => {
  it("requires opt-in and a named test database/user", () => {
    expect(() => localConnection({})).toThrow("PG_TEST_ALLOW_LOCAL");
    expect(() => localConnection({ PG_TEST_ALLOW_LOCAL: "1" })).toThrow("PG_TEST_DATABASE");
    expect(() => localConnection({ ...explicit, PG_TEST_DATABASE: "production" })).toThrow("PG_TEST_DATABASE");
  });
  it.each(["/tmp", "/var/run/postgresql", "localhost", "127.0.0.1", "::1"])("accepts local endpoint %s", host => {
    expect(localConnection({ ...explicit, PG_TEST_HOST: host, PG_TEST_PORT: "5433" })).toMatchObject({ host, port: 5433, database: "spendwise_app01_test", user: "tester", ssl: false });
  });
  it.each(["example.com", "ep-demo.neon.tech", "127.1.2.3", "localhost.example.com"])("refuses non-allowlisted endpoint %s", host => {
    expect(() => localConnection({ ...explicit, PG_TEST_HOST: host })).toThrow("local socket or loopback");
  });
  it.each(["0", "65536", "NaN", "1.5"])("refuses invalid port %s", port => {
    expect(() => localConnection({ ...explicit, PG_TEST_PORT: port })).toThrow("Invalid local test port");
  });
  it("ignores application and ambient pg connection settings", () => {
    expect(localConnection({ ...explicit, DATABASE_URL: "postgresql://remote.invalid/production", PGHOST: "remote.invalid", PGPORT: "6000", PGDATABASE: "production", PGUSER: "other" })).toMatchObject({ host: "/tmp", port: 5432, database: "spendwise_app01_test", user: "tester" });
  });
});
