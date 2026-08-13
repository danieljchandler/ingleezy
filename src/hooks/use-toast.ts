/**
 * Compatibility shim — `useToast` / `toast` calls are forwarded to sonner.
 *
 * The original radix-based implementation has been removed to drop ~6 kB gz
 * from the main bundle (it was double-mounted alongside sonner). The API kept
 * here matches the subset that the codebase actually uses:
 *   toast({ title, description, variant })
 *   const { toast, dismiss } = useToast()
 */
import { toast as sonnerToast } from "sonner";

type ToastVariant = "default" | "destructive";

interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

const stringify = (node: React.ReactNode): string => {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  // For ReactNodes we just fall back to empty — sonner will use title only.
  return "";
};

function toast(input: ToastInput | string) {
  const opts: ToastInput = typeof input === "string" ? { title: input } : input;
  const title = stringify(opts.title) || " ";
  const description = stringify(opts.description) || undefined;
  const fn = opts.variant === "destructive" ? sonnerToast.error : sonnerToast;
  const id = fn(title, { description, duration: opts.duration });
  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
    update: () => {
      /* no-op: sonner toasts are immutable after creation */
    },
  };
}

function useToast() {
  return {
    toasts: [] as never[],
    toast,
    dismiss: (toastId?: string) => sonnerToast.dismiss(toastId),
  };
}

export { useToast, toast };
