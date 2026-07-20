"use client";

import type { ReactElement } from "react";
import { ExternalLink, Link2, Maximize2 } from "lucide-react";
import { cn } from "../lib/cn";
import { IconButton } from "../primitives/IconButton";

/** Structural subset of the /me/assets item the tiles need. */
export interface AssetTileAsset {
  id: string;
  url: string;
  prompt?: string | null;
}

/** Label derived from the generation prompt (Library tiles have no title). */
export function assetLabel(asset: AssetTileAsset, untitled = "Untitled asset"): string {
  const prompt = asset.prompt?.trim();
  return prompt !== undefined && prompt !== "" ? prompt : untitled;
}

/** User-visible strings — lifted to props so apps can localize (E33).
 * aria templates interpolate `{label}`. */
export interface AssetTileLabels {
  untitled?: string;
  preview?: string;
  copyUrl?: string;
  openGame?: string;
}

export interface AssetTileProps {
  asset: AssetTileAsset;
  onPreview?: (asset: AssetTileAsset) => void;
  onCopyUrl?: (asset: AssetTileAsset) => void;
  onOpenGame?: (asset: AssetTileAsset) => void;
  labels?: AssetTileLabels;
  className?: string;
}

/**
 * Library image tile (E14-F6): thumbnail + prompt-derived label; hover/focus
 * reveals the action row (preview, copy URL, open owning game).
 */
export function AssetTile({
  asset,
  onPreview,
  onCopyUrl,
  onOpenGame,
  labels,
  className,
}: AssetTileProps): ReactElement {
  const label = assetLabel(asset, labels?.untitled);
  const fill = (template: string): string => template.replace("{label}", label);
  return (
    <figure
      className={cn("group relative flex min-w-0 flex-col gap-1.5", className)}
      data-testid={`asset-tile-${asset.id}`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-edge bg-surface-2">
        <img src={asset.url} alt={label} className="aspect-square w-full max-w-full object-cover" />
        {/* Actions surface on hover and while any action has focus. */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-canvas/70 p-1.5",
            "opacity-0 transition-opacity duration-150 ease-out",
            "group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          {onPreview && (
            <IconButton
              icon={Maximize2}
              aria-label={fill(labels?.preview ?? "Preview {label}")}
              variant="soft"
              size="sm"
              onClick={() => onPreview(asset)}
            />
          )}
          {onCopyUrl && (
            <IconButton
              icon={Link2}
              aria-label={fill(labels?.copyUrl ?? "Copy URL of {label}")}
              variant="soft"
              size="sm"
              onClick={() => onCopyUrl(asset)}
            />
          )}
          {onOpenGame && (
            <IconButton
              icon={ExternalLink}
              aria-label={fill(labels?.openGame ?? "Open game of {label}")}
              variant="soft"
              size="sm"
              onClick={() => onOpenGame(asset)}
            />
          )}
        </div>
      </div>
      <figcaption className="truncate text-xs text-ink-secondary" title={label}>
        {label}
      </figcaption>
    </figure>
  );
}

export interface AssetGridProps {
  assets: AssetTileAsset[];
  onPreview?: (asset: AssetTileAsset) => void;
  onCopyUrl?: (asset: AssetTileAsset) => void;
  onOpenGame?: (asset: AssetTileAsset) => void;
  labels?: AssetTileLabels;
  className?: string;
}

/** Responsive tile grid — 2 columns at 390px per E14-F6. */
export function AssetGrid({
  assets,
  onPreview,
  onCopyUrl,
  onOpenGame,
  labels,
  className,
}: AssetGridProps): ReactElement {
  return (
    <div
      className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", className)}
      data-testid="asset-grid"
    >
      {assets.map((asset) => (
        <AssetTile
          key={asset.id}
          asset={asset}
          onPreview={onPreview}
          onCopyUrl={onCopyUrl}
          onOpenGame={onOpenGame}
          labels={labels}
        />
      ))}
    </div>
  );
}
