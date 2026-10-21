(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const params = new URLSearchParams(location.search);
  const batchId = params.get("id") || "";
  const ICON = {
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
  };

  let batch = null, meta = null, live = null;
  let state = { tab: "lectures", s: null };
  let curList = [], filterText = "";

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200); }

  async function init() {
    if (!/^[a-z0-9-]+$/i.test(batchId)) return fail("Batch not found.");
    if (/^mc-/.test(batchId)) return initLive();
    try {
      const [dRes, bRes] = await Promise.all([fetch("data/" + batchId + ".json"), fetch("batches.json").catch(() => null)]);
      if (!dRes.ok) throw new Error("not found");
      batch = await dRes.json();
      try { const bj = bRes && (await bRes.json()); meta = (bj.batches || []).find((b) => b._id === batchId) || null; } catch (e) {}
    } catch (e) { return fail("This batch could not be loaded. Please go back and try again."); }
    document.title = batch.name + " — CODEX STUDYS";
    trackRecent();
    buildFlat();
    const h = readHash();
    state = h;
    history.replaceState(state, "");
    render();
    const dl = location.hash.match(/[#&]lec=(\d+)/);
    if (dl) {
      history.replaceState(state, "", "#tab=" + state.tab + (state.s !== null ? "&s=" + state.s : ""));
      const fi = +dl[1], f = flat[fi];
      if (f && !f.pdf) openLecture(fi, { startAt: resumePos(fi), autoplay: true });
    }
  }

  function fail(msg) { $("#topTitle").textContent = "Batch"; $("#page").innerHTML = '<div class="empty">' + esc(msg) + "</div>"; }

  function readHash() {
    const m = location.hash.match(/tab=(lectures|notes|about)(?:&s=(\d+))?/);
    return { tab: m ? m[1] : "lectures", s: m && m[2] !== undefined ? +m[2] : null };
  }
  function go(tab, s) {
    state = { tab, s: s === undefined ? null : s };
    filterText = "";
    history.pushState(state, "", "#tab=" + tab + (state.s !== null ? "&s=" + state.s : ""));
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", (e) => {
    const wasOpen = $("#lv").classList.contains("open");
    if (wasOpen && !(e.state && e.state.p)) closeOverlay(true);
    if (live && wasOpen && e.state && e.state.sub === state.sub && e.state.top === state.top && e.state.ct === state.ct) return; // just closed the player: page behind is already right
    if (live) { const st = e.state || {}; liveNav(st.sub != null ? st.sub : liveHash().sub, st.sub != null ? st.top : liveHash().top, st.ct || liveHash().ct, "none"); return; }
    state = (e.state && e.state.tab) ? { tab: e.state.tab, s: e.state.s === undefined ? null : e.state.s } : readHash();
    filterText = ""; render();
  });
  $("#backBtn").addEventListener("click", () => {
    if (live ? state.sub != null : state.s !== null) { history.back(); return; }
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) history.back();
    else location.href = "index.html#courses";
  });

  function trackRecent() {
    try {
      const k = "codex-studys-recent";
      const arr = JSON.parse(localStorage.getItem(k) || "[]").filter((x) => x._id !== batchId);
      arr.unshift({ _id: batchId, name: batch.name, byName: batch.by || "", language: (meta && meta.language) || "", previewImage: (meta && meta.previewImage) || "" });
      localStorage.setItem(k, JSON.stringify(arr.slice(0, 8)));
    } catch (e) {}
  }

  const total = (groups) => groups.reduce((n, g) => n + g.i.length, 0);

  function render() {
    const page = $("#page");
    const groups = state.tab === "notes" ? batch.notes : batch.lectures;
    const inSubject = state.s !== null && state.tab !== "about" && groups[state.s];
    $("#topTitle").textContent = inSubject ? groups[state.s].n : batch.name;
    if (inSubject) { page.innerHTML = renderItems(groups[state.s]); bindItems(groups[state.s]); return; }
    const img = (meta && meta.previewImage) || "assets/batch-" + batchId + ".webp";
    let html = '<div class="hero"><img class="hero-img" src="' + esc(img) + '" alt="' + esc(batch.name) + '" onerror="this.src=\'assets/codex-telegram.png\'">' +
      '<div class="hero-body"><h2 class="hero-title">' + esc(batch.name) + '</h2><p class="hero-sub">' + esc(batch.by || "") + '</p>' +
      '<div class="badges"><span class="badge accent">Recorded</span><span class="badge">' + esc((meta && meta.language) || "Hinglish") + '</span></div></div></div>' +
      '<div class="tabs">' + ["lectures", "notes", "about"].map((t) => '<button class="tab' + (state.tab === t ? " active" : "") + '" data-tab="' + t + '" type="button">' + t[0].toUpperCase() + t.slice(1) + "</button>").join("") + "</div>";
    if (state.tab === "about") html += renderAbout();
    else html += '<div class="list">' + (groups.length ? groups.map((g, i) => subjectRow(g, i)).join("") : '<div class="empty">Nothing here yet.</div>') + "</div>";
    page.innerHTML = html;
    page.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tab !== state.tab) go(b.dataset.tab); }));
    page.querySelectorAll("[data-s]").forEach((b) => b.addEventListener("click", () => go(state.tab, +b.dataset.s)));
  }

  function subjectRow(g, i) {
    const notes = state.tab === "notes";
    const n = g.i.length;
    if (notes) return '<button class="row" type="button" data-s="' + i + '"><span class="ico pdf">' + ICON.doc + '</span><span class="row-main"><span class="row-name">' + esc(g.n) +
      '</span><div class="row-sub">' + n + (n === 1 ? " note" : " notes") + "</div></span>" + ICON.chev + "</button>";
    const st = chapterStats(i), pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    return '<button class="row chapter" type="button" data-s="' + i + '"><span class="row-main"><span class="row-name">' + esc(g.n) +
      '</span><span class="row-sub">' + st.total + (st.total === 1 ? " Lecture" : " Lectures") + (st.notes ? " | " + st.notes + (st.notes === 1 ? " Note" : " Notes") : "") + '</span>' +
      '<span class="ch-prog"><span class="ch-bar"><i style="width:' + pct + '%"></i></span><b>' + pct + "%</b></span></span>" + ICON.chev + "</button>";
  }

  function renderAbout() {
    const subj = batch.lectures.map((g) => g.n);
    const doneAll = allVids.reduce((n, f) => n + (isDone(f.idx) ? 1 : 0), 0);
    return '<div class="stats" style="grid-template-columns:repeat(4,1fr)"><div class="stat"><b>' + total(batch.lectures) + '</b><span>Lectures</span></div><div class="stat"><b>' + total(batch.notes) + '</b><span>Notes</span></div><div class="stat"><b id="lvAbDone">' + doneAll + '</b><span>Completed</span></div><div class="stat"><b>' + batch.lectures.length + '</b><span>Subjects</span></div></div>' +
      '<div class="about-card"><h3>About this batch</h3><p>' + esc(batch.about || "") + '</p></div>' +
      '<div class="about-card" style="margin-top:14px"><h3>Subjects</h3><div class="tags">' + subj.map((s) => '<span class="tag">' + esc(s) + "</span>").join("") + "</div></div>";
  }

  function renderItems(g) {
    const notes = state.tab === "notes";
    let h = '<p class="crumb">' + esc(batch.name) + " › " + (notes ? "Notes" : "Lectures") + " › " + esc(g.n) + "</p>";
    if (g.i.length > 10) h += '<input class="search" id="itemSearch" type="search" placeholder="Search in ' + esc(g.n) + '…" autocomplete="off" value="' + esc(filterText) + '">';
    if (!notes) {
      const st = chapterStats(state.s), pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      h = h.replace('</p>', '</p><div class="lv-prog' + (st.total && st.done >= st.total ? " full" : "") + '" id="lvProg"><div class="lv-prog-top"><span id="lvProgTxt">' + st.done + "/" + st.total + ' lectures done</span><b id="lvProgPct">' + pct + '%</b></div><div class="lv-bar"><i id="lvProgFill" style="width:' + pct + '%"></i></div></div>');
    }
    h += '<div class="list" id="itemList"></div>';
    return h;
  }

  function bindItems(g) {
    const notes = state.tab === "notes";
    const list = $("#itemList");
    const draw = () => {
      const q = filterText.trim().toLowerCase();
      const rows = [];
      g.i.forEach((it, idx) => { if (!q || it[0].toLowerCase().includes(q)) rows.push([it, idx]); });
      curList = rows.map((r) => ({ it: r[0], idx: r[1] }));
      list.innerHTML = rows.length ? rows.map(([it, idx], n) => itemRow(it, idx, n, notes)).join("") : '<div class="empty">No results found.</div>';
      const openRow = (el, a) => {
        const n = +el.dataset.n;
        if (notes) { openNote(curList[n], a && a.dataset.act); return; }
        const fi = offsets[state.s] + curList[n].idx, f = flat[fi];
        if (f && f.pdf) window.open(f.it[1], "_blank", "noopener,noreferrer"); else openLecture(fi);
      };
      list.querySelectorAll("[data-n]").forEach((el) => {
        el.addEventListener("click", (e) => {
          const c = e.target.closest("[data-chk]");
          if (c) { e.stopPropagation(); const i = +c.dataset.chk; setDone(i, !isDone(i)); return; }
          openRow(el, e.target.closest("[data-act]"));
        });
        el.addEventListener("keydown", (e) => {
          if (e.target !== el) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openRow(el, null); }
        });
      });
    };
    const search = $("#itemSearch");
    if (search) search.addEventListener("input", () => { filterText = search.value; draw(); });
    draw();
  }

  function itemRow(it, idx, n, notes) {
    const fi = notes ? -1 : offsets[state.s] + idx;
    const done = !notes && isDone(fi);
    if (notes) return '<div class="row item" data-n="' + n + '" role="button" tabindex="0"><span class="ico pdf" style="width:42px;height:42px;border-radius:13px">' + ICON.doc + '</span><span class="row-main"><span class="row-name">' + esc(it[0]) + '</span></span><span class="act"><button class="pill-btn solid" data-act="view" type="button">View</button><button class="pill-btn" data-act="dl" type="button">Download</button></span></div>';
    return '<div class="row item' + (done ? " done" : "") + '" data-n="' + n + '" data-fi="' + fi + '" data-num="' + (idx + 1) + '" role="button" tabindex="0"><span class="num">' + (done ? "✓" : idx + 1) + '</span><span class="row-main"><span class="row-name">' + esc(it[0]) + '</span></span><span class="play">' + ICON.play + '</span><button class="lv-chk" type="button" data-chk="' + fi + '" aria-pressed="' + (done ? "true" : "false") + '" aria-label="' + (done ? "Mark as not complete" : "Mark as complete") + '">' + SV.tick + "</button></div>";
  }

  function openNote(entry, act) {
    const url = entry.it[1];
    if (/^mcn:/.test(url)) {
      // live note: the real file link is fetched on click
      const [b, s, l] = url.slice(4).split("|");
      const w = act === "dl" ? null : window.open("about:blank", "_blank");
      toast("Opening…");
      fetch("/api/note?b=" + encodeURIComponent(b) + "&s=" + encodeURIComponent(s) + "&l=" + encodeURIComponent(l))
        .then((r) => r.json())
        .then((j) => {
          const links = (j && j.links) || [];
          if (!links.length) { if (w) w.close(); toast("No attachment available."); return; }
          if (act === "dl") { const a = document.createElement("a"); a.href = links[0].url; a.download = ""; a.target = "_blank"; a.rel = "noopener noreferrer"; document.body.appendChild(a); a.click(); a.remove(); toast("Download started"); }
          else if (w) w.location.href = links[0].url; else window.open(links[0].url, "_blank", "noopener,noreferrer");
          for (let i = 1; i < links.length && act !== "dl"; i++) window.open(links[i].url, "_blank", "noopener,noreferrer");
        })
        .catch(() => { if (w) w.close(); toast("Couldn't load this file. Try again."); });
      return;
    }
    if (act === "dl") { const a = document.createElement("a"); a.href = url; a.download = ""; a.target = "_blank"; a.rel = "noopener noreferrer"; document.body.appendChild(a); a.click(); a.remove(); toast("Download started"); }
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  /* ---------- live (Macro) batches: loaded lazily, one small request per tap ---------- */
  const enc = encodeURIComponent;
  const LTABS = [["videos", "Lectures"], ["notes", "Notes"], ["DppNotes", "DPP PDF"], ["DppVideos", "DPP Videos"], ["DppTests", "DPP Tests"], ["exercises", "Practice"]];
  const NOTE_TYPES = ["notes", "DppNotes", "exercises"];
  const lcache = {};
  let liveTok = 0;

  async function lget(key, url) {
    if (lcache[key]) return lcache[key];
    const r = await fetch(url);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) throw new Error((j && j.message) || "failed");
    lcache[key] = j;
    return j;
  }

  function liveHash() {
    const g = (k) => { const m = location.hash.match(new RegExp("[#&]" + k + "=([A-Za-z0-9]+)")); return m ? m[1] : null; };
    const sub = g("sub"), top = g("top");
    return { sub: sub != null ? +sub : null, top: sub != null && top != null ? +top : null, ct: g("ct") || "videos" };
  }
  function liveHashStr(st) {
    if (st.sub == null) return location.pathname + location.search;
    return "#sub=" + st.sub + (st.top != null ? "&top=" + st.top + "&ct=" + st.ct : "");
  }

  async function initLive() {
    try {
      const j = await lget("details", "/api/live?op=details&id=" + enc(batchId));
      live = j;
    } catch (e) { return fail("This batch could not be loaded. Please go back and try again."); }
    batch = { name: live.name, by: live.by, about: live.about, lectures: [], notes: [] };
    meta = { previewImage: live.previewImage || "", language: live.language || "" };
    document.title = batch.name + " — CODEX STUDYS";
    trackRecent();
    const h = liveHash();
    const sub = h.sub != null && live.subjects[h.sub] ? h.sub : null;
    const ct = LTABS.some((t) => t[0] === h.ct) ? h.ct : "videos";
    state = { tab: NOTE_TYPES.includes(ct) ? "notes" : "lectures", s: null, sub, top: sub == null ? null : h.top, ct };
    history.replaceState(state, "");
    liveRender();
  }

  // mode: "push" adds a history entry, "replace" swaps the current one, "none" only renders (back/forward)
  function liveNav(sub, top, ct, mode) {
    ct = LTABS.some((t) => t[0] === ct) ? ct : "videos";
    if (sub != null && !live.subjects[sub]) { sub = null; top = null; }
    state = { tab: NOTE_TYPES.includes(ct) ? "notes" : "lectures", s: sub == null || top == null ? null : 0, sub, top: sub == null ? null : top, ct };
    filterText = "";
    if (mode === "push") history.pushState(state, "", liveHashStr(state));
    else if (mode === "replace") history.replaceState(state, "", liveHashStr(state));
    liveRender();
    if (mode === "push") window.scrollTo(0, 0);
  }

  const lSkeleton = '<div class="list"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  function lError(msg) {
    $("#page").innerHTML = '<div class="empty">' + esc(msg) + '<br><br><button class="pill-btn solid" id="lvRetry" type="button">Retry</button></div>';
    $("#lvRetry").addEventListener("click", () => { Object.keys(lcache).forEach((k) => { if (k !== "details") delete lcache[k]; }); liveRender(); });
  }

  function fmtTime(v) { const d = new Date(v); return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function classStatus(it) {
    const raw = it.status || "";
    if (/end|complet|expired/.test(raw)) return "Ended";
    if (/live|ongoing|started/.test(raw)) return "Live";
    if (/upcoming|todo|scheduled/.test(raw)) return "Upcoming";
    const now = Date.now(), st = Date.parse(it.start), en = Date.parse(it.end);
    if (!isNaN(en) && now > en) return "Ended";
    if (!isNaN(st) && now < st) return "Upcoming";
    return !isNaN(st) && !isNaN(en) ? "Live" : "";
  }
  async function liveToday(tok) {
    const list = $("#page").querySelector(".list");
    if (!list) return;
    let items = [];
    try { items = (await lget("today", "/api/live?op=today&id=" + enc(batchId))).items || []; } catch (e) { return; }
    delete lcache.today; // always fresh
    if (tok !== liveTok || state.sub != null) return;
    const wrap = document.createElement("div");
    wrap.className = "today";
    wrap.innerHTML = '<h3 class="today-h">Today\'s classes</h3>' + (items.length ? '<div class="today-row">' + items.map((it, i) => {
      const st = classStatus(it), when = [fmtTime(it.start), fmtTime(it.end)].filter(Boolean).join(" – ");
      return '<button class="today-card" type="button" data-td="' + i + '"><span class="today-thumb">' + (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : "") +
        (st ? '<span class="today-st ' + st.toLowerCase() + '">' + st + "</span>" : "") + '<span class="today-play">' + ICON.play + '</span></span><span class="today-t">' + esc(it.title) + '</span><span class="today-m">' + esc([when, it.type].filter(Boolean).join(" · ")) + "</span></button>";
    }).join("") + "</div>" : '<p class="crumb">No class scheduled for today.</p>');
    list.parentNode.insertBefore(wrap, list);
    wrap.querySelectorAll("[data-td]").forEach((b) => b.addEventListener("click", () => {
      const fallback = live.subjects[0] ? live.subjects[0]._id : "";
      batch.lectures = [{ n: "Today's classes", i: items.map((it) => [it.title, "mc:" + live.batchId + "|" + (it.subjectId || fallback) + "|" + it.id, "m"]) }];
      batch.notes = [];
      buildFlat();
      state.s = 0;
      openLecture(+b.dataset.td);
    }));
  }

  async function liveRender() {
    const tok = ++liveTok;
    const page = $("#page");
    if (state.sub == null) {
      $("#topTitle").textContent = live.name;
      const img = meta.previewImage || "assets/codex-telegram.png";
      let html = '<div class="hero"><img class="hero-img" src="' + esc(img) + '" alt="' + esc(live.name) + '" referrerpolicy="no-referrer" onerror="this.src=\'assets/codex-telegram.png\'">' +
        '<div class="hero-body"><h2 class="hero-title">' + esc(live.name) + '</h2><p class="hero-sub">' + esc(live.by || "") + '</p>' +
        '<div class="badges"><span class="badge accent">Live</span><span class="badge">' + esc(meta.language || "Hinglish") + '</span></div></div></div>';
      if (live.about) html += '<div class="about-card" style="margin-bottom:14px"><p>' + esc(live.about.length > 400 ? live.about.slice(0, 400) + "…" : live.about) + '</p></div>';
      html += '<div class="list">' + (live.subjects.length ? live.subjects.map((sj, i) =>
        '<button class="row chapter" type="button" data-sub="' + i + '"><span class="row-main"><span class="row-name">' + esc(sj.name) + '</span><span class="row-sub">' + (sj.count ? sj.count + (sj.count === 1 ? " Lecture" : " Lectures") : "View topics") + '</span></span>' + ICON.chev + "</button>").join("") : '<div class="empty">No subjects published for this batch yet.</div>') + "</div>";
      page.innerHTML = html;
      page.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => liveNav(+b.dataset.sub, null, "videos", "push")));
      liveToday(tok);
      return;
    }
    const sj = live.subjects[state.sub];
    if (state.top == null) {
      $("#topTitle").textContent = sj.name;
      page.innerHTML = lSkeleton;
      let topics;
      try { topics = (await lget("t" + state.sub, "/api/live?op=topics&slug=" + enc(live.slug) + "&sub=" + enc(sj.slug))).topics || []; }
      catch (e) { if (tok === liveTok) lError("Couldn't load the topics. Please retry."); return; }
      if (tok !== liveTok) return;
      let h = '<p class="crumb">' + esc(live.name) + " › " + esc(sj.name) + "</p>";
      if (topics.length > 10) h += '<input class="search" id="topSearch" type="search" placeholder="Search topics…" autocomplete="off">';
      h += '<div class="list" id="topList"></div>';
      page.innerHTML = h;
      const draw = (q) => {
        const rows = topics.map((t, i) => [t, i]).filter(([t]) => !q || t.name.toLowerCase().includes(q));
        $("#topList").innerHTML = rows.length ? rows.map(([t, i]) =>
          '<button class="row chapter" type="button" data-top="' + i + '"><span class="row-main"><span class="row-name">' + esc(t.name) + '</span><span class="row-sub">' + (t.lectures || 0) + " Lectures" + (t.notes ? " | " + t.notes + " Notes" : "") + "</span></span>" + ICON.chev + "</button>").join("") : '<div class="empty">No topics found.</div>';
        $("#topList").querySelectorAll("[data-top]").forEach((b) => b.addEventListener("click", () => liveNav(state.sub, +b.dataset.top, "videos", "push")));
      };
      draw("");
      const ts = $("#topSearch"); if (ts) ts.addEventListener("input", () => draw(ts.value.trim().toLowerCase()));
      return;
    }
    // topic: Lectures / Notes / DPP PDF / DPP Videos
    page.innerHTML = lSkeleton;
    let topics;
    try { topics = (await lget("t" + state.sub, "/api/live?op=topics&slug=" + enc(live.slug) + "&sub=" + enc(sj.slug))).topics || []; }
    catch (e) { if (tok === liveTok) lError("Couldn't load this topic. Please retry."); return; }
    if (tok !== liveTok) return;
    const topic = topics[state.top];
    if (!topic) { liveNav(state.sub, null, "videos", "replace"); return; }
    $("#topTitle").textContent = topic.name;
    const tabs = '<div class="tabs scroll">' + LTABS.map((t) => '<button class="tab' + (state.ct === t[0] ? " active" : "") + '" data-ct="' + t[0] + '" type="button">' + t[1] + "</button>").join("") + "</div>";
    page.innerHTML = tabs + lSkeleton;
    const bindTabs = () => page.querySelectorAll("[data-ct]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.ct !== state.ct) liveNav(state.sub, state.top, b.dataset.ct, "replace"); }));
    bindTabs();
    if (state.ct === "DppTests") {
      batch.lectures = []; batch.notes = []; buildFlat();
      let tests;
      try { tests = (await lget("x" + state.sub + "|" + state.top, "/api/live?op=tests&id=" + enc(live.batchId) + "&subjectId=" + enc(sj._id) + "&topic=" + enc(topic.id))).tests || []; }
      catch (e) { if (tok === liveTok) { page.innerHTML = tabs + '<div class="empty">Couldn\'t load the tests. Please retry.<br><br><button class="pill-btn solid" id="lvRetry3" type="button">Retry</button></div>'; bindTabs(); $("#lvRetry3").addEventListener("click", () => { delete lcache["x" + state.sub + "|" + state.top]; liveRender(); }); } return; }
      if (tok !== liveTok) return;
      page.innerHTML = tabs + (tests.length ? '<p class="crumb">' + esc(live.name) + " › DPP Tests › " + esc(topic.name) + '</p><div class="list">' + tests.map((t) =>
        '<div class="row item"><span class="ico pdf" style="width:42px;height:42px;border-radius:13px">' + ICON.doc + '</span><span class="row-main"><span class="row-name">' + esc(t.name) + '</span><span class="row-sub">' +
        esc([t.q ? t.q + " questions" : "", t.marks ? t.marks + " marks" : "", t.min ? t.min + " min" : ""].filter(Boolean).join(" · ")) + "</span></span></div>").join("") + "</div>" : '<div class="empty">Nothing published in this section yet.</div>');
      bindTabs();
      return;
    }
    let items;
    try { items = (await lget("c" + state.sub + "|" + state.top + "|" + state.ct, "/api/live?op=contents&slug=" + enc(live.slug) + "&sub=" + enc(sj.slug) + "&topic=" + enc(topic.id) + "&type=" + state.ct)).items || []; }
    catch (e) { if (tok === liveTok) { page.innerHTML = tabs + '<div class="empty">Couldn\'t load this section. Please retry.<br><br><button class="pill-btn solid" id="lvRetry2" type="button">Retry</button></div>'; bindTabs(); $("#lvRetry2").addEventListener("click", () => { delete lcache["c" + state.sub + "|" + state.top + "|" + state.ct]; liveRender(); }); } return; }
    if (tok !== liveTok) return;
    const isNotes = NOTE_TYPES.includes(state.ct);
    const g = { n: topic.name, i: items.map((it) => isNotes
      ? [(state.ct === "DppNotes" ? "DPP | " : state.ct === "exercises" ? "Practice | " : "") + it.title, "mcn:" + live.slug + "|" + sj.slug + "|" + it.id]
      : [(state.ct === "DppVideos" ? "DPP | " : "") + it.title, "mc:" + live.batchId + "|" + sj._id + "|" + it.id, "m"]) };
    batch.lectures = isNotes ? [] : [g];
    batch.notes = isNotes ? [g] : [];
    buildFlat();
    state.s = 0;
    page.innerHTML = tabs + (g.i.length ? renderItems(g) : '<div class="empty">Nothing published in this section yet.</div>');
    bindTabs();
    if (g.i.length) bindItems(g);
  }

  /* ---------- lecture list + completion ---------- */
  const DONE_KEY = "cx-done";
  const RECENT_KEY = "codex-studys-recent-lectures";
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const readDone = () => { const m = lsGet(DONE_KEY, {}); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; };
  let doneMap = readDone();
  const lkey = (idx) => {
    const f = flat[idx];
    if (live && f) { const p = String(f.it[1]).split("|"); return batchId + "-" + p[p.length - 1]; }
    return batchId + "-" + idx;
  };
  const isDone = (idx) => !!doneMap[lkey(idx)];
  const isPdf = (u) => /\.pdf(\?|#|$)/i.test(String(u || ""));
  let flat = [], offsets = [], allVids = [], vids = [], lite = [], noteFlat = [], doneCount = 0, curG = -1;
  let player = null, cur = -1;

  function buildFlat() {
    flat = []; offsets = [];
    batch.lectures.forEach((g, gi) => { offsets[gi] = flat.length; g.i.forEach((it, ii) => flat.push({ it, g: gi, i: ii, idx: flat.length, pdf: isPdf(it[1]) })); });
    allVids = flat.filter((f) => !f.pdf);
    vids = []; lite = []; noteFlat = []; curG = -1;
    countDone();
  }
  const notesGroupFor = (gi) => batch.notes.findIndex((n) => n.n === batch.lectures[gi].n);
  const chapterStats = (gi) => {
    let total = 0, done = 0;
    flat.forEach((f) => { if (f.g === gi && !f.pdf) { total++; if (isDone(f.idx)) done++; } });
    const ni = notesGroupFor(gi);
    return { total, done, notes: ni >= 0 ? batch.notes[ni].i.length : 0 };
  };
  // the lecture screen only ever shows the lectures (and notes) of the chapter being watched
  function setGroup(gi) {
    if (gi === curG) return;
    curG = gi;
    vids = allVids.filter((f) => f.g === gi);
    lite = vids.map((f) => ({ id: lkey(f.idx), idx: f.idx, title: f.it[0] }));
    const ni = notesGroupFor(gi);
    noteFlat = [];
    (ni >= 0 ? [ni] : batch.notes.map((_, i) => i)).forEach((i) => batch.notes[i].i.forEach((it) => noteFlat.push({ title: it[0], url: it[1], g: i })));
    countDone();
  }
  function countDone() { doneMap = readDone(); doneCount = vids.reduce((n, f) => n + (isDone(f.idx) ? 1 : 0), 0); }

  function setDone(idx, on) {
    const m = readDone(), k = lkey(idx);
    if (on) m[k] = 1; else delete m[k];
    doneMap = m;
    try { localStorage.setItem(DONE_KEY, JSON.stringify(m)); } catch (e) {}
    doneCount = vids.reduce((n, f) => n + (isDone(f.idx) ? 1 : 0), 0);
    // update every visible copy of this lecture in place (no re-render)
    document.querySelectorAll('[data-fi="' + idx + '"]').forEach((r) => {
      r.classList.toggle("done", !!on);
      const n = r.querySelector(".num"); if (n) n.textContent = on ? "✓" : r.dataset.num;
      const c = r.querySelector("[data-chk]"); if (c) { c.setAttribute("aria-pressed", on ? "true" : "false"); c.setAttribute("aria-label", on ? "Mark as not complete" : "Mark as complete"); }
    });
    updateProgressDom();
  }

  function updateProgressDom() {
    const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
    if (state.s !== null && state.tab === "lectures" && batch.lectures[state.s]) {
      const st = chapterStats(state.s), pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      set("lvProgTxt", (el) => { el.textContent = st.done + "/" + st.total + " lectures done"; });
      set("lvProgPct", (el) => { el.textContent = pct + "%"; });
      set("lvProgFill", (el) => { el.style.width = pct + "%"; });
      set("lvProg", (el) => el.classList.toggle("full", st.total > 0 && st.done >= st.total));
    }
    set("lvAbDone", (el) => { el.textContent = String(allVids.reduce((n, f) => n + (isDone(f.idx) ? 1 : 0), 0)); });
  }

  function resumePos(fi) {
    const p = +lsGet("lp:pos:" + lkey(fi), 0) || 0;
    return p > 10 ? p : 0;
  }

  /* ---------- recently watched (lecture level) ---------- */
  function trackLecture(f) {
    if (live) return;
    try {
      const kind = f.it[2], src = f.it[1];
      const thumb = kind === "y" ? "https://i.ytimg.com/vi/" + encodeURIComponent(src) + "/hqdefault.jpg" : ((meta && meta.previewImage) || "assets/batch-" + batchId + ".webp");
      const arr = lsGet(RECENT_KEY, []).filter((x) => !(x && x.b === batchId && x.i === f.idx));
      arr.unshift({ b: batchId, i: f.idx, t: f.it[0], bn: batch.name, th: thumb, at: Date.now() });
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, 10)));
    } catch (e) {}
  }

  /* ---------- lecture screen ---------- */
  const SV = {
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'
  };

  function showAlt(html) {
    if (player) { try { player.v.pause(); } catch (e) {} }
    $("#lvRoot").style.display = "none";
    const a = $("#lvAlt"); a.innerHTML = html; a.classList.add("show");
  }
  function hideAlt() {
    const a = $("#lvAlt"); a.classList.remove("show"); a.innerHTML = "";
    $("#lvRoot").style.display = "";
  }

  function lecData(pos, o) {
    const f = vids[pos], src = f.it[1], kind = f.it[2] === "m" ? "v" : f.it[2];
    const live = f.it[2] === "m";
    return {
      id: lkey(f.idx), idx: f.idx, kind, title: f.it[0],
      videoUrl: kind === "y" ? "https://www.youtube.com/watch?v=" + src : (live ? f.hls : src),
      downloadUrl: kind === "v" && !live ? src : null,
      quality: {}, chapters: [],
      attachments: noteFlat.filter((x) => !/^mcn:/.test(x.url)).map((x) => ({ title: x.title, url: x.url })),
      course: { title: batch.name },
      lectures: lite,
      previousLecture: pos > 0 ? lite[pos - 1] : null,
      nextLecture: pos < vids.length - 1 ? lite[pos + 1] : null,
      startAt: o.startAt || 0, autoplay: o.autoplay !== false
    };
  }

  const playerOpts = {
    onBack: () => closeOverlay(false),
    onNavigate: (n) => { if (n) openLecture(n.idx, {}); },
    onSelectLecture: (l) => { if (l) openLecture(l.idx, {}); },
    onEnded: (d) => { if (d && d.idx != null) setDone(d.idx, true); }
  };

  function openLecture(fi, o) {
    o = o || {};
    const f0 = flat[fi]; if (!f0 || f0.pdf) return;
    setGroup(f0.g);
    const pos = vids.findIndex((f) => f.idx === fi); if (pos < 0) return;
    const ov = $("#lv");
    if (!ov.classList.contains("open")) {
      history.pushState(Object.assign({}, state, { p: 1 }), "");
      ov.classList.add("open"); document.body.style.overflow = "hidden";
    }
    playPos(pos, o);
  }

  let pFallback = null;
  // file-stream "watch" pages expose the raw file at /dl/<id>, so the app's own player can stream it
  const streamUrl = (u) => String(u).replace(/\/watch\/([^/?#]+)/, "/dl/$1");
  function showFrame(f, pos) {
    showAlt('<iframe src="' + esc(f.it[1]) + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe>' +
      '<div class="lv-altbar"><button class="pill-btn" type="button" data-alt="prev"' + (pos > 0 ? "" : " disabled") + '>◀ Prev</button><a class="pill-btn" href="' + esc(f.it[1]) + '" target="_blank" rel="noopener noreferrer">Open in new tab</a><button class="pill-btn" type="button" data-alt="next"' + (pos < vids.length - 1 ? "" : " disabled") + ">Next ▶</button></div>");
  }

  function liveStream(f) {
    const [b, s, l] = f.it[1].slice(3).split("|");
    return fetch("/api/stream?b=" + encodeURIComponent(b) + "&s=" + encodeURIComponent(s) + "&l=" + encodeURIComponent(l))
      .then((r) => r.json())
      .then((j) => { if (!j || !j.hls) throw new Error("no stream"); f.hls = j.hls; f.hlsAt = Date.now(); return j.hls; });
  }

  function playPos(pos, o) {
    cur = pos;
    const f = vids[pos];
    if (f.it[2] === "m" && (!f.hls || Date.now() - f.hlsAt > 4 * 60 * 1000)) {
      // live lecture: resolve its stream first, then play
      toast("Loading lecture…");
      liveStream(f).then(() => { if (cur === pos) playPos(pos, o); })
        .catch(() => { if (cur !== pos) return; toast("Stream isn't available for this lecture yet."); if (!player) closeOverlay(false); });
      return;
    }
    trackLecture(f);
    const d = lecData(pos, o);
    if (d.kind === "p") { d.videoUrl = d.downloadUrl = streamUrl(f.it[1]); pFallback = { f, pos }; } else pFallback = null;
    hideAlt();
    if (!player) {
      player = new LecturePlayer($("#lvRoot"), d, playerOpts);
      // if a file-stream link can't be decoded by this browser, fall back to its own page in a frame
      player.v.addEventListener("error", () => {
        if (pFallback && vids[cur] === pFallback.f) { const fb = pFallback; pFallback = null; showFrame(fb.f, fb.pos); }
      });
      try { LecturePlayer.mediaSession(player, "assets/icon-192.png"); } catch (e) {}
    } else player.load(d);
  }

  function closeOverlay(fromPop) {
    const ov = $("#lv"); if (!ov.classList.contains("open")) return;
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    if (player) { try { player.v.pause(); player.save(); } catch (e) {} }
    hideAlt();
    ov.classList.remove("open"); document.body.style.overflow = "";
    if (!fromPop && history.state && history.state.p) history.back();
  }

  $("#lvAlt").addEventListener("click", (e) => {
    const b = e.target.closest("[data-alt]"); if (!b || b.disabled) return;
    if (b.dataset.alt === "prev" && cur > 0) openLecture(vids[cur - 1].idx, {});
    else if (b.dataset.alt === "next" && cur < vids.length - 1) openLecture(vids[cur + 1].idx, {});
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("#lv").classList.contains("open")) return;
    if (document.fullscreenElement || (player && player.menu)) return;
    closeOverlay(false);
  });
  window.addEventListener("storage", (e) => { if (e.key === DONE_KEY && batch) { countDone(); updateProgressDom(); } });

  init();
})();
