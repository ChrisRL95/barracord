import type { Room } from 'livekit-client'

type ConnectionStat = {
  id: string
  type: string
  selectedCandidatePairId?: string
  state?: string
  nominated?: boolean
  currentRoundTripTime?: number
  responsesReceived?: number
}

// RTT of the selected ICE pair, in milliseconds. This is the media-server
// round trip, not mouth-to-ear delay or a request to an unrelated HTTP server.
export function pingFromStats(report: RTCStatsReport): number | null {
  const stats: ConnectionStat[] = []
  report.forEach((value) => stats.push(value as ConnectionStat))
  const selectedIds = stats.filter((stat) => stat.type === 'transport' && stat.selectedCandidatePairId).map((stat) => stat.selectedCandidatePairId)
  const pairs = stats.filter((stat) => stat.type === 'candidate-pair' && stat.state === 'succeeded' &&
    (selectedIds.length ? selectedIds.includes(stat.id) : stat.nominated === true))
  const values = pairs.filter((stat) => stat.responsesReceived !== 0).map((stat) => stat.currentRoundTripTime)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  return values.length ? Math.round(Math.max(...values) * 1000) : null
}

export async function readCallPing(room: Room): Promise<number | null> {
  // The installed LiveKit version exposes read-only WebRTC stats on these
  // transports. Missing/closed transports simply leave the metric unavailable.
  const manager = room.engine?.pcManager
  const transports = [manager?.publisher, manager?.subscriber].filter((transport) => Boolean(transport))
  const results = await Promise.allSettled(transports.map(async (transport) => pingFromStats(await transport!.getStats())))
  const values = results.flatMap((result) => result.status === 'fulfilled' && result.value !== null ? [result.value] : [])
  return values.length ? Math.max(...values) : null
}
