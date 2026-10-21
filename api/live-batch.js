// Builds a full batch in the app's own data format ({name, by, about, lectures[], notes[]})
// from the live source, so batch.html / the lecture player work unchanged.
//   lecture item: [title, "mc:<batchId>|<subjectId>|<scheduleId>", "m"]  (stream resolved on play via /api/stream)
//   note item:    [title, "mcn:<batchSlug>|<subjectSlug>|<scheduleId>"]    (file resolved on click via /api/note)
const { upstreamData, safe, q1, plainText, pool } = require("./_lib");

const MAX_PAGES = 25;
const BUDGET_MS = 50 * 1000;

async function listAll(slug, subjectSlug, topicId, contentType, deadline) {
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() > deadline) return { items, partial: true };
    const qs = "?page=" + page + "&contentType=" + contentType + "&tag=" + encodeURIComponent(topicId);
    const data = await upstreamData("v2/batches/" + slug + "/subject/" + subjectSlug + "/contents", qs);
    if (!Array.isArray(data) || !data.length) break;
    let fresh = 0;
    for (const it of data) { if (it && it._id && !seen.has(it._id)) { seen.add(it._id); items.push(it); fresh++; } }
    if (!fresh) break;
  }
  return { items, partial: false };
}

module.exports = async (req, res) => {
  const id = String(q1(req.query.id) || "").replace(/^mc-/, "");
  if (!safe(id)) return res.status(400).json({ success: false, message: "Bad batch id" });
  const deadline = Date.now() + BUDGET_MS;
  try {
    const d = await upstreamData("v3/batches/" + id + "/details");
    if (!d || !d.slug) return res.status(404).json({ success: false, message: "Batch not found" });
    const slug = d.slug;
    const subjects = (d.subjects || []).filter((s) => s && s.slug);
    const multi = subjects.length > 1;
    let partial = false;

    const topicLists = await pool(subjects, 6, async (s) => {
      const topics = [];
      const seen = new Set();
      for (let page = 1; page <= 6; page++) {
        const data = await upstreamData("v2/batches/" + slug + "/subject/" + s.slug + "/topics", page > 1 ? "?page=" + page : "");
        if (!Array.isArray(data) || !data.length) break;
        let fresh = 0;
        for (const t of data) { if (t && t._id && !seen.has(t._id)) { seen.add(t._id); topics.push(t); fresh++; } }
        if (!fresh || data.length < 10) break;
      }
      return topics;
    });

    const jobs = [];
    subjects.forEach((s, si) => (topicLists[si] || []).forEach((t) => jobs.push({ s, t })));

    const results = await pool(jobs, 10, async ({ s, t }) => {
      const [vids, dppv, notes, dppn] = await Promise.all(["videos", "DppVideos", "notes", "DppNotes"].map((c) => listAll(slug, s.slug, t._id, c, deadline)));
      if ([vids, dppv, notes, dppn].some((r) => r.partial)) partial = true;
      const name = (multi ? s.subject + " › " : "") + (t.name || "Topic");
      const title = (it) => String(it.topic || (it.videoDetails && it.videoDetails.name) || "Untitled").trim();
      const lec = [];
      vids.items.forEach((it) => lec.push([title(it), "mc:" + id + "|" + s._id + "|" + it._id, "m"]));
      dppv.items.forEach((it) => lec.push(["DPP | " + title(it), "mc:" + id + "|" + s._id + "|" + it._id, "m"]));
      const nt = [];
      notes.items.forEach((it) => nt.push([title(it), "mcn:" + slug + "|" + s.slug + "|" + it._id]));
      dppn.items.forEach((it) => nt.push(["DPP | " + title(it), "mcn:" + slug + "|" + s.slug + "|" + it._id]));
      return { name, lec, nt };
    });

    const lectures = [], notes = [];
    results.forEach((r) => {
      if (!r) return;
      if (r.lec.length) lectures.push({ n: r.name, i: r.lec });
      if (r.nt.length) notes.push({ n: r.name, i: r.nt });
    });

    const img = d.previewImage && d.previewImage.baseUrl && d.previewImage.key ? d.previewImage.baseUrl + d.previewImage.key : "";
    const out = {
      id: "mc-" + id,
      name: d.name || "Batch",
      by: [d.byName, d.class ? "Class " + d.class : ""].filter(Boolean).join(" · "),
      about: plainText(d.shortDescription) || (d.name || ""),
      language: d.language || "",
      previewImage: img,
      lectures, notes, partial
    };
    // only cache complete builds
    res.setHeader("Cache-Control", partial ? "no-store" : "public, s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json(out);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ success: false, message: "Content source unreachable" });
  }
};
