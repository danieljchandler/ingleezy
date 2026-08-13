 import { useState, useRef, useEffect, useCallback } from "react";
 import { ChevronDown, ChevronUp, Eye, EyeOff, Play, Pause, Plus, BookOpen, Check, Link2, MonitorPlay } from "lucide-react";
 import { cn } from "@/lib/utils";
 import { Switch } from "@/components/ui/switch";
 import {
   Popover,
   PopoverContent,
   PopoverTrigger,
 } from "@/components/ui/popover";
 import { Button } from "@/components/ui/button";
 import type { TranscriptLine, WordToken, VocabItem } from "@/types/transcript";
import { supabase } from "@/integrations/supabase/client";
import { useDialect } from "@/contexts/DialectContext";
import { AskAISentence } from "@/components/shared/AskAISentence";
import { TranslationPair } from "@/components/shared/TranslationPair";
import { FushaLine } from "@/components/shared/FushaLine";
import { useDisplayPrefs } from "@/hooks/useDisplayPrefs";
import { useFushaLines } from "@/hooks/useFushaLines";

 interface LineByLineTranscriptProps {
   lines: TranscriptLine[];
   audioUrl?: string;
   currentTimeMs?: number;
   onAddToVocabSection?: (word: VocabItem) => void;
   onSaveToMyWords?: (word: VocabItem) => void;
   savedWords?: Set<string>;
   vocabSectionWords?: Set<string>;
 }
 
interface InlineTokenProps {
  token: WordToken;
  parentLine: TranscriptLine;
  isHighlighted?: boolean;
  isSelected?: boolean;
  onAddToVocabSection?: (word: VocabItem) => void;
  onSaveToMyWords?: (word: VocabItem) => void;
  isSavedToMyWords?: boolean;
  isInVocabSection?: boolean;
  onTokenClick?: (token: WordToken) => void;
  forceSingleOpen?: boolean;
  onForceSingleOpenChange?: (open: boolean) => void;
  // compound popover
  compoundOpen?: boolean;
  compoundGloss?: string;
  compoundMsa?: string;
  compoundLiteral?: string;
  compoundSurface?: string;
  onCompoundOpenChange?: (open: boolean) => void;
  onAddCompoundToVocab?: () => void;
  onSaveCompoundToMyWords?: () => void;
  isCompoundSavedToMyWords?: boolean;
  isCompoundInVocabSection?: boolean;
  isLoadingCompound?: boolean;
}
 
