"""Idempotent demo seed for design/QA review: a few creators + public games
so the feed, trending rail and who-to-follow populate. Run:
    .venv/bin/python manage.py shell < seed_demo.py
"""
from django.contrib.auth import get_user_model
from django.utils import timezone

from games.models import Game, GameStatus, GameVersion, Visibility

U = get_user_model()

CREATORS = [
    ("mahmoud@demo.local", "Mahmoud Alhariri", "mahmoud", 128),
    ("lina@demo.local", "Lina Q", "lina", 74),
    ("sami@demo.local", "Sami Dev", "sami", 41),
]
users = {}
for email, name, handle, followers in CREATORS:
    u, _ = U.objects.get_or_create(email=email, defaults={"display_name": name, "handle": handle})
    u.display_name, u.handle, u.follower_count, u.email_verified = name, handle, followers, True
    u.save()
    users[handle] = u

GAMES = [
    ("mahmoud", "sugar-swap", "Sugar Swap", "تبديل الحلوى", "puzzle",
     "Swap adjacent candies to line up 3+ of the same color and clear them before your moves run out.", 320, 44),
    ("lina", "flick-to-glory", "Flick to Glory", "ركلة المجد", "arcade",
     "Flick the ball into the top corner past the keeper. Curve it around the wall for style points.", 210, 31),
    ("sami", "penalty-ace", "Penalty Ace", "بطل الجزاء", "shooter",
     "Aim, power up, and bury the penalty. Beat the keeper five times to win the shootout.", 180, 22),
    ("mahmoud", "signature-run", "SIGNATURE", "توقيع", "runner",
     "An endless neon runner — dodge lasers, grab coins, and chase your best distance.", 156, 19),
    ("lina", "flubby-bird", "Flubby Bird", "الطائر الطائش", "flappy",
     "Tap to flap through the pipes. One more try, every time.", 142, 27),
]
for handle, slug, en, ar, genre, summary, plays, likes in GAMES:
    owner = users[handle]
    g, _ = Game.objects.get_or_create(slug=slug, defaults={"owner": owner})
    g.owner = owner
    g.title_en, g.title_ar, g.genre = en, ar, genre
    g.summary_en, g.summary_ar = summary, summary
    g.status, g.visibility = GameStatus.LIVE, Visibility.PUBLIC
    g.play_count, g.like_count = plays, likes
    g.published_at = timezone.now()
    g.save()
    v, _ = GameVersion.objects.get_or_create(
        game=g, version_no=1,
        defaults={"play_url": f"http://127.0.0.1:8002/games/{slug}/index.html"},
    )
    g.current_version = v
    g.save(update_fields=["current_version"])

print(f"seeded {U.objects.count()} users, {Game.objects.filter(status='live').count()} live games")
