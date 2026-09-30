import type { SupportedInstrument } from '../lib/instrument'
import { withBase } from '../lib/baseUrl'

interface InstrumentIconProps {
  kind: SupportedInstrument
  size?: number
}

const LABELS: Record<SupportedInstrument, string> = {
  guitar: '吉他',
  bass: '贝斯',
  keyboard: '键盘',
  drums: '鼓',
}

export default function InstrumentIcon({ kind, size = 20 }: InstrumentIconProps) {
  return (
    <img
      className="instrument-icon-image"
      src={withBase(`icons/${kind}.svg`)}
      width={size}
      height={size}
      alt={LABELS[kind]}
      title={LABELS[kind]}
      draggable={false}
    />
  )
}
