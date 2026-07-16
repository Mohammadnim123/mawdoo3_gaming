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


class LegalSystemPageTests(TestCase):
    """Legal reader islands + SEO/system pages (codply parity)."""

    ROBOTS_DISALLOWS = [
        "/studio",
        "/g/*/studio",
        "/create",
        "/me",
        "/dashboard",
        "/account/",
        "/notifications",
        "/login",
        "/api/",
        "/admin",  # ours alone — the Django admin is real here
    ]

    def test_robots_matches_reference_disallow_list(self):
        body = self.client.get("/robots.txt").content.decode()
        self.assertIn("User-agent: *", body)
        self.assertIn("Allow: /", body)
        for path in self.ROBOTS_DISALLOWS:
            self.assertIn(f"Disallow: {path}", body)
        self.assertIn("Sitemap: http://testserver/sitemap.xml", body)

    def test_sitemap_contains_legal_pages_with_metadata(self):
        body = self.client.get("/sitemap.xml").content.decode()
        self.assertIn("<loc>http://testserver/privacy</loc>", body)
        self.assertIn("<loc>http://testserver/terms</loc>", body)
        self.assertIn("<changefreq>yearly</changefreq>", body)
        self.assertIn("<changefreq>hourly</changefreq>", body)
        self.assertIn("<priority>0.3</priority>", body)

    def test_legal_pages_mount_island(self):
        for slug in ("privacy", "terms"):
            with self.subTest(slug=slug):
                r = self.client.get(f"/{slug}")
                self.assertEqual(r.status_code, 200)
                self.assertContains(r, 'id="legal-island"')
                self.assertContains(r, 'id="legal-island-props"')
                self.assertContains(r, f'"slug": "{slug}"')
                self.assertContains(r, "games/dist/islands/legal.js")

    def test_legal_pages_localized_titles(self):
        en = self.client.get("/privacy?lang=en")
        self.assertContains(en, "Privacy Policy")
        ar = self.client.get("/privacy?lang=ar")
        self.assertContains(ar, "سياسة الخصوصية")

    def test_404_page_renders_reference_copy(self):
        r = self.client.get("/definitely/not/a/page?lang=en")
        self.assertEqual(r.status_code, 404)
        self.assertContains(r, "404 — level not found", status_code=404)
        self.assertContains(r, "never generated in the first place", status_code=404)
        self.assertContains(r, "Explore games", status_code=404)

    def test_404_page_localizes_to_arabic(self):
        r = self.client.get("/definitely/not/a/page?lang=ar")
        self.assertEqual(r.status_code, 404)
        self.assertContains(r, "المرحلة غير موجودة", status_code=404)

    def test_500_template_renders_without_context(self):
        # Django's server_error renders 500.html with NO context — the
        # template must be standalone-safe (no context processors, no DB).
        from django.template import loader

        html = loader.get_template("500.html").render()
        self.assertIn("Something glitched", html)
        self.assertIn("fp-btn-cta", html)


class LocaleTests(TestCase):
    def test_language_toggle_sets_cookie(self):
        r = self.client.get("/?lang=en")
        self.assertEqual(r.cookies.get("fp_locale").value, "en")

    def test_rtl_default_is_arabic(self):
        r = self.client.get("/")
        self.assertContains(r, 'dir="rtl"')


class ChromeTests(TestCase):
    """Global chrome parity (codply reference TopBar/Footer/MobileTabBar)."""

    def test_topbar_slots_and_island(self):
        html = self.client.get("/?lang=en").content.decode()
        for probe in (
            'id="chrome-search"',
            'id="chrome-actions"',
            'id="chrome-actions-props"',
            'id="chrome-overlay"',
            "dist/islands/chrome.js",
        ):
            self.assertIn(probe, html)
        # H6: no server-rendered theme toggle; the old vanilla helper is gone.
        self.assertNotIn("data-theme-toggle", html)
        self.assertNotIn("games/js/chrome.js", html)

    def test_topbar_create_links_to_studio(self):
        html = self.client.get("/?lang=en").content.decode()
        self.assertIn('<a href="/studio" class="hidden md:block">', html)

    def test_logged_out_actions(self):
        html = self.client.get("/?lang=en").content.decode()
        self.assertIn('data-testid="language-toggle"', html)
        self.assertIn('href="/login"', html)
        self.assertIn('"me": null', html)

    def test_footer_reference_content(self):
        en = self.client.get("/?lang=en").content.decode()
        self.assertIn("Turning your words into little worlds you can play.", en)
        self.assertIn("Made with prompts, pixels &amp; a lot of play.", en)
        self.assertIn("© 2026 Codply.", en)
        ar = self.client.get("/?lang=ar").content.decode()
        self.assertIn("نحوّل كلماتك إلى عوالم صغيرة يمكنك لعبها.", ar)
        self.assertIn("جميع الحقوق محفوظة.", ar)

    def test_mobile_tabbar_active_state(self):
        html = self.client.get("/?lang=en").content.decode()
        self.assertIn("grid h-16 grid-cols-4", html)
        self.assertIn('<a href="/" aria-current="page"', html)

    def test_search_placeholder_has_no_ellipsis(self):
        en = self.client.get("/?lang=en").content.decode()
        self.assertIn('placeholder="Search games"', en)
        self.assertNotIn("Search games…", en)

    def test_theme_boot_uses_fp_theme_key(self):
        html = self.client.get("/").content.decode()
        self.assertIn('localStorage.getItem("fp-theme")', html)
        self.assertIn("colorScheme", html)

    def test_organization_and_website_jsonld(self):
        html = self.client.get("/").content.decode()
        self.assertIn('"@type":"Organization"', html)
        self.assertIn('"@type":"WebSite"', html)
        self.assertIn("/#organization", html)
