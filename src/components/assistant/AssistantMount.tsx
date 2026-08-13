import { lazy, Suspense, useEffect, useState } from "react";
import { useAiAssistant } from "@/contexts/AiAssistantContext";

const AskAiPanel = lazy(() =>
  import("./AskAiPanel").then((m) => ({ default: m.AskAiPanel })),
);

/**
 * Mounts the Ask AI panel lazily: the chunk (panel + tappable-text machinery)
 * is only fetched the first time the assistant is opened, and stays mounted
 * afterwards so the conversation survives closing the sheet.
 */
export function AssistantMount() {
  const { isOpen } = useAiAssistant();
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    if (isOpen) setEverOpened(true);
  }, [isOpen]);

  if (!everOpened) return null;

  return (
    <Suspense fallback={null}>
      <AskAiPanel />
    </Suspense>
  );
}
