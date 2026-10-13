// War Party TOC approval desk.
// Talks to GitHub directly from the browser with each editor's own access token.
// Approving writes one small decision file; GitHub Actions then publishes it to the site.
(function () {
  var BR = window.BR, esc = BR.esc;
  var CFG = window.BR_CONFIG || {};
  var EDITORS = CFG.editors || ["Will Wisner", "Anthony Canania"];
  var API = "https://api.github.com";

  var S = {
    repo: BR.store("br.repo") || (CFG.repo && CFG.repo.indexOf("OWNER/") !== 0 ? CFG.repo : ""),
    branch: CFG.branch || "main",
    token: BR.store("br.token") || "",
    editor: BR.store("br.editor") || "",
    login: BR.store("br.login") || "",
    view: "queue",
    queue: [], decided: {}, published: [],
    laneFilter: "all", tierFilter: "all", shown: 25
  };

  var view = document.getElementById("view");

  // ---------------------------------------------------------------- GitHub
  function gh(path, opts) {
    opts = opts || {};
    var headers = Object.assign({
      "Authorization": "Bearer " + S.token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }, opts.headers || {});
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body, cache: "no-store" }).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (t) {
        if (!r.ok) {
          var msg = t;
          try { msg = JSON.parse(t).message || t; } catch (e) {}
          var err = new Error(msg); err.status = r.status; throw err;
        }
        return t;
      });
    });
  }
  function contents(path) { return "/repos/" + S.repo + "/contents/" + path; }
  function getJSON(path, fallback) {
    return gh(contents(path) + "?ref=" + encodeURIComponent(S.branch), { headers: { Accept: "application/vnd.github.raw+json" } })
      .then(function (t) { return JSON.parse(t); })
      .catch(function (e) { if (e.status === 404 && fallback !== undefined) return fallback; throw e; });
  }
  function listDir(path) {
    return gh(contents(path) + "?ref=" + encodeURIComponent(S.branch)).then(function (t) { return JSON.parse(t); })
      .catch(function (e) { if (e.status === 404) return []; throw e; });
  }
  function b64(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function putFile(path, obj, message) {
    return gh(contents(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, content: b64(JSON.stringify(obj, null, 1) + "\n"), branch: S.branch })
    });
  }
  function decide(id, status, edits, label, extra) {
    var rec = Object.assign({ id: id, status: status, edits: edits || {}, editor: S.editor, editor_login: S.login, decided_at: new Date().toISOString().replace(/\.\d+Z$/, "Z") }, extra || {});
    return putFile("data/decisions/" + id + "-" + Date.now() + ".json", rec, status.charAt(0).toUpperCase() + status.slice(1) + ": " + (label || id).slice(0, 70) + " (" + S.editor + ")");
  }
  function explain(e) {
    if (e.status === 401) return "GitHub did not accept the token. Check it in Settings; it may have expired.";
    if (e.status === 403) return "The token is missing a permission. It needs Contents: read and write on this repository" + (S.view === "run" ? ", and Actions: read and write to start a sweep." : ".");
    if (e.status === 404) return "Repository not found. Check the name in Settings, and that the token has access to it.";
    return e.message || String(e);
  }

  // ---------------------------------------------------------------- helpers
  function flash(msg, kind) {
    var f = document.getElementById("flash");
    f.hidden = !msg;
    f.className = "notice " + (kind || "");
    f.innerHTML = msg || "";
  }
  function ready() { return S.repo && S.token && S.editor; }
  function who() {
    document.getElementById("who").innerHTML = ready()
      ? "Signed in as <b>" + esc(S.editor) + "</b>" + (S.login ? " (" + esc(S.login) + ")" : "") + " · " + esc(S.repo)
      : "Not set up on this device";
  }
  function setView(v) {
    S.view = v;
    document.querySelectorAll("[data-view]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.view === v)); });
    flash("");
    if (!ready() && v !== "setup") return renderSetup("Set up this device first. It takes about two minutes.");
    ({ queue: loadQueue, published: loadPublished, wire: loadWire, countdowns: loadCountdowns, pulled: loadPulled, sitrep: loadSitrep, run: loadRun, setup: renderSetup })[v]();
  }
  document.querySelector(".views").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-view]"); if (b) setView(b.dataset.view);
  });
  function loading(what) { view.innerHTML = '<div class="empty"><b>Loading ' + esc(what) + "…</b></div>"; }

  var DISCLOSING = { client_conflict: 1, foundation: 1, war_party: 1 };
  function hasDisclosure(item) { return (item.flags || []).some(function (f) { return DISCLOSING[f.type]; }); }

  function xPost(item, f) {
    var link = BR.storyUrl(item.id);
    var tags = (item.hashtags || (item.draft && item.draft.hashtags) || []).map(function (t) { return "#" + t; }).join(" ");
    var body = (f.x_post || f.headline || "").trim();
    if (hasDisclosure(item) || (item.disclosures && item.disclosures.length)) body += " (Disclosure at link)";
    return body + "\n\n" + link + (tags ? " " + tags : "");
  }
  function xLength(text) {
    return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
  }
  function fbPost(item, f) {
    var link = BR.storyUrl(item.id);
    var disc = item.disclosures || (item.flags || []).filter(function (x) { return x.disclosure; }).map(function (x) { return x.disclosure; });
    var out = (f.fb_post || f.summary || "").trim();
    var suicide = item.suicide_safe || (item.flags || []).some(function (x) { return x.type === "suicide"; });
    if (suicide && !/988/.test(out)) out += "\n\nIf you or someone you know is struggling, call the Veterans Crisis Line: dial 988, then press 1.";
    if (disc.length) out += "\n\n" + Array.from(new Set(disc)).join(" ");
    return out + "\n\nRead more: " + link;
  }

  // ---------------------------------------------------------------- setup
  function renderSetup(note) {
    view.innerHTML =
      '<div class="panel setup">' +
      (note ? '<div class="notice warn">' + esc(note) + "</div>" : "") +
      '<p class="label">Set up this device</p>' +
      '<p class="help">Your token stays in this browser on this device only. Each editor uses their own token, and each approval is recorded under that editor\'s name.</p>' +
      '<label class="field"><span>Your name</span><select id="sEditor">' +
      '<option value="">Choose…</option>' + EDITORS.map(function (n) { return "<option" + (n === S.editor ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="field"><span>Repository <em>owner/name</em></span><input id="sRepo" type="text" autocomplete="off" spellcheck="false" placeholder="your-github-name/battle-rhythm" value="' + esc(S.repo) + '"></label>' +
      '<label class="field"><span>GitHub access token</span><input id="sToken" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" value="' + esc(S.token) + '"></label>' +
      '<p class="help">Create one at GitHub → Settings → Developer settings → Fine-grained tokens. Give it access to this repository only, with <code>Contents: Read and write</code>. Add <code>Actions: Read and write</code> if you want the "Run a sweep now" button.</p>' +
      '<div class="row"><button class="btn primary" id="sSave" type="button">Save and test</button>' +
      (S.token ? '<button class="btn danger" id="sForget" type="button">Forget token on this device</button>' : "") +
      '<span class="status-msg" id="sMsg"></span></div></div>';
    document.getElementById("sSave").onclick = function () {
      var msg = document.getElementById("sMsg");
      S.editor = document.getElementById("sEditor").value;
      S.repo = document.getElementById("sRepo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
      S.token = document.getElementById("sToken").value.trim();
      if (!S.editor || !S.repo || !S.token) { msg.className = "status-msg err"; msg.textContent = "Fill in all three fields."; return; }
      msg.className = "status-msg"; msg.textContent = "Testing…";
      gh("/user").then(function (t) { S.login = JSON.parse(t).login || ""; })
        .then(function () { return getJSON("data/queue.json"); })
        .then(function () {
          BR.store("br.editor", S.editor); BR.store("br.repo", S.repo); BR.store("br.token", S.token); BR.store("br.login", S.login);
          who(); msg.className = "status-msg ok"; msg.textContent = "Connected. Opening the queue…";
          setTimeout(function () { setView("queue"); }, 700);
        })
        .catch(function (e) { msg.className = "status-msg err"; msg.textContent = explain(e); });
    };
    var forget = document.getElementById("sForget");
    if (forget) forget.onclick = function () {
      ["br.token", "br.login"].forEach(function (k) { BR.store(k, null); });
      S.token = ""; S.login = ""; who(); renderSetup("Token removed from this device.");
    };
  }

  // ---------------------------------------------------------------- queue
  function loadQueue() {
    loading("the queue");
    Promise.all([getJSON("data/queue.json", []), listDir("data/decisions")]).then(function (r) {
      S.queue = r[0] || [];
      S.decided = {};
      (r[1] || []).forEach(function (f) { if (/\.json$/.test(f.name)) S.decided[f.name.split("-")[0].replace(/\.json$/, "")] = true; });
      renderQueue();
    }).catch(function (e) { view.innerHTML = '<div class="notice err">' + esc(explain(e)) + "</div>"; });
  }

  function pendingItems() {
    return S.queue.filter(function (it) { return it.status === "pending" && !S.decided[it.id]; })
      .sort(function (a, b) { return b.score - a.score; });
  }

  function renderQueue() {
    var all = pendingItems();
    document.getElementById("qCount").textContent = all.length ? String(all.length) : "";
    var items = all.filter(function (it) {
      return (S.laneFilter === "all" || it.lane === S.laneFilter) &&
        (S.tierFilter === "all" || (S.tierFilter === "sitrep" ? it.sitrep : it.tier === S.tierFilter));
    });
    var lanes = ["all"].concat(Object.keys(BR.LANES));
    var head =
      '<div class="filters">' +
      lanes.map(function (k) {
        var n = all.filter(function (it) { return k === "all" || it.lane === k; }).length;
        return '<button type="button" class="tab" data-lf="' + k + '" aria-pressed="' + (S.laneFilter === k) + '">' + (k === "all" ? "" : BR.laneDot(k)) + (k === "all" ? "All" : esc(BR.LANES[k])) + ' <span class="c">' + n + "</span></button>";
      }).join("") +
      '<span class="sep"></span>' +
      [["all", "Everything"], ["report", "Report candidates"], ["sitrep", "Battle Rhythm candidates"], ["hold", "Held for review"]].map(function (t) {
        return '<button type="button" class="tab" data-tf="' + t[0] + '" aria-pressed="' + (S.tierFilter === t[0]) + '">' + t[1] + "</button>";
      }).join("") +
      '<span class="sep"></span><button type="button" class="btn-ghost" id="refresh">Refresh</button></div>';
    var body = items.length
      ? '<div class="cards">' + items.slice(0, S.shown).map(qcard).join("") + "</div>" +
        (items.length > S.shown ? '<div class="row"><button class="btn" id="more" type="button">Show ' + Math.min(25, items.length - S.shown) + " more</button></div>" : "")
      : '<div class="empty"><b>The queue is clear.</b><span>Everything else from the last sweep went straight to the Wire. The agents sweep at about 4 AM and 2 PM Central, or start one from the Sweeps tab.</span></div>';
    view.innerHTML = head + body;

    view.querySelectorAll("[data-lf]").forEach(function (b) { b.onclick = function () { S.laneFilter = b.dataset.lf; S.shown = 25; renderQueue(); }; });
    view.querySelectorAll("[data-tf]").forEach(function (b) { b.onclick = function () { S.tierFilter = b.dataset.tf; S.shown = 25; renderQueue(); }; });
    document.getElementById("refresh").onclick = loadQueue;
    var more = document.getElementById("more"); if (more) more.onclick = function () { S.shown += 25; renderQueue(); };
    items.slice(0, S.shown).forEach(wire);
  }

  function fieldVals(it) {
    var d = it.draft || {};
    return {
      headline: d.headline || it.source_title, summary: d.summary || "", why_it_matters: d.why_it_matters || "",
      take: d.take || "", x_post: d.x_post || "", fb_post: d.fb_post || "", lane: it.lane
    };
  }

  function qcard(it) {
    var f = fieldVals(it), p = it.score_parts || {}, id = it.id, isReport = it.tier === "report" && it.draft;
    var flags = (it.flags || []).map(function (fl) {
      var crit = fl.type === "foundation" || fl.type === "suicide" || fl.type === "medical_claim";
      return '<span class="flag' + (crit ? " crit" : "") + '" title="' + esc(fl.detail || "") + '">' + esc(fl.label || fl.type) + "</span>";
    }).join("");
    var disc = (it.flags || []).filter(function (fl) { return fl.disclosure; }).map(function (fl) { return '<div class="discl">' + esc(fl.disclosure) + "</div>"; }).join("");
    var foundation = (it.flags || []).some(function (fl) { return fl.type === "foundation"; })
      ? '<div class="notice err">Both pilot editors serve on the Grunt Style Foundation board, so neither can approve this story without a conflict. Recommended: kill it.</div>' : "";
    var where = it.on_wire
      ? '<div class="why">Already on the Wire as a link. Approving turns it into a TOC Report.</div>'
      : '<div class="notice warn">Held off the Wire because of the flags above. Post it as a link' + (isReport ? ", publish it as a Report," : "") + " or kill it.</div>";
    var label = isReport ? (it.sitrep ? "Report candidate · Battle Rhythm" : "Report candidate") : "Held for review";
    var head = '<article class="qcard" id="c-' + id + '">' +
      '<div class="qhead"><span class="score ' + (it.sitrep ? "sitrep" : "draft") + '">' + it.score + "</span>" +
      '<span class="tier">' + label + "</span>" +
      '<span class="lane-chip">' + BR.laneDot(it.lane) + esc(BR.LANES[it.lane] || it.lane) + "</span>" +
      (it.policy ? '<span class="policy-chip">POLICY</span>' : "") + ((it.place || it.state) ? '<span class="tier">' + esc(it.place || it.state) + "</span>" : "") + (it.country && it.country !== "US" ? '<span class="flag">OUTSIDE THE U.S. · ' + esc(it.country) + "</span>" : "") + flags + "</div>" +
      '<div class="orig"><span class="t">' + esc(it.source_title) + '</span><span class="m">' + esc(it.source) + " · found " + esc(BR.ago(it.found_at)) +
      (it.published_at ? " · published " + esc(BR.ago(it.published_at)) : "") + ' · <a href="' + esc(it.source_url) + '" target="_blank" rel="noopener">Open the source ↗</a></span>' +
      ((it.also_covered_by || []).length ? '<span class="m">Also covered by: ' + it.also_covered_by.map(function (a) { return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.source) + "</a>"; }).join(", ") + "</span>" : "") +
      "</div>" +
      '<div class="why">Relevance <b>' + (p.relevance || 0) + "</b>/30 · Impact <b>" + (p.impact || 0) + "</b>/25 · Traction <b>" + (p.traction || 0) + "</b>/15 · Angle <b>" + (p.angle || 0) + "</b>/15 · Timeliness <b>" + (p.timeliness || 0) + "</b>/15<br>" + esc(it.score_why || "") + "</div>" +
      foundation + where + disc;
    var linkBtn = !it.on_wire ? '<button class="btn" type="button" id="' + id + '-link">Post to the Wire as a link</button>' : "";
    var killBtn = '<button class="btn danger" type="button" id="' + id + '-kill">' + (it.on_wire ? "Skip the Report" : "Kill") + "</button>";
    var pullBtn = it.on_wire ? '<button class="btn danger" type="button" id="' + id + '-pull">Skip and pull from the Wire</button>' : "";
    if (!isReport) {
      return head + '<div class="row">' + linkBtn + killBtn + '<span class="status-msg" id="' + id + '-msg"></span></div></article>';
    }
    return head +
      (it.draft.open_questions ? '<div class="why">Not yet known: ' + esc(it.draft.open_questions) + "</div>" : "") +
      '<div class="grid2">' +
      field(id, "headline", "Headline", f.headline, "input") +
      '<label class="field"><span>Lane</span><select id="' + id + '-lane">' + Object.keys(BR.LANES).map(function (k) { return '<option value="' + k + '"' + (k === f.lane ? " selected" : "") + ">" + esc(BR.LANES[k]) + "</option>"; }).join("") + "</select></label>" +
      "</div>" +
      field(id, "summary", "Summary · our words", f.summary, 3) +
      field(id, "why_it_matters", "Why it matters", f.why_it_matters, 2) +
      field(id, "take", "Our take · opinion, signed by you", f.take, 4) +
      '<div class="grid2">' + field(id, "x_post", "X post", f.x_post, 4, true) + field(id, "fb_post", "Facebook post", f.fb_post, 6) + "</div>" +
      '<label class="check"><input type="checkbox" id="' + id + '-ok"> I reviewed every field, including the take, and it says what I mean.</label>' +
      '<div class="row">' +
      '<button class="btn primary" type="button" id="' + id + '-approve" disabled>Publish as a Report</button>' +
      linkBtn + killBtn + pullBtn +
      '<span class="status-msg" id="' + id + '-msg"></span></div>' +
      "</article>";
  }
  function field(id, key, label, val, rows, counter) {
    var input = rows === "input"
      ? '<input type="text" id="' + id + "-" + key + '" value="' + esc(val) + '">'
      : '<textarea id="' + id + "-" + key + '" rows="' + rows + '">' + esc(val) + "</textarea>";
    return '<label class="field"><span>' + esc(label) + (counter ? ' <em id="' + id + '-xcount"></em>' : "") + "</span>" + input + "</label>";
  }
  function read(id) {
    var o = {};
    ["headline", "summary", "why_it_matters", "take", "x_post", "fb_post", "lane"].forEach(function (k) {
      var el = document.getElementById(id + "-" + k); o[k] = el ? el.value.trim() : "";
    });
    return o;
  }

  function removeCard(id) {
    S.decided[id] = true;
    var c = document.getElementById("c-" + id); if (c) c.remove();
    document.getElementById("qCount").textContent = String(pendingItems().length || "");
  }
  function confirmClick(btn, label, run) {
    var armed = null, original = btn.textContent;
    btn.onclick = function () {
      if (!btn.classList.contains("confirm")) {
        btn.classList.add("confirm"); btn.textContent = label;
        armed = setTimeout(function () { btn.classList.remove("confirm"); btn.textContent = original; }, 3000);
        return;
      }
      clearTimeout(armed); run();
    };
  }

  function wire(it) {
    var id = it.id, msg = document.getElementById(id + "-msg");
    var approve = document.getElementById(id + "-approve"), ok = document.getElementById(id + "-ok");
    var link = document.getElementById(id + "-link"), kill = document.getElementById(id + "-kill"), pull = document.getElementById(id + "-pull");
    var buttons = [approve, link, kill, pull].filter(Boolean);
    function busy(on, text) { buttons.forEach(function (b) { b.disabled = on; }); if (approve && !on) approve.disabled = !ok.checked; msg.className = "status-msg"; msg.textContent = text || ""; }
    function fail(e) { busy(false); msg.className = "status-msg err"; msg.textContent = explain(e); }

    if (approve) {
      var xEl = document.getElementById(id + "-x_post"), xCount = document.getElementById(id + "-xcount");
      var count = function () { var n = xLength(xPost(it, read(id))); xCount.textContent = n + " / 280 with link"; xCount.className = n > 280 ? "over" : ""; };
      xEl.addEventListener("input", count); count();
      ok.onchange = function () { approve.disabled = !ok.checked; };
      approve.onclick = function () {
        var f = read(id);
        if (!f.headline || !f.summary) { msg.className = "status-msg err"; msg.textContent = "Headline and summary are required."; return; }
        if (/\[DRY RUN\]/.test(f.summary + f.take)) { msg.className = "status-msg err"; msg.textContent = "Replace the test placeholder text first."; return; }
        if (xLength(xPost(it, f)) > 280) { msg.className = "status-msg err"; msg.textContent = "The X post is too long."; return; }
        busy(true, "Publishing…");
        var edits = {}, orig = fieldVals(it);
        Object.keys(f).forEach(function (k) { if (f[k] !== orig[k]) edits[k] = f[k]; });
        ["headline", "summary", "take", "x_post", "fb_post", "why_it_matters"].forEach(function (k) { if (!(k in edits)) edits[k] = f[k]; });
        edits.lane = f.lane;
        decide(id, "approved", edits, f.headline).then(function () {
          S.decided[id] = true;
          done(it, f, "Published as a TOC Report by " + S.editor + ". It goes live in about two minutes.");
        }).catch(fail);
      };
    }
    if (link) link.onclick = function () {
      busy(true, "Posting…");
      decide(id, "wire", null, it.source_title).then(function () { removeCard(id); }).catch(fail);
    };
    confirmClick(kill, it.on_wire ? "Click again to skip" : "Click again to kill", function () {
      busy(true, "Saving…");
      decide(id, "killed", null, it.source_title).then(function () { removeCard(id); }).catch(fail);
    });
    if (pull) confirmClick(pull, "Click again to pull it", function () {
      busy(true, "Pulling…");
      decide(id, "killed_all", null, it.source_title).then(function () { removeCard(id); }).catch(fail);
    });
  }

  function done(it, f, note) {
    var card = document.getElementById("c-" + it.id);
    var x = xPost(it, f), fb = fbPost(it, f), link = BR.storyUrl(it.id);
    card.classList.add("done");
    card.innerHTML =
      '<div class="qhead"><span class="score ' + (it.sitrep ? "sitrep" : "draft") + '">' + it.score + '</span><span class="lane-chip">' + BR.laneDot(f.lane) + esc(BR.LANES[f.lane]) + "</span></div>" +
      '<div class="orig"><span class="t">' + esc(f.headline) + '</span><span class="status-msg ok">' + esc(note) + "</span></div>" +
      '<div class="row"><button class="btn" type="button" data-copy="x">Copy X post</button><button class="btn" type="button" data-copy="fb">Copy Facebook post</button><button class="btn" type="button" data-copy="link">Copy link</button></div>' +
      '<p class="help">Post these once the story is live, so the link works when people click it.</p>';
    card.querySelector('[data-copy="x"]').onclick = function () { BR.copy(x, this); };
    card.querySelector('[data-copy="fb"]').onclick = function () { BR.copy(fb, this); };
    card.querySelector('[data-copy="link"]').onclick = function () { BR.copy(link, this); };
    document.getElementById("qCount").textContent = String(pendingItems().length || "");
  }

  // ---------------------------------------------------------------- shared pull helpers
  var REASONS = ["Wrong location", "Inaccurate", "Duplicate", "Off-topic", "Conflict or legal", "Other"];
  function reasonSelect(id) {
    return '<select id="' + id + '" aria-label="Reason"><option value="">Reason…</option>' + REASONS.map(function (r) { return "<option>" + r + "</option>"; }).join("") + "</select>";
  }

  // ---------------------------------------------------------------- published TOC Reports
  function loadPublished() {
    loading("published TOC Reports");
    getJSON("site/data/published.json", []).then(function (list) {
      S.published = list || [];
      if (!S.published.length) { view.innerHTML = '<div class="empty"><b>No TOC Reports published yet.</b><span>Published Reports appear here with copy-ready posts, edit and correct tools, and Pull.</span></div>'; return; }
      view.innerHTML = '<div class="panel">' + S.published.slice(0, 60).map(function (p) {
        var key = "p" + p.id;
        return '<div class="pub" id="' + key + '"><span class="t">' + esc(p.headline) + '</span>' +
          '<span class="m">' + esc(p.lane_label) + (p.place ? " · " + esc(p.place) : "") + " · by " + esc(p.take_by) + " · " + esc(BR.ct(new Date(p.approved_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " CT" + (p.correction ? " · corrected" : "") + "</span>" +
          '<div class="row"><button class="btn" type="button" data-a="x">Copy X post</button><button class="btn" type="button" data-a="fb">Copy Facebook post</button>' +
          '<button class="btn" type="button" data-a="link">Copy link</button><a class="btn-ghost" href="story.html?id=' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener">Open</a>' +
          '<button class="btn" type="button" data-a="edit">Edit or correct</button></div>' +
          '<div class="row">' + reasonSelect(key + "-reason") + '<button class="btn danger" type="button" data-a="pull">Pull from the site</button><span class="status-msg"></span></div>' +
          '<div class="setup" data-edit hidden style="max-width:none;margin-top:10px">' +
          field(key, "headline", "Headline", p.headline, "input") +
          field(key, "summary", "Summary", p.summary, 3) +
          field(key, "why_it_matters", "Why it matters", p.why_it_matters || "", 2) +
          field(key, "take", "Our take", p.take || "", 4) +
          '<label class="field"><span>Correction note <em>shown on the Report; leave empty for a silent fix of a typo</em></span><input type="text" id="' + key + '-correction" maxlength="400" placeholder="Example: An earlier version said the story was in Ohio. It is in England."></label>' +
          '<div class="row"><button class="btn primary" type="button" data-a="save">Save changes</button><span class="status-msg" data-msg></span></div></div></div>';
      }).join("") + "</div>";
      S.published.slice(0, 60).forEach(function (p) {
        var key = "p" + p.id, row = document.getElementById(key), msg = row.querySelector(".row .status-msg");
        row.querySelector('[data-a="x"]').onclick = function () { BR.copy(xPost(p, p), this); };
        row.querySelector('[data-a="fb"]').onclick = function () { BR.copy(fbPost(p, p), this); };
        row.querySelector('[data-a="link"]').onclick = function () { BR.copy(BR.storyUrl(p.id), this); };
        row.querySelector('[data-a="edit"]').onclick = function () { var e = row.querySelector("[data-edit]"); e.hidden = !e.hidden; };
        row.querySelector('[data-a="save"]').onclick = function () {
          var b = this, m = row.querySelector("[data-msg]"), edits = {};
          ["headline", "summary", "why_it_matters", "take"].forEach(function (k) { var v = document.getElementById(key + "-" + k).value.trim(); if (v !== (p[k] || "")) edits[k] = v; });
          var corr = document.getElementById(key + "-correction").value.trim();
          if (!Object.keys(edits).length && !corr) { m.className = "status-msg err"; m.textContent = "Nothing has changed."; return; }
          b.disabled = true; m.className = "status-msg"; m.textContent = "Saving…";
          decide(p.id, "edited", edits, p.headline, { correction: corr }).then(function () { m.className = "status-msg ok"; m.textContent = "Saved. The Report updates in about two minutes."; })
            .catch(function (e) { b.disabled = false; m.className = "status-msg err"; m.textContent = explain(e); });
        };
        var pb = row.querySelector('[data-a="pull"]');
        confirmClick(pb, "Click again to pull", function () {
          var reason = document.getElementById(key + "-reason").value;
          if (!reason) { msg.className = "status-msg err"; msg.textContent = "Pick a reason first."; pb.classList.remove("confirm"); pb.textContent = "Pull from the site"; return; }
          pb.disabled = true; msg.textContent = "Pulling…";
          decide(p.id, "pull", null, p.headline, { reason: reason }).then(function () { msg.className = "status-msg ok"; msg.textContent = "Pulled. It leaves the site in about two minutes. Undo from the Pulled tab."; })
            .catch(function (e) { pb.disabled = false; msg.className = "status-msg err"; msg.textContent = explain(e); });
        });
      });
      var q = new URLSearchParams(location.search).get("edit");
      if (q) { var row = document.getElementById("p" + q); if (row) { row.querySelector("[data-edit]").hidden = false; row.scrollIntoView({ block: "start" }); } }
    }).catch(function (e) { view.innerHTML = '<div class="notice err">' + esc(explain(e)) + "</div>"; });
  }

  // ---------------------------------------------------------------- wire
  function loadWire() {
    loading("the Wire");
    getJSON("site/data/wire.json", []).then(function (list) {
      var q = "";
      function draw() {
        var items = (list || []).filter(function (w) { return !q || (w.headline + " " + w.source + " " + (w.place || "")).toLowerCase().indexOf(q) > -1; });
        document.getElementById("wList").innerHTML = items.slice(0, 150).map(function (w) {
          return '<div class="pub" id="w-' + w.id + '"><a class="t" href="' + esc(w.url) + '" target="_blank" rel="noopener">' + esc(w.headline) + " ↗</a>" +
            '<span class="m">' + esc(BR.LANES[w.lane] || "") + " · " + esc(w.source) + (w.place ? " · " + esc(w.place) : "") + (w.country && w.country !== "US" ? " · " + esc(w.country) : "") + " · score " + (w.score || "?") + " · " + esc(BR.ago(w.found_at)) + (w.report ? " · has a TOC Report" : "") + "</span>" +
            '<div class="row">' + reasonSelect("wr-" + w.id) + '<button class="btn danger" type="button" data-hide="' + w.id + '">Pull from the Wire</button><span class="status-msg"></span></div></div>';
        }).join("") || '<p class="help">No matching links.</p>';
        document.querySelectorAll("[data-hide]").forEach(function (b) {
          confirmClick(b, "Click again to pull", function () {
            var row = document.getElementById("w-" + b.dataset.hide), msg = row.querySelector(".status-msg"), w = list.filter(function (x) { return x.id === b.dataset.hide; })[0];
            var reason = document.getElementById("wr-" + w.id).value;
            if (!reason) { msg.className = "status-msg err"; msg.textContent = "Pick a reason first."; b.classList.remove("confirm"); b.textContent = "Pull from the Wire"; return; }
            b.disabled = true; msg.textContent = "Pulling…";
            decide(w.id, "hide_wire", null, w.headline, { reason: reason }).then(function () { msg.className = "status-msg ok"; msg.textContent = "Pulled. It leaves the site in about two minutes."; })
              .catch(function (e) { b.disabled = false; msg.className = "status-msg err"; msg.textContent = explain(e); });
          });
        });
      }
      view.innerHTML = '<div class="panel">' +
        '<p class="label">The Wire <small>' + (list || []).length + " links live now</small></p>" +
        '<p class="help">Everything here posted automatically. Pull anything that does not belong; the reason helps the agents learn. You can also pull straight from the public site while editor mode is on.</p>' +
        '<label class="field" style="margin:12px 0"><span>Search</span><input type="text" id="wSearch" placeholder="Search headlines, outlets, or places"></label>' +
        '<div id="wList"></div></div>';
      document.getElementById("wSearch").addEventListener("input", function () { q = this.value.trim().toLowerCase(); draw(); });
      draw();
    }).catch(function (e) { view.innerHTML = '<div class="notice err">' + esc(explain(e)) + "</div>"; });
  }

  // ---------------------------------------------------------------- countdowns
  function loadCountdowns() {
    loading("Countdowns");
    Promise.all([getJSON("data/countdown_suggestions.json", []), getJSON("site/data/countdowns.json", [])]).then(function (r) {
      var sug = (r[0] || []).slice().sort(function (a, b) { return a.date.localeCompare(b.date); }), live = r[1] || [];
      view.innerHTML =
        '<div class="panel"><p class="label">Suggested by the agents <small>' + sug.length + " waiting</small></p>" +
        '<p class="help">Dates the agents found in stories. Check the date and the wording, then confirm or dismiss. Only confirmed Countdowns appear on the site.</p>' +
        (sug.length ? sug.map(function (c) {
          return '<div class="pub" id="s-' + c.id + '"><div class="grid2">' +
            '<label class="field"><span>Label</span><input type="text" id="sl-' + c.id + '" maxlength="80" value="' + esc(c.label) + '"></label>' +
            '<label class="field"><span>Date</span><input type="text" id="sd-' + c.id + '" value="' + esc(c.date) + '" placeholder="YYYY-MM-DD"></label></div>' +
            '<span class="m">From: <a href="story.html?id=' + encodeURIComponent(c.story_id) + '" target="_blank" rel="noopener">' + esc(c.headline || "the story") + "</a> · " + BR.daysUntil(c.date) + " days out</span>" +
            '<div class="row"><button class="btn primary" type="button" data-ok="' + c.id + '">Confirm</button><button class="btn danger" type="button" data-no="' + c.id + '">Dismiss</button><span class="status-msg"></span></div></div>';
        }).join("") : '<p class="help">No suggestions right now. They arrive with TOC Report drafts.</p>') + "</div>" +
        '<div class="panel" style="margin-top:20px"><p class="label">Live on the site <small>' + live.length + "</small></p>" +
        (live.length ? live.map(function (c) {
          return '<div class="pub" id="c-' + c.id + '"><span class="t">' + esc(c.label) + '</span><span class="m">' + esc(c.date) + " · " + BR.daysUntil(c.date) + " days · added by " + esc(c.added_by || "") + "</span>" +
            '<div class="row"><button class="btn danger" type="button" data-rm="' + c.id + '">Remove</button><span class="status-msg"></span></div></div>';
        }).join("") : '<p class="help">None yet.</p>') +
        '<p class="label" style="margin-top:18px">Add one yourself</p><div class="grid2">' +
        '<label class="field"><span>Label</span><input type="text" id="nl" maxlength="80" placeholder="Federal hemp THC cap takes effect"></label>' +
        '<label class="field"><span>Date</span><input type="text" id="nd" placeholder="YYYY-MM-DD"></label></div>' +
        '<div class="row"><button class="btn primary" type="button" id="nAdd">Add Countdown</button><span class="status-msg" id="nMsg"></span></div></div>';
      function act(btn, run) {
        var msg = btn.parentNode.querySelector(".status-msg");
        btn.disabled = true; msg.className = "status-msg"; msg.textContent = "Saving…";
        run().then(function () { msg.className = "status-msg ok"; msg.textContent = "Done. The site updates in about two minutes."; })
          .catch(function (e) { btn.disabled = false; msg.className = "status-msg err"; msg.textContent = explain(e); });
      }
      var okDate = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)); };
      view.querySelectorAll("[data-ok]").forEach(function (b) {
        b.onclick = function () {
          var id = b.dataset.ok, c = sug.filter(function (x) { return x.id === id; })[0];
          var label = document.getElementById("sl-" + id).value.trim(), date = document.getElementById("sd-" + id).value.trim();
          if (!label || !okDate(date)) { var m = b.parentNode.querySelector(".status-msg"); m.className = "status-msg err"; m.textContent = "Use a label and a date like 2026-12-11."; return; }
          act(b, function () { return decide(id, "countdown_add", null, label, { date: date, label: label, suggestion_id: id, story_id: c.story_id, headline: c.headline }); });
        };
      });
      view.querySelectorAll("[data-no]").forEach(function (b) { b.onclick = function () { act(b, function () { return decide(b.dataset.no, "countdown_dismiss", null, "Countdown suggestion"); }); }; });
      view.querySelectorAll("[data-rm]").forEach(function (b) { confirmClick(b, "Click again to remove", function () { act(b, function () { return decide(b.dataset.rm, "countdown_remove", null, "Countdown"); }); }); });
      document.getElementById("nAdd").onclick = function () {
        var label = document.getElementById("nl").value.trim(), date = document.getElementById("nd").value.trim(), b = this;
        if (!label || !okDate(date)) { var m = document.getElementById("nMsg"); m.className = "status-msg err"; m.textContent = "Use a label and a date like 2026-12-11."; return; }
        act(b, function () { return decide("cd" + Date.now(), "countdown_add", null, label, { date: date, label: label }); });
      };
    }).catch(function (e) { view.innerHTML = '<div class="notice err">' + esc(explain(e)) + "</div>"; });
  }

  // ---------------------------------------------------------------- pulled
  function loadPulled() {
    loading("pulled stories");
    getJSON("data/pulled.json", []).then(function (list) {
      list = list || [];
      var byId = {}; list.forEach(function (p) { (byId[p.id] = byId[p.id] || []).push(p); });
      var ids = Object.keys(byId);
      view.innerHTML = '<div class="panel"><p class="label">Pulled <small>' + ids.length + " stories</small></p>" +
        '<p class="help">Everything pulled from the site, newest first. Undo puts it back exactly as it was. The reasons are shared with the agents so they make fewer of the same mistakes.</p>' +
        (ids.length ? ids.map(function (id) {
          var p = byId[id][0], kinds = byId[id].map(function (x) { return x.kind === "report" ? "TOC Report" : "Wire link"; }).join(" + ");
          return '<div class="pub"><span class="t">' + esc(p.headline) + '</span><span class="m">' + esc(kinds) + " · " + esc(p.reason || "no reason given") + " · pulled by " + esc(p.by || "") + " · " + esc(BR.ago(p.at)) + "</span>" +
            '<div class="row"><button class="btn" type="button" data-undo="' + esc(id) + '">Undo</button><span class="status-msg"></span></div></div>';
        }).join("") : '<p class="help">Nothing has been pulled.</p>') + "</div>";
      view.querySelectorAll("[data-undo]").forEach(function (b) {
        b.onclick = function () {
          var msg = b.parentNode.querySelector(".status-msg"); b.disabled = true; msg.textContent = "Restoring…";
          decide(b.dataset.undo, "restore", null, "Restore").then(function () { msg.className = "status-msg ok"; msg.textContent = "Restored. It's back on the site in about two minutes."; })
            .catch(function (e) { b.disabled = false; msg.className = "status-msg err"; msg.textContent = explain(e); });
        };
      });
    }).catch(function (e) { view.innerHTML = '<div class="notice err">' + esc(explain(e)) + "</div>"; });
  }

  // ---------------------------------------------------------------- sitrep
  function firstSentence(s) { var m = String(s || "").match(/^.*?[.!?](\s|$)/); return (m ? m[0] : s || "").trim(); }
  function loadSitrep() {
    loading("today's stories");
    Promise.all([getJSON("site/data/published.json", []), getJSON("site/data/wire.json", [])]).then(function (r) {
      var today = BR.ctDayKey(new Date());
      var reps = (r[0] || []).filter(function (p) { return BR.ctDayKey(new Date(p.approved_at)) === today; })
        .sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      var ids = {}; reps.forEach(function (p) { ids[p.id] = 1; });
      var wires = (r[1] || []).filter(function (w) { return !ids[w.id] && Date.now() - Date.parse(w.published_at || w.found_at) < 36 * 3600e3; })
        .sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, Math.max(0, 7 - reps.length));
      if (!reps.length && !wires.length) { view.innerHTML = '<div class="empty"><b>Nothing for the Battle Rhythm yet.</b><span>It builds from today\'s Reports first, then the strongest Wire headlines.</span></div>'; return; }
      var date = BR.ct(new Date(), { weekday: "long", month: "long", day: "numeric" });
      var n = 0;
      var text = "WAR PARTY TOC · THE BATTLE RHYTHM\n" + date + "\n\n" +
        reps.map(function (p) { n++; return n + ". " + p.headline + " (TOC Report)\n" + firstSentence(p.summary) + "\n" + BR.storyUrl(p.id); })
          .concat(wires.map(function (w) { n++; return n + ". " + w.headline + " (" + w.source + ")\n" + w.url; })).join("\n\n") +
        "\n\nThe full board: " + BR.siteUrl();
      view.innerHTML = '<div class="panel setup" style="max-width:none">' +
        '<p class="label">Today\'s Battle Rhythm <small>' + reps.length + " Reports, " + wires.length + " Wire headlines</small></p>" +
        '<p class="help">Reports come first, then the strongest headlines from the last 36 hours. Edit below, then copy it into a Facebook post or an email.</p>' +
        '<label class="field"><span>Battle Rhythm text</span><textarea id="sitText" rows="20">' + esc(text) + "</textarea></label>" +
        '<div class="row"><button class="btn primary" type="button" id="sitCopy">Copy the Battle Rhythm</button></div></div>';
      document.getElementById("sitCopy").onclick = function () { BR.copy(document.getElementById("sitText").value, this); };
    }).catch(function (e) { view.innerHTML = '<div class="notice err">' + esc(explain(e)) + "</div>"; });
  }

  // ---------------------------------------------------------------- sweeps
  function loadRun() {
    loading("the last sweep");
    getJSON("data/last_run.json", {}).then(function (r) {
      var fail = (r.feeds_failed || []).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("");
      var errs = (r.errors || []).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("");
      view.innerHTML = '<div class="panel setup" style="max-width:none">' +
        '<p class="label">Last sweep</p>' +
        (r.finished_at ? '<dl class="kv">' +
          "<dt>Finished</dt><dd>" + esc(BR.ct(new Date(r.finished_at), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) + " CT" + (r.dry_run ? " (test run)" : "") + "</dd>" +
          "<dt>New stories</dt><dd>" + (r.new || 0) + "</dd><dt>Added to queue</dt><dd>" + (r.queued || 0) + "</dd><dt>Drafted</dt><dd>" + (r.drafted || 0) + "</dd>" +
          "<dt>Feeds working</dt><dd>" + (r.feeds_ok || []).length + "</dd><dt>Feeds failing</dt><dd>" + (r.feeds_failed || []).length + "</dd></dl>"
          : '<p class="help">No sweep has run yet.</p>') +
        (fail ? '<p class="label">Feeds that failed</p><ul class="help">' + fail + "</ul>" : "") +
        (errs ? '<p class="label">Errors</p><ul class="help">' + errs + "</ul>" : "") +
        '<p class="help">Sweeps run automatically at about 4 AM and 2 PM Central. A sweep takes about five minutes.</p>' +
        '<div class="row"><button class="btn primary" type="button" id="runNow">Run a sweep now</button><span class="status-msg" id="runMsg"></span></div></div>';
      document.getElementById("runNow").onclick = function () {
        var b = this, m = document.getElementById("runMsg");
        b.disabled = true; m.textContent = "Starting…";
        gh("/repos/" + S.repo + "/actions/workflows/collect.yml/dispatches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref: S.branch }) })
          .then(function () { m.className = "status-msg ok"; m.textContent = "Sweep started. New stories reach the queue in about five minutes."; })
          .catch(function (e) { b.disabled = false; m.className = "status-msg err"; m.textContent = explain(e); });
      };
    }).catch(function (e) { view.innerHTML = '<div class="notice err">' + esc(explain(e)) + "</div>"; });
  }

  who();
  setView(!ready() ? "setup" : new URLSearchParams(location.search).get("edit") ? "published" : "queue");
})();
