import type * as alphaTab from '@coderline/alphatab'

export type SupportedInstrument = 'guitar' | 'bass' | 'keyboard' | 'drums'

export function detectInstrument(
  track: alphaTab.model.Track | undefined,
): SupportedInstrument | null {
  if (!track) return null
  const name = track.name.toLowerCase()

  if (track.isPercussion || /drum|鼓|percus/.test(name)) return 'drums'
  if (/bass|贝斯|低音|upright/.test(name)) return 'bass'
  if (/piano|keyboard|keys|synth|键盘|钢琴/.test(name)) return 'keyboard'
  if (
    /guitar|吉他|gtr|acoustic|electric/.test(name) ||
    track.staves.some(
      (staff) => staff.showTablature && staff.stringTuning.tunings.length === 6,
    )
  ) {
    return 'guitar'
  }
  return null
}
