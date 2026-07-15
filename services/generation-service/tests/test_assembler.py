from __future__ import annotations

import json
import re

from generation_service.infrastructure.packaging.assembler import (
    BUNDLE_FILES,
    StarterTemplate,
    TemplateAssembler,
)

REQUIRED_FILES = BUNDLE_FILES


def make_assembler(template_dir) -> TemplateAssembler:
    return TemplateAssembler(StarterTemplate.load(template_dir))


def test_bundle_is_complete_and_self_contained(template_dir, sample_blueprint, valid_game_code):
    assembler = make_assembler(template_dir)
    bundle = assembler.assemble("abc123", sample_blueprint, valid_game_code)

    assert set(bundle) == REQUIRED_FILES
    page = bundle["index.html"].decode()
    # No unresolved placeholders anywhere.
    assert "__" not in re.sub(r"__proto__", "", page)
    # Arabic blueprint → RTL page in Arabic.
    assert 'lang="ar"' in page and 'dir="rtl"' in page
    assert "تخمين الأرقام" in page
    # Only local, relative references — a self-contained static bundle.
    assert "http://" not in page and "https://" not in page


def test_runtime_manifest_carries_strings_and_tweaks(
    template_dir, sample_blueprint, valid_game_code
):
    assembler = make_assembler(template_dir)
    page = assembler.assemble("abc123", sample_blueprint, valid_game_code)["index.html"].decode()

    match = re.search(
        r'<script type="application/json" id="game-manifest">(.*?)</script>', page, re.S
    )
    assert match
    manifest = json.loads(match.group(1).replace("<\\/", "</"))
    assert manifest["gameId"] == "abc123"
    assert manifest["templateVersion"] == assembler.template_version
    assert manifest["defaultLocale"] == "ar"
    assert manifest["tweaks"]["max_attempts"] == 7
    assert manifest["strings"]["you_win"]["ar"] == "لقد فزت!"
    # The blueprint itself must NOT leak into the served bundle.
    assert "core_rule" not in page and "coreRule" not in page


def test_engine_is_pinned_from_template(template_dir, sample_blueprint, valid_game_code):
    assembler = make_assembler(template_dir)
    bundle = assembler.assemble("abc123", sample_blueprint, valid_game_code)
    engine = bundle["engine.js"].decode()
    assert "createGame" in engine
    assert bundle["game.js"].decode() == valid_game_code.game_js


def test_webgl3d_bundle_includes_pinned_three(template_dir, sample_blueprint, valid_game_code):
    assembler = make_assembler(template_dir)
    blueprint_3d = sample_blueprint.model_copy(update={"rendering": "webgl3d"})
    bundle = assembler.assemble("abc3d", blueprint_3d, valid_game_code)

    assert set(bundle) == REQUIRED_FILES | {"three.min.js"}
    page = bundle["index.html"].decode()
    assert '<script src="three.min.js"></script>' in page
    # three must load before the game code that uses the THREE global.
    assert page.index("three.min.js") < page.index("game.js")


def test_2d_bundle_has_no_three(template_dir, sample_blueprint, valid_game_code):
    assembler = make_assembler(template_dir)
    bundle = assembler.assemble("abc2d", sample_blueprint, valid_game_code)
    assert "three.min.js" not in bundle
    assert "three.min.js" not in bundle["index.html"].decode()


def test_hostile_manifest_strings_cannot_break_the_page(
    template_dir, sample_blueprint, valid_game_code
):
    """LLM-controlled blueprint text must survive embedding: '<!--<script'
    (the script-data double-escape opener) and literal template tokens must
    not corrupt the page or get re-substituted."""
    hostile = sample_blueprint.model_copy(
        update={
            "title": sample_blueprint.title.model_copy(
                update={"en": "__EXTRA_RUNTIME__", "ar": "<!--<script عنوان"}
            )
        }
    )
    assembler = make_assembler(template_dir)
    page = assembler.assemble("abc123", hostile, valid_game_code)["index.html"].decode()

    # No '<' survives inside the embedded JSON — the double-escape sequence is dead.
    match = re.search(
        r'<script type="application/json" id="game-manifest">(.*?)</script>', page, re.S
    )
    assert match and "<!--<script" not in match.group(1)
    manifest = json.loads(match.group(1))
    assert manifest["title"]["ar"] == "<!--<script عنوان"
    # The token literal in the title is NOT replaced by the runtime script tag.
    assert manifest["title"]["en"] == "__EXTRA_RUNTIME__"
    assert page.count('<script src="three.min.js">') == 0
