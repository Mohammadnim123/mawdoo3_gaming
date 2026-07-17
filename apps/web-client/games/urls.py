from django.urls import path
from django.views.generic import RedirectView

from games import views

app_name = "games"

urlpatterns = [
    path("", views.home, name="home"),
    # v0.7 reference parity: the home page IS the feed — old /feed links 301.
    path("feed", RedirectView.as_view(url="/", permanent=True, query_string=True)),
    path("create", views.create, name="create"),
    path("studio", views.studio_home, name="studio_home"),
    path("studio/<uuid:game_id>", views.studio, name="studio"),
    # Hand-typed slugs (uuid route wins for real ids; jobs/ is more specific).
    path("studio/<str:handle>", views.studio_slug, name="studio_slug"),
    path("studio/jobs/<uuid:job_ref_id>/stream", views.stream_proxy, name="stream"),
    path("studio/jobs/<uuid:job_ref_id>/status", views.job_status, name="job_status"),
    path("studio/jobs/<uuid:job_ref_id>/answers", views.job_answers, name="job_answers"),
    path("studio/jobs/<uuid:job_ref_id>/cancel", views.job_cancel, name="job_cancel"),
    path("games/<uuid:game_id>/post", views.game_post, name="post"),
    path("games/<uuid:game_id>/chat", views.game_chat, name="chat"),
    path("games/<uuid:game_id>/remix", views.game_remix, name="remix"),
    path("games/<uuid:game_id>/versions", views.game_versions, name="versions"),
    path(
        "games/<uuid:game_id>/versions/<uuid:version_id>/source",
        views.version_source,
        name="version_source",
    ),
    path("games/<uuid:game_id>/rollback", views.game_rollback, name="rollback"),
    path("g/<slug:slug>", views.game_detail, name="detail"),
    path("g/<slug:slug>/studio", views.game_studio_redirect, name="studio_redirect"),
]
