import { describe, expect, it } from "vitest";
import { citationUrl, parseCitationUrl, safeSourceUrl, transformCitationMarkdown } from "./citations";
import { stripProvenanceFromToolResultText } from "./strip-tool-header";

describe("citation Markdown conversion", () => {
  it("uses one number per provenance ID while preserving per-reference field filters", () => {
    const result = transformCitationMarkdown("收入[[p_1a2b:营收，毛利率]]，利润[[p_5c6d]]，再看[[p_1a2b:净利润]]。");
    const links = [...result.matchAll(/\[(\d+)\]\(([^)]+)\)/g)];
    expect(links.map((link) => link[1])).toEqual(["1", "2", "1"]);
    expect(parseCitationUrl(links[0][2])).toEqual({ provenanceId: "p_1a2b", index: 1, fields: ["营收", "毛利率"] });
    expect(parseCitationUrl(links[2][2])?.fields).toEqual(["净利润"]);
    expect(result).not.toContain("session");
  });
  it("leaves inline code, fenced code, indented code and existing links intact", () => {
    const source = "`[[p_1a2b]]`\n```md\n[[p_5c6d]]\n```\n    [[p_9e0f]]\n[文档 [[p_1a2b]]](https://example.test)\n正文[[p_3e4f]]";
    const result = transformCitationMarkdown(source);
    expect(result).toContain("`[[p_1a2b]]`");
    expect(result).toContain("```md\n[[p_5c6d]]\n```");
    expect(result).toContain("    [[p_9e0f]]");
    expect(result).toContain("[文档 [[p_1a2b]]](https://example.test)");
    expect(result).toContain("正文[1](#aurora-citation?");
  });
  it("does not transform citations inside multiline inline code", () => {
    const source = "`代码\n[[p_1a2b]]`\n正文[[p_5c6d]]";
    expect(transformCitationMarkdown(source)).toContain("`代码\n[[p_1a2b]]`");
    expect(transformCitationMarkdown(source)).toContain("正文[1](#aurora-citation?");
  });
  it("removes source-defined illegal placeholders and leaves an incomplete streaming marker alone", () => {
    expect(transformCitationMarkdown("A[[p_xxxx]]B[[p_1234]]C[[p_ABCD]]D[[搜索结果]]E")).toBe("ABCDE");
    expect(transformCitationMarkdown("正文[[p_1a")).toBe("正文[[p_1a");
  });
  it("is idempotent and preserves escaped markers", () => {
    const once = transformCitationMarkdown("\\[[p_1a2b]]，正文[[p_5c6d]]");
    expect(once).toContain("\\[[p_1a2b]]");
    expect(transformCitationMarkdown(once)).toBe(once);
  });
  it("encodes fields as URL data instead of injecting Markdown or HTML", () => {
    const reference = { provenanceId: "p_1a2b", index: 1, fields: ['<img src=x onerror="alert(1)">'] };
    const url = citationUrl(reference);
    expect(url).not.toContain("<img");
    expect(parseCitationUrl(url)).toEqual(reference);
  });
  it("rejects malformed, duplicate and external citation URLs", () => {
    for (const url of [undefined, "https://example.test/#aurora-citation?pid=p_1a2b&index=1", "#aurora-citation?pid=p_1234&index=1", "#aurora-citation?pid=p_1a2b&index=0", "#aurora-citation?pid=p_1a2b&index=1&pid=p_5c6d"]) {
      expect(parseCitationUrl(url)).toBeNull();
    }
  });
});

describe("source content safety", () => {
  it("only makes ordinary HTTP(S) URLs navigable", () => {
    expect(safeSourceUrl("https://example.test/filing")).toBe("https://example.test/filing");
    for (const value of ["javascript:alert(1)", "data:text/html,hello", "file:///private", "//example.test", "https://user:secret@example.test", "https://example.test/\npath", null]) {
      expect(safeSourceUrl(value)).toBeUndefined();
    }
  });
  it("removes injected citation instructions without changing the source data", () => {
    expect(stripProvenanceFromToolResultText("🔖 来源标记\n[[p_1a2b]]\n请引用\n（来自 公司公告）\n实际收入：100")).toBe("实际收入：100");
    expect(stripProvenanceFromToolResultText("[[p_1a2b]] ← 引用此数据请复制此标记（来自 公告）\n正文[[p_5c6d]]")).toBe("正文");
  });
});
