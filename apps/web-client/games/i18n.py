"""Bilingual UI strings for the client chrome (ar default, en toggle).

Only this client's own interface is localized here — the games themselves
localize through the starter-template SDK, and game data (titles, summaries)
arrives pre-localized from the API.
"""

from __future__ import annotations

STRINGS: dict[str, dict] = {
    "ar": {
        "app_title": "ألعاب موضوع",
        "heading": "ألعاب مولّدة",
        "subheading": "اكتب فكرة لعبتك وسيبنيها الذكاء الاصطناعي — ثم العبها فورًا",
        "empty": "لا توجد ألعاب بعد — اكتب فكرة في الأعلى وأنشئ أول لعبة!",
        "service_error": "تعذّر الوصول إلى خدمة التوليد",
        "refresh": "تحديث",
        "back": "رجوع",
        "play": "العب",
        "other_lang": "English",
        "prompt_placeholder": "اكتب فكرة لعبتك… مثال: لعبة جمع العملات",
        "generate": "أنشئ اللعبة",
        "gen_failed": "فشل التوليد",
        "gen_failed_message": (
            "لم نتمكّن من بناء هذه اللعبة هذه المرة — جرّب مرة أخرى أو عدّل الفكرة قليلًا"
        ),
        "invalid_prompt": "هذه الفكرة خارج نطاق الألعاب المصغّرة التي يمكن توليدها",
        "prompt_too_short": "الفكرة قصيرة جدًا — اكتب وصفًا أطول قليلًا",
        "prompt_too_long": "الفكرة أطول من المسموح — اختصرها قليلًا",
        "validation_unavailable": "تعذّر التحقق من الفكرة الآن — حاول مرة أخرى",
        "edit_title": "عدّل اللعبة بالدردشة",
        "edit_placeholder": "مثال: اجعلها أسرع · أصعب · غيّر الألوان…",
        "send": "أرسل",
        "status_generating": "جارٍ توليد لعبتك…",
        "status_tweaking": "جارٍ تعديل لعبتك…",
        "status_hint": "تُحدَّث هذه الصفحة تلقائيًا — ستنتقل إلى اللعبة عند اكتمالها",
        "back_home": "العودة إلى القائمة",
        "back_to_game": "العودة إلى اللعبة",
        "error_title": "حدث خطأ",
        "original_prompt": "الفكرة الأصلية",
        "stages": {
            "queued": "في الانتظار",
            "understanding": "فهم الفكرة",
            "blueprint": "تصميم اللعبة",
            "code_generation": "كتابة كود اللعبة",
            "validation": "فحص الجودة",
            "packaging": "تجهيز الحزمة",
            "storage": "الحفظ",
            "done": "اكتمل",
        },
    },
    "en": {
        "app_title": "Mawdoo3 Games",
        "heading": "Generated games",
        "subheading": "Describe your game idea, the AI builds it — then play it instantly",
        "empty": "No games yet — type an idea above and generate your first one!",
        "service_error": "Could not reach the generation service",
        "refresh": "Refresh",
        "back": "Back",
        "play": "Play",
        "other_lang": "العربية",
        "prompt_placeholder": "Describe your game… e.g. Build a Snake game",
        "generate": "Generate",
        "gen_failed": "Generation failed",
        "gen_failed_message": (
            "We couldn't build this game this time — "
            "please try again or tweak the idea a little"
        ),
        "invalid_prompt": "That prompt can't be turned into a mini-game",
        "prompt_too_short": "That idea is too short — write a bit more",
        "prompt_too_long": "That idea is too long — shorten it a little",
        "validation_unavailable": "Could not check your idea right now — please try again",
        "edit_title": "Edit this game by chat",
        "edit_placeholder": "e.g. make it faster · harder · change the colors…",
        "send": "Send",
        "status_generating": "Generating your game…",
        "status_tweaking": "Updating your game…",
        "status_hint": (
            "This page updates automatically — you'll be taken to the game when it's ready"
        ),
        "back_home": "Back to the list",
        "back_to_game": "Back to the game",
        "error_title": "Something went wrong",
        "original_prompt": "Original idea",
        "stages": {
            "queued": "Queued",
            "understanding": "Understanding the idea",
            "blueprint": "Designing the game",
            "code_generation": "Writing the game code",
            "validation": "Quality gate",
            "packaging": "Packaging",
            "storage": "Storing",
            "done": "Done",
        },
    },
}


def strings(lang: str) -> dict:
    return STRINGS.get(lang, STRINGS["ar"])


def stage_label(lang: str, stage: str) -> str:
    return strings(lang)["stages"].get(stage, stage or "…")
