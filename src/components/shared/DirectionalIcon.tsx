import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { LucideProps } from "lucide-react";

/**
 * Navigation arrows that point the way the learner reads.
 *
 * The page is `dir="rtl"`, so "back" is to the **right** and "forward" is to
 * the **left** — the exact opposite of the icon names. Every one of these
 * inherited from Hakiya pointed the wrong way after the root flip: a back
 * button showing `ArrowLeft` was telling an Arabic reader to go forward, and a
 * "next" button showing `ChevronRight` was pointing back at what they had just
 * finished.
 *
 * Wrapping them is what keeps that decision in one place. Call sites name the
 * *intent* — back, next, drill in — and never the compass direction, so the
 * next person to add a button cannot get it wrong by copying a neighbour.
 *
 * Deliberately fixed to RTL rather than reading direction at runtime. Ingleezy
 * has exactly one UI language, `strings.ts` says so, and a `useDirection()`
 * hook would be machinery serving a case that cannot occur. If a second UI
 * language ever lands, this file is the one place that has to learn about it.
 *
 * NOT for the media transport. `SkipBack` / `SkipForward` and the seek buttons
 * mean earlier and later in *time*, which does not mirror — a rewind button
 * points the same way in Cairo as in Chicago.
 */

/** Back, up a level, return — the direction the learner came from. */
export const IconBack = (props: LucideProps) => <ArrowRight {...props} />;

/** Onward: submit, continue, next question. */
export const IconNext = (props: LucideProps) => <ArrowLeft {...props} />;

/** The chevron form of back, for tighter chrome. */
export const ChevronBack = (props: LucideProps) => <ChevronRight {...props} />;

/** The chevron form of next. */
export const ChevronNext = (props: LucideProps) => <ChevronLeft {...props} />;

/**
 * The chevron that sits at the end of a tappable row and means "opens".
 *
 * Same glyph as `ChevronNext`, different name on purpose: a list row is not
 * navigation through a sequence, and the two would drift apart the moment
 * anyone wanted a different affordance for one of them.
 */
export const ChevronOpen = (props: LucideProps) => <ChevronLeft {...props} />;
