from __future__ import annotations

from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from games.models import Game, GameStatus, Visibility
from games.services.generation_api import GenerationApiError, get_client


@require_GET
def robots(request):
    lines = [
        "User-agent: *",
        "Allow: /$",
        "Allow: /g/",
        "Allow: /u/",
        "Disallow: /studio",
        "Disallow: /create",
        "Disallow: /me",
        "Disallow: /account",
        "Disallow: /login",
        "Disallow: /admin",
        "Disallow: /search",
        f"Sitemap: {request.build_absolute_uri('/sitemap.xml')}",
    ]
    return HttpResponse("\n".join(lines) + "\n", content_type="text/plain")


@require_GET
def sitemap(request):
    urls = [request.build_absolute_uri("/")]
    for g in Game.objects.filter(status=GameStatus.LIVE, visibility=Visibility.PUBLIC)[:5000]:
        urls.append(request.build_absolute_uri(f"/g/{g.slug}"))
    handles = (
        Game.objects.filter(status=GameStatus.LIVE, visibility=Visibility.PUBLIC)
        .values_list("owner__handle", flat=True).distinct()
    )
    for h in handles:
        urls.append(request.build_absolute_uri(f"/u/{h}"))
    body = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    body += [f"<url><loc>{u}</loc></url>" for u in urls]
    body.append("</urlset>")
    return HttpResponse("\n".join(body), content_type="application/xml")


@require_GET
def privacy(request):
    return render(request, "legal/privacy.html", {})


@require_GET
def terms(request):
    return render(request, "legal/terms.html", {})


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
