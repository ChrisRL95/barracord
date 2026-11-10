import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { empty, maxPoints, maxStrokes } from './useStreamAnnotations'
import type { Contributor, Frame, Point, Stroke, Tool } from './useStreamAnnotations'
import './StreamAnnotations.css'

export default function StreamAnnotations({ videoFrame, frame, publish, people, self, identities, clearAll, clearVersion }: {
  videoFrame: RefObject<HTMLDivElement | null>; frame: Frame; publish?: (frame: Frame, reliable: boolean) => void
  people: Contributor[]; self: string; identities: string[]; clearAll?: () => void; clearVersion: number
}) {
  const [tool, setTool] = useState<Tool | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const drag = useRef<Stroke | null>(null)
  const pointerTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    window.clearTimeout(pointerTimer.current)
    drag.current = null
  }, [clearVersion])

  useEffect(() => {
    const container = videoFrame.current
    if (!container) return
    let video: HTMLVideoElement | null = null
    const measure = () => {
      const scale = video?.videoWidth ? Math.min(container.clientWidth / video.videoWidth, container.clientHeight / video.videoHeight) : 0
      setSize({ width: (video?.videoWidth ?? 0) * scale, height: (video?.videoHeight ?? 0) * scale })
    }
    const bindVideo = () => {
      video?.removeEventListener('resize', measure)
      video = container.querySelector('video')
      video?.addEventListener('resize', measure)
      measure()
    }
    const resize = new ResizeObserver(measure)
    resize.observe(container)
    const mutation = new MutationObserver(bindVideo)
    mutation.observe(container, { childList: true })
    bindVideo()
    return () => { resize.disconnect(); mutation.disconnect(); video?.removeEventListener('resize', measure) }
  }, [videoFrame])

  function point(event: ReactPointerEvent<SVGSVGElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    const normalize = (value: number, length: number) => Math.max(0, Math.min(1000, Math.round(value / length * 1000)))
    return [normalize(event.clientX - rect.left, rect.width), normalize(event.clientY - rect.top, rect.height)]
  }

  function finish() {
    const stroke = drag.current
    drag.current = null
    if (!stroke) return
    if (stroke.tool === 'pointer') {
      pointerTimer.current = window.setTimeout(() => publish?.({ strokes: frame.strokes }, true), 1200)
      return
    }
    const strokes = stroke.points.length > 1 ? [...frame.strokes, stroke].slice(-maxStrokes) : frame.strokes
    publish?.({ strokes }, true)
  }

  function renderStroke(stroke: Stroke, key: number) {
    const points = stroke.points.map(([x, y]) => [x * size.width / 1000, y * size.height / 1000])
    const [x, y] = points[0]
    if (stroke.tool === 'pointer' || points.length === 1) return <circle key={key} cx={x} cy={y} r={5} className="annotation-pointer" />
    if (stroke.tool === 'pen') return <polyline key={key} points={points.map((p) => p.join(',')).join(' ')} />
    const [endX, endY] = points[points.length - 1]
    const angle = Math.atan2(endY - y, endX - x)
    const head = (offset: number) => `${endX - 12 * Math.cos(angle + offset)},${endY - 12 * Math.sin(angle + offset)}`
    return <polyline key={key} points={`${x},${y} ${endX},${endY} ${head(-0.55)} ${endX},${endY} ${head(0.55)}`} />
  }

  const contributors = [...people, { identity: self, name: 'Você', frame }]
  const hues = new Map<string, number>()
  for (const identity of [...new Set([...identities, ...contributors.map((person) => person.identity)])].sort()) {
    let hash = 0
    for (const char of identity) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0
    let hue = (hash >>> 0) % 360
    for (let attempts = 0; attempts < 24 && [...hues.values()].some((used) => Math.min(Math.abs(hue - used), 360 - Math.abs(hue - used)) < 23); attempts++) {
      hue = (hue + 137) % 360
    }
    hues.set(identity, hue)
  }

  return <>
    {size.width > 0 && size.height > 0 && <svg className={`stream-annotation-layer${tool ? ' drawing' : ''}`} style={size} aria-hidden="true"
      onPointerDown={(event) => {
        if (!tool || !publish || event.button !== 0 || drag.current) return
        window.clearTimeout(pointerTimer.current)
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { tool, points: [point(event)] }
        publish({ strokes: frame.strokes, preview: drag.current }, false)
      }}
      onPointerMove={(event) => {
        const stroke = drag.current
        if (!stroke || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        const next = point(event)
        const last = stroke.points[stroke.points.length - 1]
        if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 4) return
        const previous = stroke.points.length < maxPoints ? stroke.points : stroke.points.filter((_, i) => i % 2 === 0)
        const points = stroke.tool === 'pen' ? [...previous, next] : stroke.tool === 'arrow' ? [stroke.points[0], next] : [next]
        drag.current = { tool: stroke.tool, points }
        publish?.({ strokes: frame.strokes, preview: drag.current }, false)
      }}
      onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={finish}>
      {contributors.map((person) => {
        const color = `hsl(${hues.get(person.identity)} 95% 68%)`
        const [x, y] = person.frame.preview?.points.at(-1) ?? [0, 0]
        return <g key={person.identity} style={{ color, stroke: color }}>
          {person.frame.strokes.map(renderStroke)}
          {person.frame.preview && <>
            {renderStroke(person.frame.preview, -1)}
            {person.identity !== self && <text className="annotation-author" x={Math.max(4, Math.min(size.width - 4, x * size.width / 1000))}
              y={Math.max(16, y * size.height / 1000 - 10)} textAnchor={x > 500 ? 'end' : 'start'}>{person.name}</text>}
          </>}
        </g>
      })}
    </svg>}
    {publish && <div className="stream-annotation-tools" role="group" aria-label="Anotações da transmissão">
      <button type="button" disabled={!size.width} aria-expanded={tool !== null} onClick={() => setTool(tool ? null : 'pen')}>{tool ? 'Fechar ferramentas' : 'Anotar'}</button>
      {tool && <>
        {([['pointer', 'Ponteiro'], ['pen', 'Caneta'], ['arrow', 'Seta']] as const).map(([value, label]) =>
          <button type="button" key={value} aria-pressed={tool === value} onClick={() => setTool(value)}>{label}</button>)}
        <button type="button" disabled={!frame.strokes.length} onClick={() => { window.clearTimeout(pointerTimer.current); publish({ strokes: frame.strokes.slice(0, -1) }, true) }}>Desfazer</button>
        <button type="button" disabled={!frame.strokes.length} onClick={() => { window.clearTimeout(pointerTimer.current); publish(empty, true) }}>Limpar meus traços</button>
        {clearAll && <button type="button" onClick={() => { window.clearTimeout(pointerTimer.current); drag.current = null; clearAll() }}>Limpar tudo</button>}
      </>}
    </div>}
  </>
}
