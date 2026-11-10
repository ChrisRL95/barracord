import { useEffect, useRef, useState } from 'react'
import { RoomEvent } from 'livekit-client'
import type { Room } from 'livekit-client'

export type Tool = 'pointer' | 'pen' | 'arrow'
export type Point = [number, number]
export type Stroke = { tool: Tool; points: Point[] }
export type Frame = { strokes: Stroke[]; preview?: Stroke }
type Source = { identity: string; sid: string }
export const empty: Frame = { strokes: [] }
const topic = 'barracord.annotations.v2'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
export const maxStrokes = 24
export const maxPoints = 32

function validStroke(value: unknown): value is Stroke {
  const stroke = value as Stroke | null
  return !!stroke && ['pointer', 'pen', 'arrow'].includes(stroke.tool) && Array.isArray(stroke.points) &&
    stroke.points.length > 0 && stroke.points.length <= maxPoints &&
    stroke.points.every((point) => Array.isArray(point) && point.length === 2 &&
      point.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000))
}

export type Contributor = { identity: string; name: string; frame: Frame }

function useBoard(room: Room | null, sid: string | undefined, publisher: string | undefined) {
  const [own, setOwn] = useState<{ sid: string; frame: Frame } | null>(null)
  const [others, setOthers] = useState<{ sid: string; people: Contributor[] } | null>(null)
  const [clearVersion, setClearVersion] = useState(0)
  const sent = useRef({ sid: '', frame: empty, sequence: 0, lastPreview: 0 })
  const clearContributors = useRef<(() => void) | null>(null)
  const self = room?.localParticipant.identity

  function send(data: object, reliable: boolean) {
    if (!room || !sid) return
    const current = sent.current
    void room.localParticipant.publishData(encoder.encode(JSON.stringify({ ...data, sid, sequence: ++current.sequence })), { topic, reliable }).catch(() => {})
  }

  function publish(frame: Frame, reliable: boolean) {
    if (!room || !sid) return
    if (sent.current.sid !== sid) sent.current = { sid, frame: empty, sequence: 0, lastPreview: 0 }
    const current = sent.current
    current.frame = frame
    setOwn({ sid, frame })
    if (!reliable && performance.now() - current.lastPreview < 45) return
    current.lastPreview = performance.now()
    send(reliable ? { strokes: frame.strokes } : { preview: frame.preview }, reliable)
  }

  function clearAll() {
    if (!sid || self !== publisher) return
    publish(empty, true)
    clearContributors.current?.()
    send({ clear: true }, true)
  }

  useEffect(() => {
    if (!room || !sid || !publisher) return
    const authors = new Map<string, { person: Contributor; commit: number; sequence: number; timer?: number }>()
    const refresh = () => setOthers({ sid, people: [...authors.values()].map(({ person }) => person) })
    const clear = () => {
      for (const entry of authors.values()) {
        window.clearTimeout(entry.timer)
        entry.commit = entry.sequence
        entry.person = { ...entry.person, frame: empty }
      }
      refresh()
    }
    clearContributors.current = clear
    const request = () => void room.localParticipant.publishData(encoder.encode(JSON.stringify({ sid, request: true })), { topic, reliable: true }).catch(() => {})
    const disconnected = (participant: { identity: string }) => {
      window.clearTimeout(authors.get(participant.identity)?.timer)
      authors.delete(participant.identity)
      refresh()
    }
    const onData = (bytes: Uint8Array, participant?: { identity: string; name?: string }, _kind?: unknown, incomingTopic?: string) => {
      if (incomingTopic !== topic || !participant || bytes.length > 12_000) return
      let data
      try { data = JSON.parse(decoder.decode(bytes)) } catch { return }
      if (data?.sid !== sid) return
      const current = sent.current
      if (data.request === true) {
        if (current.sid === sid && current.frame.strokes.length) {
          void room?.localParticipant.publishData(encoder.encode(JSON.stringify({ sid, sequence: ++current.sequence, strokes: current.frame.strokes })), {
            topic, reliable: true, destinationIdentities: [participant.identity],
          }).catch(() => {})
        }
        return
      }
      if (!Number.isSafeInteger(data.sequence)) return
      if (data.clear === true) {
        if (participant.identity !== publisher) return
        clear()
        if (current.sid === sid) {
          current.frame = empty
          void room.localParticipant.publishData(encoder.encode(JSON.stringify({ sid, sequence: ++current.sequence, strokes: [] })), { topic, reliable: true }).catch(() => {})
        }
        setOwn({ sid, frame: empty })
        setClearVersion((version) => version + 1)
        return
      }
      const entry = authors.get(participant.identity) ?? {
        person: { identity: participant.identity, name: participant.name || 'Participante', frame: empty }, commit: -1, sequence: -1, timer: undefined,
      }
      const frame = entry.person.frame
      if (Array.isArray(data.strokes) && data.strokes.length <= maxStrokes && data.strokes.every(validStroke) && data.sequence > entry.commit) {
        entry.commit = data.sequence
        if (data.sequence >= entry.sequence) {
          entry.sequence = data.sequence
          window.clearTimeout(entry.timer)
          entry.person = { ...entry.person, frame: { strokes: data.strokes } }
        } else entry.person = { ...entry.person, frame: { ...frame, strokes: data.strokes } }
      } else if (validStroke(data.preview) && data.sequence > entry.sequence) {
        entry.sequence = data.sequence
        entry.person = { ...entry.person, frame: { ...frame, preview: data.preview } }
        window.clearTimeout(entry.timer)
        entry.timer = window.setTimeout(() => {
          entry.person = { ...entry.person, frame: { strokes: entry.person.frame.strokes } }
          refresh()
        }, 1200)
      } else return
      authors.set(participant.identity, entry)
      refresh()
    }
    room.on(RoomEvent.DataReceived, onData)
    room.on(RoomEvent.Reconnected, request)
    room.on(RoomEvent.ParticipantDisconnected, disconnected)
    request()
    return () => {
      room.off(RoomEvent.DataReceived, onData)
      room.off(RoomEvent.Reconnected, request)
      room.off(RoomEvent.ParticipantDisconnected, disconnected)
      for (const entry of authors.values()) window.clearTimeout(entry.timer)
      clearContributors.current = null
      setOthers(null)
    }
  }, [room, sid, publisher])

  return {
    frame: own?.sid === sid ? own?.frame ?? empty : empty,
    people: others?.sid === sid ? others?.people ?? [] : [],
    self: self || '',
    identities: room ? [room.localParticipant.identity, ...room.remoteParticipants.keys()] : [],
    clearVersion,
    publish: sid ? publish : undefined,
    clearAll: sid && self === publisher ? clearAll : undefined,
  }
}

export function useStreamAnnotations(room: Room | null, localSid: string | undefined, source: Source | null) {
  const local = useBoard(room, localSid, room?.localParticipant.identity)
  const remote = useBoard(room, source?.sid, source?.identity)
  return { local, remote }
}
