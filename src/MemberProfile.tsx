import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './MemberProfile.css'

export type ProfileAppearance = { nickColor?: string; font?: string; frame?: string; badge?: string; color?: string; effect?: string; bannerRevision?: string }
type Profile = ProfileAppearance & { avatar: string; banner: string; bio: string; color: string; revision: string }
export type ProfileTarget = { id: string; name: string }
const emptyProfile: Profile = { avatar: '', banner: '', bio: '', color: '#125361', revision: '' }
const imageUrl = (value: string) => 'data:image/jpeg;base64,' + value

export function ProfileName({ name, appearance }: { name: string; appearance?: ProfileAppearance }) {
  return <><span className="profile-nick" data-font={appearance?.font} style={{ color: appearance?.nickColor || undefined }}>{name}</span>
    {appearance?.badge && <span className="profile-badge" title={appearance.badge}>{appearance.badge}</span>}</>
}

export function ProfileAvatar({ name, className, image, frame, onClick }: { name: string; className: string; image?: string; frame?: string; onClick: () => void }) {
  return <button type="button" className={`profile-avatar-button ${className}`} data-frame={frame} title={`Perfil de ${name}`} aria-label={`Abrir perfil de ${name}`} onClick={onClick}>
    {name.slice(0, 1).toUpperCase()}
    {image && <img src={image} alt="" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} key={image} />}
  </button>
}

async function prepareImage(file: File, kind: 'avatar' | 'banner') {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('Escolha uma imagem JPG, PNG ou WebP de até 8 MB.')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = kind === 'avatar' ? 256 : 900
    canvas.height = kind === 'avatar' ? 256 : 300
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Não consegui preparar a imagem.')
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    context.fillStyle = '#1b1724'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    const limit = kind === 'avatar' ? 64 * 1024 : 240 * 1024
    for (const quality of [0.9, 0.75, 0.55]) {
      const image = canvas.toDataURL('image/jpeg', quality).split(',')[1]
      if (image.length <= Math.floor(limit / 3) * 4) return image
    }
    throw new Error('A imagem ficou muito grande. Experimente outra foto.')
  } finally { bitmap.close() }
}

function ProfileCard({ name, profile }: { name: string; profile: Profile }) {
  return <article className="member-profile-card" data-effect={profile.effect}>
    <div className="member-profile-banner" style={{ backgroundColor: profile.color }}>
      {profile.banner && <img src={imageUrl(profile.banner)} alt="" />}
    </div>
    <div className="member-profile-details">
      <div className="member-profile-photo" data-frame={profile.frame} style={{ borderColor: profile.frame ? undefined : profile.color }}>
        {profile.avatar ? <img src={imageUrl(profile.avatar)} alt="" /> : name.slice(0, 1).toUpperCase()}
      </div>
      <strong><ProfileName name={name} appearance={profile} /></strong>
      {profile.bio && <div className="member-profile-bio"><small>SOBRE MIM</small><p>{profile.bio}</p></div>}
    </div>
  </article>
}

