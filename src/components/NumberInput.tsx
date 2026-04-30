"use client";

import { forwardRef, useRef, type InputHTMLAttributes, type Ref } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Optional className applied to the wrapper. Use this for layout (width,
   *  margin, etc.) when the input itself doesn't carry a width class.
   *  Defaults to `block w-full` so the input fills its parent row. */
  wrapperClassName?: string;
};

/**
 * Drop-in replacement for `<input type="number">` with custom up/down spinner
 * buttons that match the rest of the dark UI. The native chrome can't be
 * recolored cross-browser, so we hide it (in globals.css) and overlay our own
 * SVG chevron buttons. The buttons drive the input via `stepUp` / `stepDown`
 * which respect `step`, `min`, and `max`, then dispatch a native input event
 * so React's controlled-input bookkeeping picks it up.
 */
const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput(
  { className, style, wrapperClassName, disabled, readOnly, ...rest },
  ref
) {
  const localRef = useRef<HTMLInputElement | null>(null);

  const setRef = (node: HTMLInputElement | null) => {
    localRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
  };

  const step = (dir: 1 | -1) => {
    const el = localRef.current;
    if (!el || el.disabled || el.readOnly) return;
    try {
      if (dir === 1) el.stepUp();
      else el.stepDown();
    } catch {
      // step="any" with empty value can throw; fall back to manual increment.
      const cur = parseFloat(el.value || "0") || 0;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(el, String(cur + dir));
    }
    // Trigger React's onChange via the native input event.
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  return (
    <span className={`sd-number-input ${wrapperClassName ?? ""}`}>
      <input
        ref={setRef}
        type="number"
        className={className}
        style={style}
        disabled={disabled}
        readOnly={readOnly}
        {...rest}
      />
      <span className="sd-number-input__spin" aria-hidden="true">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || readOnly}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(1)}
          aria-label="Increment"
        >
          <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6">
            <polyline points="3 7.5 6 4.5 9 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || readOnly}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(-1)}
          aria-label="Decrement"
        >
          <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6">
            <polyline points="3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </span>
    </span>
  );
}) as React.ForwardRefExoticComponent<Props & { ref?: Ref<HTMLInputElement> }>;

export default NumberInput;
