from __future__ import annotations

from django import template

register = template.Library()

_SEO_MAX = 160


@register.filter
def loc_title(game, locale: str = "en") -> str:
    return game.title(locale)


@register.filter
def loc_summary(game, locale: str = "en") -> str:
    return game.summary(locale)


@register.filter
def seo_description(text: str) -> str:
    """Reference Seo.description: 160-char cap on a word boundary + ellipsis."""
    text = (text or "").strip()
    if len(text) <= _SEO_MAX:
        return text
    cut = text[:_SEO_MAX]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip() + "…"


@register.filter
def seo_game_description(game, locale: str = "en") -> str:
    """The game meta description: the creator's caption, else the reference's
    synthesized copy — never the raw generation prompt."""
    summary = game.summary(locale)
    if summary:
        return seo_description(summary)
    by = game.owner.display_name or f"@{game.owner.handle}"
    kind = f"{game.genre} game" if game.genre else "game"
    return seo_description(
        f"Play {game.title(locale)} by {by} — a {kind} made on Codply. "
        "Play it free in your browser, then remix it into your own."
    )
