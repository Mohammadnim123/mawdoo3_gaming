/**
 * Progressive enhancement for the generation-progress page: poll the Django
 * status endpoint (which proxies the generation service) and either update
 * the stage label, reload on failure (the server renders the failed state),
 * or follow the redirect to the finished game.
 *
 * Polling is a self-scheduling timeout, not an interval: a new request is
 * only sent after the previous one settles (no overlap pile-up), errors back
 * off exponentially, permanent errors (4xx) stop polling and reload so the
 * server can render the error, and hidden tabs pause instead of polling.
 *
 * Without JavaScript the page falls back to a <noscript> meta-refresh; the
 * server redirects to the game when the job succeeds.
 */
(function () {
  const root = document.getElementById('gen-status');
  if (!root || root.dataset.state !== 'running') return;

  const pollUrl = root.dataset.pollUrl;
  const baseIntervalMs = parseInt(root.dataset.interval || '3000', 10);
  const maxIntervalMs = baseIntervalMs * 10;
  const label = document.getElementById('stage-label');
  let intervalMs = baseIntervalMs;

  function schedule() {
    setTimeout(poll, intervalMs);
  }

  async function poll() {
    if (document.hidden) {
      schedule();
      return;
    }
    try {
      const response = await fetch(pollUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          // Permanent (job unknown, bad request) — let the server render it.
          window.location.reload();
          return;
        }
        intervalMs = Math.min(intervalMs * 2, maxIntervalMs); // transient 5xx
        schedule();
        return;
      }
      intervalMs = baseIntervalMs;
      const data = await response.json();
      if (data.redirect_url) {
        window.location.assign(data.redirect_url);
        return;
      }
      if (data.status === 'failed') {
        window.location.reload();
        return;
      }
      if (label && data.stage_label) {
        label.textContent = '⏳ ' + data.stage_label + '…';
      }
    } catch (err) {
      intervalMs = Math.min(intervalMs * 2, maxIntervalMs); // network error
    }
    schedule();
  }

  schedule();
})();
