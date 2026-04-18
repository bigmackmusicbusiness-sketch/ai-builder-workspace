// packages/ui/index.ts — token + primitive + pattern barrel.

// ── Tokens ────────────────────────────────────────────────────────
export * from './tokens/spacing';
export * from './tokens/color';
export * from './tokens/type';
export * from './tokens/radius';
export * from './tokens/elevation';
export * from './tokens/motion';

// ── Primitives ────────────────────────────────────────────────────
export { Button } from './primitives/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './primitives/Button';

export { Input } from './primitives/Input';
export type { InputProps } from './primitives/Input';

export { Textarea } from './primitives/Textarea';
export type { TextareaProps } from './primitives/Textarea';

export { Select } from './primitives/Select';
export type { SelectProps, SelectOption, SelectGroup } from './primitives/Select';

export { TabsRoot, TabsList, TabsTrigger, TabsContent } from './primitives/Tabs';

export { Dialog } from './primitives/Dialog';
export type { DialogProps } from './primitives/Dialog';

export { Popover } from './primitives/Popover';
export type { PopoverProps } from './primitives/Popover';

export { Tooltip, TooltipProvider } from './primitives/Tooltip';
export type { TooltipProps } from './primitives/Tooltip';

export { Menu } from './primitives/Menu';
export type { MenuProps, MenuItem } from './primitives/Menu';

export { ScrollArea } from './primitives/ScrollArea';
export type { ScrollAreaProps } from './primitives/ScrollArea';

export { Resizable, ResizablePane } from './primitives/Resizable';

export { Skeleton } from './primitives/Skeleton';
export type { SkeletonProps } from './primitives/Skeleton';

export { Banner } from './primitives/Banner';
export type { BannerProps, BannerVariant } from './primitives/Banner';

export { Badge } from './primitives/Badge';
export type { BadgeProps, BadgeVariant } from './primitives/Badge';

export { Chip } from './primitives/Chip';
export type { ChipProps } from './primitives/Chip';

export { Kbd } from './primitives/Kbd';
export type { KbdProps } from './primitives/Kbd';

// ── Patterns ──────────────────────────────────────────────────────
export { PageHeader } from './patterns/PageHeader';
export type { PageHeaderProps } from './patterns/PageHeader';

export { EmptyState } from './patterns/EmptyState';
export type { EmptyStateProps } from './patterns/EmptyState';

export { ErrorState } from './patterns/ErrorState';
export type { ErrorStateProps } from './patterns/ErrorState';

export { LoadingState } from './patterns/LoadingState';
export type { LoadingStateProps } from './patterns/LoadingState';

export { PermissionGate } from './patterns/PermissionGate';
export type { PermissionGateProps } from './patterns/PermissionGate';

export { SectionDivider } from './patterns/SectionDivider';
export type { SectionDividerProps } from './patterns/SectionDivider';
