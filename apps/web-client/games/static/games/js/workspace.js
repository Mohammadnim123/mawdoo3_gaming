/* Codply workspace — consumes the engine SSE stream (proxied same-origin) and
 * renders the live step timeline, then finalizes + reveals the game on done. */
(function () {
  "use strict";
  var root = document.getElementById("workspace");
  if (!root || !window.EventSource) return;

  var streamUrl = root.dataset.streamUrl;
  var statusUrl = root.dataset.statusUrl;
  var timeline = document.getElementById("ws-timeline");
  var titleEl = document.getElementById("ws-title");
  var rows = {}; // step name -> <li>

  function icon(status) {
    return status === "done" ? "✓" : "•";
  }

  function upsertStep(step, label, status) {
    var li = rows[step];
    if (!li) {
      li = document.createElement("li");
      li.className = "flex items-center gap-2";
      timeline.appendChild(li);
      rows[step] = li;
    }
    // Mark previous rows complete once a new step starts.
    Object.keys(rows).forEach(function (k) {
      if (k !== step) rows[k].dataset.done = "1";
    });
    li.innerHTML =
      '<span class="inline-flex h-5 w-5 items-center justify-center rounded-full" ' +
      'style="background:var(--color-surface-2);color:var(--color-violet)">' +
      icon(status) + "</span><span>" + (label || step) + "</span>";
    if (titleEl && label) titleEl.textContent = label;
  }

  function finalize() {
    fetch(statusUrl, { headers: { "X-Requested-With": "fetch" } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.redirect_url) window.location.href = d.redirect_url;
        else window.location.reload();
      })
      .catch(function () { window.location.reload(); });
  }

  function showFailed(msg) {
    var box = document.getElementById("ws-failed");
    if (box) {
      box.hidden = false;
      if (msg) {
        var m = document.getElementById("ws-failed-msg");
        if (m) m.textContent = msg;
      }
    }
  }

  var es = new EventSource(streamUrl);
  es.addEventListener("step", function (e) {
    try { var d = JSON.parse(e.data); upsertStep(d.step, d.label, d.status); } catch (x) {}
  });
  es.addEventListener("done", function () { es.close(); finalize(); });
  es.addEventListener("failed", function (e) {
    es.close();
    var msg = null;
    try { msg = JSON.parse(e.data).error_user_msg; } catch (x) {}
    showFailed(msg);
  });
  es.onerror = function () {
    // The browser auto-reconnects (with Last-Event-ID). If the job is already
    // finished, a status poll settles the page.
    fetch(statusUrl).then(function (r) { return r.json(); }).then(function (d) {
      if (d.status === "succeeded" && d.redirect_url) { es.close(); window.location.href = d.redirect_url; }
      else if (d.status === "failed") { es.close(); showFailed(d.error); }
    }).catch(function () {});
  };
})();
