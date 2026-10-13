// Editor mode: on a device where the approval desk is connected, every story on the
// public site gets a Pull button. Pulling writes one decision file; the site updates
// in a minute or two. Pulled stories can be restored from the desk.
(function () {
  var BR = window.BR, esc = BR.esc;
  var CFG = window.BR_CONFIG || {};
  var repo = BR.store("br.repo") || "", token = BR.store("br.token") || "", editor = BR.store("br.editor") || "";
  BR.isEditor = !!(repo && token && editor);
  if (!BR.isEditor) return;
  document.addEventListener("DOMContentLoaded", function () { document.body.classList.add("editor"); });

  var REASONS = ["Wrong location", "Inaccurate", "Duplicate", "Off-topic", "Conflict or legal", "Other"];

  function b64(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function decide(rec, label) {
    rec.editor = editor; rec.editor_login = BR.store("br.login") || "";
    rec.decided_at = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    return fetch("https://api.github.com/repos/" + repo + "/contents/data/decisions/" + rec.id + "-" + Date.now() + ".json", {
      method: "PUT",
      headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Pull: " + label.slice(0, 70) + " (" + editor + ")", content: b64(JSON.stringify(rec, null, 1) + "\n"), branch: CFG.branch || "main" })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(r.status === 401 ? "The desk token was not accepted. Reconnect on the desk." : (j.message || "GitHub error " + r.status)); });
    });
  }

  // Markup for a Pull button; kind is "report" or "wire".
  BR.pullButton = function (kind, id, headline) {
    return '<span class="ed" style="position:relative"><button type="button" class="pull-btn" data-pull="' + kind + '" data-id="' + esc(id) + '" data-h="' + esc(headline) + '">PULL</button></span>';
  };

  document.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-pull]");
    var reason = ev.target.closest("[data-reason]");
    if (reason) {
      var menu = reason.closest(".pull-menu"), src = menu.previousElementSibling;
      var kind = src.dataset.pull, id = src.dataset.id, h = src.dataset.h, msg = menu.querySelector(".msg");
      menu.querySelectorAll("button").forEach(function (x) { x.disabled = true; });
      msg.textContent = "Pulling…";
      decide({ id: id, status: kind === "report" ? "pull" : "hide_wire", reason: reason.dataset.reason }, h).then(function () {
        msg.textContent = "Pulled. It leaves the site in a minute or two. Undo it from the desk's Pulled tab.";
        var host = src.closest("li, article");
        if (host) host.classList.add("pulled");
        src.disabled = true; src.textContent = "PULLED";
        setTimeout(function () { menu.remove(); }, 4000);
      }).catch(function (e) {
        msg.textContent = e.message;
        menu.querySelectorAll("button").forEach(function (x) { x.disabled = false; });
      });
      return;
    }
    if (b) {
      var open = b.parentNode.querySelector(".pull-menu");
      document.querySelectorAll(".pull-menu").forEach(function (m) { m.remove(); });
      if (open) return;
      var m = document.createElement("div");
      m.className = "pull-menu";
      m.innerHTML = "<p>Pull this " + (b.dataset.pull === "report" ? "TOC Report" : "headline") + " because:</p>" +
        REASONS.map(function (r) { return '<button type="button" data-reason="' + r + '">' + r + "</button>"; }).join("") + '<span class="msg"></span>';
      b.parentNode.appendChild(m);
      return;
    }
    if (!ev.target.closest(".pull-menu")) document.querySelectorAll(".pull-menu").forEach(function (m) { m.remove(); });
  });
})();
