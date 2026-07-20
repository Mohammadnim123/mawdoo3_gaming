from __future__ import annotations

from xml.sax.saxutils import escape

from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET
from games.models import Game, GameStatus, Visibility
from games.services.generation_api import GenerationApiError, get_client


@require_GET
def robots(request):
    # Mirrors the reference app/robots.ts: public content is open to ALL
    # crawlers (incl. AI/answer-engine bots); app/private surfaces are
    # disallowed. /admin is ours alone — the Django admin is real here.
    lines = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /studio",
        "Disallow: /g/*/studio",
        "Disallow: /create",
        "Disallow: /me",
        "Disallow: /dashboard",
        "Disallow: /account/",
        "Disallow: /notifications",
        "Disallow: /login",
        "Disallow: /api/",
        "Disallow: /admin",
        f"Sitemap: {request.build_absolute_uri('/sitemap.xml')}",
    ]
    return HttpResponse("\n".join(lines) + "\n", content_type="text/plain")


def _sitemap_entry(loc, lastmod=None, changefreq=None, priority=None, image=None):
    parts = [f"<loc>{escape(loc)}</loc>"]
    if lastmod:
        parts.append(f"<lastmod>{escape(lastmod)}</lastmod>")
    if changefreq:
        parts.append(f"<changefreq>{changefreq}</changefreq>")
    if priority:
        parts.append(f"<priority>{priority}</priority>")
    if image:
        parts.append(f"<image:image><image:loc>{escape(image)}</image:loc></image:image>")
    return f"<url>{''.join(parts)}</url>"


@require_GET
def sitemap(request):
    # Mirrors the reference app/sitemap.ts: home + the indexable policy pages,
    # then every PUBLIC live game (weekly / 0.8, lastmod + cover image) and
    # the creators behind them (weekly / 0.4).
    entries = [
        _sitemap_entry(request.build_absolute_uri("/"), changefreq="hourly", priority="1.0"),
        _sitemap_entry(request.build_absolute_uri("/privacy"), changefreq="yearly", priority="0.3"),
        _sitemap_entry(request.build_absolute_uri("/terms"), changefreq="yearly", priority="0.3"),
    ]
    public_live = Game.objects.filter(status=GameStatus.LIVE, visibility=Visibility.PUBLIC)
    for g in public_live[:5000]:
        image = None
        if g.cover_url:
            image = (g.cover_url if g.cover_url.startswith("http")
                     else request.build_absolute_uri(g.cover_url))
        entries.append(
            _sitemap_entry(
                request.build_absolute_uri(f"/g/{g.slug}"),
                lastmod=g.created_at.date().isoformat(),
                changefreq="weekly",
                priority="0.8",
                image=image,
            )
        )
    handles = public_live.values_list("owner__handle", flat=True).distinct()
    for h in handles:
        entries.append(
            _sitemap_entry(
                request.build_absolute_uri(f"/u/{h}"), changefreq="weekly", priority="0.4"
            )
        )
    body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
        ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        *entries,
        "</urlset>",
    ]
    return HttpResponse("\n".join(body), content_type="application/xml")


# Localized <title>/<meta description> for the legal pages — mirrors the
# reference metadata (doc.title / doc.tagline from domain/legal/documents.ts).
# The full document content lives in the React island; this is head-only copy.
LEGAL_META = {
    "privacy": {
        "en": ("Privacy Policy", "The plain-English version of what we collect and why."),
        "ar": ("سياسة الخصوصية", "شرح واضح وبسيط لِما نجمعه ولماذا."),
    },
    "terms": {
        "en": ("Terms of Service", "The deal between you and Codply — be cool, make things."),
        "ar": ("شروط الخدمة", "الاتفاق بينك وبين Codply — كن لطيفاً واصنع أشياء رائعة."),
    },
}


def _legal_page(request, slug: str):
    locale = getattr(request, "locale", "en")
    title, tagline = LEGAL_META[slug].get(locale, LEGAL_META[slug]["en"])
    return render(
        request,
        f"legal/{slug}.html",
        {
            "meta_title": title,
            "meta_description": tagline,
            "island_props": {"slug": slug},
        },
    )


@require_GET
def privacy(request):
    return _legal_page(request, "privacy")


@require_GET
def terms(request):
    return _legal_page(request, "terms")


@require_GET
def status(request):
    engine_ok = True
    try:
        get_client().list_games(limit=1)
    except GenerationApiError:
        engine_ok = False
    except Exception:
        engine_ok = False
    return render(request, "pages/status.html", {"engine_ok": engine_ok})
