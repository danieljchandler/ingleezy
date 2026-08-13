import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionFrameProps {
  children: ReactNode;
  className?: string;
}

/**
 * SectionFrame - Subtle hand-painted watercolor border for section containers
 * 
 * Creates an organic, imperfect border effect reminiscent of watercolor edges.
 * Use only for large section containers (topic grids, content areas).
 * Do NOT use for individual cards or buttons.
 */
export function SectionFrame({ children, className }: SectionFrameProps) {
  return (
    <div className={cn("relative", className)}>
      {/* Top edge - organic watercolor stroke */}
      <div 
        className="absolute -top-3 left-4 right-4 h-3 pointer-events-none"
        style={{
          background: `
            linear-gradient(90deg, 
              transparent 0%, 
              hsl(38 30% 50% / 0.06) 15%, 
              hsl(0 0% 20% / 0.04) 35%,
              hsl(38 35% 55% / 0.07) 55%,
              hsl(0 0% 25% / 0.03) 75%,
              transparent 100%
            )
          `,
          maskImage: `
            linear-gradient(90deg,
              transparent 0%,
              black 8%,
              black 92%,
              transparent 100%
            )
          `,
          WebkitMaskImage: `
            linear-gradient(90deg,
              transparent 0%,
              black 8%,
              black 92%,
              transparent 100%
            )
          `,
          borderRadius: "50% 50% 0 0 / 100% 100% 0 0",
          transform: "scaleY(0.5)",
        }}
      />
      
      {/* Left edge - organic watercolor stroke */}
      <div 
        className="absolute top-4 -left-3 bottom-4 w-3 pointer-events-none"
        style={{
          background: `
            linear-gradient(180deg, 
              transparent 0%, 
              hsl(0 0% 20% / 0.04) 20%, 
              hsl(38 35% 50% / 0.06) 45%,
              hsl(38 30% 55% / 0.05) 70%,
              transparent 100%
            )
          `,
          maskImage: `
            linear-gradient(180deg,
              transparent 0%,
              black 10%,
              black 90%,
              transparent 100%
            )
          `,
          WebkitMaskImage: `
            linear-gradient(180deg,
              transparent 0%,
              black 10%,
              black 90%,
              transparent 100%
            )
          `,
          borderRadius: "50% 0 0 50% / 100% 0 0 100%",
          transform: "scaleX(0.5)",
        }}
      />
      
      {/* Right edge - organic watercolor stroke */}
      <div 
        className="absolute top-4 -right-3 bottom-4 w-3 pointer-events-none"
        style={{
          background: `
            linear-gradient(180deg, 
              transparent 0%, 
              hsl(38 30% 55% / 0.05) 25%, 
              hsl(0 0% 22% / 0.04) 50%,
              hsl(38 35% 50% / 0.06) 75%,
              transparent 100%
            )
          `,
          maskImage: `
            linear-gradient(180deg,
              transparent 0%,
              black 10%,
              black 90%,
              transparent 100%
            )
          `,
          WebkitMaskImage: `
            linear-gradient(180deg,
              transparent 0%,
              black 10%,
              black 90%,
              transparent 100%
            )
          `,
          borderRadius: "0 50% 50% 0 / 0 100% 100% 0",
          transform: "scaleX(0.5)",
        }}
      />
      
      {/* Bottom edge - organic watercolor stroke */}
      <div 
        className="absolute -bottom-3 left-4 right-4 h-3 pointer-events-none"
        style={{
          background: `
            linear-gradient(90deg, 
              transparent 0%, 
              hsl(0 0% 22% / 0.04) 20%, 
              hsl(38 35% 55% / 0.06) 40%,
              hsl(38 30% 50% / 0.05) 65%,
              hsl(0 0% 20% / 0.03) 85%,
              transparent 100%
            )
          `,
          maskImage: `
            linear-gradient(90deg,
              transparent 0%,
              black 8%,
              black 92%,
              transparent 100%
            )
          `,
          WebkitMaskImage: `
            linear-gradient(90deg,
              transparent 0%,
              black 8%,
              black 92%,
              transparent 100%
            )
          `,
          borderRadius: "0 0 50% 50% / 0 0 100% 100%",
          transform: "scaleY(0.5)",
        }}
      />
      
      {/* Corner accents - soft organic touches */}
      <div 
        className="absolute -top-2 -left-2 w-6 h-6 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 100% 100%, hsl(38 30% 50% / 0.05) 0%, transparent 70%)`,
        }}
      />
      <div 
        className="absolute -top-2 -right-2 w-6 h-6 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 0% 100%, hsl(0 0% 20% / 0.04) 0%, transparent 70%)`,
        }}
      />
      <div 
        className="absolute -bottom-2 -left-2 w-6 h-6 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 100% 0%, hsl(0 0% 22% / 0.04) 0%, transparent 70%)`,
        }}
      />
      <div 
        className="absolute -bottom-2 -right-2 w-6 h-6 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 0% 0%, hsl(38 35% 55% / 0.05) 0%, transparent 70%)`,
        }}
      />
      
      {/* Content */}
      <div className="relative">
        {children}
      </div>
    </div>
  );
}
