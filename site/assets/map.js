// War Party TOC map: a tactical hex globe on desktop, a flat draggable map on phones
// (and as a fallback where 3D isn't available). Both share the same clustered story data.
(function () {
  var BR = window.BR, esc = BR.esc;
  var GOLD = "#b88b34", DC = { lat: 38.9, lon: -77.0 };
  var state = { clusters: [], installations: [], hotzones: [], countries: null, showInst: false, onSelect: null, globe: null, flat: null };

  function rgb(hex) { var n = parseInt(hex.replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(","); }

  // Group stories into ~2-degree cells so a busy area shows one marker with a count.
  function cluster(items) {
    var cells = {};
    items.forEach(function (x) {
      var c = BR.coords(x); if (!c) return;
      var key = Math.round(c.lat / 2) + ":" + Math.round(c.lon / 2);
      var cell = cells[key] || (cells[key] = { key: key, lat: 0, lon: 0, items: [], report: false });
      cell.items.push(x); cell.lat += c.lat; cell.lon += c.lon;
      if (x.kind === "report" || x.report) cell.report = true;
    });
    return Object.keys(cells).map(function (k) {
      var c = cells[k], n = c.items.length;
      c.lat /= n; c.lon /= n;
      c.items.sort(function (a, b) { return (b.kind === "report") - (a.kind === "report") || (b.score || 0) - (a.score || 0); });
      c.lane = c.items[0].lane;
      c.name = BR.placeName(c.items[0]) || (Math.abs(c.lat).toFixed(0) + (c.lat >= 0 ? "N " : "S ") + Math.abs(c.lon).toFixed(0) + (c.lon >= 0 ? "E" : "W"));
      c.foreign = c.items.some(function (x) { return x.country && x.country !== "US"; });
      return c;
    });
  }

  function tipHtml(c) {
    return '<div class="globe-tip"><b>' + esc(c.name) + "</b> · " + c.items.length + (c.items.length === 1 ? " story" : " stories") +
      "<br>" + c.items.slice(0, 3).map(function (x) { return (x.kind === "report" ? "★ " : "• ") + esc(x.headline); }).join("<br>") + "</div>";
  }

  // ---------------------------------------------------------------- globe
  function webgl() {
    try { var c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); }
    catch (e) { return false; }
  }

  function buildGlobe(el) {
    var g = window.Globe({ animateIn: true })(el)
      .width(el.clientWidth).height(el.clientHeight || 340)
      .backgroundColor("rgba(0,0,0,0)")
      .showAtmosphere(true).atmosphereColor(GOLD).atmosphereAltitude(0.17)
      .hexPolygonsData(state.countries.features).hexPolygonResolution(3).hexPolygonMargin(0.38)
      .hexPolygonColor(function () { return "rgba(184,139,52,0.55)"; })
      .pointLat("lat").pointLng("lon").pointsMerge(false)
      .pointColor(function (c) { return BR.laneColor(c.lane); })
      .pointAltitude(function (c) { return 0.03 + Math.min(0.16, c.items.length * 0.018); })
      .pointRadius(function (c) { return 0.7 + Math.min(0.9, Math.sqrt(c.items.length) * 0.22); })
      .pointLabel(tipHtml)
      .onPointClick(function (c) { focus(c); })
      .ringLat("lat").ringLng("lon").ringMaxRadius("max").ringPropagationSpeed("speed").ringRepeatPeriod("period")
      .ringColor(function (r) { return function (t) { return "rgba(" + r.rgb + "," + (r.alpha * (1 - t)).toFixed(3) + ")"; }; })
      .arcStartLat("sLat").arcStartLng("sLon").arcEndLat("eLat").arcEndLng("eLon")
      .arcColor(function () { return ["rgba(184,139,52,0.05)", "rgba(226,189,108,0.9)"]; })
      .arcDashLength(0.35).arcDashGap(0.25).arcDashAnimateTime(2400).arcStroke(0.45)
      .labelLat("lat").labelLng("lon").labelText("name").labelSize(0.42).labelDotRadius(0.2).labelAltitude(0.006)
      .labelColor(function () { return "rgba(241,232,216,0.8)"; }).labelResolution(2)
      .labelLabel(function (i) { return '<div class="globe-tip">' + esc(i.name) + " · " + esc(i.where) + "</div>"; });
    var mat = g.globeMaterial();
    if (mat && mat.color) mat.color.set("#100d0e");
    if (mat && mat.emissive) mat.emissive.set("#070505");
    var ctl = g.controls();
    ctl.autoRotate = true; ctl.autoRotateSpeed = 0.35; ctl.enablePan = false;
    var idle;
    function pause() { ctl.autoRotate = false; clearTimeout(idle); idle = setTimeout(function () { ctl.autoRotate = true; }, 25000); }
    el.addEventListener("pointerdown", pause);
    el.addEventListener("wheel", pause, { passive: true });
    g.pointOfView({ lat: 30, lng: -45, altitude: 2.35 }, 0);
    if (window.ResizeObserver) new ResizeObserver(function () { g.width(el.clientWidth); }).observe(el);
    g._pause = pause;
    return g;
  }

  function globeData() {
    var g = state.globe; if (!g) return;
    var cl = state.clusters;
    g.pointsData(cl);
    var rings = [];
    cl.forEach(function (c) { if (c.report) rings.push({ lat: c.lat, lon: c.lon, rgb: rgb("#e2bd6c"), alpha: 0.9, max: 3.2, speed: 1.6, period: 1700 }); });
    state.hotzones.forEach(function (h) { rings.push({ lat: h.lat, lon: h.lon, rgb: rgb("#d8604a"), alpha: 0.55, max: Math.max(3, h.radius_km / 111), speed: 0.9, period: 2600 }); });
    g.ringsData(rings);
    g.arcsData(cl.filter(function (c) { return c.foreign && c.items.some(function (x) { return x.lane === "active_duty"; }); })
      .map(function (c) { return { sLat: DC.lat, sLon: DC.lon, eLat: c.lat, eLon: c.lon }; }));
    g.labelsData(state.showInst ? state.installations : []);
  }

  function focus(c) {
    if (state.globe) {
      state.globe._pause();
      state.globe.pointOfView({ lat: c.lat, lng: c.lon, altitude: 1.35 }, 900);
    }
    if (state.onSelect) state.onSelect(c);
  }

  // ---------------------------------------------------------------- flat map
  function buildFlat(cv) {
    var view = { z: 1, x: 0, y: 0 }, W = 0, H = 0, ctx = cv.getContext("2d");
    var pointers = {}, dragged = false, pinch0 = 0, z0 = 1, start = null;
    function size() {
      var dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }
    // Equirectangular, cropped to latitudes 75N to 56S.
    function proj(lat, lon) {
      var base = W / 360;
      return [(lon + 180) * base * view.z + view.x, (75 - lat) * base * view.z + view.y];
    }
    function clamp() {
      var w = W * view.z, h = (131 * W / 360) * view.z;
      view.x = Math.min(0, Math.max(W - w, view.x));
      view.y = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, view.y));
    }
    function draw() {
      if (!W) return;
      clamp();
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0d0a0b"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#241e1c"; ctx.lineWidth = 1;
      for (var lon = -180; lon <= 180; lon += 30) { var a = proj(75, lon), b = proj(-56, lon); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      for (var lat = -45; lat <= 75; lat += 30) { var c = proj(lat, -180), d = proj(lat, 180); ctx.beginPath(); ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.stroke(); }
      if (state.countries) {
        ctx.fillStyle = "#2b2422"; ctx.strokeStyle = "#4a3d30"; ctx.lineWidth = 0.6;
        state.countries.features.forEach(function (f) {
          var polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
          ctx.beginPath();
          polys.forEach(function (poly) { poly.forEach(function (ring) {
            ring.forEach(function (p, i) { var q = proj(p[1], p[0]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
            ctx.closePath();
          }); });
          ctx.fill("evenodd"); ctx.stroke();
        });
      }
      state.hotzones.forEach(function (h) {
        var p = proj(h.lat, h.lon), r = Math.max(14, (h.radius_km / 111) * (W / 360) * view.z);
        var g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
        g.addColorStop(0, "rgba(216,96,74,0.45)"); g.addColorStop(1, "rgba(216,96,74,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
      });
      if (state.showInst) {
        ctx.strokeStyle = "rgba(241,232,216,0.75)"; ctx.lineWidth = 1.2;
        state.installations.forEach(function (i) { var p = proj(i.lat, i.lon); ctx.beginPath(); ctx.moveTo(p[0], p[1] - 4); ctx.lineTo(p[0] + 4, p[1]); ctx.lineTo(p[0], p[1] + 4); ctx.lineTo(p[0] - 4, p[1]); ctx.closePath(); ctx.stroke(); });
      }
      state.clusters.forEach(function (c) {
        var p = proj(c.lat, c.lon), r = 5 + Math.min(9, Math.sqrt(c.items.length) * 2.6);
        c._x = p[0]; c._y = p[1]; c._r = r;
        if (c.report) { ctx.beginPath(); ctx.arc(p[0], p[1], r + 5, 0, Math.PI * 2); ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5; ctx.stroke(); }
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fillStyle = BR.laneColor(c.lane); ctx.fill();
        if (c.items.length > 1) { ctx.fillStyle = "#141112"; ctx.font = "600 11px 'IBM Plex Mono', monospace"; ctx.textAlign = "center"; ctx.fillText(String(c.items.length), p[0], p[1] + 4); ctx.textAlign = "start"; }
      });
    }
    function zoomAt(f, cx, cy) {
      var nz = Math.min(8, Math.max(1, view.z * f));
      view.x = cx - (cx - view.x) * (nz / view.z); view.y = cy - (cy - view.y) * (nz / view.z); view.z = nz; draw();
    }
    function hit(x, y) {
      for (var i = state.clusters.length - 1; i >= 0; i--) { var c = state.clusters[i]; if (Math.hypot(c._x - x, c._y - y) <= c._r + 8) return c; }
      return null;
    }
    cv.addEventListener("pointerdown", function (e) {
      cv.setPointerCapture(e.pointerId); pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      dragged = false; start = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); z0 = view.z; }
    });
    cv.addEventListener("pointermove", function (e) {
      var p = pointers[e.pointerId]; if (!p) return;
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        p.x = e.clientX; p.y = e.clientY;
        var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), r = cv.getBoundingClientRect();
        zoomAt((z0 * d / pinch0) / view.z, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); dragged = true; return;
      }
      view.x += e.clientX - p.x; view.y += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) dragged = true;
      draw();
    });
    function up(e) {
      var r = cv.getBoundingClientRect();
      if (!dragged && Object.keys(pointers).length === 1) { var c = hit(e.clientX - r.left, e.clientY - r.top); if (c && state.onSelect) state.onSelect(c); }
      delete pointers[e.pointerId];
    }
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; });
    cv.addEventListener("wheel", function (e) { e.preventDefault(); var r = cv.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    function home() {
      if (!W) return;
      view.z = Math.max(1, H / (131 * W / 360));
      view.x = 0; view.y = 0;
      var p = proj(30, -40); view.x = W / 2 - p[0]; view.y = H / 2 - p[1];
      draw();
    }
    var first = true;
    if (window.ResizeObserver) new ResizeObserver(function () { size(); if (first && W) { first = false; home(); } }).observe(cv);
    window.addEventListener("resize", size);
    size(); if (W) { first = false; home(); }
    return {
      draw: draw,
      zoom: function (f) { zoomAt(f, W / 2, H / 2); },
      reset: home,
      center: function (lat, lon, z) { view.z = z || 3; var p = proj(lat, lon); view.x += W / 2 - p[0]; view.y += H / 2 - p[1]; draw(); }
    };
  }

  // ---------------------------------------------------------------- public
  BR.Map = {
    init: function (opts) {
      state.onSelect = opts.onSelect;
      state.installations = opts.installations || [];
      state.hotzones = opts.hotzones || [];
      state.clusters = cluster(opts.items || []);
      return fetch("vendor/countries.geojson").then(function (r) { return r.json(); }).then(function (geo) {
        state.countries = geo;
        var flatEl = document.getElementById("flatmap"), globeEl = document.getElementById("globe");
        var wide = window.matchMedia("(min-width: 1100px)").matches;
        if (globeEl && window.Globe && webgl()) {
          try { state.globe = buildGlobe(globeEl); globeData(); flatEl.classList.add("when-globe"); }
          catch (e) { state.globe = null; globeEl.hidden = true; }
        } else if (globeEl) { globeEl.hidden = true; }
        if (!state.globe || !wide) state.flat = buildFlat(flatEl);
        window.matchMedia("(min-width: 1100px)").addEventListener("change", function (m) {
          if (!m.matches && !state.flat) state.flat = buildFlat(flatEl);
        });
      }).catch(function () {
        var w = document.getElementById("mapWrap"); if (w) w.innerHTML = '<div class="empty"><b>The map could not load.</b><span>Refresh to try again.</span></div>';
      });
    },
    setInstallations: function (on) { state.showInst = on; globeData(); if (state.flat) state.flat.draw(); },
    zoom: function (f) { if (state.flat) state.flat.zoom(f); },
    reset: function () { if (state.flat) state.flat.reset(); if (state.globe) state.globe.pointOfView({ lat: 30, lng: -45, altitude: 2.35 }, 800); },
    focus: function (c) { focus(c); if (state.flat) state.flat.center(c.lat, c.lon, 3); }
  };
})();
