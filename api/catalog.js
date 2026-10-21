// Slim live batch catalog in the same shape as batches.json (so the existing UI renders it unchanged).
const { CATALOG_URL, UA } = require("./_lib");

let cache = null, cachedAt = 0, inflight = null;
const TTL = 30 * 60 * 1000;

function parseExam(exam) {
  if (!exam) return "";
  try { const p = JSON.parse(exam); if (Array.isArray(p)) return p.filter(Boolean).join(", "); } catch (e) {}
  return String(exam);
}

function categoryOf(text, cls) {
  const t = String(text || "").toLowerCase();
  if (/\bneet\b|\baiims\b|pre[- ]?medical/.test(t)) return "neet";
  if (/\bjee\b|\biit\b/.test(t)) return "jee";
  if (/board|cbse|icse|\bbseb\b|10th|12th|class[- ]?10\b/.test(t) || String(cls) === "10") return "boards";
  if (/bank|ibps|sbi|rbi/.test(t)) return "banking";
  if (/upsc|ias|pcs/.test(t)) return "upsc";
  if (/ssc|cgl|chsl|railway|rrb|ntpc/.test(t)) return "ssc";
  if (/\bgate\b/.test(t)) return "gate";
  return "other";
}

// Pinned on top, in exactly this order (each one's 2.0 / 3.0 ... follows its base batch). Everything else keeps the normal order.
const PINNED = [
  [/\barjuna\b/, /\bjee\b/],
  [/\barjuna\b/, /\bneet\b/],
  [/\blakshya\b/, /\bjee\b/],
  [/\blakshya\b/, /\bneet\b/],
  [/\bprayaa?s\b/, /\bjee\b/],
  [/\byakeen\b/, /\bneet\b/],
  [/\bmission\b/, /\bjeet\b/],
  [/\bjee\s*360\b/],
  [/\babhiyaa?n\b/]
];
const pinRank = (name) => {
  const t = String(name || "").toLowerCase();
  if (!/2027/.test(t)) return PINNED.length;
  const i = PINNED.findIndex((all) => all.every((re) => re.test(t)));
  return i < 0 ? PINNED.length : i;
};
const versionOf = (name) => { const m = String(name || "").match(/\b(\d)\.[0o]\b/i); return m ? Number(m[1]) : 1; };
const ts = (v) => { const n = Date.parse(v); return isNaN(n) ? 0 : n; };

async function load() {
  const res = await fetch(CATALOG_URL, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!res.ok) throw new Error("Catalog unavailable (" + res.status + ")");
  const json = await res.json();
  const rows = Array.isArray(json && json.data) ? json.data : [];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || !r.batch_id || !r.name || seen.has(r.batch_id)) continue;
    seen.add(r.batch_id);
    const exam = parseExam(r.exam);
    out.push({
      _id: "mc-" + r.batch_id,
      name: String(r.name),
      byName: [r.class ? "Class " + r.class : "", exam].filter(Boolean).join(" · "),
      language: r.language || "",
      previewImage: r.photo || "",
      startDate: r.start_date || "",
      type: "MC_BATCH",
      category: categoryOf(exam + " " + r.name + " " + (r.class ? "class " + r.class : ""), r.class),
      slug: String(r.batch_id),
      _p: pinRank(r.name),
      _v: versionOf(r.name),
      _u: r.updated_at || ""
    });
  }
  out.sort((a, b) => (a._p - b._p) || (a._p < PINNED.length ? a._v - b._v : String(b._u).localeCompare(String(a._u))));
  out.forEach((b) => { delete b._u; delete b._p; delete b._v; });
  return out;
}

async function getCatalog() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  if (!inflight) {
    inflight = load().then((rows) => { cache = rows; cachedAt = Date.now(); inflight = null; return rows; })
      .catch((err) => { inflight = null; if (cache) return cache; throw err; });
  }
  return inflight;
}

module.exports = async (req, res) => {
  try {
    const batches = await getCatalog();
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json({ success: true, batches });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ success: false, batches: [], message: "Catalog is temporarily unavailable." });
  }
};
