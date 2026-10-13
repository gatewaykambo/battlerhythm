// Share buttons for TOC Reports and Wire headlines.
// Reports share our page; Wire headlines share the original article.
(function () {
  var BR = window.BR, esc = BR.esc;

  function links(url, text) {
    var u = encodeURIComponent(url), t = encodeURIComponent(text), both = encodeURIComponent(text + " " + url);
    return {
      x: "https://x.com/intent/post?text=" + t + "&url=" + u,
      facebook: "https://www.facebook.com/sharer/sharer.php?u=" + u,
      linkedin: "https://www.linkedin.com/sharing/share-offsite/?url=" + u,
      text: "sms:?&body=" + both,
      email: "mailto:?subject=" + t + "&body=" + encodeURIComponent(text + "\n\n" + url + "\n\nvia War Party TOC"),
      reddit: "https://www.reddit.com/submit?url=" + u + "&title=" + t,
      threads: "https://www.threads.net/intent/post?text=" + both,
      bluesky: "https://bsky.app/intent/compose?text=" + both,
      truth: "https://truthsocial.com/share?text=" + t + "&url=" + u,
      whatsapp: "https://wa.me/?text=" + both
    };
  }

  // A full row for Reports. opts.compact shows icon-sized buttons.
  BR.shareRow = function (url, text) {
    var l = links(url, text);
    var a = function (key, label) { return '<a class="sbtn" href="' + esc(l[key]) + '" target="_blank" rel="noopener">' + label + "</a>"; };
    return '<div class="share" data-url="' + esc(url) + '" data-text="' + esc(text) + '"><span class="lbl">SHARE</span>' +
      a("x", "X") + a("facebook", "Facebook") + a("linkedin", "LinkedIn") +
      '<a class="sbtn" href="' + esc(l.text) + '">Text</a>' +
      '<a class="sbtn" href="' + esc(l.email) + '">Email</a>' +
      '<button type="button" class="sbtn" data-share="copy">Copy link</button>' +
      (navigator.share ? '<button type="button" class="sbtn primary" data-share="native">Share…</button>' : "") +
      '<button type="button" class="sbtn" data-share="more" aria-expanded="false">More ▾</button></div>';
  };

  // A single share icon for Wire rows; opens a small menu.
  BR.shareIcon = function (url, text) {
    return '<span class="share" data-url="' + esc(url) + '" data-text="' + esc(text) + '"><button type="button" class="icon-btn" data-share="more" aria-label="Share this headline" aria-expanded="false">' +
      '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg></button></span>';
  };

  function closeMenus(except) {
    document.querySelectorAll(".share-more").forEach(function (m) { if (m !== except) { m.remove(); } });
    document.querySelectorAll('[data-share="more"][aria-expanded="true"]').forEach(function (b) { if (!except || !b.parentNode.contains(except)) b.setAttribute("aria-expanded", "false"); });
  }

  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-share]");
    if (!btn) { if (!ev.target.closest(".share-more")) closeMenus(); return; }
    var box = btn.closest(".share"), url = box.dataset.url, text = box.dataset.text, kind = btn.dataset.share;
    if (kind === "copy") { BR.copy(url, btn); return; }
    if (kind === "native") {
      try { navigator.share({ title: text, text: text, url: url }).catch(function () {}); } catch (e) {}
      return;
    }
    if (kind === "more") {
      var open = box.querySelector(".share-more");
      closeMenus();
      if (open) return;
      var l = links(url, text), compact = !box.querySelector(".sbtn");
      var items = (compact ? [["x", "X"], ["facebook", "Facebook"], ["linkedin", "LinkedIn"], ["text", "Text message"], ["email", "Email"]] : [])
        .concat([["reddit", "Reddit"], ["threads", "Threads"], ["bluesky", "Bluesky"], ["truth", "Truth Social"], ["whatsapp", "WhatsApp"]]);
      var m = document.createElement("div");
      m.className = "share-more"; m.setAttribute("role", "menu");
      m.innerHTML = items.map(function (it) {
        var ext = it[0] !== "text" && it[0] !== "email";
        return '<a role="menuitem" href="' + esc(l[it[0]]) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + it[1] + "</a>";
      }).join("") + (compact ? '<button type="button" role="menuitem" data-share="copy">Copy link</button>' : "") +
        (compact && navigator.share ? '<button type="button" role="menuitem" data-share="native">Share…</button>' : "");
      box.appendChild(m);
      btn.setAttribute("aria-expanded", "true");
    }
  });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeMenus(); });
})();
