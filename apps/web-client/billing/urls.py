from django.urls import path

from . import views

urlpatterns = [
    path("account/billing", views.billing, name="billing"),
    path("account/billing/claim", views.claim_daily, name="claim_daily"),
    path("account/billing/checkout", views.checkout, name="checkout"),
    path("account/settings", views.settings_view, name="settings"),
    path("dashboard", views.dashboard, name="dashboard"),
]
