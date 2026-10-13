// Battle Rhythm home page: Daily Sitrep, Reports, the Wire, map, On X, and Policy Watch.
(function () {
  var BR = window.BR, esc = BR.esc;
  var reports = [], wire = [], xposts = [];
  var lane = BR.store("br.lane") || "all", state = null, shown = 40;

  function stateName(code) { return code && BR_GEO.states[code] ? BR_GEO.states[code][0] : ""; }
  function when(x) { return x.published_at || x.found_at || x.approved_at; }
  function storyHref(id) { return "story.html?id=" + encodeURIComponent(id); }

  // ---------- Sitrep: today's Reports first, then the strongest Wire stories ----------
  function renderSitrep() {
    var el = document.getElementById("sitrep");
    var today = BR.ctDayKey(new Date());
    var rep = reports.filter(function (p) { return BR.ctDayKey(new Date(p.approved_at)) === today; })
      .sort(function (a, b) { return (b.score || 0) - (a.score || 0); })
      .map(function (p) { return { report: true, id: p.id, headline: p.headline, lane: p.lane, source: "Battle Rhythm Report" }; });
    var repIds = {}; rep.forEach(function (r) { repIds[r.id] = 1; });
    var top = wire.filter(function (w) { return !repIds[w.id] && Date.now() - Date.parse(when(w)) < 36 * 3600e3; })
      .sort(function (a, b) { return (b.score || 0) - (a.score || 0); })
      .map(function (w) { return { report: !!w.report, id: w.id, headline: w.headline, lane: w.lane, source: w.source, url: w.url }; });
    var list = rep.concat(top).slice(0, 7);
    document.getElementById("sitrepDate").textContent = BR.ct(new Date(), { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();
    if (!list.length) {
      el.outerHTML = '<div class="empty" id="sitrep"><b>The first Sitrep is on its way.</b><span>The agents sweep the news at about 4 AM and 2 PM Central. Headlines appear here after the next sweep.</span></div>';
      return;
    }
    el.innerHTML = list.map(function (x, i) {
      var link = x.report ? '<a href="' + storyHref(x.id) + '">' : '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">';
      return '<li><span class="n">' + (i + 1) + "</span>" + link + esc(x.headline) + "</a>" +
        '<span class="meta">' + (x.report ? '<span class="report-tag sm">REPORT</span> ' : "") + esc((BR.LANES[x.lane] || "").toUpperCase()) + " · " + esc(x.report ? "Battle Rhythm" : x.source) + "</span></li>";
    }).join("");
  }

  // ---------- Reports ----------
  function renderReports() {
    var el = document.getElementById("reports");
    if (!reports.length) {
      el.innerHTML = '<div class="empty"><b>Our first Reports are being written.</b><span>Battle Rhythm Reports are the stories our editors take on directly: what happened, why it matters, and what we think. Until then, the Wire below has the day\'s news.</span></div>';
      return;
    }
    el.innerHTML = reports.slice(0, 6).map(function (p) {
      var take = p.take ? '<div class="take"><span class="take-label">Our take</span><p>' + esc(p.take.length > 260 ? p.take.slice(0, 257).replace(/\s+\S*$/, "") + "…" : p.take) + "</p></div>" : "";
      return '<article class="report"><span class="report-tag">BATTLE RHYTHM REPORT</span>' +
        '<div class="story-meta"><span class="lane-chip">' + BR.laneDot(p.lane) + esc(p.lane_label) + "</span>" +
        (p.policy ? '<span class="policy-chip">POLICY</span>' : "") + (stateName(p.state) ? "<span>" + esc(stateName(p.state)) + "</span>" : "") +
        "<span>" + esc(BR.ago(p.approved_at)) + "</span></div>" +
        '<h3><a href="' + storyHref(p.id) + '">' + esc(p.headline) + "</a></h3>" +
        "<p>" + esc(p.summary) + "</p>" + take +
        '<span class="byline">By ' + esc(p.take_by) + " · Battle Rhythm</span>" +
        '<a class="source-link" href="' + storyHref(p.id) + '">Read the report</a></article>';
    }).join("");
  }

  // ---------- Wire ----------
  function renderTabs() {
    var counts = { all: wire.length };
    Object.keys(BR.LANES).forEach(function (k) { counts[k] = wire.filter(function (w) { return w.lane === k; }).length; });
    document.getElementById("laneTabs").innerHTML = ["all"].concat(Object.keys(BR.LANES)).map(function (k) {
      return '<button type="button" class="tab" data-lane="' + k + '" aria-pressed="' + (lane === k) + '">' +
        (k === "all" ? "" : BR.laneDot(k)) + (k === "all" ? "All lanes" : BR.LANES[k]) + ' <span class="c">' + counts[k] + "</span></button>";
    }).join("");
  }
  function renderWire() {
    var items = wire.filter(function (w) { return (lane === "all" || w.lane === lane) && (!state || w.state === state); });
    var note = document.getElementById("filterNote");
    if (state) {
      note.hidden = false;
      note.innerHTML = "Showing " + esc(stateName(state)) + ' <button type="button" id="clearState">Show all states</button>';
      document.getElementById("clearState").onclick = function () { state = null; renderWire(); drawMap(); };
    } else note.hidden = true;
    document.getElementById("feedCount").textContent = items.length + (items.length === 1 ? " headline" : " headlines");
    var el = document.getElementById("wire");
    el.innerHTML = items.length ? items.slice(0, shown).map(function (w) {
      var also = (w.also || []).length ? "<span>also " + w.also.map(function (a) { return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.source) + "</a>"; }).join(", ") + "</span>" : "";
      return '<li class="' + (w.report ? "is-report" : "") + '">' + BR.laneDot(w.lane) +
        '<a class="h" href="' + esc(w.url) + '" target="_blank" rel="noopener">' + esc(w.headline) + "</a>" +
        '<span class="meta"><span>' + esc(w.source) + "</span><span>" + esc(BR.ago(when(w))) + "</span>" +
        (stateName(w.state) ? "<span>" + esc(stateName(w.state)) + "</span>" : "") +
        (w.policy ? '<span class="policy-chip">POLICY</span>' : "") +
        (w.report ? '<a class="report-tag sm" href="' + storyHref(w.id) + '">READ OUR REPORT</a>' : "") + also + "</span></li>";
    }).join("") : '<li class="empty"><b>No headlines here yet.</b><span>New stories arrive with each sweep, twice a day.</span></li>';
    var more = document.getElementById("wireMoreWrap");
    more.hidden = items.length <= shown;
  }
  document.getElementById("wireMore").onclick = function () { shown += 40; renderWire(); };
  document.getElementById("laneTabs").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-lane]"); if (!b) return;
    lane = b.dataset.lane; BR.store("br.lane", lane); shown = 40;
    renderTabs(); renderWire();
  });

  // ---------- On X ----------
  function renderX() {
    var el = document.getElementById("xlist");
    el.innerHTML = xposts.length ? xposts.map(function (x) {
      return "<li>" + '<span class="handle">@' + esc(x.handle) + "</span>" +
        (x.note ? '<p class="note">' + esc(x.note) + "</p>" : "") +
        '<a class="go" href="' + esc(x.url) + '" target="_blank" rel="noopener">View the post on X ↗</a>' +
        '<span class="meta">Picked by ' + esc(x.added_by || "our editors") + " · " + esc(BR.ago(x.added_at)) + "</span></li>";
    }).join("") : '<li class="empty"><b>Nothing picked yet.</b><span>Our editors add the posts worth your time.</span></li>';
  }

  // ---------- Policy Watch ----------
  function renderPolicy() {
    var items = reports.filter(function (p) { return p.policy; }).map(function (p) { return { report: true, id: p.id, headline: p.headline, lane: p.lane, t: p.approved_at }; })
      .concat(wire.filter(function (w) { return w.policy && !w.report; }).map(function (w) { return { id: w.id, headline: w.headline, lane: w.lane, url: w.url, source: w.source, t: when(w) }; }))
      .sort(function (a, b) { return (b.t || "").localeCompare(a.t || ""); }).slice(0, 10);
    document.getElementById("policy").innerHTML = items.length ? items.map(function (p) {
      var link = p.report ? '<a href="' + storyHref(p.id) + '">' : '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">';
      return "<li>" + link + esc(p.headline) + '</a><span class="meta"><span class="lane-chip">' + BR.laneDot(p.lane) + esc(BR.LANES[p.lane] || "") + "</span>" +
        (p.report ? '<span class="report-tag sm">REPORT</span>' : "<span>" + esc(p.source) + "</span>") + "<span>" + esc(BR.ago(p.t)) + "</span></span></li>";
    }).join("") : '<li class="empty"><b>No policy items yet.</b><span>Bills, rules, and rulings land here.</span></li>';
  }

  // ---------- Map ----------
  var cv = document.getElementById("map"), tip = document.getElementById("mapTip"), markers = [];
  var W = 800, H = 500;
  function P(lon, lat) { return [40 + (lon + 125) * 12.2, 30 + (49.5 - lat) * 15.6]; }
  function inset(code) { return code === "AK" ? [70, 440] : [150, 455]; }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function drawMap() {
    var dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var gold = css("--gold"), edge = css("--edge"), muted = css("--muted"), text = css("--text"), bg = css("--bg");
    var poly = BR_GEO.outline.map(function (p) { return P(p[0], p[1]); });
    ctx.beginPath(); poly.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath();
    ctx.save(); ctx.clip(); ctx.fillStyle = edge;
    for (var y = 20; y < H; y += 12) for (var x = 20; x < W; x += 12) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.restore(); ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = "600 12px " + css("--mono"); ctx.fillStyle = muted;
    ["AK", "HI"].forEach(function (c) { var p = inset(c); ctx.strokeStyle = edge; ctx.strokeRect(p[0] - 26, p[1] - 22, 52, 40); ctx.fillText(c, p[0] - 8, p[1] + 34); });

    var groups = {};
    wire.forEach(function (w) { if (w.state && BR_GEO.states[w.state]) (groups[w.state] = groups[w.state] || { items: [], report: false }).items.push(w); });
    reports.forEach(function (p) {
      if (!p.state || !BR_GEO.states[p.state]) return;
      var g = (groups[p.state] = groups[p.state] || { items: [], report: false });
      g.report = true;
      if (!g.items.some(function (w) { return w.id === p.id; })) g.items.push(p);
    });
    markers = Object.keys(groups).map(function (code) {
      var s = BR_GEO.states[code], pt = s[1] == null ? inset(code) : P(s[1], s[2]), g = groups[code];
      var lead = g.items.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); })[0];
      return { code: code, name: s[0], x: pt[0], y: pt[1], n: g.items.length, lane: lead.lane, report: g.report || g.items.some(function (w) { return w.report; }), r: 6 + Math.min(10, Math.sqrt(g.items.length) * 3) };
    });
    markers.forEach(function (m) {
      var col = css("--lane-" + m.lane) || gold;
      ctx.globalAlpha = state && state !== m.code ? 0.35 : 1;
      if (m.report) { ctx.beginPath(); ctx.arc(m.x, m.y, m.r + 6, 0, Math.PI * 2); ctx.strokeStyle = gold; ctx.lineWidth = 3; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      if (m.n > 1) { ctx.fillStyle = bg; ctx.font = "600 12px " + css("--mono"); ctx.textAlign = "center"; ctx.fillText(String(m.n), m.x, m.y + 4); ctx.textAlign = "start"; }
      if (state === m.code) { ctx.beginPath(); ctx.arc(m.x, m.y, m.r + 11, 0, Math.PI * 2); ctx.strokeStyle = text; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.globalAlpha = 1;
    });
    if (!markers.length) {
      ctx.fillStyle = muted; ctx.font = "500 14px " + css("--mono"); ctx.textAlign = "center";
      ctx.fillText("Markers appear when stories are tied to a state", W / 2, H / 2); ctx.textAlign = "start";
    }
  }
  function hit(ev) {
    var r = cv.getBoundingClientRect(), sx = W / r.width;
    var x = (ev.clientX - r.left) * sx, y = (ev.clientY - r.top) * sx;
    for (var i = markers.length - 1; i >= 0; i--) {
      var m = markers[i];
      if (Math.hypot(m.x - x, m.y - y) <= m.r + 8) return { m: m, left: ev.clientX - r.left, top: ev.clientY - r.top };
    }
    return null;
  }
  cv.addEventListener("mousemove", function (ev) {
    var h = hit(ev); cv.style.cursor = h ? "pointer" : "default";
    if (!h) { tip.hidden = true; return; }
    tip.hidden = false; tip.style.left = h.left + "px"; tip.style.top = h.top + "px";
    tip.textContent = h.m.name + " · " + h.m.n + (h.m.n === 1 ? " story" : " stories") + (h.m.report ? " · Report" : "");
  });
  cv.addEventListener("mouseleave", function () { tip.hidden = true; });
  cv.addEventListener("click", function (ev) {
    var h = hit(ev);
    state = h && state !== h.m.code ? h.m.code : null;
    lane = "all"; renderTabs(); renderWire(); drawMap();
    if (state) document.getElementById("wireTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("br:theme", drawMap);

  function legend() {
    document.getElementById("legend").innerHTML = Object.keys(BR.LANES).map(function (k) {
      return "<span>" + BR.laneDot(k) + esc(BR.LANES[k]) + "</span>";
    }).join("");
  }

  function boot(r) {
    reports = (r[0] || []).slice().sort(function (a, b) { return (b.approved_at || "").localeCompare(a.approved_at || ""); });
    wire = (r[1] || []).slice().sort(function (a, b) { return (when(b) || "").localeCompare(when(a) || ""); });
    xposts = r[2] || [];
    var meta = r[3];
    if (lane !== "all" && !BR.LANES[lane]) lane = "all";
    document.getElementById("wireCount").textContent = String(wire.length);
    document.getElementById("repCount").textContent = String(reports.length);
    document.getElementById("lastSweep").textContent = meta && meta.last_sweep_at ? BR.ct(new Date(meta.last_sweep_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT" : "pending";
    renderSitrep(); renderReports(); renderTabs(); renderWire(); renderX(); renderPolicy(); legend(); drawMap();
  }

  Promise.all([
    BR.fetchJSON("data/published.json").catch(function () { return []; }),
    BR.fetchJSON("data/wire.json").catch(function () { return []; }),
    BR.fetchJSON("data/xposts.json").catch(function () { return []; }),
    BR.fetchJSON("data/meta.json").catch(function () { return null; })
  ]).then(boot);
})();
