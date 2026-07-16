from __future__ import annotations

from django import template

register = template.Library()


@register.filter
def loc_title(game, locale: str = "en") -> str:
    return game.title(locale)


@register.filter
def loc_summary(game, locale: str = "en") -> str:
    return game.summary(locale)
