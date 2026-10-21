// Shared server-side helpers for the live (Macro) content source.
// Ported from Macro-main/src/lib/content/upstream.server.ts + catalog.server.ts

const UPSTREAM_ORIGIN = "https://vidcloud.eu.org";
const TOKEN_ENDPOINT = UPSTREAM_ORIGIN + "/generate_token.php";
const API_PREFIX = UPSTREAM_ORIGIN + "/api";
const PRIMARY_PREFIX = "https://proxy.streamvideo.co.in/fetch/api.penpencil.co";
const CATALOG_URL = "https://studystark.github.io/batches/batches.json";
const TOKEN_TTL_MS = 5 * 60 * 1000;
const UA = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36";
const BROWSER_HEADERS = { Accept: "application/json", "User-Agent": UA };

let cachedToken = null, cachedTokenAt = 0, inflightToken = null;

async function requestToken() {
  try {
    const res = await fetch(TOKEN_ENDPOINT, { headers: { Accept: "application/json", "User-Agent": UA, Referer: UPSTREAM_ORIGIN + "/" } });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.success && json.access_token ? json.access_token : null;
  } catch (e) { return null; }
}

async function getToken(force) {
  if (!force && cachedToken && Date.now() - cachedTokenAt < TOKEN_TTL_MS) return cachedToken;
  if (!inflightToken) {
    inflightToken = requestToken().then((t) => {
      if (t) { cachedToken = t; cachedTokenAt = Date.now(); }
      inflightToken = null;
      return t;
    });
  }
  return inflightToken;
}

function looksHealthy(status, body) {
  if (status < 200 || status >= 300) return false;
  try { const j = JSON.parse(body); return !(j && j.success === false); } catch (e) { return false; }
}

async function tryPrimary(clean, search) {
  try {
    const res = await fetch(PRIMARY_PREFIX + "/" + clean + (search || ""), { headers: BROWSER_HEADERS });
    const body = await res.text();
    return looksHealthy(res.status, body) ? { status: res.status, body } : null;
  } catch (e) { return null; }
}

// Open mirror first, token-based source as instant fallback (same order as Macro).
async function upstreamApi(path, search) {
  const clean = String(path).replace(/^\/+/, "");
  const primary = await tryPrimary(clean, search);
  if (primary) return primary;
  const url = API_PREFIX + "/" + clean + (search || "");
  const call = (token) => fetch(url, { headers: Object.assign({}, BROWSER_HEADERS, token ? { Authorization: "Bearer " + token } : {}, { Referer: UPSTREAM_ORIGIN + "/" }) });
  try {
    let res = await call(await getToken(false));
    if (res.status === 401 || res.status === 403) res = await call(await getToken(true));
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 502, body: JSON.stringify({ success: false, message: "Content source unreachable" }) };
  }
}

// Returns the `data` field of a successful upstream response, or null.
async function upstreamData(path, search) {
  const r = await upstreamApi(path, search || "");
  if (r.status < 200 || r.status >= 300) return null;
  try { const j = JSON.parse(r.body); return j && j.success === false ? null : (j && "data" in j ? j.data : j); } catch (e) { return null; }
}

const SAFE_ID = /^[A-Za-z0-9_.~-]+$/;
const safe = (v) => typeof v === "string" && v.length > 0 && v.length < 200 && SAFE_ID.test(v);
const q1 = (v) => (Array.isArray(v) ? v[0] : v);

function plainText(html) {
  return String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// Runs fn over items with limited concurrency.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = { upstreamApi, upstreamData, CATALOG_URL, safe, q1, plainText, pool, UA };
