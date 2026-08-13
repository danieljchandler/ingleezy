import { useState, useRef, useCallback, useEffect } from 'react';
import { Move } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImagePositionEditorProps {
  imageUrl: string;
  /** Position as "x y" percentages (e.g., "50 50" for center) */
  position: string;
  /** Callback when position changes */
  onPositionChange: (position: string) => void;
}

/**
 * ImagePositionEditor - Allows dragging to set the focal point of an image
 * 
 * The user drags within the preview area to adjust which part of the image
 * is centered when displayed with object-cover.
 */
export const ImagePositionEditor = ({
  imageUrl,
  position,
  onPositionChange,
}: ImagePositionEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Parse position string to x,y values
  const [posX, posY] = position.split(' ').map(Number);
  
  const updatePosition = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    
    onPositionChange(`${Math.round(x)} ${Math.round(y)}`);
  }, [onPositionChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    updatePosition(e.clientX, e.clientY);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    updatePosition(e.clientX, e.clientY);
  }, [isDragging, updatePosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    const touch = e.touches[0];
    updatePosition(touch.clientX, touch.clientY);
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    updatePosition(touch.clientX, touch.clientY);
  }, [isDragging, updatePosition]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleTouchEnd);
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Move className="w-4 h-4" />
        <span>Drag to set image focal point</span>
      </div>
      
      {/* Preview showing how image will look in 4:3 card */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className={cn(
          "relative aspect-[4/3] w-full max-w-xs mx-auto rounded-xl overflow-hidden",
          "border-2 border-dashed cursor-crosshair select-none",
          isDragging ? "border-primary" : "border-muted-foreground/25"
        )}
      >
        <img
          src={imageUrl}
          alt="Position preview"
          className="w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: `${posX}% ${posY}%` }}
          draggable={false}
        />
        
        {/* Focal point indicator */}
        <div
          className={cn(
            "absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 pointer-events-none",
            "rounded-full border-2 border-primary bg-primary/20",
            "flex items-center justify-center",
            isDragging && "scale-110"
          )}
          style={{ left: `${posX}%`, top: `${posY}%` }}
        >
          <div className="w-2 h-2 rounded-full bg-primary" />
        </div>
        
        {/* Crosshairs */}
        <div 
          className="absolute w-full h-px bg-primary/40 pointer-events-none"
          style={{ top: `${posY}%` }}
        />
        <div 
          className="absolute h-full w-px bg-primary/40 pointer-events-none"
          style={{ left: `${posX}%` }}
        />
      </div>
      
      {/* Position display */}
      <div className="text-center text-xs text-muted-foreground">
        Position: {posX}% horizontal, {posY}% vertical
      </div>
      
      {/* Quick preset buttons */}
      <div className="flex justify-center gap-2">
        {[
          { label: 'Center', pos: '50 50' },
          { label: 'Top', pos: '50 25' },
          { label: 'Bottom', pos: '50 75' },
        ].map(({ label, pos }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPositionChange(pos)}
            className={cn(
              "px-3 py-1.5 text-xs rounded-md transition-colors",
              position === pos
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};
