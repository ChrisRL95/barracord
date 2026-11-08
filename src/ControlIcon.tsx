export type ControlIconName = 'microphone' | 'microphoneOff' | 'headphones' | 'deafen' | 'screen' | 'fullscreen' | 'settings' | 'leave' | 'sound' | 'soundOff'

export default function ControlIcon({ name }: { name: ControlIconName }) {
  const props = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (name === 'microphone') return <svg {...props}><rect x="8" y="3" width="8" height="13" rx="4" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" /></svg>
  if (name === 'microphoneOff') return <svg {...props}><path d="M8.3 8.3V12a3.7 3.7 0 0 0 6.3 2.6M16 10.2V7a4 4 0 0 0-6.8-2.8M5.5 11.5a6.5 6.5 0 0 0 10.9 4.8M12 18v3M8.5 21h7M3 3l18 18" /></svg>
  if (name === 'deafen' || name === 'headphones') return <svg {...props}><path d="M4 13a8 8 0 0 1 16 0v4a2 2 0 0 1-2 2h-2v-6h4M4 13v6h2v-6H4M8 20c.8.7 2.1 1 4 1" />{name === 'deafen' && <path d="M3 3l18 18" />}</svg>
  if (name === 'screen') return <svg {...props}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4M12 8v5M9.5 10.5 12 8l2.5 2.5" /></svg>
  if (name === 'fullscreen') return <svg {...props}><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4" /></svg>
  if (name === 'settings') return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.3 2.3-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.2v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.3-2.3.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4.7v-3.2h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L6 7.8l2.3-2.3.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h3.2v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.3 2.3-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.4 1Z" /></svg>
  if (name === 'leave') return <svg {...props}><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" /></svg>
  if (name === 'soundOff') return <svg {...props}><path d="M5 10v4h3l4 3V7l-4 3H5M3 3l18 18" /></svg>
  return <svg {...props}><path d="M5 10v4h3l4 3V7l-4 3H5ZM16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" /></svg>
}
