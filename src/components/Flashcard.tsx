import { useState } from "react";
import { VocabularyCard, type VocabularyWord } from "@/components/design-system";

interface FlashcardProps {
  word: VocabularyWord;
  gradient?: string;
}

/**
 * Flashcard - Uses VocabularyCard for consistent styling
 */
export const Flashcard = ({ word }: FlashcardProps) => {
  const [showTapHint, setShowTapHint] = useState(true);

  const handleCardClick = () => {
    setShowTapHint(false);
  };

  return (
    <VocabularyCard
      word={word}
      showTapHint={showTapHint}
      hintText="Tap to hear"
      showRepeatButton={true}
      onCardClick={handleCardClick}
    />
  );
};
