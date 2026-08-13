import { useState, useCallback, useEffect, useRef } from "react";
import { Slider } from "@/components/ui/slider";

interface TimeRangeSelectorProps {
  duration: number; // total seconds
  maxRange?: number; // max selectable range in seconds (default 180)
  onChange: (range: [number, number]) => void;
  value?: [number, number];
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const TimeRangeSelector = ({
  duration,
  maxRange = 180,
  onChange,
  value,
}: TimeRangeSelectorProps) => {
  const effectiveMax = Math.min(duration, maxRange);
  const [range, setRange] = useState<[number, number]>(value || [0, effectiveMax]);

  const controlledStart = value?.[0];
  const controlledEnd = value?.[1];

  /**
   * Follow the caller when it revises the range.
   *
   * `useState(value || …)` read the prop once and never again. The
   * transcription screen discovers a clip's duration asynchronously and revises
   * the range after probing the media, but the slider kept whatever it was
   * mounted with — so the screen and the slider disagreed about what would be
   * processed.
   */
  useEffect(() => {
    if (controlledStart === undefined || controlledEnd === undefined) return;
    setRange((cur) =>
      cur[0] === controlledStart && cur[1] === controlledEnd ? cur : [controlledStart, controlledEnd],
    );
  }, [controlledStart, controlledEnd]);

  /**
   * Tell the caller about the range this component chose for itself.
   *
   * Picking `[0, effectiveMax]` on mount without saying so left the parent's
   * idea of the range at whatever it initialised itself with: a parent starting
   * at `[0, 0]` submitted an empty range while the screen showed three minutes
   * selected. Reported whenever the derived default changes, so a duration that
   * arrives late is reported too.
   *
   * The ref guard is what keeps this from looping — `onChange` is usually a
   * fresh function on every parent render.
   */
  const touched = useRef(false);
  const lastReported = useRef<string | null>(null);
  useEffect(() => {
    if (value || touched.current) return;
    const key = `0-${effectiveMax}`;
    if (lastReported.current === key) return;
    lastReported.current = key;
    const auto: [number, number] = [0, effectiveMax];
    setRange(auto);
    onChange(auto);
  }, [value, effectiveMax, onChange]);

  const handleChange = useCallback(
    (newValues: number[]) => {
      let [start, end] = newValues;
      
      // Enforce max range constraint
      if (end - start > maxRange) {
        // If user moved the end handle, clamp it
        if (end !== range[1]) {
          end = start + maxRange;
        } else {
          // User moved the start handle
          start = end - maxRange;
        }
      }

      // Clamp to valid bounds
      start = Math.max(0, start);
      end = Math.min(duration, end);

      const newRange: [number, number] = [start, end];
      touched.current = true;
      setRange(newRange);
      onChange(newRange);
    },
    [duration, maxRange, onChange, range]
  );

  const selectedDuration = range[1] - range[0];

  return (
    <div className="space-y-3" dir="ltr">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Select segment to process</span>
        <span className="font-mono text-xs">
          {/*
            The effective cap, not the configured one. On a forty-five-second
            clip the whole thing is already selected, and "0:45 / 3:00 max" read
            as an invitation to select two and a quarter minutes that do not
            exist.
          */}
          {formatTime(selectedDuration)} / {formatTime(effectiveMax)} max
        </span>
      </div>
      
      <Slider
        value={range}
        onValueChange={handleChange}
        min={0}
        max={duration}
        step={1}
        className="w-full"
      />

      <div className="flex justify-between text-xs font-mono text-muted-foreground">
        <span>{formatTime(range[0])}</span>
        <span className="text-foreground font-medium">
          {formatTime(range[0])} – {formatTime(range[1])}
        </span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};
