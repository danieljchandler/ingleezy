import { cn } from "@/lib/utils";
export interface TopicCardTopic {
  id: string;
  name: string;
  nameArabic: string;
  icon?: string;
  gradient: string;
  wordCount?: number;
}
interface TopicCardProps {
  topic: TopicCardTopic;
  onClick: () => void;
  /** Additional className */
  className?: string;
}

// Brand-aligned gradient mapping for legacy gradients
const brandGradients: Record<string, string> = {
  "from-yellow-400 to-orange-500": "bg-gradient-sand",
  "from-orange-400 to-red-500": "bg-gradient-red",
  "from-green-400 to-emerald-600": "bg-gradient-green",
  "from-blue-400 to-cyan-500": "bg-gradient-indigo",
  "from-purple-400 to-pink-500": "bg-gradient-indigo",
  "from-pink-400 to-rose-500": "bg-gradient-red",
  "from-teal-400 to-green-500": "bg-gradient-olive",
  "from-indigo-400 to-purple-500": "bg-gradient-indigo",
  "from-green-500 to-green-700": "bg-gradient-green",
  "from-emerald-500 to-emerald-700": "bg-gradient-green",
  "from-teal-500 to-teal-700": "bg-gradient-green",
  "from-yellow-500 to-yellow-700": "bg-gradient-sand",
  "from-amber-500 to-amber-700": "bg-gradient-sand",
  "from-orange-400 to-orange-600": "bg-gradient-sand",
  "from-lime-500 to-lime-700": "bg-gradient-olive",
  "from-blue-500 to-blue-700": "bg-gradient-indigo",
  "from-slate-500 to-slate-700": "bg-gradient-indigo",
  "from-gray-500 to-gray-700": "bg-gradient-charcoal",
  "from-red-500 to-red-700": "bg-gradient-red",
  "from-rose-500 to-rose-700": "bg-gradient-red",
  "from-pink-500 to-pink-700": "bg-gradient-red",
  "from-purple-500 to-purple-700": "bg-gradient-indigo",
  "from-violet-500 to-violet-700": "bg-gradient-indigo",
  "from-indigo-500 to-indigo-700": "bg-gradient-indigo"
};

// Cycle through brand gradients for topics
const brandGradientCycle = ["bg-gradient-green", "bg-gradient-sand", "bg-gradient-olive", "bg-gradient-indigo", "bg-gradient-red", "bg-gradient-charcoal"];

/**
 * TopicCard - Consistent topic selection card
 * 
 * Use this component for all topic displays across the app.
 * Features a subtle top accent stripe using the brand gradient.
 */
export const TopicCard = ({
  topic,
  onClick,
  className
}: TopicCardProps) => {
  // Try to map existing gradient to brand gradient, or use cycle based on name hash
  const getBrandGradient = () => {
    if (topic.gradient.startsWith("bg-gradient-")) {
      return topic.gradient;
    }
    const mapped = brandGradients[topic.gradient];
    if (mapped) return mapped;

    // Fallback: use consistent gradient based on topic name hash
    const hash = topic.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return brandGradientCycle[hash % brandGradientCycle.length];
  };
  const gradientClass = getBrandGradient();
  return <button onClick={onClick} aria-label={`${topic.name} — ${topic.nameArabic}`} className={cn("relative w-full aspect-[4/3] rounded-xl p-5", "flex flex-col items-center justify-center gap-2", "transform transition-all duration-200", "hover:scale-[1.02] active:scale-[0.98]", "bg-card-cream border border-desert-red/20", "shadow-topic hover:shadow-topic-hover hover:border-desert-red/40", className)}>
      {/* Gradient accent stripe at top */}
      <div className={cn("absolute top-0 left-0 right-0 h-1 rounded-t-xl border-accent", gradientClass)} />
      
      <div className="text-center">
        <p className="text-xl md:text-2xl font-bold text-foreground font-arabic leading-relaxed">
          {topic.nameArabic}
        </p>
        <p className="text-sm text-muted-foreground font-sans mt-1">
          {topic.name}
        </p>
      </div>
      
      {topic.wordCount !== undefined && <div className="absolute bottom-3 right-3 bg-muted rounded-full px-2.5 py-0.5 border border-border">
          <span className="text-xs font-semibold text-muted-foreground">
            {topic.wordCount}
          </span>
        </div>}
    </button>;
};