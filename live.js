// Lazy live content, one small call per tap (same flow as Macro):
//   op=details  &id=<batchId>                               -> batch info + subjects
//   op=topics   &slug=<batchSlug>&sub=<subjectSlug>         -> topics of a subject
//   op=contents &slug&sub&topic=<topicId>&type=<videos|notes|DppNotes|DppVideos> -> items of one tab
const { upstreamData, safe, q1, plainText } = require("./_lib");

const TYPES = new Set(["videos", "notes", "DppNotes", "DppVideos", "exercises"]);
const MAX_PAGES = 25;

function done(res, body, cache) {
  res.setHeader("Cache-Control", cache ? "public, s-maxage=600, stale-while-revalidate=3600" : "no-store");
  res.status(200).json(body);
}
const fail = (res, code, message) => { res.setHeader("Cache-Control", "no-store"); res.status(code).json({ success: false, message }); };
const imgOf = (r) => (r && r.baseUrl && r.key ? r.baseUrl + r.key : "");

module.exports = async (req, res) => {
  const op = q1(req.query.op);
  try {
    if (op === "details") {
      const id = String(q1(req.query.id) || "").replace(/^mc-/, "");
      if (!safe(id)) return fail(res, 400, "Bad batch id");
      const d = await upstreamData("v3/batches/" + id + "/details");
      if (!d || !d.slug) return fail(res, 404, "Batch not found");
      return done(res, {
        success: true, batchId: id, slug: d.slug, name: d.name || "Batch",
        by: [d.byName, d.class ? "Class " + d.class : ""].filter(Boolean).join(" · "),
        about: plainText(d.shortDescription), language: d.language || "", previewImage: imgOf(d.previewImage),
        subjects: (d.subjects || []).filter((s) => s && s.slug).map((s) => ({ _id: s._id, slug: s.slug, name: s.subject || "Subject", count: s.lectureCount || 0 }))
      }, true);
    }

    if (op === "today") {
      const id = String(q1(req.query.id) || "").replace(/^mc-/, "");
      if (!safe(id)) return fail(res, 400, "Bad batch id");
      const raw = await upstreamData("v2/batches/" + id + "/todays-schedule");
      const items = (Array.isArray(raw) ? raw : []).map((e) => {
        const d = (e && e.data) || e || {};
        const subj = d.subjectId;
        return {
          id: d._id || (e && e._id) || "",
          title: String(d.topic || (d.videoDetails && d.videoDetails.name) || "Class").trim(),
          start: d.startTime || "", end: d.endTime || "",
          status: String((d.tag || "") + " " + (d.status || "")).toLowerCase(),
          thumb: (d.videoDetails && d.videoDetails.image) || "",
          type: d.lectureType || (e && e.type) || "",
          subjectId: d.batchSubjectId || (typeof subj === "string" ? subj : (subj && subj._id)) || ""
        };
      }).filter((x) => x.id);
      return done(res, { success: true, items }, false);
    }

    if (op === "tests") {
      const id = String(q1(req.query.id) || "").replace(/^mc-/, "");
      const subjectId = q1(req.query.subjectId), topic = q1(req.query.topic);
      if (!safe(id) || !safe(subjectId) || !safe(topic)) return fail(res, 400, "Bad request");
      const tests = [], seen = new Set();
      for (let page = 1; page <= 10; page++) {
        const data = await upstreamData("v3/test-service/tests/dpp", "?" + new URLSearchParams({ batchId: id, batchSubjectId: subjectId, chapterId: topic, isSubjective: "false", page: String(page) }).toString());
        if (!Array.isArray(data) || !data.length) { if (page === 1 && data === null) return fail(res, 502, "Content source unreachable"); break; }
        let fresh = 0;
        for (const t of data) {
          const tt = (t && t.test) || {};
          const key = tt._id || (t && t.contentId);
          if (!key || seen.has(key)) continue;
          seen.add(key); fresh++;
          tests.push({ name: tt.name || "DPP Test", q: tt.totalQuestions || 0, marks: tt.totalMarks || 0, min: tt.maxDuration || 0 });
        }
        if (!fresh) break;
      }
      return done(res, { success: true, tests }, true);
    }

    const slug = q1(req.query.slug), sub = q1(req.query.sub);
    if (!safe(slug) || !safe(sub)) return fail(res, 400, "Bad request");

    if (op === "topics") {
      const topics = [], seen = new Set();
      for (let page = 1; page <= 6; page++) {
        const data = await upstreamData("v2/batches/" + slug + "/subject/" + sub + "/topics", page > 1 ? "?page=" + page : "");
        if (!Array.isArray(data) || !data.length) { if (page === 1 && data === null) return fail(res, 502, "Content source unreachable"); break; }
        let fresh = 0;
        for (const t of data) if (t && t._id && !seen.has(t._id)) { seen.add(t._id); fresh++; topics.push({ id: t._id, name: t.name || "Topic", lectures: t.lectureVideos != null ? t.lectureVideos : (t.videos || 0), notes: t.notes || 0, exercises: t.exercises || 0 }); }
        if (!fresh || data.length < 10) break;
      }
      return done(res, { success: true, topics }, true);
    }

    if (op === "contents") {
      const topic = q1(req.query.topic), type = q1(req.query.type);
      if (!safe(topic) || !TYPES.has(type)) return fail(res, 400, "Bad request");
      const items = [], seen = new Set();
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await upstreamData("v2/batches/" + slug + "/subject/" + sub + "/contents", "?page=" + page + "&contentType=" + type + "&tag=" + encodeURIComponent(topic));
        if (!Array.isArray(data) || !data.length) { if (page === 1 && data === null) return fail(res, 502, "Content source unreachable"); break; }
        let fresh = 0;
        for (const it of data) {
          if (!it || !it._id || seen.has(it._id)) continue;
          seen.add(it._id); fresh++;
          items.push({ id: it._id, title: String(it.topic || (it.videoDetails && it.videoDetails.name) || "Untitled").trim() });
        }
        if (!fresh) break;
      }
      return done(res, { success: true, items }, true);
    }
    return fail(res, 400, "Unknown op");
  } catch (e) {
    return fail(res, 502, "Content source unreachable");
  }
};
