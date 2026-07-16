from django.urls import path

from games import views

app_name = "games"

urlpatterns = [
    path("", views.home, name="home"),
    path("create", views.create, name="create"),
    path("studio/<uuid:game_id>", views.studio, name="studio"),
    path("studio/jobs/<uuid:job_ref_id>/stream", views.stream_proxy, name="stream"),
    path("studio/jobs/<uuid:job_ref_id>/status", views.job_status, name="job_status"),
    path("games/<uuid:game_id>/post", views.game_post, name="post"),
    path("games/<uuid:game_id>/chat", views.game_chat, name="chat"),
    path("games/<uuid:game_id>/remix", views.game_remix, name="remix"),
    path("g/<slug:slug>", views.game_detail, name="detail"),
]
