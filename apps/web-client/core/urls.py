from django.urls import path

from . import views

urlpatterns = [
    path("robots.txt", views.robots, name="robots"),
    path("sitemap.xml", views.sitemap, name="sitemap"),
    path("status", views.status, name="status"),
    path("privacy", views.privacy, name="privacy"),
    path("terms", views.terms, name="terms"),
]
