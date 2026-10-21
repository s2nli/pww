// Resolves the HLS stream for one lecture (same endpoint Macro's watch page uses).
const { safe, q1, UA } = require("./_lib");

module.exports = async (req, res) => {
  const b = q1(req.query.b), s = q1(req.query.s), l = q1(req.query.l);
  res.setHeader("Cache-Control", "no-store");
  if (!safe(b) || !safe(s) || !safe(l)) return res.status(400).json({ success: false, message: "Bad request" });
  try {
    const url = "https://pw-stream.pages.dev/api/video-url?" + new URLSearchParams({ batchId: b, subjectId: s, scheduleId: l }).toString();
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
    const j = await r.json().catch(() => null);
    const hls = (j && (j.HLS_STREAM_URL || j.hls_url)) || null;
    if (!hls) return res.status(404).json({ success: false, message: "Stream isn't available for this lecture yet." });
    res.status(200).json({ success: true, hls });
  } catch (e) {
    res.status(502).json({ success: false, message: "Stream source unreachable" });
  }
};
