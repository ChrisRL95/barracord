import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import SoundboardIcon from './SoundboardIcon'
import ControlIcon from './ControlIcon'

export type VoicePerson = { identity: string; name: string; joining?: boolean; muted?: boolean; deafened?: boolean; sharing?: boolean }

type Props = {
  channelName: string
  people: VoicePerson[]
  selfIdentity: string
  speakingIdentities: string[]
  soundboardIdentity: string | null
  renderAvatar: (person: VoicePerson) => ReactNode
}

const leaveAnimationMs = 180
const byName = new Intl.Collator('pt-BR', { sensitivity: 'base' })

type ShownPerson = VoicePerson & { leaving?: boolean }

// Keeps people who just left on screen for a short fade-out, so the list
// slides instead of jumping when someone enters or leaves the channel.
function useLeavingPeople(people: VoicePerson[]): ShownPerson[] {
  const [leaving, setLeaving] = useState<ShownPerson[]>([])
  const previousRef = useRef<VoicePerson[]>(people)
  const timersRef = useRef(new Map<string, number>())

  useEffect(() => {
    const current = new Set(people.map((person) => person.identity))
    const gone = previousRef.current.filter((person) => !current.has(person.identity))
    previousRef.current = people
    const timers = timersRef.current
    // Someone who came back must not stay in the fade-out list.
    people.forEach((person) => {
      const timer = timers.get(person.identity)
      if (timer !== undefined) { window.clearTimeout(timer); timers.delete(person.identity) }
    })
    setLeaving((list) => {
      const kept = list.filter((person) => !current.has(person.identity))
      const added = gone.filter((person) => !kept.some((item) => item.identity === person.identity)).map((person) => ({ ...person, leaving: true }))
      return added.length || kept.length !== list.length ? [...kept, ...added] : list
    })
    gone.forEach((person) => {
      timers.set(person.identity, window.setTimeout(() => {
        timers.delete(person.identity)
        setLeaving((list) => list.filter((item) => item.identity !== person.identity))
      }, leaveAnimationMs))
    })
  }, [people])

  useEffect(() => {
    const timers = timersRef.current
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const current = new Set(people.map((person) => person.identity))
  return [...people, ...leaving.filter((person) => !current.has(person.identity))]
    .sort((a, b) => byName.compare(a.name, b.name) || byName.compare(a.identity, b.identity))
}

export default function VoiceChannelMembers({ channelName, people, selfIdentity, speakingIdentities, soundboardIdentity, renderAvatar }: Props) {
  const shown = useLeavingPeople(people)
  if (!shown.length) return null
  return <div className="voice-channel-members" aria-label={`Pessoas em ${channelName}`}>{shown.map((person) => {
    const self = person.identity === selfIdentity
    const speaking = !person.leaving && speakingIdentities.includes(person.identity)
    const playingSound = !person.leaving && person.identity === soundboardIdentity
    const classes = ['voice-channel-member', self && 'self', speaking && 'speaking', person.joining && 'joining', person.leaving && 'leaving'].filter(Boolean).join(' ')
    // Silenciar tudo já desliga o microfone, então só o fone aparece.
    const micMuted = person.muted && !person.deafened
    const status = [speaking && 'falando', playingSound && 'tocando Soundboard', person.joining && 'entrando', person.sharing && 'transmitindo a tela', micMuted && 'microfone mutado', person.deafened && 'áudio silenciado'].filter(Boolean)
    return <div className={classes} key={person.identity} aria-hidden={person.leaving || undefined} aria-label={[person.name, ...status].join(', ')}>
      {renderAvatar(person)}
      <strong>{person.name}{self && <small> {person.joining ? 'entrando…' : 'você'}</small>}</strong>
      {(playingSound || person.sharing || micMuted || person.deafened) && <span className="voice-member-status" aria-hidden="true">
        {playingSound && <span className="voice-soundboard-indicator" title="Tocando Soundboard"><SoundboardIcon /></span>}
        {person.sharing && <span className="voice-member-live" title="Transmitindo a tela"><ControlIcon name="screen" /></span>}
        {micMuted && <span className="voice-member-muted" title="Microfone mutado"><ControlIcon name="microphoneOff" /></span>}
        {person.deafened && <span className="voice-member-muted" title="Áudio silenciado"><ControlIcon name="deafen" /></span>}
      </span>}
    </div>
  })}</div>
}
