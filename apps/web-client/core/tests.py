from __future__ import annotations

from django.test import TestCase


class PolishPageTests(TestCase):
    def test_robots(self):
        r = self.client.get("/robots.txt")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "text/plain")
        self.assertIn("Sitemap:", r.content.decode())

    def test_sitemap(self):
        r = self.client.get("/sitemap.xml")
        self.assertEqual(r.status_code, 200)
        self.assertIn("urlset", r.content.decode())

    def test_legal_pages(self):
        self.assertEqual(self.client.get("/privacy").status_code, 200)
        self.assertEqual(self.client.get("/terms").status_code, 200)

    def test_status_page_renders_when_engine_down(self):
        # No engine running in tests → page still renders (degraded).
        r = self.client.get("/status")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "System status")


class LocaleTests(TestCase):
    def test_language_toggle_sets_cookie(self):
        r = self.client.get("/?lang=en")
        self.assertEqual(r.cookies.get("fp_locale").value, "en")

    def test_rtl_default_is_arabic(self):
        r = self.client.get("/")
        self.assertContains(r, 'dir="rtl"')
