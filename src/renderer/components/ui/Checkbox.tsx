import { CheckIcon } from '../icons/CheckIcon'

export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className="flex-shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center text-contrast"
      style={{
        borderColor: checked ? 'var(--color-primary)' : 'var(--color-text-muted)',
        backgroundColor: checked ? 'var(--color-primary)' : 'transparent',
      }}
    >
      {checked && <CheckIcon />}
    </span>
  )
}