export default function MemberProfile({ target, viewerId, url, close, saved, callAttention }: {
  target: ProfileTarget; viewerId: string; url: string; close: () => void; saved: (appearance: ProfileAppearance, revision?: string) => void; callAttention: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showActions, setShowActions] = useState(false)
  const editable = target.id === viewerId

  useEffect(() => {
    dialog.current?.showModal()
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error('Não foi possível abrir o perfil. Confira se a Barraca está aberta e atualizada.')
        const { profile } = await response.json()
        if (!controller.signal.aborted) setDraft(profile ?? emptyProfile)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Perfil indisponível.')
      }
    })()
    return () => controller.abort()
  }, [url])

  async function chooseImage(kind: 'avatar' | 'banner', file: File) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await prepareImage(file, kind)
      setDraft((current) => current && { ...current, [kind]: data })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a imagem.') }
    finally { setBusy(false) }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Não foi possível salvar o perfil.')
      setDraft(body.profile)
      const { nickColor, font, frame, badge, color, effect, banner, avatar, revision } = body.profile
      saved({ nickColor, font, frame, badge, color, effect, bannerRevision: banner ? revision : undefined }, avatar ? revision : undefined)
      setNotice('Perfil salvo.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o perfil.') }
    finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="member-profile-dialog" aria-labelledby="profile-title" onClose={close}
    onCancel={(event) => { if (busy) event.preventDefault() }}>
    <header><div><small>PERFIS DA BARRACA</small><h2 id="profile-title">{editable ? 'Meu perfil' : 'Perfil de ' + target.name}</h2></div>
      <button type="button" aria-label="Fechar perfil" disabled={busy} onClick={() => dialog.current?.close()}>×</button></header>
    <div className="member-profile-scroll">
      {error && <p className="member-profile-error" role="alert">{error}</p>}
      {!draft && !error && <p role="status">Carregando perfil…</p>}
      {draft && <div className={editable ? 'member-profile-grid' : undefined}>
        {editable && <form className="member-profile-form" onSubmit={(event) => void save(event)}>
          {(['avatar', 'banner'] as const).map((kind) => <div className="member-profile-image-field" key={kind}>
            <label>{kind === 'avatar' ? 'Foto de perfil' : 'Banner'}
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) void chooseImage(kind, file)
              }} /></label>
            {draft[kind] && <button type="button" disabled={busy} onClick={() => { setDraft({ ...draft, [kind]: '' }); setNotice('') }}>Remover {kind === 'avatar' ? 'foto' : 'banner'}</button>}
          </div>)}
          <label className="member-profile-color">Cor de destaque<input type="color" value={draft.color} disabled={busy} onChange={(event) => { setDraft({ ...draft, color: event.target.value }); setNotice('') }} /></label>
          <div className="member-profile-color">
            <label>Cor do nick<input type="color" value={draft.nickColor || '#eee7ff'} disabled={busy} onChange={(event) => { setDraft({ ...draft, nickColor: event.target.value }); setNotice('') }} /></label>
            <button type="button" disabled={busy || !draft.nickColor} onClick={() => { setDraft({ ...draft, nickColor: '' }); setNotice('') }}>Usar padrão</button>
          </div>
          {([
            ['font', 'Fonte do nick', [['rounded', 'Arredondada'], ['retro', 'Retrô'], ['mono', 'Monoespaçada']]],
            ['frame', 'Moldura do avatar', [['neon', 'Neon'], ['gold', 'Dourada'], ['holo', 'Holográfica']]],
            ['effect', 'Efeito no cartão', [['glow', 'Aura'], ['shine', 'Reflexo']]],
          ] as const).map(([field, label, options]) => <label key={field}>{label}
            <select value={draft[field] || ''} disabled={busy} onChange={(event) => { setDraft({ ...draft, [field]: event.target.value }); setNotice('') }}>
              <option value="">{field === 'font' ? 'Padrão' : 'Nenhum'}</option>
              {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select></label>)}
          <label>Selo personalizado<input type="text" maxLength={24} value={draft.badge || ''} disabled={busy} placeholder="🎧 DJ da Barraca" onChange={(event) => { setDraft({ ...draft, badge: event.target.value }); setNotice('') }} /></label>
          <label>Sobre mim<textarea value={draft.bio} maxLength={180} rows={3} disabled={busy} placeholder="Conte um pouco sobre você…" onChange={(event) => { setDraft({ ...draft, bio: event.target.value }); setNotice('') }} /></label>
          <small>{draft.bio.length}/180</small>
          <footer><span role="status">{notice}</span><button type="submit" className="member-profile-save" disabled={busy}>{busy ? 'Aguarde…' : 'Salvar perfil'}</button></footer>
        </form>}
        <div onContextMenu={(event) => {
          if (editable) return
          event.preventDefault()
          setShowActions(true)
        }}>
          {editable && <small className="member-profile-preview-label">PRÉVIA</small>}
          <ProfileCard name={target.name} profile={draft} />
          {!editable && showActions && <button type="button" className="member-profile-attention" onClick={() => {
            dialog.current?.close()
            callAttention()
          }}>Chamar atenção</button>}
        </div>
      </div>}
    </div>
  </dialog>
}
