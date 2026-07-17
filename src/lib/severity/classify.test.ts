import { describe, it, expect } from "vitest";
import { classifySeverity } from "./classify";

describe("severity #8 classifySeverity — event-type mapping", () => {
  it("vanished ⇒ breaking", () => {
    const v = classifySeverity({ type: "vanished" });
    expect(v.severity).toBe("breaking");
    expect(v.reason).toContain("vanished");
  });

  it("spec_change ⇒ spec", () => {
    expect(classifySeverity({ type: "spec_change" }).severity).toBe("spec");
  });

  it("version_bump ⇒ minor (conservative, no over-claim)", () => {
    expect(classifySeverity({ type: "version_bump" }).severity).toBe("minor");
  });

  it("appeared ⇒ meta", () => {
    expect(classifySeverity({ type: "appeared" }).severity).toBe("meta");
  });
});

describe("severity #8 classifySeverity — diff-kind mapping", () => {
  it("kind=vanish ⇒ breaking", () => {
    const v = classifySeverity({ type: "vanished", diffs: [{ kind: "vanish" }] });
    expect(v.severity).toBe("breaking");
    expect(v.reason).toContain("vanish");
  });

  it("kind=body ⇒ spec", () => {
    expect(
      classifySeverity({ type: "spec_change", diffs: [{ kind: "body" }] }).severity,
    ).toBe("spec");
  });

  it("kind=version ⇒ minor", () => {
    expect(
      classifySeverity({ type: "version_bump", diffs: [{ kind: "version" }] }).severity,
    ).toBe("minor");
  });

  it("kind=appear ⇒ meta", () => {
    expect(
      classifySeverity({ type: "appeared", diffs: [{ kind: "appear" }] }).severity,
    ).toBe("meta");
  });

  it("picks the strongest diff kind when several are present", () => {
    const v = classifySeverity({
      type: "spec_change",
      diffs: [{ kind: "version" }, { kind: "vanish" }, { kind: "body" }],
    });
    expect(v.severity).toBe("breaking");
    expect(v.reason).toContain("vanish");
  });

  it("empty diffs falls back to the event type", () => {
    expect(classifySeverity({ type: "spec_change", diffs: [] }).severity).toBe("spec");
  });
});
