import { useEffect, useRef, useState } from 'react'

type Preview = { title: string; description: string; hostname: string }

export default function ChatLinkPreview({ href, endpoint, installationId }: { href: string; endpoint: string; installationId: string }) {
  const marker = useRef<HTMLSpanElement>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  useEffect(() => {
    if (!marker.current) return
    const controller = new AbortController()
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      const url = endpoint.trim().replace(/\/token\/?$/, '/messages/preview')
      const query = new URLSearchParams({ url: href, installationId })
      void fetch(`${url}?${query}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ preview: Preview | null }> : null)
        .then((result) => { if (result?.preview && !controller.signal.aborted) setPreview(result.preview) })
        .catch(() => {})
    }, { rootMargin: '100px' })
    observer.observe(marker.current)
    return () => { observer.disconnect(); controller.abort() }
  }, [href, endpoint, installationId])

  if (!preview) return <span className="chat-preview-marker" ref={marker} aria-hidden="true" />
  return <a className="chat-link-preview" href={href} target="_blank" rel="noopener noreferrer">
    <small>{preview.hostname}</small>
    <strong>{preview.title}</strong>
    {preview.description && <span>{preview.description}</span>}
  </a>
}
