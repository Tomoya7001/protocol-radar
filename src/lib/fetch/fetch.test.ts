import { describe, expect, it } from "vitest";
import { FakeHttpClient, response } from "./fakeClient";
import { fetchSource } from "./fetchCore";
import { noSleep } from "./types";
import { validateSourceUrl } from "./validate";
import { createMemoryLogger } from "./logger";
import { parseGithubRefs, pollGithub } from "./github";
import { contentHash } from "./hash";

describe("F-003 fetch core — conditional GET", () => {
  it("sends If-None-Match / If-Modified-Since from stored etag/last_modified", async () => {
    const client = new FakeHttpClient([response(304)]);
    const outcome = await fetchSource(client, {
      url: "https://example.test/spec",
      kind: "http",
      etag: 'W/"abc"',
      lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
    });

    expect(outcome.kind).toBe("not_modified");
    const sent = client.calls[0];
    expect(sent?.headers?.["if-none-match"]).toBe('W/"abc"');
    expect(sent?.headers?.["if-modified-since"]).toBe(
      "Wed, 21 Oct 2026 07:28:00 GMT",
    );
  });

  it("304 yields not_modified => caller records NO new observation and preserves etag", async () => {
    const client = new FakeHttpClient([response(304)]);
    const outcome = await fetchSource(client, {
      url: "https://example.test/spec",
      kind: "http",
      etag: 'W/"keep-me"',
    });
    // The core reports not_modified; no content/hash is produced, so the source's etag is
    // untouched by the caller.
    expect(outcome).toEqual({ kind: "not_modified", httpStatus: 304 });
  });

  it("changed body (200 with new content + new etag) yields content with content_hash", async () => {
    const body = "spec v2 body";
    const client = new FakeHttpClient([
      response(200, body, { etag: 'W/"v2"', "last-modified": "later" }),
    ]);
    const outcome = await fetchSource(client, {
      url: "https://example.test/spec",
      kind: "http",
      etag: 'W/"v1"',
    });

    expect(outcome.kind).toBe("content");
    if (outcome.kind === "content") {
      expect(outcome.body).toBe(body);
      expect(outcome.contentHash).toBe(contentHash(body));
      expect(outcome.etag).toBe('W/"v2"');
      expect(outcome.lastModified).toBe("later");
    }
  });

  it("transient 500 then 200 is retried and succeeds (no real sleeps)", async () => {
    const client = new FakeHttpClient([
      response(500),
      response(200, "ok body", { etag: 'W/"x"' }),
    ]);
    const outcome = await fetchSource(
      client,
      { url: "https://example.test/spec", kind: "http" },
      { sleep: noSleep, baseDelayMs: 0 },
    );
    expect(outcome.kind).toBe("content");
    expect(client.calls).toHaveLength(2);
  });

  it("network error then 200 is retried and succeeds", async () => {
    const client = new FakeHttpClient([
      new Error("ECONNRESET"),
      response(200, "recovered"),
    ]);
    const outcome = await fetchSource(
      client,
      { url: "https://example.test/spec", kind: "http" },
      { sleep: noSleep },
    );
    expect(outcome.kind).toBe("content");
    expect(client.calls).toHaveLength(2);
  });

  it("gives up after maxAttempts of persistent 5xx and returns error (no throw)", async () => {
    const client = new FakeHttpClient([
      response(503),
      response(503),
      response(503),
    ]);
    const outcome = await fetchSource(
      client,
      { url: "https://example.test/spec", kind: "http" },
      { sleep: noSleep, maxAttempts: 3 },
    );
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.httpStatus).toBe(503);
    }
    expect(client.calls).toHaveLength(3);
  });

  it("404/410 yields absent (drives vanish detection), never throws", async () => {
    const client = new FakeHttpClient([response(404)]);
    const outcome = await fetchSource(client, {
      url: "https://example.test/gone",
      kind: "http",
    });
    expect(outcome).toEqual({ kind: "absent", httpStatus: 404 });
  });
});

describe("F-003 validateSourceUrl", () => {
  it("404 flags the source inactive and logs a TODO (never invents a URL)", async () => {
    const client = new FakeHttpClient([response(404)]);
    const logger = createMemoryLogger();
    const result = await validateSourceUrl(
      client,
      "https://example.test/missing",
      logger,
    );
    expect(result.markInactive).toBe(true);
    expect(result.ok).toBe(false);
    expect(logger.lines.some((l) => l.startsWith("[TODO]"))).toBe(true);
  });

  it("permanent network failure flags inactive + TODO, does not throw", async () => {
    const client = new FakeHttpClient([new Error("ENOTFOUND")]);
    const logger = createMemoryLogger();
    const result = await validateSourceUrl(
      client,
      "https://nope.invalid/x",
      logger,
    );
    expect(result.markInactive).toBe(true);
    expect(logger.lines.some((l) => l.includes("do NOT invent"))).toBe(true);
  });

  it("2xx keeps the source active", async () => {
    const client = new FakeHttpClient([response(200)]);
    const result = await validateSourceUrl(client, "https://example.test/ok");
    expect(result.ok).toBe(true);
    expect(result.markInactive).toBe(false);
  });
});

describe("F-003 GitHub poll variant", () => {
  it("parses the tags shape [{ name }]", () => {
    const refs = parseGithubRefs(
      JSON.stringify([{ name: "v2.0.0" }, { name: "v1.0.0" }]),
    );
    expect(refs.map((r) => r.name)).toEqual(["v2.0.0", "v1.0.0"]);
  });

  it("parses the releases shape [{ tag_name }] and ignores malformed items", () => {
    const refs = parseGithubRefs(
      JSON.stringify([{ tag_name: "v3.1.0" }, {}, { tag_name: "" }, 5]),
    );
    expect(refs.map((r) => r.name)).toEqual(["v3.1.0"]);
  });

  it("returns [] on invalid JSON (never throws)", () => {
    expect(parseGithubRefs("not json")).toEqual([]);
  });

  it("pollGithub returns latestRef from injected client content", async () => {
    const client = new FakeHttpClient([
      response(200, JSON.stringify([{ name: "v2.0.0" }, { name: "v1.9.0" }]), {
        etag: 'W/"gh"',
      }),
    ]);
    const result = await pollGithub(client, {
      url: "https://api.github.test/repos/o/r/tags",
    });
    expect(result.latestRef).toBe("v2.0.0");
    expect(result.outcome.kind).toBe("content");
  });
});
