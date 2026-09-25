import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./errors.js";

const COOKIE = "aurora_local_session";
const SESSION_MS = 12 * 60 * 60 * 1000;

/** A single-user loopback service. Local OS processes are inside its trust boundary. */
export class LocalAccess {
  private readonly sessions = new Map<string, number>();
  constructor(private readonly origin: string, private readonly now: () => number = Date.now) {}

  checkRequest(req: IncomingMessage, publicResource = false) {
    const expected = new URL(this.origin);
    if (req.headers.host !== expected.host) throw new HttpError(403, "HOST_DENIED", "不允许的本机服务地址。");
    const peer = req.socket.remoteAddress;
    if (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") {
      throw new HttpError(403, "LOCAL_ONLY", "服务仅允许本机访问。");
    }
    // Public static pages may be opened from a link. API access still requires
    // the stricter Origin / Fetch Metadata checks below and a local session.
    if (publicResource) return;
    if (req.headers.origin && req.headers.origin !== this.origin) {
      throw new HttpError(403, "ORIGIN_DENIED", "不允许跨站访问本机服务。");
    }
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin" && site !== "none") {
      throw new HttpError(403, "ORIGIN_DENIED", "不允许跨站访问本机服务。");
    }
  }

  createSession(req: IncomingMessage, res: ServerResponse) {
    this.checkRequest(req);
    // The browser can open its own local application, but an arbitrary external
    // website cannot mint a session via fetch, a form, an iframe or CORS preflight.
    if (req.headers.origin !== this.origin || req.headers["sec-fetch-site"] !== "same-origin") {
      throw new HttpError(403, "SAME_ORIGIN_REQUIRED", "请从 AURORA 本机页面建立连接。");
    }
    for (const [token, expires] of this.sessions) if (expires <= this.now()) this.sessions.delete(token);
    if (this.sessions.size >= 64) throw new HttpError(429, "SESSION_LIMIT", "打开的本机会话过多，请重启服务后重试。");
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, this.now() + SESSION_MS);
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`);
  }

  requireSession(req: IncomingMessage) {
    this.checkRequest(req);
    if (!["GET", "HEAD"].includes(req.method || "") && req.headers.origin !== this.origin) {
      throw new HttpError(403, "SAME_ORIGIN_REQUIRED", "修改操作必须从 AURORA 本机页面发起。");
    }
    const presented = req.headers.cookie?.split(";").map((value) => value.trim())
      .find((value) => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
    const encoded = Buffer.from(presented);
    for (const [token, expires] of this.sessions) {
      const known = Buffer.from(token);
      if (encoded.length === known.length && timingSafeEqual(encoded, known) && expires > this.now()) return;
    }
    throw new HttpError(401, "LOCAL_SESSION_REQUIRED", "本机连接已过期，请重新连接。");
  }

  revoke(req: IncomingMessage, res: ServerResponse) {
    this.requireSession(req);
    const presented = req.headers.cookie?.split(";").map((value) => value.trim())
      .find((value) => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (presented) this.sessions.delete(presented);
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  }
}

export function responseHeaders(res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
}
