import type { ReactElement } from "react";

/**
 * Product mark. Two sides join into one result.
 * Decorative beside a text title; the standalone file carries the name.
 */
export function Logo(): ReactElement {
  return (
    <svg className="sm-logo" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M6 6.5h6.2c3.6 0 3.8 5.2 3.8 8.3"
        stroke="var(--sm-current)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M26 6.5h-6.2c-3.6 0-3.8 5.2-3.8 8.3"
        stroke="var(--sm-incoming)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M16 14.8v10.7"
        stroke="var(--sm-accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="14.8" r="1.7" fill="var(--sm-accent)" />
    </svg>
  );
}
