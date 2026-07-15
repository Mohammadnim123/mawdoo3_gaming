/**
 * Read-only listener for the starter template's postMessage hooks: the game
 * runs sandboxed on a foreign origin and its only channel out is postMessage;
 * we surface game_over (and its score) in the event log.
 *
 * Events are accepted only from the game iframe itself: the sender's origin
 * must be the game origin AND the source window must be the iframe — payload
 * fields alone (source/gameId) are attacker-controllable by any window.
 */
(function () {
  const frame = document.getElementById('game-frame');
  const log = document.getElementById('event-log');
  if (!frame || !log) return;

  const gameId = frame.dataset.gameId;
  const gameOrigin = frame.dataset.gameOrigin;
  window.addEventListener('message', (event) => {
    if (event.origin !== gameOrigin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== 'mawdoo3-game' || data.gameId !== gameId) return;
    if (data.event === 'game_over') {
      const score = data.data && data.data.score;
      log.textContent =
        score === null || score === undefined
          ? '🏁 game_over'
          : '🏁 game_over — score: ' + score;
    }
  });
})();
