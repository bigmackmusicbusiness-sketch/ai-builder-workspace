// packages/ui/primitives/Tabs.tsx — Radix Tabs with token-compliant styling.
export {
  Root as TabsRoot,
  List as TabsList,
  Trigger as TabsTrigger,
  Content as TabsContent,
} from '@radix-ui/react-tabs';

// Re-export with class-name convention for clsx composability.
// Styling is applied via globals via .abw-tabs-* class names in primitives.css.
