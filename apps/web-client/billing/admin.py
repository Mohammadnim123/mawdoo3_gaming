from __future__ import annotations

from django.contrib import admin

from .models import CreatorEarning, CreditLedger, PayoutRequest, Subscription


@admin.register(CreditLedger)
class CreditLedgerAdmin(admin.ModelAdmin):
    list_display = ["user", "kind", "amount_cents", "balance_after_cents", "created_at"]
    list_filter = ["kind"]
    search_fields = ["user__handle"]
    raw_id_fields = ["user", "job"]


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "plan", "status", "period_end"]
    list_filter = ["plan", "status"]
    raw_id_fields = ["user"]


@admin.register(CreatorEarning)
class CreatorEarningAdmin(admin.ModelAdmin):
    list_display = ["user", "amount_cents", "source", "created_at"]
    raw_id_fields = ["user", "game"]


@admin.register(PayoutRequest)
class PayoutRequestAdmin(admin.ModelAdmin):
    list_display = ["user", "amount_cents", "status", "created_at", "resolved_at"]
    list_filter = ["status"]
    raw_id_fields = ["user"]
