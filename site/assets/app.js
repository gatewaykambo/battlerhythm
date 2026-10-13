// War Party TOC home page: the Wire, the Battle Rhythm, TOC Reports, the globe, Countdowns, and Policy Watch.
(function () {
  var BR = window.BR, esc = BR.esc;
  var reports = [], wire = [], countdowns = [];
  var lane = BR.store("br.lane") || "all", idFilter = null, idFilterName = "", shown = 40;
  var narrow = window.matchMedia("(max-width: 1099px)");

  function when(x) { return x.published_at || x.found_at || x.approved_at; }
  function storyHref(id) { return "story.html?id=" + encodeURIComponent(id); }
  function pull(kind, id, h) { return BR.pullButton ? BR.pullButton(kind, id, h) : ""; }
  function placeBit(x) {
    var p = BR.placeName(x);
    if (x.country && x.country !== "US" && p.indexOf(",") < 0 && !/[A-Z]{2}$/.test(p)) p = p ? p + " · " + x.country : x.country;
    return p ? "<span>" + esc(p) + "</span>" : "";
  }

  // ---------- tabs (phones and tablets) ----------
  function setTab(t) {
    if (["briefing", "wire", "map"].indexOf(t) < 0) t = "briefing";
    document.body.dataset.tab = t;
    document.querySelectorAll(".tabbar button").forEach(function (b) { b.setAttribute("aria-current", b.dataset.tab === t ? "page" : "false"); });
    if (narrow.matches) window.scrollTo(0, 0);
    if (t === "map") window.dispatchEvent(new Event("resize"));
  }
  document.querySelector(".tabbar").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-tab]"); if (!b) return;
    history.replaceState(null, "", "#" + b.dataset.tab); setTab(b.dataset.tab);
  });
  setTab((location.hash || "").slice(1));

  // ---------- ticker ----------
  function renderTicker() {
    var day = Date.now() - 24 * 3600e3;
    var top = reports.filter(function (p) { return Date.parse(p.approved_at) > day; }).map(function (p) { return { h: p.headline, href: storyHref(p.id), ext: false, s: (p.score || 0) + 5 }; })
      .concat(wire.filter(function (w) { return !w.report && Date.parse(when(w)) > day; }).map(function (w) { return { h: w.headline, href: w.url, ext: true, s: w.score || 0 }; }))
      .sort(function (a, b) { return b.s - a.s; }).slice(0, 4);
    if (!top.length) return;
    var html = top.map(function (t) { return '<a href="' + esc(t.href) + '"' + (t.ext ? ' target="_blank" rel="noopener"' : "") + ">" + esc(t.h) + '</a><span class="dia">◆</span>'; }).join("");
    document.getElementById("tickMove").innerHTML = html + html;
    document.getElementById("ticker").hidden = false;
  }

  // ---------- Battle Rhythm ----------
  function renderRhythm() {
    var today = BR.ctDayKey(new Date());
    var reps = reports.filter(function (p) { return BR.ctDayKey(new Date(p.approved_at)) === today; });
    if (!reps.length) reps = reports.filter(function (p) { return Date.now() - Date.parse(p.approved_at) < 36 * 3600e3; });
    reps = reps.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var ids = {}; reps.forEach(function (p) { ids[p.id] = 1; });
    var top = wire.filter(function (w) { return !ids[w.id] && Date.now() - Date.parse(when(w)) < 36 * 3600e3; })
      .sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    var list = reps.map(function (p) { return { h: p.headline, href: storyHref(p.id), src: "TOC REPORT · " + (p.take_by || "").toUpperCase(), rep: true }; })
      .concat(top.map(function (w) { return { h: w.headline, href: w.url, src: w.source.toUpperCase() + " ↗", ext: true }; })).slice(0, 8);
    document.getElementById("rhythmDate").textContent = BR.ct(new Date(), { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
    var el = document.getElementById("rhythm");
    el.innerHTML = list.length ? list.map(function (x, i) {
      return '<li><span class="n">' + (i + 1) + '</span><span><a href="' + esc(x.href) + '"' + (x.ext ? ' target="_blank" rel="noopener"' : "") + ">" + esc(x.h) + '</a><span class="src' + (x.rep ? " rep" : "") + '">' + esc(x.src) + "</span></span></li>";
    }).join("") : '<li class="empty" style="grid-column:1/-1"><b>The first Battle Rhythm is on its way.</b><span>It fills after the next sweep, at about 4 AM and 2 PM Central.</span></li>';
  }

  // ---------- TOC Reports ----------
  function reportCard(p, hero) {
    var take = p.take ? '<div class="take"><span class="take-label">Our take · ' + esc(p.take_by) + "</span><p>" +
      esc(!hero && p.take.length > 220 ? p.take.slice(0, 217).replace(/\s+\S*$/, "") + "…" : p.take) + "</p></div>" : "";
    return '<article class="report' + (hero ? " hero" : "") + '" id="r-' + esc(p.id) + '">' +
      '<div class="meta"><span class="tag-report">TOC REPORT</span><span class="lane-chip"><i class="dot" style="background:var(--lane-' + p.lane + ')"></i>' + esc(p.lane_label) + "</span>" +
      (p.policy ? '<span class="tag-policy">POLICY</span>' : "") + placeBit(p) + "<span>" + esc(BR.ago(p.approved_at)) + "</span>" +
      '<span style="margin-left:auto;position:relative">' + pull("report", p.id, p.headline) + "</span></div>" +
      '<h3><a href="' + storyHref(p.id) + '">' + esc(p.headline) + "</a></h3>" +
      (hero ? '<p class="sum">' + esc(p.summary) + "</p>" : "") + take +
      (p.correction ? '<p class="correction">Correction: ' + esc(p.correction.note) + "</p>" : "") +
      '<span class="byline">By ' + esc(p.take_by) + " · War Party TOC</span>" +
      BR.shareRow(BR.storyUrl(p.id), p.headline) + "</article>";
  }
  function renderReports() {
    var hero = document.getElementById("hero"), grid = document.getElementById("reports");
    if (!reports.length) {
      hero.innerHTML = '<div class="empty"><b>Our first TOC Reports are being written.</b><span>TOC Reports are the stories our editors take on directly: what happened, why it matters, and what we think. Until then, the Wire has the day\'s news.</span></div>';
      grid.innerHTML = ""; return;
    }
    var day = Date.now() - 36 * 3600e3;
    var ordered = reports.slice().sort(function (a, b) {
      var fa = Date.parse(a.approved_at) > day, fb = Date.parse(b.approved_at) > day;
      return (fb - fa) || (b.score || 0) - (a.score || 0) || (b.approved_at || "").localeCompare(a.approved_at || "");
    });
    hero.innerHTML = reportCard(ordered[0], true);
    var rest = ordered.slice(1, 9);
    document.getElementById("moreReports").hidden = !rest.length;
    grid.innerHTML = rest.map(function (p) { return reportCard(p, false); }).join("");
  }

  // ---------- the Wire ----------
  function renderChips() {
    var counts = { all: wire.length };
    Object.keys(BR.LANES).forEach(function (k) { counts[k] = wire.filter(function (w) { return w.lane === k; }).length; });
    document.getElementById("laneChips").innerHTML = ["all"].concat(Object.keys(BR.LANES)).map(function (k) {
      return '<button type="button" class="chip" data-lane="' + k + '" aria-pressed="' + (lane === k) + '">' +
        (k === "all" ? "All" : '<i style="background:var(--lane-' + k + ')"></i>' + BR.LANE_SHORT[k]) + "</button>";
    }).join("");
  }
  function wireRow(w) {
    var also = (w.also || []).length ? "<span>also " + w.also.map(function (a) { return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.source) + "</a>"; }).join(", ") + "</span>" : "";
    return '<li class="' + (w.report ? "is-report" : "") + '" data-id="' + esc(w.id) + '"><i class="dot" style="background:var(--lane-' + w.lane + ')"></i>' +
      '<a class="h" href="' + esc(w.url) + '" target="_blank" rel="noopener">' + esc(w.headline) + "</a>" +
      '<span class="acts">' + BR.shareIcon(w.url, w.headline) + "</span>" +
      '<span class="meta"><span>' + esc(w.source) + "</span><span>" + esc(BR.ago(when(w))) + "</span>" + placeBit(w) +
      (w.policy ? '<span class="tag-policy">POLICY</span>' : "") +
      (w.report ? '<a class="tag-report" href="' + storyHref(w.id) + '">READ OUR TOC REPORT</a>' : "") + also +
      '<span style="position:relative">' + pull("wire", w.id, w.headline) + "</span></span></li>";
  }
  function miniReport(p) {
    return '<li class="inline-report"><article class="report"><div class="meta"><span class="tag-report">TOC REPORT</span><span class="lane-chip"><i class="dot" style="background:var(--lane-' + p.lane + ')"></i>' + esc(BR.LANE_SHORT[p.lane] || "") + "</span></div>" +
      '<h3><a href="' + storyHref(p.id) + '">' + esc(p.headline) + '</a></h3><span class="byline">By ' + esc(p.take_by) + " · read and share →</span></article></li>";
  }
  function renderWire() {
    var items = wire.filter(function (w) { return (lane === "all" || w.lane === lane) && (!idFilter || idFilter[w.id]); });
    var note = document.getElementById("filterNote");
    if (idFilter) {
      note.hidden = false;
      note.innerHTML = "Showing stories near " + esc(idFilterName) + ' <button type="button" id="clearFilter">Show everything</button>';
      document.getElementById("clearFilter").onclick = function () { idFilter = null; renderWire(); };
    } else note.hidden = true;
    document.getElementById("wireMeta").textContent = items.length + " live";
    var html = [], reps = narrow.matches && lane === "all" && !idFilter ? reports.slice(0, 4) : [];
    items.slice(0, shown).forEach(function (w, i) {
      html.push(wireRow(w));
      if (reps.length && (i + 1) % 6 === 0) html.push(miniReport(reps.shift()));
    });
    document.getElementById("wire").innerHTML = html.join("") ||
      '<li class="empty" style="display:grid"><b>No headlines here yet.</b><span>New stories arrive with each sweep, twice a day.</span></li>';
    document.getElementById("moreRow").hidden = items.length <= shown;
  }
  document.getElementById("moreBtn").onclick = function () { shown += 40; renderWire(); };
  document.getElementById("laneChips").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-lane]"); if (!b) return;
    lane = b.dataset.lane; BR.store("br.lane", lane); shown = 40; renderChips(); renderWire();
  });
  narrow.addEventListener("change", renderWire);

  // ---------- Countdowns ----------
  function renderCountdowns() {
    var items = countdowns.map(function (c) { return Object.assign({ days: BR.daysUntil(c.date) }, c); }).filter(function (c) { return c.days >= 0; })
      .sort(function (a, b) { return a.days - b.days; });
    var html = items.length ? items.slice(0, 6).map(function (c) {
      var d = new Date(c.date + "T12:00:00Z");
      var date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
      return '<div class="cd"><span class="days">' + (c.days === 0 ? "TODAY" : c.days) + "<small>" + (c.days === 0 ? "" : c.days === 1 ? "DAY" : "DAYS") + "</small></span>" +
        '<span><span class="what">' + esc(c.label) + '</span><br><span class="when">' + date + (c.story_id ? ' · <a href="' + storyHref(c.story_id) + '">the story</a>' : "") + "</span></span></div>";
    }).join("") : '<div class="empty"><b>No countdowns yet.</b><span>Deadlines the agents spot in stories appear here once an editor confirms them.</span></div>';
    document.getElementById("countdowns").innerHTML = html;
    var ph = document.getElementById("phoneCountdowns");
    if (items.length) { ph.hidden = false; ph.innerHTML = '<h2 class="label">Countdowns</h2>' + html; }
  }

  // ---------- Policy Watch ----------
  function renderPolicy() {
    var items = reports.filter(function (p) { return p.policy; }).map(function (p) { return { report: true, id: p.id, h: p.headline, lane: p.lane, t: p.approved_at }; })
      .concat(wire.filter(function (w) { return w.policy && !w.report; }).map(function (w) { return { h: w.headline, lane: w.lane, url: w.url, source: w.source, t: when(w) }; }))
      .sort(function (a, b) { return (b.t || "").localeCompare(a.t || ""); }).slice(0, 10);
    document.getElementById("policy").innerHTML = items.length ? items.map(function (p) {
      var a = p.report ? '<a href="' + storyHref(p.id) + '">' : '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">';
      return "<li>" + a + esc(p.h) + (p.report ? "" : " ↗") + '</a><span class="meta"><i class="dot" style="background:var(--lane-' + p.lane + ')"></i>' +
        (p.report ? '<span class="tag-report">TOC REPORT</span>' : "<span>" + esc(p.source) + "</span>") + "<span>" + esc(BR.ago(p.t)) + "</span></span></li>";
    }).join("") : '<li class="empty"><b>No policy items yet.</b><span>Bills, rules, and rulings land here.</span></li>';
  }

  // ---------- map ----------
  function legend() {
    document.getElementById("legend").innerHTML = Object.keys(BR.LANES).map(function (k) { return '<span><i class="dot" style="background:var(--lane-' + k + ')"></i>' + esc(BR.LANE_SHORT[k]) + "</span>"; }).join("") +
      '<span><i class="ring"></i>TOC Report</span><span><i class="hot"></i>Active operations</span>';
  }
  function showLocation(c) {
    var el = document.getElementById("loc");
    el.hidden = false;
    el.innerHTML = "<h3><span>" + esc(c.name) + "</span><span>" + c.items.length + (c.items.length === 1 ? " story" : " stories") + "</span></h3>" +
      c.items.slice(0, 6).map(function (x) {
        return x.kind === "report" ? '<a href="' + storyHref(x.id) + '"><span class="tag-report">TOC REPORT</span> ' + esc(x.headline) + "</a>"
          : '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.headline) + " ↗</a>";
      }).join("") + '<button type="button" class="btn-ghost" id="locWire">Show these in the Wire</button>';
    document.getElementById("locWire").onclick = function () {
      idFilter = {}; c.items.forEach(function (x) { idFilter[x.id] = 1; }); idFilterName = c.name; lane = "all";
      renderChips(); renderWire();
      if (narrow.matches) { history.replaceState(null, "", "#wire"); setTab("wire"); }
      else document.getElementById("wireTitle").scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
  }
  function startMap(installations, hotzones) {
    var items = reports.map(function (p) { return Object.assign({ kind: "report" }, p); })
      .concat(wire.filter(function (w) { return !reports.some(function (p) { return p.id === w.id; }); }).map(function (w) { return Object.assign({ kind: "wire" }, w); }));
    var go = function () { BR.Map.init({ items: items, installations: installations, hotzones: hotzones, onSelect: showLocation }); };
    if (!narrow.matches) {
      var s = document.createElement("script");
      s.src = "vendor/globe.gl.min.js"; s.onload = go; s.onerror = go;
      document.head.appendChild(s);
    } else go();
    document.getElementById("instBtn").onclick = function () {
      var on = this.getAttribute("aria-pressed") !== "true";
      this.setAttribute("aria-pressed", String(on)); BR.Map.setInstallations(on);
    };
    document.getElementById("zIn").onclick = function () { BR.Map.zoom(1.5); };
    document.getElementById("zOut").onclick = function () { BR.Map.zoom(1 / 1.5); };
    document.getElementById("zReset").onclick = function () { BR.Map.reset(); };
  }

  // ---------- boot ----------
  Promise.all([
    BR.fetchJSON("data/published.json").catch(function () { return []; }),
    BR.fetchJSON("data/wire.json").catch(function () { return []; }),
    BR.fetchJSON("data/countdowns.json").catch(function () { return []; }),
    BR.fetchJSON("data/installations.json").catch(function () { return { items: [] }; }),
    BR.fetchJSON("data/hotzones.json").catch(function () { return { items: [] }; }),
    BR.fetchJSON("data/meta.json").catch(function () { return null; })
  ]).then(function (r) {
    reports = (r[0] || []).slice().sort(function (a, b) { return (b.approved_at || "").localeCompare(a.approved_at || ""); });
    wire = (r[1] || []).slice().sort(function (a, b) { return (when(b) || "").localeCompare(when(a) || ""); });
    countdowns = r[2] || [];
    var meta = r[5];
    if (lane !== "all" && !BR.LANES[lane]) lane = "all";
    document.getElementById("wireCount").textContent = String(wire.length);
    document.getElementById("repCount").textContent = String(reports.length);
    document.getElementById("lastSweep").textContent = meta && meta.last_sweep_at ? BR.ct(new Date(meta.last_sweep_at), { hour: "numeric", minute: "2-digit" }) + " CT" : "pending";
    renderTicker(); renderRhythm(); renderReports(); renderChips(); renderWire(); renderCountdowns(); renderPolicy(); legend();
    startMap((r[3] && r[3].items) || [], (r[4] && r[4].items) || []);
  });
})();
