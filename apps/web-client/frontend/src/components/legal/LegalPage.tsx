"use client";

import type { ReactElement } from "react";
import { CalendarClock, ScrollText, ShieldCheck, type LucideIcon } from "lucide-react";
import { Card, cn, tint } from "@codply/ui";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  getLegalDocument,
  type LegalDocument,
  type LegalIconName,
  type LegalSlug,
} from "@/domain/legal/documents";

/** Hero-icon map — keeps the content module free of React/lucide imports. */
const HERO_ICONS: Record<LegalIconName, LucideIcon> = {
  shield: ShieldCheck,
  scroll: ScrollText,
};

/** A cheerful, rotating palette so each section card gets its own hue — the
 * house is "colorful and icon-rich", and the accent stays theme-aware. */
const SECTION_HUES = [
  "var(--color-violet)",
  "var(--color-cyan)",
  "var(--color-pink)",
  "var(--color-lime)",
  "var(--color-orange)",
  "var(--color-info)",
] as const;

function hueFor(index: number): string {
  return SECTION_HUES[index % SECTION_HUES.length]!;
}

/**
 * A reusable, cute reader for versioned legal documents. Given a slug it
 * resolves the matching document for the ACTIVE locale (useI18n) and renders:
 * a hero, a sticky in-page section-nav on wide screens, and each section as a
 * clean rounded card. FLAT (zero shadow), tokens only, logical CSS.
 */
export function LegalPage({ slug }: { slug: LegalSlug }): ReactElement {
  const { locale, f } = useI18n();
  const doc = getLegalDocument(slug, locale);
  const HeroIcon = HERO_ICONS[doc.icon];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      {/* Hero */}
      <header className="flex flex-col gap-4 border-b border-edge-subtle pb-8">
        <span
          className="flex size-14 items-center justify-center rounded-2xl border border-edge"
          style={{ backgroundColor: tint("var(--color-violet)", 12) }}
        >
          <HeroIcon className="size-7 text-violet" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="fp-title-hero font-[family-name:var(--font-space-grotesk)] font-bold">
            {doc.title}
          </h1>
          <p className="max-w-2xl text-base text-ink-secondary sm:text-lg">{doc.tagline}</p>
        </div>
        <p className="flex w-fit items-center gap-2 rounded-full border border-edge bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-muted">
          <CalendarClock className="size-3.5 text-cyan" aria-hidden />
          {f.msg(lastUpdatedTemplate(locale), { date: f.fullDate(doc.updated) })}
        </p>
      </header>

      <div className="mt-8 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        <SectionNav doc={doc} />

        <main className="flex min-w-0 flex-col gap-4">
          {doc.intro && (
            <p className="max-w-[68ch] text-pretty text-base leading-relaxed text-ink-secondary">
              {doc.intro}
            </p>
          )}
          {doc.sections.map((section, index) => {
            const hue = hueFor(index);
            return (
              <Card
                key={section.id}
                id={section.id}
                className="scroll-mt-24 flex flex-col gap-3 p-5 sm:p-6"
              >
                <h2 className="flex items-center gap-3 text-lg font-semibold text-ink">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                    style={{ backgroundColor: tint(hue, 16), color: hue }}
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">{section.heading}</span>
                </h2>
                <LegalProse body={section.body} />
              </Card>
            );
          })}
        </main>
      </div>
    </div>
  );
}

/** Sticky jump-links (wide screens only) — logical `end` border for RTL. */
function SectionNav({ doc }: { doc: LegalDocument }): ReactElement {
  return (
    <nav aria-label={doc.title} className="hidden lg:block">
      <ul className="sticky top-20 flex flex-col gap-1 border-s border-edge-subtle ps-4">
        {doc.sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={cn(
                "block rounded-lg px-2 py-1.5 text-sm text-ink-muted",
                "transition-colors duration-150 ease-out hover:bg-surface-1 hover:text-ink",
              )}
            >
              {section.heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A block of `string[]` body: "- "-prefixed lines fold into a bullet list,
 * everything else is a paragraph. Keeps the content plain data. */
function LegalProse({ body }: { body: readonly string[] }): ReactElement {
  const blocks: ({ kind: "p"; text: string } | { kind: "ul"; items: string[] })[] = [];
  for (const line of body) {
    const bullet = line.startsWith("- ");
    if (bullet) {
      const item = line.slice(2);
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(item);
      else blocks.push({ kind: "ul", items: [item] });
    } else {
      blocks.push({ kind: "p", text: line });
    }
  }

  return (
    <div className="flex max-w-[68ch] flex-col gap-3 text-[0.95rem] leading-relaxed text-ink-secondary">
      {blocks.map((block, index) =>
        block.kind === "p" ? (
          <p key={index} className="text-pretty">
            {block.text}
          </p>
        ) : (
          <ul key={index} className="flex flex-col gap-2">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex gap-2.5">
                <span
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-violet"
                  aria-hidden
                />
                <span className="min-w-0 text-pretty">{item}</span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/** "Last updated {date}" — kept out of the global catalog on purpose (this is
 * legal-content chrome), so it ships bilingually right here. */
function lastUpdatedTemplate(locale: string): string {
  return locale === "ar" ? "آخر تحديث {date}" : "Last updated {date}";
}
