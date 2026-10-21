// Resolves the real file link(s) for a notes / DPP PDF item (schedule-details is the only place the key is filled).
const { upstreamData, safe, q1 } = require("./_lib");

module.exports = async (req, res) => {
  const b = q1(req.query.b), s = q1(req.query.s), l = q1(req.query.l);
  res.setHeader("Cache-Control", "no-store");
  if (!safe(b) || !safe(s) || !safe(l)) return res.status(400).json({ success: false, message: "Bad request" });
  const d = await upstreamData("v1/batches/" + b + "/subject/" + s + "/schedule/" + l + "/schedule-details");
  if (!d) return res.status(502).json({ success: false, links: [] });
  const groups = [].concat(d.homeworkIds || [], d.exerciseIds || []);
  const links = [];
  groups.forEach((hw) => (hw.attachmentIds || []).forEach((a) => {
    if (!a || !a.baseUrl || !a.key) return;
    const base = a.baseUrl.endsWith("/") ? a.baseUrl : a.baseUrl + "/";
    links.push({ name: a.name || hw.topic || "Open PDF", url: base + String(a.key).replace(/^\/+/, "") });
  }));
  res.status(200).json({ success: true, links });
};
