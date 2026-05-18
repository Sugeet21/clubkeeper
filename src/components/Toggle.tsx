interface ToggleProps {
  value: boolean
  onChange: (value: boolean) => void
  'aria-label'?: string
}

/** Accessible toggle switch. Touch target is ≥44px via py-2 padding. */
export function Toggle({ value, onChange, 'aria-label': ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      onClick={() => onChange(!value)}
      className="py-2 inline-flex items-center"
    >
      <span
        className={`relative inline-flex w-12 h-7 rounded-full transition-colors duration-200 ${
          value ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  )
}
