import { ChevronLeft } from "lucide-react";
import { useSmartBack } from "../hooks/useSmartBack";

/**
 * Shared header back control — overlay-aware smart back with fallback.
 */
export default function BackButton({ fallback, className = "icon-btn", label = "Go back" }) {
  const goBack = useSmartBack(fallback);
  return (
    <button type="button" className={className} aria-label={label} onClick={() => goBack()}>
      <ChevronLeft size={22} strokeWidth={1.85} />
    </button>
  );
}
