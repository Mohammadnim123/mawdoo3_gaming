from django.urls import path

from . import views

urlpatterns = [
    path("games/<uuid:game_id>/like", views.like, name="like"),
    path("games/<uuid:game_id>/save", views.save, name="save"),
    path("games/<uuid:game_id>/share", views.share, name="share"),
    path("games/<uuid:game_id>/comments", views.comment_add, name="comment_add"),
    path("comments/<uuid:comment_id>/delete", views.comment_delete, name="comment_delete"),
    path("users/<slug:handle>/follow", views.follow, name="follow"),
    path("notifications", views.notifications, name="notifications"),
    path("search", views.search, name="search"),
]
