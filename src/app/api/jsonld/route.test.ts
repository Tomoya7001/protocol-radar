import { describe, it, expect, afterEach } from "vitest";
import { __setDbForTests } from "@/app/_data/db";
import { seededDb } from "@/app/_data/fixtures";
import { GET } from "./route";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");

function req(path: string): Request {
  return new Request(`http://test.local${path}`);
}

afterEach(() => {
  __setDbForTests(null);
});

describe("C2 GET /api/jsonld", () => {
  it("returns 200 application/ld+json schema.org Dataset", async () => {
    __setDbForTests(seededDb(NOW));
    const res = GET(req(`/api/jsonld?now=${NOW}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/ld+json");

    const doc = (await res.json()) as {
      "@context": string;
      "@type": string;
      mainEntity: { "@type": string; numberOfItems: number };
    };
    expect(doc["@context"]).toBe("https://schema.org");
    expect(doc["@type"]).toBe("Dataset");
    expect(doc.mainEntity["@type"]).toBe("ItemList");
    expect(doc.mainEntity.numberOfItems).toBe(5);
  });
});
