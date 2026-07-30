import { useFlashOnChange } from '../hooks/useFlashOnChange'

// Wraps a live-updating numeric value so its background briefly flashes
// green (up) or red (down) when it changes, fading out over 500ms.
export default function FlashValue({ value, className = '', as: Tag = 'span', children }) {
  const flash = useFlashOnChange(value)
  const flashClass = flash ? ` score-flash-${flash}` : ''
  return <Tag className={className + flashClass}>{children}</Tag>
}
