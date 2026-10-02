import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { LucideProps } from "lucide-react";

/**
 * Navigation arrows that point the way the learner reads.
 *
 * The page is `dir="rtl"`, so "back" points **right** and "forward" points
 * **left**. Call sites name the *intent* — back, next, drill in — and never the
 * compass direction, so the next person to add a button cannot get it wrong by
 * copying a neighbour.
 *
 * The mirroring itself happens exactly once, in `src/index.css`: a
 * `:dir(rtl)` rule flips every lucide arrow and chevron. That rule is what
 * fixes the forty-odd raw lucide icons the app inherited in LTR terms (shadcn's
 * pagination, carousel and submenus; the admin back buttons), so it stays.
 * These wrappers therefore return the glyph an LTR page would use for the
 * intent — back = ArrowLeft, next = ArrowRight — and let that rule turn it
 * round.
 *
 * They used to return the already-mirrored glyph instead (back = ArrowRight),
 * written a day after the CSS rule without knowing it existed. The two flips
 * cancelled out, and every task row, "continue" button and onboarding arrow in
 * the app pointed backwards. `DirectionalIcon.test.tsx` now pins both halves so
 * that cannot happen silently again.
 *
 * Inside an LTR island (`.font-english`, `dir="ltr"`) the rule does not apply,
 * so these point the LTR way there — which is correct for a left-to-right run.
 *
 * NOT for the media transport. `SkipBack` / `SkipForward` and the seek buttons
 * mean earlier and later in *time*, which does not mirror — a rewind button
 * points the same way in Cairo as in Chicago.
 */

/** Back, up a level, return — the direction the learner came from. */
export const IconBack = (props: LucideProps) => <ArrowLeft {...props} />;

/** Onward: submit, continue, next question. */
export const IconNext = (props: LucideProps) => <ArrowRight {...props} />;

/** The chevron form of back, for tighter chrome. */
export const ChevronBack = (props: LucideProps) => <ChevronLeft {...props} />;

/** The chevron form of next. */
export const ChevronNext = (props: LucideProps) => <ChevronRight {...props} />;

/**
 * The chevron that sits at the end of a tappable row and means "opens".
 *
 * Same glyph as `ChevronNext`, different name on purpose: a list row is not
 * navigation through a sequence, and the two would drift apart the moment
 * anyone wanted a different affordance for one of them.
 */
export const ChevronOpen = (props: LucideProps) => <ChevronRight {...props} />;
