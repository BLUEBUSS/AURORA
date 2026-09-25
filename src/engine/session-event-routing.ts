// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/** Session routing helpers shared by the legacy and Chat V2 event consumers. */

export function normalizeSessionKey(key: string | null | undefined): string {
  return (key ?? "").trim().toLowerCase();
}

export function sessionKeysMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left === right || normalizeSessionKey(left) === normalizeSessionKey(right);
}

/**
 * Gateway events normally carry sessionKey at the envelope level. A few
 * fin-core streams (notably task_update/provenance_patch) carry it in data,
 * so both locations are accepted while preserving a strict guard for chat and
 * agent streams.
 */
export function eventSessionKey(
  payload: Record<string, unknown>,
): string | undefined {
  if (typeof payload.sessionKey === "string" && payload.sessionKey.trim()) {
    return payload.sessionKey;
  }
  const data = payload.data;
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>).sessionKey;
    if (typeof nested === "string" && nested.trim()) return nested;
  }
  return undefined;
}

/**
 * Return true only when an event can safely be applied to the current view.
 * Session-scoped chat/agent events without an identifiable key are rejected;
 * unscoped system events remain available to their existing consumers.
 */
export function isEventForSession(
  event: string,
  payload: Record<string, unknown>,
  currentSessionKey: string | null | undefined,
): boolean {
  const key = eventSessionKey(payload);
  if ((event === "chat" || event === "agent") && !key) return false;
  return !key || sessionKeysMatch(key, currentSessionKey);
}
