import { useEffect, useRef, useState } from 'react'
import { RoomEvent } from 'livekit-client'
import type { Room } from 'livekit-client'

export type Tool = 'pointer' | 'pen' | 'arrow'
export type Point = [number, number]
export type Stroke = { tool: Tool; points: Point[] }
export type Frame = { strokes: Stroke[]; preview?: Stroke }
type Source = { identity: string; sid: string }
export const empty: Frame = { strokes: [] }
const topic = 'barracord.annotations.v1'
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

export function useStreamAnnotations(room: Room | null, localSid: string | undefined, source: Source | null) {
  const [local, setLocal] = useState<{ sid: string; frame: Frame } | null>(null)
  const [remote, setRemote] = useState<Frame>(empty)
  const published = useRef({ sid: '', frame: empty, sequence: 0, lastPreview: 0 })

  function publish(frame: Frame, reliable: boolean) {
    if (!room || !localSid) return
    if (published.current.sid !== localSid) published.current = { sid: localSid, frame: empty, sequence: 0, lastPreview: 0 }
    const current = published.current
    current.frame = frame
    setLocal({ sid: localSid, frame })
    if (!reliable && performance.now() - current.lastPreview < 45) return
    current.lastPreview = performance.now()
    const data = reliable ? frame : { preview: frame.preview }
    void room.localParticipant.publishData(encoder.encode(JSON.stringify({ sid: localSid, sequence: ++current.sequence, ...data })), { topic, reliable }).catch(() => {})
  }

  useEffect(() => {
    if (!room) return
    const onRequest = (bytes: Uint8Array, participant?: { identity: string }, _kind?: unknown, incomingTopic?: string) => {
      if (incomingTopic !== topic || !participant || !localSid || bytes.length > 256) return
      let request
      try { request = JSON.parse(decoder.decode(bytes)) } catch { return }
      if (request?.request !== localSid) return
      const current = published.current
      const frame = current.sid === localSid ? current.frame : empty
      void room.localParticipant.publishData(encoder.encode(JSON.stringify({ sid: localSid, sequence: current.sid === localSid ? ++current.sequence : 0, strokes: frame.strokes })), {
        topic, reliable: true, destinationIdentities: [participant.identity],
      }).catch(() => {})
    }
    room.on(RoomEvent.DataReceived, onRequest)
    return () => { room.off(RoomEvent.DataReceived, onRequest) }
  }, [room, localSid])

  const remoteSid = source?.sid
  const remoteIdentity = source?.identity
  useEffect(() => {
    if (!room || !remoteSid || !remoteIdentity) return
    let sequence = -1
    let commitSequence = -1
    let timer: number | undefined
    const onData = (bytes: Uint8Array, participant?: { identity: string }, _kind?: unknown, incomingTopic?: string) => {
      if (incomingTopic !== topic || participant?.identity !== remoteIdentity || bytes.length > 12_000) return
      let data
      try { data = JSON.parse(decoder.decode(bytes)) } catch { return }
      if (data?.sid !== remoteSid || !Number.isSafeInteger(data.sequence)) return
      if (Array.isArray(data.strokes) && data.strokes.length <= maxStrokes && data.strokes.every(validStroke) && data.sequence > commitSequence) {
        commitSequence = data.sequence
        if (data.sequence >= sequence) {
          sequence = data.sequence
          window.clearTimeout(timer)
          setRemote({ strokes: data.strokes })
        } else setRemote((frame) => ({ ...frame, strokes: data.strokes }))
      } else if (validStroke(data.preview) && data.sequence > sequence) {
        sequence = data.sequence
        setRemote((frame) => ({ ...frame, preview: data.preview }))
        window.clearTimeout(timer)
        timer = window.setTimeout(() => setRemote((frame) => ({ strokes: frame.strokes })), 1200)
      }
    }
    const request = () => void room.localParticipant.publishData(encoder.encode(JSON.stringify({ request: remoteSid })), {
      topic, reliable: true, destinationIdentities: [remoteIdentity],
    }).catch(() => {})
    room.on(RoomEvent.DataReceived, onData)
    room.on(RoomEvent.Reconnected, request)
    request()
    return () => {
      room.off(RoomEvent.DataReceived, onData)
      room.off(RoomEvent.Reconnected, request)
      window.clearTimeout(timer)
      setRemote(empty)
    }
  }, [room, remoteSid, remoteIdentity])
  return { local: local?.sid === localSid ? local?.frame ?? empty : empty, remote, publish }
}
