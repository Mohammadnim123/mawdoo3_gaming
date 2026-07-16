"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  AudioLines,
  ExternalLink,
  Image as ImageIcon,
  MessageSquare,
  Search,
} from "lucide-react";
import type { MyAsset } from "@codply/contracts";
import {
  AssetGrid,
  AudioAssetRow,
  Button,
  Chip,
  CopyButton,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  SegmentedControl,
  Skeleton,
  assetLabel,
  cn,
  useToast,
} from "@codply/ui";
import { getServices } from "@/domain/services";
import { useI18n } from "@/components/i18n/I18nProvider";
import {
  buildLibraryParams,
  type LibraryChip,
  type LibrarySegment,
  type LibrarySource,
} from "@/domain/workspace/library";

const SEARCH_DEBOUNCE_MS = 300;

export interface LibraryViewProps {
  /** Current workspace game (null on a brand-new project). */
  gameId: string | null;
  /** Jump back to the chat (empty-state CTA). */
  onBackToChat: () => void;
  className?: string;
}

/**
 * Every asset my games generated (E14-F6): Images|Audio segments, project/all
 * source, All|Unused chips, debounced server-side search, cursor infinite
 * scroll, copy-URL / open-game actions, single shared audio element.
 */
export function LibraryView({ gameId, onBackToChat, className }: LibraryViewProps): ReactElement {
  const { t, f } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [segment, setSegment] = useState<LibrarySegment>("images");
  const [source, setSource] = useState<LibrarySource>(gameId !== null ? "project" : "all");
  const [chip, setChip] = useState<LibraryChip>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<MyAsset | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo(
    () => ({ segment, source, chip, search, gameId }),
    [segment, source, chip, search, gameId],
  );

  const assetsQuery = useInfiniteQuery({
    queryKey: ["me-assets", filters],
    queryFn: ({ pageParam }) => getServices().games.meAssets(buildLibraryParams(filters, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = assetsQuery;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const items = useMemo(
    () => assetsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [assetsQuery.data],
  );
  const byId = useMemo(() => new Map(items.map((a) => [a.id, a])), [items]);

  const copyUrl = async (asset: { url: string }): Promise<void> => {
    try {
      await navigator.clipboard.writeText(asset.url);
      toast({ title: t.workspace.library.urlCopied, variant: "success" });
    } catch {
      toast({ title: t.workspace.library.copyFailed, variant: "error" });
    }
  };
  const openGame = (asset: MyAsset): void => router.push(`/studio/${asset.game.id}`);

  const toggleAudio = (asset: MyAsset): void => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === asset.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = asset.url;
    void audio.play().catch(() => setPlayingId(null));
    setPlayingId(asset.id);
  };

  const isImages = segment === "images";

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4", className)}
      data-testid="library-view"
    >
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label={t.workspace.library.assetType}
          options={[
            { value: "images", label: t.workspace.library.images, icon: ImageIcon },
            { value: "audio", label: t.workspace.library.audio, icon: AudioLines },
          ]}
          value={segment}
          onChange={(v) => setSegment(v)}
        />
        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          {t.workspace.library.source}
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as LibrarySource)}
            className={cn(
              "h-8 rounded-xl border border-edge bg-surface-2 px-2 text-sm text-ink",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet",
            )}
            aria-label={t.workspace.library.assetSource}
          >
            <option value="project" disabled={gameId === null}>
              {t.workspace.library.thisProject}
            </option>
            <option value="all">{t.workspace.library.allMyProjects}</option>
          </select>
        </label>
        <div className="flex items-center gap-2" role="group" aria-label={t.workspace.library.usageFilter}>
          <Chip selected={chip === "all"} onClick={() => setChip("all")}>
            {t.workspace.library.all}
          </Chip>
          <Chip selected={chip === "unused"} onClick={() => setChip("unused")}>
            {t.workspace.library.unused}
          </Chip>
        </div>
      </div>

      <Input
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
        placeholder={isImages ? t.workspace.library.searchImages : t.workspace.library.searchAudio}
        aria-label={t.workspace.library.searchAssets}
        leading={<Search className="size-4" aria-hidden />}
      />

      {assetsQuery.isPending && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-2xl" />
          ))}
        </div>
      )}

      {assetsQuery.isError && (
        <EmptyState
          icon={ImageIcon}
          title={t.workspace.library.errorTitle}
          description={t.workspace.library.errorDescription}
          action={
            <Button variant="soft" onClick={() => void assetsQuery.refetch()}>
              {t.common.retry}
            </Button>
          }
        />
      )}

      {assetsQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={isImages ? ImageIcon : AudioLines}
          title={isImages ? t.workspace.library.noImagesTitle : t.workspace.library.noAudioTitle}
          description={
            isImages
              ? t.workspace.library.noImagesDescription
              : t.workspace.library.noAudioDescription
          }
          action={
            <Button
              variant="soft"
              onClick={onBackToChat}
              leftIcon={<MessageSquare className="size-4" aria-hidden />}
            >
              {t.workspace.library.backToChat}
            </Button>
          }
        />
      )}

      {items.length > 0 && isImages && (
        <AssetGrid
          assets={items}
          onPreview={(a) => setPreview(byId.get(a.id) ?? null)}
          onCopyUrl={(a) => void copyUrl(a)}
          onOpenGame={(a) => {
            const asset = byId.get(a.id);
            if (asset) openGame(asset);
          }}
          labels={{
            untitled: t.workspace.library.untitledAsset,
            preview: t.workspace.library.previewOf,
            copyUrl: t.workspace.library.copyUrlOf,
            openGame: t.workspace.library.openGameOf,
          }}
        />
      )}

      {items.length > 0 && !isImages && (
        <ul className="flex flex-col gap-2">
          {items.map((asset) => (
            <li key={asset.id}>
              <AudioAssetRow
                label={assetLabel(asset, t.workspace.library.untitledAsset)}
                playing={playingId === asset.id}
                onToggle={() => toggleAudio(asset)}
                detail={`${asset.type} · ${asset.game.title}`}
                labels={{
                  play: `${t.common.play} {label}`,
                  pause: `${t.common.pause} {label}`,
                }}
                trailing={
                  <span className="flex shrink-0 items-center gap-1">
                    <CopyButton
                      text={asset.url}
                      aria-label={f.msg(t.workspace.library.copyUrlOf, {
                        label: assetLabel(asset, t.workspace.library.untitledAsset),
                      })}
                      copiedLabel={t.common.copied}
                    />
                    <IconButton
                      icon={ExternalLink}
                      aria-label={f.msg(t.workspace.library.openGameOf, { label: asset.game.title })}
                      variant="ghost"
                      size="sm"
                      onClick={() => openGame(asset)}
                    />
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {isFetchingNextPage && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-2xl" />
          ))}
        </div>
      )}
      <div ref={sentinelRef} aria-hidden />

      {/* Large preview (image tiles). */}
      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? assetLabel(preview, t.workspace.library.untitledAsset) : t.workspace.library.preview}
        description={preview ? f.msg(t.workspace.library.fromGame, { title: preview.game.title }) : undefined}
        closeLabel={t.ui.closeDialog}
        footer={
          preview ? (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => void copyUrl(preview)}>
                {t.common.copyUrl}
              </Button>
              <Button variant="soft" onClick={() => openGame(preview)}>
                {t.common.openGame}
              </Button>
            </div>
          ) : undefined
        }
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- CDN asset preview
          <img
            src={preview.url}
            alt={assetLabel(preview, t.workspace.library.untitledAsset)}
            className="max-h-[55dvh] w-full rounded-2xl border border-edge bg-surface-2 object-contain"
          />
        )}
      </Dialog>

      <audio ref={audioRef} onEnded={() => setPlayingId(null)} className="hidden" />
    </div>
  );
}
