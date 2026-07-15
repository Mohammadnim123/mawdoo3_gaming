from django.urls import path

from games import views

app_name = "games"

urlpatterns = [
    path("", views.home, name="home"),
    path("generate/", views.generate, name="generate"),
    path("generations/<str:job_id>/", views.generation_status, name="generation_status"),
    path(
        "api/generations/<str:job_id>/",
        views.generation_status_data,
        name="generation_status_data",
    ),
    path("games/<str:game_id>/", views.play, name="play"),
    path("games/<str:game_id>/edit/", views.edit, name="edit"),
]
