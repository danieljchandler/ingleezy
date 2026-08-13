import { VocabularyCard, type VocabularyWord } from "@/components/design-system";

interface ReviewCardProps {
  word: VocabularyWord;
  gradient?: string;
  showAnswer: boolean;
  onReveal: () => void;
}

/**
 * ReviewCard - Uses VocabularyCard for consistent styling
 */
export const ReviewCard = ({ word, showAnswer, onReveal }: ReviewCardProps) => {
  const handleCardClick = () => {
    if (!showAnswer) {
      onReveal();
    }
  };

  return (
    <VocabularyCard
      word={word}
      showAnswer={showAnswer}
      showTapHint={!showAnswer}
      hintText="Tap to reveal"
      showRepeatButton={showAnswer}
      onCardClick={handleCardClick}
    />
  );
};
