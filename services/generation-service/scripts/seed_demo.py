"""Seed one hand-built demo game through the real container (no API key needed).

Useful to verify the store→serve→play path and to give the web client
something to show before the first AI generation. The demo game is written
against the same SDK contract and must pass the same quality gate — running
this script is also a live test of the template + gate pair.

    .venv/bin/python scripts/seed_demo.py
"""

from __future__ import annotations

import asyncio
import sys

from generation_service.config.settings import get_settings
from generation_service.container import Container
from generation_service.domain.blueprint import (
    Control,
    GameBlueprint,
    Genre,
    LocalizedText,
    TweakParameter,
    UiString,
)
from generation_service.domain.entities import (
    Game,
    GameVersion,
    GeneratedGameCode,
    game_version_prefix,
    new_id,
)
from generation_service.infrastructure.storage import store_bundle

GAME_ID = "demo-coins"

BLUEPRINT = GameBlueprint(
    title=LocalizedText(en="Coin Tap", ar="جمع العملات"),
    genre=Genre.CLICKER,
    summary="Tap the coin before time runs out — every tap scores and moves the coin.",
    core_rule=(
        "Tapping the coin adds one point and relocates it; "
        "the round ends when the timer hits zero."
    ),
    win_condition=None,
    lose_condition="Timer reaches zero",
    rules=[
        "A single coin is visible at a random position",
        "Tapping the coin scores exactly one point and moves it",
        "The round lasts round_seconds seconds",
        "The final score is reported when time is up",
    ],
    controls=[Control(input="tap", action="tap the coin to collect it")],
    difficulty="fixed round length; the challenge is speed",
    rendering="dom",
    default_locale="ar",
    visual_style="deep navy background, golden coin, big rounded numbers",
    entities=["coin", "score counter", "timer"],
    tweaks=[
        TweakParameter(name="round_seconds", description="round length", value=30),
        TweakParameter(name="coin_size", description="coin diameter in px", value=72),
    ],
    ui_strings=[
        UiString(key="score", en="Score", ar="النقاط"),
        UiString(key="time", en="Time", ar="الوقت"),
        UiString(key="game_over", en="Time's up!", ar="انتهى الوقت!"),
        UiString(key="tap_to_restart", en="Tap to play again", ar="اضغط للعب مجددًا"),
    ],
)

GAME_JS = """\
window.createGame = function ({ mount, sdk }) {
  var score = 0;
  var timeLeft = sdk.tweaks.round_seconds;
  var over = false;

  var hud = document.createElement('div');
  hud.className = 'hud';
  var scoreEl = document.createElement('span');
  var timeEl = document.createElement('span');
  hud.appendChild(scoreEl);
  hud.appendChild(timeEl);

  var field = document.createElement('div');
  field.className = 'field';
  var coin = document.createElement('button');
  coin.className = 'coin';
  coin.textContent = '🪙';
  coin.style.width = coin.style.height = sdk.tweaks.coin_size + 'px';
  field.appendChild(coin);

  var banner = document.createElement('div');
  banner.className = 'banner';

  mount.appendChild(hud);
  mount.appendChild(field);
  mount.appendChild(banner);

  function renderHud() {
    scoreEl.textContent = sdk.t('score') + ': ' + sdk.formatNumber(score);
    timeEl.textContent = sdk.t('time') + ': ' + sdk.formatNumber(timeLeft);
  }

  function moveCoin() {
    coin.style.left = sdk.randInt(5, 80) + '%';
    coin.style.top = sdk.randInt(10, 75) + '%';
  }

  function endRound() {
    over = true;
    banner.textContent = sdk.t('game_over') + ' — ' + sdk.formatNumber(score) +
      ' · ' + sdk.t('tap_to_restart');
    sdk.gameOver({ score: score, won: score > 0 });
  }

  sdk.on(coin, 'pointerdown', function (event) {
    event.preventDefault();
    if (over) return;
    score += 1;
    sdk.audio.beep({ freq: 660, duration: 0.08, type: 'triangle' });
    moveCoin();
    renderHud();
  });

  sdk.on(field, 'pointerdown', function () {
    if (!over) return;
    score = 0;
    timeLeft = sdk.tweaks.round_seconds;
    over = false;
    banner.textContent = '';
    moveCoin();
    renderHud();
  });

  sdk.every(1000, function () {
    if (over) return;
    timeLeft -= 1;
    renderHud();
    if (timeLeft <= 0) endRound();
  });

  moveCoin();
  renderHud();
  sdk.ready();
  return {};
};
"""

GAME_CSS = """\
.hud {
  display: flex;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  font-size: 1.15rem;
  font-weight: 700;
  position: fixed;
  inset-block-start: 0;
  inset-inline: 0;
}
.field { position: fixed; inset: 0; }
.coin {
  position: absolute;
  border: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fde68a, #d97706);
  font-size: 2rem;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(217, 119, 6, 0.5);
}
.banner {
  position: fixed;
  inset-inline: 0;
  inset-block-end: 15%;
  text-align: center;
  font-size: 1.3rem;
  font-weight: 700;
  color: #fbbf24;
}
"""


async def main() -> None:
    container = Container(get_settings())
    await container.startup()
    try:
        code = GeneratedGameCode(game_js=GAME_JS, game_css=GAME_CSS)

        report = await container.gate.run(BLUEPRINT, code)
        if not report.passed:
            print("demo game failed the quality gate:\n" + report.feedback())
            raise SystemExit(1)

        files = container.assembler.assemble(GAME_ID, BLUEPRINT, code)
        prefix = await store_bundle(
            container.storage, game_version_prefix(GAME_ID, 1), files
        )

        if await container.games.get(GAME_ID) is None:
            version = GameVersion(
                id=new_id(),
                game_id=GAME_ID,
                version_no=1,
                parent_id=None,
                job_id=None,
                change_summary="Initial version",
                storage_prefix=prefix,
                blueprint=BLUEPRINT,
            )
            await container.games.add(
                Game(
                    id=GAME_ID,
                    title_en=BLUEPRINT.title.en,
                    title_ar=BLUEPRINT.title.ar,
                    genre=BLUEPRINT.genre.value,
                    summary=BLUEPRINT.summary,
                    default_locale=BLUEPRINT.default_locale,
                    prompt="[seed] hand-built demo: لعبة جمع العملات",
                    blueprint=BLUEPRINT,
                    template_version=container.assembler.template_version,
                    blueprint_model="seed",
                    code_model="seed",
                    storage_prefix=prefix,
                    current_version_id=version.id,
                    current_version_no=1,
                )
            )
            await container.versions.add(version)
        print(f"seeded game '{GAME_ID}' (gate passed: {report.passed})")
    finally:
        await container.shutdown()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
