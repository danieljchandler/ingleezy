/**
 * Hakiya Design System Components
 * 
 * These are the official reusable UI components for the Hakiya app.
 * Use these components consistently throughout the application.
 * Do NOT introduce new visual styles - extend these components instead.
 */

// Cards
export { TopicCard, type TopicCardTopic } from './TopicCard';
export { VocabularyCard, type VocabularyWord } from './VocabularyCard';

// Layout
export { SectionFrame } from './SectionFrame';
export { SaduBanner } from './SaduBanner';
export { CaravanMedallion, type CaravanMedallionProps } from '@/components/landing/CaravanMedallion';
export { CampfireMedallion, type CampfireMedallionProps } from '@/components/landing/CampfireMedallion';
export { LoopingMedallion, type LoopingMedallionProps } from '@/components/media/LoopingMedallion';

// Typography
export { SectionHeader } from './SectionHeader';

// Loading — the shared affordance for long AI waits. Reach for this instead of
// hand-rolling another centred Loader2.
export { LoadingPanel, type LoadingPanelProps } from '@/components/loading/LoadingPanel';
export { LoadingEmblem, type LoadingEmblemProps } from '@/components/loading/LoadingEmblem';

// Re-export shadcn primitives with enforced styles
export { Button, buttonVariants } from '@/components/ui/button';
export { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
