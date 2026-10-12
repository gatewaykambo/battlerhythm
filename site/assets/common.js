// Shared helpers for every Battle Rhythm page.
(function () {
  var BR = (window.BR = window.BR || {});

  BR.LANES = {
    active_duty: "Active Duty",
    veterans: "Veterans / VA",
    first_responders: "First Responders",
    plant_medicine: "Plant Medicine & Policy"
  };

  BR.store = function (k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) { return null; }
    return null;
  };

  BR.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  BR.siteUrl = function () {
    var cfg = window.BR_CONFIG || {};
    return (cfg.siteUrl || location.origin).replace(/\/$/, "");
  };
  BR.storyUrl = function (id) { return BR.siteUrl() + "/story.html?id=" + encodeURIComponent(id); };

  var MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  function two(n) { return (n < 10 ? "0" : "") + n; }
  BR.dtg = function (d) {
    return two(d.getUTCDate()) + two(d.getUTCHours()) + two(d.getUTCMinutes()) + "Z " + MON[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2);
  };
  BR.ct = function (d, opts) {
    try {
      return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: "America/Chicago" }, opts || { hour: "numeric", minute: "2-digit" })).format(d);
    } catch (e) { return d.toLocaleString(); }
  };
  BR.ago = function (iso) {
    if (!iso) return "";
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (isNaN(s)) return "";
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  };
  BR.ctDayKey = function (d) {
    return BR.ct(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  BR.laneDot = function (lane) {
    return '<i style="background: var(--lane-' + lane + ')"></i>';
  };

  BR.fetchJSON = function (path) {
    return fetch(path + (path.indexOf("?") > -1 ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  };

  BR.copy = function (text, btn) {
    function done(ok) {
      if (!btn) return;
      var old = btn.dataset.label || btn.textContent;
      btn.dataset.label = old;
      btn.textContent = ok ? "Copied" : "Select and copy";
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      done(ok);
    }
  };

  // Header clocks and contrast toggle, on every page.
  function startClocks() {
    var z = document.getElementById("cz"), c = document.getElementById("cc");
    if (!z && !c) return;
    function tick() {
      var d = new Date();
      if (z) z.textContent = BR.dtg(d);
      if (c) c.textContent = BR.ct(d, { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    tick(); setInterval(tick, 1000);
  }
  function contrast() {
    var root = document.documentElement;
    if (BR.store("br.hc") === "1") root.classList.add("hc");
    var b = document.getElementById("hcBtn");
    if (!b) return;
    function label() { b.setAttribute("aria-pressed", String(root.classList.contains("hc"))); }
    label();
    b.addEventListener("click", function () {
      root.classList.toggle("hc");
      BR.store("br.hc", root.classList.contains("hc") ? "1" : "0");
      label();
      document.dispatchEvent(new CustomEvent("br:theme"));
    });
  }
  document.addEventListener("DOMContentLoaded", function () { startClocks(); contrast(); });
})();
