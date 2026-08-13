import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  /** Main title - Arabic text (primary) */
  titleArabic?: string;
  /** Secondary title - English text */
  titleEnglish?: string;
  /** Simple title when no Arabic/English split needed */
  title?: string;
  /** Subtitle or description */
  subtitle?: string;
  /** Alignment */
  align?: "left" | "center" | "right";
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional className */
  className?: string;
}

/**
 * SectionHeader - Consistent section heading component
 * 
 * Use this component for all section headings across the app.
 * Follows the typography hierarchy: Arabic primary, English secondary.
 */
export const SectionHeader = ({
  titleArabic,
  titleEnglish,
  title,
  subtitle,
  align = "center",
  size = "md",
  className,
}: SectionHeaderProps) => {
  const alignmentClasses = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  };

  const sizeClasses = {
    sm: {
      arabic: "text-xl md:text-2xl",
      english: "text-sm",
      title: "text-xl md:text-2xl",
      subtitle: "text-xs",
    },
    md: {
      arabic: "text-2xl md:text-3xl",
      english: "text-base",
      title: "text-2xl md:text-3xl",
      subtitle: "text-sm",
    },
    lg: {
      arabic: "text-3xl md:text-4xl",
      english: "text-lg",
      title: "text-3xl md:text-4xl",
      subtitle: "text-base",
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div className={cn(alignmentClasses[align], className)}>
      {/* Arabic/English split layout */}
      {(titleArabic || titleEnglish) && (
        <>
          {titleArabic && (
            <h2 
              className={cn(
                "font-bold font-arabic leading-relaxed text-foreground",
                sizes.arabic
              )}
              dir="rtl"
            >
              {titleArabic}
            </h2>
          )}
          {titleEnglish && (
            <p className={cn(
              "text-muted-foreground font-sans mt-1",
              sizes.english
            )}>
              {titleEnglish}
            </p>
          )}
        </>
      )}

      {/* Simple title layout */}
      {title && !titleArabic && !titleEnglish && (
        <h2 className={cn(
          "font-bold font-heading text-foreground",
          sizes.title
        )}>
          {title}
        </h2>
      )}

      {/* Subtitle */}
      {subtitle && (
        <p className={cn(
          "text-muted-foreground font-sans mt-2",
          sizes.subtitle
        )}>
          {subtitle}
        </p>
      )}
    </div>
  );
};
