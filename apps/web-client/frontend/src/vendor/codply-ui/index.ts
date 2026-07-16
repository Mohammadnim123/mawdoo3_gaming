// Tokens (single source of color/type/motion — CONVENTIONS §7)
export * from "./tokens";

// Utilities
export { cn } from "./lib/cn";
export { resolveIcon } from "./lib/icons";
export { tint } from "./lib/tint";

// Primitives
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./primitives/Button";
export {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
} from "./primitives/IconButton";
export { Input, type InputProps } from "./primitives/Input";
export { Textarea, type TextareaProps } from "./primitives/Textarea";
export { Card, type CardProps } from "./primitives/Card";
export { Chip, type ChipProps } from "./primitives/Chip";
export { Badge, type BadgeProps, type BadgeTone } from "./primitives/Badge";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "./primitives/Tabs";
export type { TabsContentProps, TabsListProps, TabsProps, TabsTriggerProps } from "./primitives/Tabs";
export { Dialog, type DialogProps } from "./primitives/Dialog";
export { Tooltip, type TooltipProps } from "./primitives/Tooltip";
export { Skeleton, type SkeletonProps } from "./primitives/Skeleton";
export { Progress, type ProgressProps } from "./primitives/Progress";
export { Kbd, type KbdProps } from "./primitives/Kbd";
export { Avatar, type AvatarProps } from "./primitives/Avatar";
export { Toggle, type ToggleProps } from "./primitives/Toggle";
export {
  ToastProvider,
  useToast,
  type ToastOptions,
  type ToastProviderLabels,
  type ToastVariant,
} from "./primitives/Toast";
export { CopyButton, type CopyButtonProps } from "./primitives/CopyButton";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "./primitives/SegmentedControl";

// Composites
export { GradientText, type GradientTextProps } from "./composites/GradientText";
export { ShimmerText, type ShimmerTextProps } from "./composites/ShimmerText";
export { GenreChip, type GenreChipProps } from "./composites/GenreChip";
export { StatPill, type StatPillProps } from "./composites/StatPill";
export { GameCard, type GameCardGame, type GameCardProps } from "./composites/GameCard";
export {
  StepTimeline,
  type StepTimelineProps,
  type TimelineAsset,
  type TimelineHeal,
  type TimelineStep,
  type TimelineStepStatus,
} from "./composites/StepTimeline";
export {
  ClarifyCards,
  effectiveAnswers,
  type ClarifyCardsLabels,
  type ClarifyCardsProps,
  type ClarifyQuestion,
} from "./composites/ClarifyCards";
export { PromptComposer, type PromptComposerProps } from "./composites/PromptComposer";
export { ShareBar, type ShareBarProps } from "./composites/ShareBar";
export { VersionTree, type VersionNode, type VersionTreeProps } from "./composites/VersionTree";
export { ChatPanel, type ChatPanelMessage, type ChatPanelProps } from "./composites/ChatPanel";
export { CodePane, type CodePaneProps } from "./composites/CodePane";
export {
  ConsolePane,
  type ConsoleEntry,
  type ConsoleLevel,
  type ConsolePaneProps,
} from "./composites/ConsolePane";
export { EmptyState, type EmptyStateProps } from "./composites/EmptyState";
export {
  ActivityFeed,
  applyActivity,
  type ActivityFeedProps,
  type ActivityItemPreview,
  type ActivityItem,
  type ActivityItemStatus,
} from "./composites/ActivityFeed";
export { DiffBlock, type DiffBlockProps } from "./composites/DiffBlock";
export { ThinkingIndicator, type ThinkingIndicatorProps } from "./composites/ThinkingIndicator";
export { FileTree, type FileTreeFile, type FileTreeKind, type FileTreeProps } from "./composites/FileTree";
export { EditorTabs, type EditorTab, type EditorTabsProps } from "./composites/EditorTabs";
export {
  AssetGrid,
  AssetTile,
  assetLabel,
  type AssetGridProps,
  type AssetTileAsset,
  type AssetTileLabels,
  type AssetTileProps,
} from "./composites/AssetGrid";
export { AudioAssetRow, type AudioAssetRowProps } from "./composites/AudioAssetRow";
export { CreditBalance, type CreditBalanceProps } from "./composites/CreditBalance";
export {
  CreditLedgerList,
  formatDelta,
  type CreditLedgerListProps,
  type CreditLedgerRow,
} from "./composites/CreditLedgerList";
export { PlanMeter, type PlanMeterProps } from "./composites/PlanMeter";
export { FailureNotice, type FailureNoticeProps } from "./composites/FailureNotice";
export { Notice, type NoticeProps, type NoticeTone } from "./composites/Notice";
export { StatCard, type StatCardProps } from "./composites/StatCard";
export { PricingCard, type PricingCardProps } from "./composites/PricingCard";
