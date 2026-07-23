import { describe, expect, it } from "vitest";
import { FakeHttpClient, response } from "./fakeClient";
import { contentHash } from "./hash";
import {
  normalizePackageBody,
  npmPackageUrl,
  packageContentHash,
  packageUrl,
  parseNpmVersion,
  parsePackageVersion,
  parsePyPiVersion,
  pollPackageVersion,
  previousPackageVersion,
  pypiPackageUrl,
} from "./packageRegistry";

describe("F1 packageRegistry — npm/PyPI version parsing", () => {
  it("builds the correct registry URLs (scoped npm names keep the slash)", () => {
    expect(npmPackageUrl("@modelcontextprotocol/sdk")).toBe(
      "https://registry.npmjs.org/@modelcontextprotocol/sdk",
    );
    expect(pypiPackageUrl("crewai")).toBe("https://pypi.org/pypi/crewai/json");
    expect(packageUrl("npm", "a2a-js")).toBe(
      "https://registry.npmjs.org/a2a-js",
    );
    expect(packageUrl("pypi", "a2a-sdk")).toBe(
      "https://pypi.org/pypi/a2a-sdk/json",
    );
  });

  it("parses npm dist-tags.latest and PyPI info.version", () => {
    expect(
      parseNpmVersion(JSON.stringify({ "dist-tags": { latest: "1.29.0" } })),
    ).toBe("1.29.0");
    expect(parsePyPiVersion(JSON.stringify({ info: { version: "1.15.5" } }))).toBe(
      "1.15.5",
    );
    // Registry-dispatching helper picks the right field per registry.
    expect(
      parsePackageVersion("npm", JSON.stringify({ "dist-tags": { latest: "9.9.9" } })),
    ).toBe("9.9.9");
    expect(
      parsePackageVersion("pypi", JSON.stringify({ info: { version: "9.9.9" } })),
    ).toBe("9.9.9");
  });

  it("returns null (never throws) on malformed or version-less payloads", () => {
    expect(parseNpmVersion("not json")).toBeNull();
    expect(parseNpmVersion(JSON.stringify({ "dist-tags": {} }))).toBeNull();
    expect(parseNpmVersion(JSON.stringify({ name: "x" }))).toBeNull();
    expect(parseNpmVersion(JSON.stringify({ "dist-tags": { latest: "" } }))).toBeNull();
    expect(parsePyPiVersion("<html>500</html>")).toBeNull();
    expect(parsePyPiVersion(JSON.stringify({ info: {} }))).toBeNull();
    expect(parsePyPiVersion(JSON.stringify({}))).toBeNull();
  });

  it("normalizePackageBody is deterministic and content_hash matches sha256(body)", () => {
    const body = normalizePackageBody("npm", "a2a-js", "0.2.0");
    expect(body).toBe(normalizePackageBody("npm", "a2a-js", "0.2.0"));
    expect(packageContentHash("npm", "a2a-js", "0.2.0")).toBe(contentHash(body));
  });

  it("previousPackageVersion round-trips the normalized body", () => {
    const body = normalizePackageBody("pypi", "crewai", "1.15.5");
    expect(previousPackageVersion(body)).toBe("1.15.5");
    expect(previousPackageVersion(null)).toBeNull();
    expect(previousPackageVersion("garbage")).toBeNull();
  });

  it("pollPackageVersion returns the parsed version for a content outcome", async () => {
    const client = new FakeHttpClient([
      response(200, JSON.stringify({ "dist-tags": { latest: "1.29.0" } })),
    ]);
    const result = await pollPackageVersion(client, {
      registry: "npm",
      url: npmPackageUrl("@modelcontextprotocol/sdk"),
    });
    expect(result.outcome.kind).toBe("content");
    expect(result.version).toBe("1.29.0");
  });

  it("pollPackageVersion passes non-content outcomes through with no version", async () => {
    const client = new FakeHttpClient([response(404)]);
    const result = await pollPackageVersion(client, {
      registry: "pypi",
      url: pypiPackageUrl("does-not-exist"),
    });
    expect(result.outcome.kind).toBe("absent");
    expect(result.version).toBeUndefined();
  });

  it("sends a GET to the given URL (injectable client, no real network)", async () => {
    const client = new FakeHttpClient([
      response(200, JSON.stringify({ info: { version: "1.1.2" } })),
    ]);
    await pollPackageVersion(client, {
      registry: "pypi",
      url: pypiPackageUrl("a2a-sdk"),
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.url).toBe("https://pypi.org/pypi/a2a-sdk/json");
    expect(client.calls[0]!.method).toBe("GET");
  });
});
