import { useRef, useState, type KeyboardEvent } from "react";

/**
 * A one-time code typed one digit per box, the way a phone does it.
 *
 * It was a single text field with wide letter-spacing, which reads fine but
 * gives no sense of progress and swallows a pasted code awkwardly. This keeps
 * ONE real input — invisible, stretched over the boxes — so everything the
 * browser knows how to do with a code still works: the numeric keyboard,
 * one-time-code autofill from SMS/mail, paste of the whole code, backspace.
 * The boxes are purely a rendering of that input's value; the active box is
 * the one the next keystroke will fill.
 */
export function CodeInput({ length = 6, value, onChange, onEnter, disabled, autoFocus, ariaLabel }: {
  length?: number;
  value: string;
  onChange: (code: string) => void;
  onEnter?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const active = Math.min(value.length, length - 1);

  const accept = (raw: string) => onChange(raw.replace(/\D/g, "").slice(0, length));
  const keepCaretAtEnd = () => {
    const el = ref.current;
    if (el) requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && onEnter && value.length === length) { e.preventDefault(); onEnter(); }
    // Arrow keys would move the caret into the middle of the code, which the
    // boxes cannot show; the code is always edited from its end.
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") e.preventDefault();
  };

  return (
    <div className="relative" data-code-input>
      <div className="flex justify-between gap-2" aria-hidden="true">
        {digits.map((d, i) => {
          const isActive = focused && !disabled && i === active && value.length < length;
          const filled = d !== "";
          return (
            <div key={i}
              className={`flex h-14 flex-1 items-center justify-center rounded-xl border bg-ivory font-mono text-[24px] font-bold text-ink transition-colors
                ${isActive ? "border-primary bg-surface ring-2 ring-primary/20" : filled ? "border-primary/60" : "border-border"}`}>
              {d}
              {isActive && <span className="ml-0.5 inline-block h-6 w-0.5 animate-pulse bg-primary" />}
            </div>
          );
        })}
      </div>
      <input
        ref={ref}
        value={value}
        onChange={(e) => accept(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { setFocused(true); keepCaretAtEnd(); }}
        onBlur={() => setFocused(false)}
        onClick={keepCaretAtEnd}
        inputMode="numeric"
        pattern="\d*"
        autoComplete="one-time-code"
        maxLength={length}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? `${length}-digit code`}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        style={{ caretColor: "transparent" }}
      />
    </div>
  );
}
