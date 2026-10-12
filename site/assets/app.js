// Battle Rhythm home page: Daily Sitrep, lane feed, map, and policy watch.
(function () {
  var BR = window.BR, esc = BR.esc;
  var all = [], lane = BR.store("br.lane") || "all", state = null;

  function card(p) {
    var disc = (p.disclosures || []).map(function (d) { return '<p class="disclosure">' + esc(d) + "</p>"; }).join("");
    return '<article class="story">' +
      '<div class="story-meta"><span class="lane-chip">' + BR.laneDot(p.lane) + esc(p.lane_label) + "</span>" +
      (p.policy ? '<span class="policy-chip">POLICY</span>' : "") +
      (p.state && BR_GEO.states[p.state] ? "<span>" + esc(BR_GEO.states[p.state][0]) + "</span>" : "") +
      "<span>" + esc(p.source) + "</span><span>" + esc(BR.ago(p.approved_at)) + "</span></div>" +
      '<h3><a href="story.html?id=' + encodeURIComponent(p.id) + '">' + esc(p.headline) + "</a></h3>" +
      "<p>" + esc(p.summary) + "</p>" +
      (p.take ? '<div class="take"><span class="take-label">Our take · ' + esc(p.take_by) + "</span><p>" + esc(p.take) + "</p></div>" : "") +
      disc +
      '<a class="source-link" href="' + esc(p.source_url) + '" target="_blank" rel="noopener">Read the full story at ' + esc(p.source) + " ↗</a>" +
      "</article>";
  }

  function renderSitrep() {
    var el = document.getElementById("sitrep");
    var today = BR.ctDayKey(new Date());
    var todays = all.filter(function (p) { return BR.ctDayKey(new Date(p.approved_at)) === today; });
    var list = (todays.length ? todays : all).slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 7);
    document.getElementById("sitrepDate").textContent = BR.ct(new Date(), { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();
    if (!todays.length && all.length) document.getElementById("sitrepTitle").textContent = "The latest from the watch";
    if (!list.length) {
      el.outerHTML = '<div class="empty" id="sitrep"><b>The first Sitrep is on its way.</b><span>Stories appear here as soon as an editor approves them. The agents sweep the news twice a day.</span></div>';
      return;
    }
    el.innerHTML = list.map(function (p, i) {
      return '<li><span class="n">' + (i + 1) + '</span><a href="story.html?id=' + encodeURIComponent(p.id) + '">' + esc(p.headline) + '</a><span class="meta">' + esc(p.lane_label.toUpperCase()) + " · " + esc(p.source) + "</span></li>";
    }).join("");
  }

  function renderTabs() {
    var counts = { all: all.length };
    Object.keys(BR.LANES).forEach(function (k) { counts[k] = all.filter(function (p) { return p.lane === k; }).length; });
    var keys = ["all"].concat(Object.keys(BR.LANES));
    document.getElementById("laneTabs").innerHTML = keys.map(function (k) {
      return '<button type="button" class="tab" data-lane="' + k + '" aria-pressed="' + (lane === k) + '">' +
        (k === "all" ? "" : BR.laneDot(k)) + (k === "all" ? "All lanes" : BR.LANES[k]) + ' <span class="c">' + counts[k] + "</span></button>";
    }).join("");
  }

  function renderFeed() {
    var items = all.filter(function (p) { return (lane === "all" || p.lane === lane) && (!state || p.state === state); });
    var note = document.getElementById("filterNote");
    if (state) {
      note.hidden = false;
      note.innerHTML = "Showing stories from " + esc(BR_GEO.states[state][0]) + ' <button type="button" id="clearState">Show all states</button>';
      document.getElementById("clearState").onclick = function () { state = null; renderFeed(); drawMap(); };
    } else note.hidden = true;
    document.getElementById("feedCount").textContent = items.length + (items.length === 1 ? " story" : " stories");
    var feed = document.getElementById("feed");
    feed.innerHTML = items.length ? items.slice(0, 60).map(card).join("") :
      '<div class="empty"><b>Nothing in this lane yet.</b><span>Approved stories show up here within a couple of minutes.</span></div>';
  }

  function renderPolicy() {
    var items = all.filter(function (p) { return p.policy; }).slice(0, 8);
    var el = document.getElementById("policy");
    el.innerHTML = items.length ? items.map(function (p) {
      return '<li><a href="story.html?id=' + encodeURIComponent(p.id) + '">' + esc(p.headline) + '</a><span class="meta"><span class="lane-chip">' + BR.laneDot(p.lane) + esc(p.lane_label) + "</span><span>" + esc(BR.ago(p.approved_at)) + "</span></span></li>";
    }).join("") : '<li class="empty"><b>No policy items yet.</b><span>Bills, rules, and rulings land here.</span></li>';
  }

  // ---------- map ----------
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
    ctx.beginPath();
    poly.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.fillStyle = edge;
    for (var y = 20; y < H; y += 12) for (var x = 20; x < W; x += 12) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.restore();
    ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();

    ctx.font = "600 12px " + css("--mono");
    ctx.fillStyle = muted;
    ["AK", "HI"].forEach(function (c) { var p = inset(c); ctx.strokeStyle = edge; ctx.strokeRect(p[0] - 26, p[1] - 22, 52, 40); ctx.fillText(c, p[0] - 8, p[1] + 34); });

    var groups = {};
    all.forEach(function (p) { if (p.state && BR_GEO.states[p.state]) (groups[p.state] = groups[p.state] || []).push(p); });
    markers = Object.keys(groups).map(function (code) {
      var s = BR_GEO.states[code];
      var pt = s[1] == null ? inset(code) : P(s[1], s[2]);
      var list = groups[code];
      return { code: code, name: s[0], x: pt[0], y: pt[1], n: list.length, lane: list[0].lane, r: 7 + Math.min(10, Math.sqrt(list.length) * 3) };
    });
    markers.forEach(function (m) {
      var col = css("--lane-" + m.lane) || gold;
      ctx.globalAlpha = state && state !== m.code ? 0.35 : 1;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r + 5, 0, Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      if (m.n > 1) { ctx.fillStyle = bg; ctx.font = "600 12px " + css("--mono"); ctx.textAlign = "center"; ctx.fillText(String(m.n), m.x, m.y + 4); ctx.textAlign = "start"; }
      if (state === m.code) { ctx.beginPath(); ctx.arc(m.x, m.y, m.r + 10, 0, Math.PI * 2); ctx.strokeStyle = text; ctx.lineWidth = 2; ctx.stroke(); }
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
    var h = hit(ev);
    cv.style.cursor = h ? "pointer" : "default";
    if (!h) { tip.hidden = true; return; }
    tip.hidden = false; tip.style.left = h.left + "px"; tip.style.top = h.top + "px";
    tip.textContent = h.m.name + " · " + h.m.n + (h.m.n === 1 ? " story" : " stories");
  });
  cv.addEventListener("mouseleave", function () { tip.hidden = true; });
  cv.addEventListener("click", function (ev) {
    var h = hit(ev);
    state = h && state !== h.m.code ? h.m.code : null;
    renderFeed(); drawMap();
    if (state) document.getElementById("feedTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.addEventListener("br:theme", drawMap);

  function legend() {
    document.getElementById("legend").innerHTML = Object.keys(BR.LANES).map(function (k) {
      return "<span>" + BR.laneDot(k) + esc(BR.LANES[k]) + "</span>";
    }).join("");
  }

  document.getElementById("laneTabs").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-lane]");
    if (!b) return;
    lane = b.dataset.lane; BR.store("br.lane", lane);
    renderTabs(); renderFeed();
  });

  function boot(published, meta) {
    all = (published || []).slice().sort(function (a, b) { return (b.approved_at || "").localeCompare(a.approved_at || ""); });
    if (lane !== "all" && !BR.LANES[lane]) lane = "all";
    document.getElementById("pubCount").textContent = String(all.length);
    document.getElementById("lastSweep").textContent = meta && meta.last_sweep_at ? BR.ct(new Date(meta.last_sweep_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT" : "pending";
    renderSitrep(); renderTabs(); renderFeed(); renderPolicy(); legend(); drawMap();
  }

  Promise.all([BR.fetchJSON("data/published.json").catch(function () { return []; }), BR.fetchJSON("data/meta.json").catch(function () { return null; })])
    .then(function (r) { boot(r[0], r[1]); });
})();
