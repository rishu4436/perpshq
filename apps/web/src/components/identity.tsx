/** PerpsHQ's perspective mark: a rising path held inside four framing corners. */
export function PerspectiveMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M6 15V6h9m10 0h9v9m0 10v9h-9m-10 0H6v-9" />
      <path d="M13 27v-7h7v-7h7" />
      <circle cx="27" cy="13" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
