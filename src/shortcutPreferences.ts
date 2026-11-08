export const actions = {
  'toggle-mic': 'Ativar/desativar microfone',
  'toggle-deafen': 'Silenciar tudo / voltar a ouvir',
} as const

export type Action = keyof typeof actions
type Combo = { code: string; key: string; modifiers: number }
export type Shortcut = { id: string; action: Action; combo: Combo | null; enabled: boolean }
export const shortcutsKey = 'barracord.keyboardShortcuts'

export function shortcutModifiers(event: KeyboardEvent) {
  return Number(event.ctrlKey) | (Number(event.altKey) << 1) | (Number(event.shiftKey) << 2) | (Number(event.metaKey) << 3)
}

export function shortcutLabel({ key, modifiers }: Combo) {
  return [modifiers & 1 && 'Ctrl', modifiers & 2 && 'Alt', modifiers & 4 && 'Shift', modifiers & 8 && 'Super', key].filter(Boolean).join(' + ')
}

export function backgroundAccelerator(shortcut: Shortcut, platform?: string) {
  const combo = shortcut.combo
  if (!combo) return null
  const { code, modifiers } = combo
  if (platform === 'win32' && code === 'IntlBackslash') return `IsoBackslash:${modifiers}`
  const named: Record<string, string> = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Space: 'Space', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab',
    Home: 'Home', End: 'End', Insert: 'Insert', Delete: 'Delete', PageUp: 'PageUp', PageDown: 'PageDown',
    Escape: 'Escape', CapsLock: 'Capslock', NumLock: 'Numlock', ScrollLock: 'Scrolllock', PrintScreen: 'PrintScreen',
    AudioVolumeUp: 'VolumeUp', AudioVolumeDown: 'VolumeDown', AudioVolumeMute: 'VolumeMute',
    MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop', MediaPlayPause: 'MediaPlayPause',
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  }
  const key = /^Key[A-Z]$|^Digit[0-9]$/.test(code) ? code.slice(-1) :
    /^Numpad[0-9]$/.test(code) ? `num${code.slice(-1)}` : /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code) ? code :
      named[code] ?? (combo.key === '+' ? 'Plus' : /^[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]$/.test(combo.key) ? combo.key : null)
  if (!key) return null
  return [modifiers & 1 && 'Ctrl', modifiers & 2 && 'Alt', modifiers & 4 && 'Shift', modifiers & 8 && 'Super', key].filter(Boolean).join('+')
}

export function loadShortcuts(): Shortcut[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(shortcutsKey) ?? 'null')
    if (!Array.isArray(saved)) return []
    return saved.filter((item): item is Shortcut =>
      item && typeof item.id === 'string' && Object.hasOwn(actions, item.action) && typeof item.enabled === 'boolean' &&
      (item.combo === null || (typeof item.combo?.code === 'string' && typeof item.combo.key === 'string' &&
        Number.isInteger(item.combo.modifiers) && item.combo.modifiers >= 0 && item.combo.modifiers <= 15)))
  } catch { return [] }
}
