import path from "node:path";
import { isIP } from "node:net";

const placeholderHost = /(^|\.)(example\.(com|net|org)|localhost)$|\.(example|test|invalid|local)$/i;
const placeholderText = /change[-_ ]?me|your[-_ ]?(domain|company|name|email)|replace[-_ ]?me|<|>/i;

export function publicHttpsUrl(value, name = "URL", { originOnly = false } = {}) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a real public HTTPS URL.`); }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash ||
      host.endsWith(".") || placeholderHost.test(host) || placeholderText.test(value) || !host.includes(".") || isIP(host) ||
      (originOnly && (parsed.pathname !== "/" || parsed.search)))
    throw new Error(`${name} must be a real public HTTPS ${originOnly ? "origin without a path" : "URL"}; placeholders and local addresses are not accepted.`);
  return originOnly ? parsed.origin : parsed.href;
}

export const publicHttpsOrigin = (value, name = "APP_ORIGIN") => publicHttpsUrl(value, name, { originOnly: true });

function integer(value, name, fallback, min, max) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return Number(value);
}

function normalizedIp(value) {
  if (typeof value !== "string") return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6 || value.includes("%")) return null;
  // Canonicalize equivalent IPv6 spellings before using them as rate-limit keys.
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const upper = parseInt(mapped[1], 16), lower = parseInt(mapped[2], 16);
  return `${upper >> 8}.${upper & 255}.${lower >> 8}.${lower & 255}`;
}

/** Trust exactly the configured number of proxies nearest the socket, never arbitrary leftmost XFF. */
export function getClientIp(req, trustedHops = 0) {
  const socketIp = normalizedIp(req.socket?.remoteAddress) || "unknown";
  if (!Number.isInteger(trustedHops) || trustedHops < 1 || trustedHops > 8) return socketIp;
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded !== "string" || forwarded.length > 1024) return socketIp;
  const parts = forwarded.split(",").map((part) => normalizedIp(part.trim()));
  if (parts.length > 16 || parts.length < trustedHops || parts.some((part) => !part)) return socketIp;
  return parts[parts.length - trustedHops];
}

/** Pure environment validation. Persistence must also be supplied by the host's actual mounted disk. */
export function loadRuntime(env = process.env, root = process.cwd()) {
  const production = env.NODE_ENV === "production";
  const port = integer(env.PORT, "PORT", production ? 10000 : 4311, 1, 65535);
  const trustProxyHops = integer(env.TRUST_PROXY_HOPS, "TRUST_PROXY_HOPS", 0, 0, 8);
  const dataDir = env.DATA_DIR?.trim();
  if (production && !(dataDir || (env.DB_PATH && env.MEDIA_DIR)))
    throw new Error("Production needs DATA_DIR on a persistent disk, or both DB_PATH and MEDIA_DIR on persistent storage.");
  for (const [key, value] of Object.entries({ DATA_DIR: dataDir, DB_PATH: env.DB_PATH, MEDIA_DIR: env.MEDIA_DIR }))
    if (production && value && (!path.isAbsolute(value) || path.parse(value).root === value || value === ":memory:"))
      throw new Error(`${key} must be an absolute, non-root persistent storage path.`);
  const dbPath = path.resolve(env.DB_PATH || path.join(dataDir || path.join(root, ".data"), "crewroom.sqlite"));
  const mediaDir = path.resolve(env.MEDIA_DIR || path.join(dataDir || path.dirname(dbPath), "media"));
  if (dbPath === mediaDir || dbPath.startsWith(`${mediaDir}${path.sep}`))
    throw new Error("DB_PATH must be separate from MEDIA_DIR.");
  let appOrigin = env.APP_ORIGIN?.trim() || undefined;
  let origins = (env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
  const operatorName = env.OPERATOR_NAME?.trim() || "";
  const supportEmail = env.SUPPORT_EMAIL?.trim() || "";
  const privacyPolicyUrl = env.PRIVACY_POLICY_URL?.trim() || (appOrigin ? `${appOrigin.replace(/\/$/, "")}/privacy` : "");
  const termsUrl = env.TERMS_URL?.trim() || (appOrigin ? `${appOrigin.replace(/\/$/, "")}/terms` : "");
  if (production) {
    appOrigin = publicHttpsOrigin(appOrigin, "APP_ORIGIN");
    if (env.POLICIES_APPROVED !== "true")
      throw new Error("Review the privacy, terms, community, support, and deletion pages, then explicitly set POLICIES_APPROVED=true for production.");
    origins = origins.map((value) => publicHttpsOrigin(value, "CORS_ORIGINS entry"));
    if (!operatorName || operatorName.length > 200 || placeholderText.test(operatorName))
      throw new Error("OPERATOR_NAME must identify the real beta operator.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail) || placeholderText.test(supportEmail) || placeholderHost.test(supportEmail.split("@")[1]))
      throw new Error("SUPPORT_EMAIL must be a real monitored email address.");
    publicHttpsUrl(privacyPolicyUrl, "PRIVACY_POLICY_URL");
    publicHttpsUrl(termsUrl, "TERMS_URL");
  }
  if (Boolean(env.RESEND_API_KEY) !== Boolean(env.MAIL_FROM))
    throw new Error("Configure RESEND_API_KEY and MAIL_FROM together, or leave both unset.");
  const moderationMode = env.MODERATION_MODE?.trim() || 'manual';
  if (!['manual', 'hybrid'].includes(moderationMode)) throw new Error('MODERATION_MODE must be manual or hybrid.');
  const moderationOperatorIds = (env.MODERATION_OPERATOR_IDS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (moderationOperatorIds.some(v => !/^user_[a-zA-Z0-9-]{1,100}$/.test(v)))
    throw new Error('MODERATION_OPERATOR_IDS must contain immutable user IDs, not email addresses.');
  if (production && moderationMode === 'hybrid' && (!moderationOperatorIds.length || env.MODERATION_PROVIDER_APPROVED !== 'true'))
    throw new Error('Hybrid moderation needs an assigned operator and explicit MODERATION_PROVIDER_APPROVED=true after reviewing provider cost, processing and policies.');
  return {
    production, port, host: env.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
    dbPath, mediaDir, staticDir: path.join(root, "dist"), appOrigin, origins,
    secureCookies: production, trustProxyHops, clientIp: (req) => getClientIp(req, trustProxyHops),
    operatorName, supportEmail, privacyPolicyUrl, termsUrl,
    minimumAge: integer(env.MINIMUM_AGE, "MINIMUM_AGE", 18, 18, 99),
    policyVersion: env.POLICY_VERSION?.trim() || "beta-1", requirePolicyAcceptance: production,
    policiesApproved: env.POLICIES_APPROVED === "true",
    moderationMode, moderationOperatorIds,
  };
}
