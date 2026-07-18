"""Mailgun HTTP-API email backend.

We were handed a Mailgun HTTP API endpoint (region-specific base URL) plus a
domain-scoped key, so rather than SMTP this backend POSTs each message to
Mailgun's ``/v3/{domain}/messages`` endpoint. Every existing ``send_mail``
call — signup verification, magic links, password resets — flows through here
unchanged; the transport is the only thing that changes.

Selected automatically in settings whenever ``MAILGUN_API_KEY`` and
``MAILGUN_DOMAIN`` are configured.
"""

from __future__ import annotations

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend


class MailgunEmailBackend(BaseEmailBackend):
    """Delivers Django ``EmailMessage`` objects via the Mailgun messages API."""

    def __init__(self, fail_silently: bool = False, **kwargs) -> None:
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.api_key = settings.MAILGUN_API_KEY
        self.domain = settings.MAILGUN_DOMAIN
        self.base_url = settings.MAILGUN_BASE_URL.rstrip("/")
        self.timeout = getattr(settings, "MAILGUN_TIMEOUT_SECONDS", 10)

    @property
    def endpoint(self) -> str:
        return f"{self.base_url}/v3/{self.domain}/messages"

    def send_messages(self, email_messages) -> int:
        if not email_messages:
            return 0
        if not (self.api_key and self.domain):
            if self.fail_silently:
                return 0
            raise ValueError(
                "Mailgun is not configured (set MAILGUN_API_KEY and MAILGUN_DOMAIN)."
            )
        return sum(1 for message in email_messages if self._send(message))

    def _send(self, message) -> bool:
        recipients = message.recipients()  # to + cc + bcc
        if not recipients:
            return False

        data = {
            "from": message.from_email,
            "to": message.to or recipients,
            "subject": message.subject,
        }
        if message.cc:
            data["cc"] = message.cc
        if message.bcc:
            data["bcc"] = message.bcc
        if message.reply_to:
            data["h:Reply-To"] = ", ".join(message.reply_to)

        # Body: a plain-text message, an HTML message, or plain text with an
        # HTML alternative (the common EmailMultiAlternatives shape).
        if message.content_subtype == "html":
            data["html"] = message.body
        else:
            data["text"] = message.body
        for content, mimetype in getattr(message, "alternatives", None) or []:
            if mimetype == "text/html":
                data["html"] = content

        try:
            response = requests.post(
                self.endpoint,
                auth=("api", self.api_key),
                data=data,
                timeout=self.timeout,
            )
            response.raise_for_status()
        except requests.RequestException:
            if self.fail_silently:
                return False
            raise
        return True
