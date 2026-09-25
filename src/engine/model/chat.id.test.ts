// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * chat.id 单测：覆盖派生稳定性 + parse 反向解析。
 *
 * roundId 为 deterministic UUID（不可逆），与老 store
 * generateDeterministicUUID(`${sessionKey}-round-${roundIndex}`) 字节级一致。
 * messageId / segmentId 仍为字面前缀格式。
 */

import { describe, expect, it } from "vitest";
import { generateDeterministicUUID } from "../pure/text";
import { ChatId } from "./chat.id";

describe("ChatId", () => {
  describe("round", () => {
    it("应该 = generateDeterministicUUID(${sessionKey}-round-${index})", () => {
      expect(ChatId.round("agent:main:session:abc", 0)).toBe(
        generateDeterministicUUID("agent:main:session:abc-round-0"),
      );
      expect(ChatId.round("agent:main:session:abc", 5)).toBe(
        generateDeterministicUUID("agent:main:session:abc-round-5"),
      );
    });

    it("相同输入应该派生相同 ID（稳定性）", () => {
      expect(ChatId.round("s", 3)).toBe(ChatId.round("s", 3));
    });

    it("不同 sessionKey 或 index 应该派生不同 ID", () => {
      expect(ChatId.round("a", 0)).not.toBe(ChatId.round("b", 0));
      expect(ChatId.round("a", 0)).not.toBe(ChatId.round("a", 1));
    });

    it("应该是 UUID v4 格式", () => {
      expect(ChatId.round("s", 0)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe("message", () => {
    it("应该按 ${roundId}:msg-${index} 派生", () => {
      const rid = ChatId.round("s", 0);
      expect(ChatId.message(rid, 0)).toBe(`${rid}:msg-0`);
      expect(ChatId.message(rid, 12)).toBe(`${rid}:msg-12`);
    });

    it("不同 round 内的同 index 应该派生不同 ID", () => {
      const a = ChatId.message(ChatId.round("s", 0), 0);
      const b = ChatId.message(ChatId.round("s", 1), 0);
      expect(a).not.toBe(b);
    });
  });

  describe("segment", () => {
    it("应该按 ${roundId}:${messageId}:${kind}:${seq} 派生", () => {
      const rid = ChatId.round("s", 0);
      const mid = ChatId.message(rid, 1);
      expect(ChatId.segment(rid, mid, "narration", 0)).toBe(`${rid}:${mid}:narration:0`);
    });

    it("不同 kind 应该派生不同 ID", () => {
      const rid = ChatId.round("s", 0);
      const mid = ChatId.message(rid, 0);
      expect(ChatId.segment(rid, mid, "narration", 0)).not.toBe(
        ChatId.segment(rid, mid, "tool-batch", 0),
      );
    });

    it("同一逻辑 segment 重复派生应该相同（去重幂等基础）", () => {
      const rid = ChatId.round("s", 0);
      const mid = ChatId.message(rid, 0);
      expect(ChatId.segment(rid, mid, "tool-batch", 2)).toBe(
        ChatId.segment(rid, mid, "tool-batch", 2),
      );
    });
  });

  describe("subagentSegment", () => {
    it("应该不依赖 roundId", () => {
      expect(ChatId.subagentSegment("sub-1", "sub-1:msg-0", "narration", 0)).toBe(
        "sub-1:sub-1:msg-0:narration:0",
      );
    });
  });

  describe("parseMessage", () => {
    it("应该反解 roundId/index", () => {
      const rid = ChatId.round("s", 2);
      const m = ChatId.parseMessage(ChatId.message(rid, 3));
      expect(m).toEqual({ roundId: rid, messageIndex: 3 });
    });

    it("非法输入应该返回 null", () => {
      expect(ChatId.parseMessage("plain-string")).toBeNull();
    });
  });
});
