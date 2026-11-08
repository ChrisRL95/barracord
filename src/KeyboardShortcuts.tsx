import { useEffect, useState } from 'react'

import { actions, backgroundAccelerator, shortcutLabel, shortcutModifiers } from './shortcutPreferences'
import type { Action, Shortcut } from './shortcutPreferences'

export default function KeyboardShortcuts({ shortcuts, onChange, backgroundAvailable, rejected }: {
  shortcuts: Shortcut[]; onChange: (shortcuts: Shortcut[]) => void; backgroundAvailable: boolean; rejected: string[]
}) {
  const [recording, setRecording] = useState<string | null>(null)
  const [error, setError] = useState('')

  function update(next: Shortcut) {
    const accelerator = backgroundAccelerator(next)
    const conflict = next.enabled && next.combo && shortcuts.some((other) => other.id !== next.id && other.enabled && (
      (other.combo?.code === next.combo?.code && other.combo?.modifiers === next.combo?.modifiers) ||
      (accelerator !== null && backgroundAccelerator(other) === accelerator)
    ))
    if (conflict) {
      setError('Esta combinação já está ativa.')
      return false
    }
    setError('')
    onChange(shortcuts.map((item) => item.id === next.id ? next : item))
    return true
  }

  useEffect(() => {
    if (!recording) return
    const capture = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat || event.isComposing || event.getModifierState('AltGraph') || !event.code || event.key === 'Unidentified' ||
        ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
      const row = shortcuts.find((item) => item.id === recording)
      if (!row) return
      const key = event.code === 'Space' ? 'Espaço' : event.code === 'CapsLock' ? 'Caps Lock' :
        event.code.startsWith('Numpad') ? `Num ${event.key.toUpperCase()}` : event.key.toUpperCase()
      const next = { ...row, enabled: row.combo === null || row.enabled, combo: { code: event.code, key, modifiers: shortcutModifiers(event) } }
      if (update(next)) setRecording(null)
    }
    window.addEventListener('keydown', capture, true)
    return () => window.removeEventListener('keydown', capture, true)
  })

  return <section className="settings-section shortcut-settings">
    <strong>Atalhos de teclado</strong>
    <p>{backgroundAvailable ? 'Os atalhos ativos funcionam em segundo plano durante a call.' : 'Nesta versão, os atalhos funcionam com o Barracord em foco.'}</p>
    {shortcuts.map((row) => <div className="shortcut-row" key={row.id}>
      <label>Ação<select value={row.action} onChange={(event) => update({ ...row, action: event.target.value as Action })}>
        {Object.entries(actions).map(([action, name]) => <option value={action} key={action}>{name}</option>)}
      </select></label>
      <div className="shortcut-binding">
        <kbd>{recording === row.id ? 'Pressione as teclas…' : row.combo ? shortcutLabel(row.combo) : 'Sem combinação'}</kbd>
        <button type="button" onClick={() => { setError(''); setRecording(recording === row.id ? null : row.id) }}>
          {recording === row.id ? 'Cancelar' : row.combo ? 'Editar atalho' : 'Gravar atalho'}
        </button>
      </div>
      <label className="shortcut-enable"><input type="checkbox" checked={row.enabled} disabled={!row.combo}
        aria-label={`Ativar atalho: ${actions[row.action]}`} onChange={(event) => update({ ...row, enabled: event.target.checked })} />Ativo</label>
      <button type="button" onClick={() => {
        if (recording === row.id) setRecording(null)
        setError('')
        onChange(shortcuts.filter((item) => item.id !== row.id))
      }}>Excluir</button>
      {backgroundAvailable && row.enabled && row.combo && !backgroundAccelerator(row) && <p className="shortcut-background">Esta tecla está disponível com o Barracord em foco.</p>}
      {row.enabled && rejected.includes(row.id) && <p className="shortcut-background" role="status">O sistema recusou a combinação. Ela está disponível com o Barracord em foco.</p>}
    </div>)}
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => {
      const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('')
      onChange([...shortcuts, { id, action: 'toggle-mic', combo: null, enabled: false }])
    }}>Adicionar atalho</button>
  </section>
}
