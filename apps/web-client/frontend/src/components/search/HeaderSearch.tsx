"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { FeedItem } from "@codply/contracts";
import { IconButton, Input } from "@codply/ui";
import { SEARCH_MIN_LENGTH, useGameSearch } from "@/domain/hooks/useGameSearch";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SearchMenu } from "./SearchMenu";

/** Header dropdown page size — the /search page fetches a larger page itself. */
const DROPDOWN_LIMIT = 6;

/**
 * Header search entry (E-search): a desktop inline combobox with a typeahead
 * dropdown (≥sm), and a compact icon that opens the same search as a
 * full-width sheet on phones (<sm). Inserted between the wordmark and the
 * right-hand nav in the TopBar.
 */
export function HeaderSearch(): ReactElement {
  const { t } = useI18n();
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="flex flex-1 items-center justify-end sm:justify-center">
      {/* Desktop (≥sm): inline combobox with an anchored dropdown. */}
      <div className="hidden w-full max-w-md sm:block">
        <SearchCombobox variant="inline" />
      </div>
      {/* Mobile (<sm): icon opens a full-width search sheet. */}
      <IconButton
        icon={Search}
        variant="ghost"
        aria-label={t.search.open}
        onClick={() => setSheetOpen(true)}
        className="sm:hidden"
        data-testid="header-search-trigger"
      />
      {sheetOpen && <SearchSheet onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

/** Full-screen search sheet for phones — flat panel dropping from the top. */
function SearchSheet({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-50 sm:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t.search.label}
    >
      <button
        type="button"
        aria-label={t.search.close}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-canvas/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 top-0 border-b border-edge bg-canvas p-3">
        <div className="mx-auto flex w-full max-w-6xl items-start gap-2">
          <div className="min-w-0 flex-1">
            <SearchCombobox variant="sheet" autoFocus onClose={onClose} />
          </div>
          <IconButton
            icon={X}
            variant="ghost"
            aria-label={t.search.close}
            onClick={onClose}
          />
        </div>
      </div>
    </div>
  );
}

interface SearchComboboxProps {
  variant: "inline" | "sheet";
  autoFocus?: boolean;
  /** Dismiss the surrounding sheet (sheet variant); undefined for inline. */
  onClose?: () => void;
}

/**
 * The shared combobox core: input (real focus) + SearchMenu listbox (virtual
 * roving focus via `aria-activedescendant`). Owns the input value, the open
 * state, and the highlighted index. Keyboard: ArrowUp/Down move the highlight
 * (wrapping through the "see all" row), Enter opens the highlighted game (or
 * submits to /search when nothing is highlighted), Escape closes. Click-outside
 * and any route change also close it.
 */
function SearchCombobox({ variant, autoFocus, onClose }: SearchComboboxProps): ReactElement {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [raw, setRaw] = useState("");
  const [open, setOpen] = useState(variant === "sheet");
  const [activeIndex, setActiveIndex] = useState(-1);

  const { items, isLoading, isError, query } = useGameSearch(raw, DROPDOWN_LIMIT);

  const trimmed = raw.trim();
  const hasQuery = trimmed.length >= SEARCH_MIN_LENGTH;
  const showMenu = (variant === "sheet" || open) && hasQuery;
  // Loading/error surface no options; results add a trailing "see all" row.
  const optionCount = !showMenu || isLoading || isError ? 0 : items.length + 1;

  const optionId = useCallback((index: number) => `${listboxId}-opt-${index}`, [listboxId]);

  // A new debounced term (or a changed result set) drops the highlight.
  useEffect(() => {
    setActiveIndex(-1);
  }, [query, items.length]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Click-outside closes the inline dropdown (the sheet owns its own backdrop).
  useEffect(() => {
    if (variant !== "inline" || !open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [variant, open]);

  // Any navigation dismisses the search (skip the initial mount).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setOpen(false);
    setActiveIndex(-1);
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const dismiss = useCallback((): void => {
    setOpen(false);
    setActiveIndex(-1);
    onClose?.();
  }, [onClose]);

  const openGame = useCallback(
    (slug: string): void => {
      dismiss();
      router.push(`/g/${slug}`);
    },
    [dismiss, router],
  );

  const seeAll = useCallback((): void => {
    if (!hasQuery) return;
    dismiss();
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }, [dismiss, hasQuery, router, trimmed]);

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    setRaw(value);
    setActiveIndex(-1);
    if (variant === "inline") setOpen(value.trim().length >= SEARCH_MIN_LENGTH);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      if (variant === "sheet") onClose?.();
      else {
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (event.key === "Enter") {
      const highlighted =
        showMenu && activeIndex >= 0 && activeIndex < items.length ? items[activeIndex] : undefined;
      if (highlighted) {
        event.preventDefault();
        openGame(highlighted.slug);
      } else if (hasQuery) {
        event.preventDefault();
        seeAll();
      }
      return;
    }
    if (optionCount === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % optionCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i <= 0 ? optionCount - 1 : i - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(optionCount - 1);
    }
  };

  const activeDescendant =
    showMenu && activeIndex >= 0 && activeIndex < optionCount ? optionId(activeIndex) : undefined;

  const menu = showMenu ? (
    <SearchMenu
      query={query}
      items={items}
      isLoading={isLoading}
      isError={isError}
      activeIndex={activeIndex}
      listboxId={listboxId}
      optionId={optionId}
      onHoverIndex={setActiveIndex}
      onSelectItem={(game: FeedItem) => openGame(game.slug)}
      onSelectSeeAll={seeAll}
    />
  ) : null;

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showMenu}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        aria-label={t.search.label}
        placeholder={t.search.placeholder}
        value={raw}
        onChange={onChange}
        onFocus={() => {
          if (variant === "inline" && hasQuery) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        leading={<Search className="size-4" aria-hidden />}
        autoComplete="off"
        enterKeyHint="search"
        spellCheck={false}
        data-testid="header-search-input"
      />
      {menu &&
        (variant === "inline" ? (
          <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-edge bg-surface-3">
            {menu}
          </div>
        ) : (
          <div className="mt-2 overflow-hidden rounded-2xl border border-edge bg-surface-2">
            {menu}
          </div>
        ))}
    </div>
  );
}