const InlineToken = ({ 
  token, 
  parentLine,
  isHighlighted, 
  isSelected,
  onAddToVocabSection,
  onSaveToMyWords,
  isSavedToMyWords,
  isInVocabSection,
  onTokenClick,
  forceSingleOpen,
  onForceSingleOpenChange,
  compoundOpen,
  compoundGloss,
  compoundMsa,
  compoundLiteral,
  compoundSurface,
  onCompoundOpenChange,
  onAddCompoundToVocab,
  onSaveCompoundToMyWords,
  isCompoundSavedToMyWords,
  isCompoundInVocabSection,
  isLoadingCompound,
}: InlineTokenProps) => {
  const { activeDialect } = useDialect();
  const [singleOpen, setSingleOpen] = useState(false);
  const [liveTranslation, setLiveTranslation] = useState<string | null>(null);
  const [liveMsa, setLiveMsa] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const hasGloss = !!token.gloss && !token.gloss.startsWith("(→") && !token.compoundRef;
  const displayGloss = hasGloss ? token.gloss : liveTranslation;
  
  // Merge forceSingleOpen from parent with local state
  const effectiveOpen = singleOpen || (forceSingleOpen ?? false);
  const setEffectiveOpen = (open: boolean) => {
    setSingleOpen(open);
    if (!open && forceSingleOpen) {
      onForceSingleOpenChange?.(false);
    }
  };
  
  const vocabItem: VocabItem = {
    arabic: token.surface,
    english: displayGloss || "",
    sentenceText: parentLine.arabic,
    sentenceEnglish: parentLine.translation,
    startMs: parentLine.startMs,
    endMs: parentLine.endMs,
  };

  const handleTranslateSingle = useCallback(async () => {
    if (isTranslating || liveTranslation) return;
    setIsTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke('translate-phrase', {
        body: {
          phrase: token.surface,
          dialect: activeDialect,
          sentenceArabic: parentLine.arabic,
          sentenceEnglish: parentLine.translation,
        },
      });
      if (!error && data?.translation) {
        setLiveTranslation(data.translation);
        if (data.msa) {
          setLiveMsa(data.msa);
        }
      }
    } catch (err) {
      console.warn('Single word translation failed:', err);
    } finally {
      setIsTranslating(false);
    }
  }, [token.surface, isTranslating, liveTranslation, activeDialect, parentLine.arabic, parentLine.translation]);

  // Auto-translate when single popover opens and no gloss
  useEffect(() => {
    if (effectiveOpen && !hasGloss && !liveTranslation && !isTranslating) {
      handleTranslateSingle();
    }
  }, [effectiveOpen, hasGloss, liveTranslation, isTranslating, handleTranslateSingle]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onTokenClick) {
      onTokenClick(token);
    } else {
      setSingleOpen(true);
    }
  };

  // If this token is the anchor for a compound popover, render that
  if (compoundOpen !== undefined) {
    return (
      <Popover open={compoundOpen} onOpenChange={onCompoundOpenChange}>
        <PopoverTrigger asChild>
          <span
            className={cn(
              "cursor-pointer transition-colors duration-150",
              "hover:text-primary hover:underline hover:decoration-primary/40 hover:underline-offset-4",
            isSelected && "bg-secondary/20 text-secondary rounded px-0.5",
              isHighlighted && "bg-primary/20 text-primary rounded px-0.5"
            )}
            role="button"
            tabIndex={0}
            onClick={handleClick}
          >
            {token.surface}
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          className="w-auto min-w-[220px] p-3 z-[100]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-3">
            <div className="text-center border-b border-border pb-2">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Link2 className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">compound phrase</span>
              </div>
              <p
                className="text-xl font-bold text-foreground mb-1"
                style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
                dir="rtl"
              >
                {compoundSurface}
              </p>
              {isLoadingCompound ? (
                <div className="flex items-center justify-center gap-2 mt-1">
                  <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <span className="text-xs text-muted-foreground">Translating…</span>
                </div>
              ) : compoundGloss ? (
                <>
                  <p className="text-sm text-muted-foreground">{compoundGloss}</p>
                  {compoundLiteral && (
                    <p className="text-xs italic text-muted-foreground/80">
                      <span className="not-italic uppercase tracking-wide text-[9px] mr-1 text-muted-foreground/60">
                        Literal
                      </span>
                      {compoundLiteral}
                    </p>
                  )}
                  {compoundMsa && (
                    <p className="text-xs text-muted-foreground/70" dir="rtl">
                      (فصحى: {compoundMsa})
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic">Could not translate</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {onAddCompoundToVocab && !isLoadingCompound && compoundGloss && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => { onAddCompoundToVocab(); onCompoundOpenChange?.(false); }}
                  disabled={isCompoundInVocabSection}
                >
                  {isCompoundInVocabSection ? <><Check className="h-4 w-4 text-primary" />In vocab section</> : <><Plus className="h-4 w-4" />Add to vocab section</>}
                </Button>
              )}
              {onSaveCompoundToMyWords && !isLoadingCompound && compoundGloss && (
                <Button
                  variant="default"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => { onSaveCompoundToMyWords(); onCompoundOpenChange?.(false); }}
                  disabled={isCompoundSavedToMyWords}
                >
                  {isCompoundSavedToMyWords ? <><Check className="h-4 w-4" />Saved to My Words</> : <><BookOpen className="h-4 w-4" />Save to My Words</>}
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Normal single-word popover
  return (
    <Popover open={effectiveOpen} onOpenChange={setEffectiveOpen}>
      <PopoverTrigger asChild>
        <span
          className={cn(
            "cursor-pointer transition-colors duration-150",
            "hover:text-primary hover:underline hover:decoration-primary/40 hover:underline-offset-4",
            "active:text-primary active:underline active:decoration-primary/60",
            isSelected && "bg-secondary/20 text-secondary rounded px-0.5",
            isHighlighted && "bg-primary/20 text-primary rounded px-0.5"
          )}
          role="button"
          tabIndex={0}
          onClick={handleClick}
        >
          {token.surface}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-auto min-w-[200px] p-3 z-[100]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          {/* Word display */}
          <div className="text-center border-b border-border pb-2">
            <p 
              className="text-xl font-bold text-foreground mb-1"
              style={{ fontFamily: "'Amiri', 'Traditional Arabic', serif" }}
              dir="rtl"
            >
              {token.surface}
            </p>
            {displayGloss && (
              <p className="text-sm text-muted-foreground">{displayGloss}</p>
            )}
            {(token.standard || liveMsa) && (
             <p className="text-xs text-muted-foreground/70" dir="rtl">
               (فصحى: {token.standard || liveMsa})
             </p>
            )}
            {!displayGloss && isTranslating && (
              <div className="flex items-center justify-center gap-2 mt-1">
                <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-xs text-muted-foreground">Translating…</span>
              </div>
            )}
            {!displayGloss && !isTranslating && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground italic">
                  No definition found
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={(e) => { e.stopPropagation(); handleTranslateSingle(); }}
                >
                  Retry translation
                </Button>
              </div>
            )}
          </div>
          
          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {onAddToVocabSection && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => {
                  onAddToVocabSection(vocabItem);
                   setEffectiveOpen(false);
                }}
                disabled={isInVocabSection}
              >
                {isInVocabSection ? (
                  <>
                    <Check className="h-4 w-4 text-primary" />
                    In vocab section
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Add to vocab section
                  </>
                )}
              </Button>
            )}
            
            {onSaveToMyWords && (
              <Button
                variant="default"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => {
                  onSaveToMyWords(vocabItem);
                  setEffectiveOpen(false);
                }}
                disabled={isSavedToMyWords}
              >
                {isSavedToMyWords ? (
                  <>
                    <Check className="h-4 w-4" />
                    Saved to My Words
                  </>
                ) : (
                  <>
                    <BookOpen className="h-4 w-4" />
                    Save to My Words
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
 
interface TranscriptLineCardProps {
   line: TranscriptLine;
   isActive: boolean;
   isPlaying: boolean;
   showTranslation: boolean;
  /** The line in Modern Standard Arabic, when the Fusha row is on and one exists. */
  fusha?: string;
   onToggle: () => void;
   onPlay: () => void;
   hasAudio: boolean;
   currentTimeMs?: number;
   onAddToVocabSection?: (word: VocabItem) => void;
   onSaveToMyWords?: (word: VocabItem) => void;
   savedWords?: Set<string>;
   vocabSectionWords?: Set<string>;
 }
 
 const TranscriptLineCard = ({
   line,
   isActive,
   isPlaying,
   showTranslation,
   fusha,
   onToggle,
   onPlay,
   hasAudio,
   currentTimeMs,
   onAddToVocabSection,
   onSaveToMyWords,
   savedWords,
   vocabSectionWords,
  }: TranscriptLineCardProps) => {
    const { activeDialect } = useDialect();
    const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
   const [compoundPopoverIdx, setCompoundPopoverIdx] = useState<number | null>(null);
   const [singlePopoverIdx, setSinglePopoverIdx] = useState<number | null>(null);
    const [liveCompound, setLiveCompound] = useState<{
      firstIdx: number;
      surface: string;
      wordCount: number;
      translation: string | null;
      msa: string | null;
      literal: string | null;
      loading: boolean;
    } | null>(null);
   const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A tap arms a 1.5s or 3s timer to clear or promote the selection, and
  // nothing cancelled it on the way out — so a reader who tapped a word and
  // navigated away left a callback setting state on a component that no longer
  // exists. Harmless in a browser, fatal under a test runner that tears the DOM
  // down between files.
  useEffect(() => {
    return () => {
      if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);
    };
  }, []);

   // Lookup compound gloss for a range [firstIdx, lastIdx] (inclusive).
   // Supports bigrams (span=1) and trigrams (span=2).
   // The backend marks compound tokens with compoundRef or legacy "(→ firstWord)" in gloss.
   const getCompoundGloss = useCallback((firstIdx: number, lastIdx: number): string | undefined => {
     if (!line.tokens) return undefined;
     const span = lastIdx - firstIdx;
     if (span < 1 || span > 2) return undefined;

     const t1 = line.tokens[firstIdx];
     const t2 = line.tokens[firstIdx + 1];
     if (!t1 || !t2) return undefined;

     const isCompound = (t: WordToken) => !!t.compoundRef || t.gloss?.startsWith("(→");

     if (span === 1) {
       if (isCompound(t2)) return t1.gloss;
       if (isCompound(t1)) return t2.gloss;
       return undefined;
     }

     // Trigram: both second and third tokens carry compound markers
     const t3 = line.tokens[firstIdx + 2];
     if (!t3) return undefined;
     if (isCompound(t2) && isCompound(t3)) return t1.gloss;
     return undefined;
   }, [line.tokens]);

   const handleTokenClick = useCallback((token: WordToken) => {
     const idx = line.tokens.findIndex(t => t.id === token.id);
     if (idx === -1) return;

     if (selectionTimerRef.current) clearTimeout(selectionTimerRef.current);

      if (selectedIndices.length === 0) {
        // First tap — select this token, close any existing popups, auto-open single popover after 1.5s if no second tap
        setCompoundPopoverIdx(null);
        setLiveCompound(null);
        setSinglePopoverIdx(null);
        setSelectedIndices([idx]);
        selectionTimerRef.current = setTimeout(() => {
          setSelectedIndices([]);
          setSinglePopoverIdx(idx);
        }, 1500);
        return;
      }

     const minSel = Math.min(...selectedIndices);
     const maxSel = Math.max(...selectedIndices);

     // Tapped the same single selected token — deselect
     if (selectedIndices.length === 1 && idx === selectedIndices[0]) {
       setSelectedIndices([]);
       return;
     }

     // Check if adjacent to current selection range
     const isAdjacentLeft = idx === minSel - 1;
     const isAdjacentRight = idx === maxSel + 1;

      if (!isAdjacentLeft && !isAdjacentRight) {
        // Not adjacent — start fresh selection
        setCompoundPopoverIdx(null);
        setLiveCompound(null);
        setSinglePopoverIdx(null);
       setSelectedIndices([idx]);
       selectionTimerRef.current = setTimeout(() => setSelectedIndices([]), 3000);
       return;
     }

     const newMin = isAdjacentLeft ? idx : minSel;
     const newMax = isAdjacentRight ? idx : maxSel;
     const newSpan = newMax - newMin; // 1 = bigram, 2 = trigram

     if (newSpan > 2) {
       // Max 3 words — start fresh
       setSelectedIndices([idx]);
       selectionTimerRef.current = setTimeout(() => setSelectedIndices([]), 3000);
       return;
     }

      // Commit the selection — always show compound popup
      const preComputedGloss = getCompoundGloss(newMin, newMax);
      setCompoundPopoverIdx(newMin);
      setSinglePopoverIdx(null);
      setSelectedIndices([]);

     if (preComputedGloss) {
       // Pre-computed compound — clear any live lookup
       setLiveCompound(null);
     } else {
       // No pre-computed compound — trigger live translation
       const combinedSurface = line.tokens
         .slice(newMin, newMax + 1)
         .map(t => t.surface)
         .join(' ');
        setLiveCompound({ firstIdx: newMin, surface: combinedSurface, wordCount: newSpan + 1, translation: null, msa: null, literal: null, loading: true });
         supabase.functions
           .invoke('translate-phrase', {
             body: {
               phrase: combinedSurface,
               dialect: activeDialect,
               sentenceArabic: line.arabic,
               sentenceEnglish: line.translation,
             },
           })
          .then(({ data, error }) => {
            if (!error && data?.translation) {
              setLiveCompound({ firstIdx: newMin, surface: combinedSurface, wordCount: newSpan + 1, translation: data.translation, msa: data.msa || null, literal: data.literal || null, loading: false });
            } else {
              console.warn('phrase translation failed:', error);
              setLiveCompound({ firstIdx: newMin, surface: combinedSurface, wordCount: newSpan + 1, translation: null, msa: null, literal: null, loading: false });
            }
          })
         .catch((err) => {
           console.warn('phrase translation error:', err);
           setLiveCompound(prev => prev ? { ...prev, loading: false } : null);
         });
     }
   }, [selectedIndices, line.tokens, getCompoundGloss]);

   const isTokenHighlighted = (_token: WordToken, _index: number): boolean => false;

   const isOverlay = line.segmentType === 'text_overlay';

   return (
     <div
       className={cn(
         "rounded-xl border p-4 transition-all duration-200",
         "hover:shadow-md",
         isOverlay
           ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50"
           : "bg-card border-border",
         isActive && !isOverlay && "ring-2 ring-primary/50 border-primary bg-primary/5",
         isActive && isOverlay && "ring-2 ring-amber-400/50"
       )}
     >
       {/* On-screen text badge */}
       {isOverlay && (
         <div className="flex items-center gap-1.5 mb-2">
           <MonitorPlay className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
           <span className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">
             On screen
           </span>
         </div>
       )}

       {/* Header row with play button */}
       <div className="flex items-start gap-3">
         {/* Play button */}
         {hasAudio && (
           <Button
             variant="ghost"
             size="icon"
             className={cn(
               "h-8 w-8 shrink-0 rounded-full transition-colors",
               isActive 
                 ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                 : "bg-muted hover:bg-muted/80"
             )}
             onClick={(e) => {
               e.stopPropagation();
               onPlay();
             }}
           >
             {isActive && isPlaying ? (
               <Pause className="h-4 w-4" />
             ) : (
               <Play className="h-4 w-4 ml-0.5" />
             )}
           </Button>
         )}
 
         {/* Arabic sentence with tokens */}
         <div
           className="flex-1 text-lg leading-loose cursor-pointer"
           dir="rtl"
           style={{ fontFamily: "'Noto Naskh Arabic', 'Traditional Arabic', serif" }}
           onClick={(e) => {
             if ((e.target as HTMLElement).closest("[data-token]")) return;
             onToggle();
           }}
         >
          {line.tokens && line.tokens.length > 0 ? (
             line.tokens.map((token, index) => {
               const isThisCompoundAnchor = compoundPopoverIdx === index;
               // Live compound data for this anchor (if a live lookup is in progress or done)
               const thisLiveCompound = isThisCompoundAnchor && liveCompound?.firstIdx === index
                 ? liveCompound
                 : null;
               // Determine compound word count: from live lookup OR from backend "(→" markers
               const compoundWordCount = isThisCompoundAnchor
                 ? (thisLiveCompound
                     ? thisLiveCompound.wordCount
                     : (() => {
                         let count = 1;
                         let next = index + 1;
                         while (
                           next < line.tokens.length &&
                           line.tokens[next]?.gloss?.startsWith("(→") &&
                           count < 3
                         ) { count++; next++; }
                         return count;
                       })())
                 : 1;
               const compoundSurface = isThisCompoundAnchor
                 ? (thisLiveCompound?.surface ?? line.tokens.slice(index, index + compoundWordCount).map(t => t.surface).join(' '))
                 : undefined;
               const compoundGloss = isThisCompoundAnchor
                 ? (thisLiveCompound
                     ? (thisLiveCompound.translation ?? undefined)
                     : getCompoundGloss(index, index + compoundWordCount - 1))
                 : undefined;
               const isLoadingCompound = isThisCompoundAnchor && !!thisLiveCompound?.loading;
               const compoundMsa = isThisCompoundAnchor ? (thisLiveCompound?.msa ?? undefined) : undefined;
               const compoundLiteral = isThisCompoundAnchor ? (thisLiveCompound?.literal ?? undefined) : undefined;

               const compoundVocabItem: VocabItem = {
                 arabic: compoundSurface || token.surface,
                 english: compoundGloss || "",
                 sentenceText: line.arabic,
                 sentenceEnglish: line.translation,
                 startMs: line.startMs,
                 endMs: line.endMs,
               };

               return (
                 <span key={token.id} data-token className="inline">
                   <InlineToken 
                     token={token}
                     parentLine={line}
                     isHighlighted={isTokenHighlighted(token, index)}
                     isSelected={selectedIndices.includes(index)}
                     onAddToVocabSection={onAddToVocabSection}
                     onSaveToMyWords={onSaveToMyWords}
                     isSavedToMyWords={savedWords?.has(token.surface)}
                     isInVocabSection={vocabSectionWords?.has(token.surface)}
                      onTokenClick={handleTokenClick}
                      forceSingleOpen={singlePopoverIdx === index}
                      onForceSingleOpenChange={(open) => { if (!open) setSinglePopoverIdx(null); }}
                      compoundOpen={isThisCompoundAnchor ? true : undefined}
                      compoundGloss={compoundGloss}
                      compoundMsa={compoundMsa}
                      compoundLiteral={compoundLiteral}
                      compoundSurface={compoundSurface}
                      isLoadingCompound={isLoadingCompound}
                     onCompoundOpenChange={(open) => {
                       if (!open) setCompoundPopoverIdx(null);
                     }}
                     onAddCompoundToVocab={onAddToVocabSection ? () => onAddToVocabSection(compoundVocabItem) : undefined}
                     onSaveCompoundToMyWords={onSaveToMyWords ? () => onSaveToMyWords(compoundVocabItem) : undefined}
                     isCompoundSavedToMyWords={compoundSurface ? savedWords?.has(compoundSurface) : false}
                     isCompoundInVocabSection={compoundSurface ? vocabSectionWords?.has(compoundSurface) : false}
                   />
                   {index < line.tokens.length - 1 &&
                     !/^[،؟.!:؛]+$/.test(token.surface) && " "}
                 </span>
               );
             })
           ) : (
             <span className="text-foreground">
               {line.arabic}
             </span>
           )}
         </div>
       </div>

      {/* Fusha (MSA) rendering — sits with the Arabic, not with the
          translation: it is the same sentence, not what the sentence means. */}
      {fusha && <FushaLine dialect={line.arabic} fusha={fusha} className="mt-2" />}

       {/* English translation (collapsible) */}
       <div
         className={cn(
           "overflow-hidden transition-all duration-200",
           showTranslation ? "max-h-64 opacity-100 mt-3" : "max-h-0 opacity-0"
         )}
       >
          <div className="pt-3 border-t border-border/50 space-y-2" style={{ fontFamily: "'Open Sans', sans-serif" }}>
            <TranslationPair
              variant="compact"
              literal={line.literal}
              natural={line.translation}
            />
            <AskAISentence
              arabic={line.arabic}
              english={line.translation}
              variant="chip"
            />
          </div>
       </div>
 
       {/* Expand indicator */}
       <div 
         className="flex justify-center mt-2 cursor-pointer"
         onClick={onToggle}
       >
         {showTranslation ? (
           <ChevronUp className="h-4 w-4 text-muted-foreground/50" />
         ) : (
           <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
         )}
       </div>

       {/* Selection hint */}
       {selectedIndices.length > 0 && (
         <p className="text-xs text-secondary/70 text-center mt-2 animate-pulse italic">
           Tap an adjacent word to see combined translation
         </p>
       )}
     </div>
   );
 };
 
export const LineByLineTranscript = ({
   lines,
   audioUrl,
   currentTimeMs,
   onAddToVocabSection,
   onSaveToMyWords,
   savedWords,
   vocabSectionWords,
 }: LineByLineTranscriptProps) => {
   const { activeDialect } = useDialect();
   // The Fusha row rides on the global "Formal Arabic (MSA)" display
   // preference, the same switch Settings and the Bible reader use — a learner
   // who asked for MSA everywhere should not have to ask again per transcript.
   const { prefs, update: updatePrefs } = useDisplayPrefs();
   const showFusha = prefs.showFormal;
   const { fushaFor, status: fushaStatus, retry: retryFusha } = useFushaLines(
     lines,
     showFusha,
     activeDialect,
   );
   const [showAllTranslations, setShowAllTranslations] = useState(false);
   const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
   const [activeLineId, setActiveLineId] = useState<string | null>(null);
   const [isPlaying, setIsPlaying] = useState(false);
  const [internalCurrentTimeMs, setInternalCurrentTimeMs] = useState<number>(0);
   const audioRef = useRef<HTMLAudioElement | null>(null);
  const lineEndListenerRef = useRef<(() => void) | null>(null);
 
   useEffect(() => {
     if (audioUrl && !audioRef.current) {
       audioRef.current = new Audio(audioUrl);
       audioRef.current.addEventListener('ended', () => { setIsPlaying(false); setActiveLineId(null); });
       audioRef.current.addEventListener('pause', () => setIsPlaying(false));
       audioRef.current.addEventListener('play', () => setIsPlaying(true));
      audioRef.current.addEventListener('timeupdate', () => {
        if (audioRef.current) setInternalCurrentTimeMs(audioRef.current.currentTime * 1000);
      });
     }
     return () => {
       if (audioRef.current) {
         if (lineEndListenerRef.current) {
           audioRef.current.removeEventListener('timeupdate', lineEndListenerRef.current);
           lineEndListenerRef.current = null;
         }
         audioRef.current.pause();
         // Detach source so the orphaned element stops decoding/playing
         audioRef.current.src = '';
         audioRef.current.load();
         audioRef.current = null;
       }
     };
   }, [audioUrl]);
 
   useEffect(() => {
     if (audioRef.current && audioUrl) audioRef.current.src = audioUrl;
   }, [audioUrl]);
 
  const effectiveCurrentTimeMs = currentTimeMs ?? internalCurrentTimeMs;

  const handlePlayLine = (line: TranscriptLine) => {
    if (!audioRef.current || !audioUrl) return;
    // Clean up any previous line-end listener
    if (lineEndListenerRef.current) {
      audioRef.current.removeEventListener('timeupdate', lineEndListenerRef.current);
      lineEndListenerRef.current = null;
    }
    if (activeLineId === line.id && isPlaying) { audioRef.current.pause(); return; }
    // Always pause and reset before starting a new line to prevent overlapping playback
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setActiveLineId(line.id);
    if (line.startMs !== undefined && line.endMs !== undefined) {
      const endSec = line.endMs / 1000;
      const onTimeUpdate = () => {
        if (!audioRef.current) return;
        if (audioRef.current.currentTime >= endSec) {
          audioRef.current.pause();
          setIsPlaying(false);
          if (lineEndListenerRef.current) {
            audioRef.current.removeEventListener('timeupdate', lineEndListenerRef.current);
          }
          lineEndListenerRef.current = null;
        }
      };
      lineEndListenerRef.current = onTimeUpdate;
      audioRef.current.addEventListener('timeupdate', onTimeUpdate);
      audioRef.current.currentTime = line.startMs / 1000;
      audioRef.current.play().catch(console.error);
    } else {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(console.error);
    }
  };
 
   const toggleLine = (lineId: string) => {
     setExpandedLines((prev) => {
       const next = new Set(prev);
       if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
       return next;
     });
   };
 
   const isLineExpanded = (lineId: string) => showAllTranslations || expandedLines.has(lineId);
 
   if (!lines || lines.length === 0) return null;
 
   return (
     <div className="space-y-4">
       <div className="flex items-center justify-between">
         <h3
           className="text-lg font-semibold text-foreground"
           style={{ fontFamily: "'Montserrat', sans-serif" }}
          >
            Sentences
         </h3>
         <div className="flex items-center gap-2">
           <span className="text-xs text-muted-foreground">Fusha</span>
           <Switch
             checked={showFusha}
             onCheckedChange={(on) => updatePrefs({ showFormal: on })}
             aria-label="Show Fusha (MSA) line"
           />
           <span className="text-xs text-muted-foreground ml-2">
             {showAllTranslations ? (
               <Eye className="h-4 w-4 inline mr-1" />
             ) : (
               <EyeOff className="h-4 w-4 inline mr-1" />
             )}
             Show all translations
           </span>
           <Switch
             checked={showAllTranslations}
             onCheckedChange={setShowAllTranslations}
             aria-label="Show all translations"
           />
         </div>
       </div>

      {showFusha && fushaStatus === "loading" && (
        <p className="text-xs text-muted-foreground text-center">
          Converting to فصحى…
        </p>
      )}
      {showFusha && fushaStatus === "error" && (
        <div className="flex items-center justify-center gap-2">
          <p className="text-xs text-muted-foreground">Couldn't convert every line to فصحى.</p>
          <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={retryFusha}>
            Retry
          </Button>
        </div>
      )}

       <div className="space-y-3">
         {lines.map((line) => (
           <TranscriptLineCard
             key={line.id}
             line={line}
             isActive={activeLineId === line.id}
             isPlaying={isPlaying && activeLineId === line.id}
             showTranslation={isLineExpanded(line.id)}
             fusha={showFusha ? fushaFor(line) : undefined}
             onToggle={() => toggleLine(line.id)}
             onPlay={() => handlePlayLine(line)}
             hasAudio={!!audioUrl}
             currentTimeMs={effectiveCurrentTimeMs}
             onAddToVocabSection={onAddToVocabSection}
             onSaveToMyWords={onSaveToMyWords}
             savedWords={savedWords}
             vocabSectionWords={vocabSectionWords}
           />
         ))}
       </div>
 
       <p className="text-xs text-muted-foreground text-center">
         {lines.length} {lines.length === 1 ? "sentence" : "sentences"}
       </p>
     </div>
   );
 };
 
 export default LineByLineTranscript;
