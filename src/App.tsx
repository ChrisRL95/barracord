import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track, VideoQuality } from 'livekit-client'
import { captureAppAudio } from './appAudio'
import type { AppAudioCapture } from './appAudio'
import SharePicker from './SharePicker'
import LinuxSharePicker from './LinuxSharePicker'
import { isLinuxDesktop, systemText } from './platformText'
import Soundboard from './Soundboard'
import MemberProfile, { ProfileAvatar } from './MemberProfile'
import type { ProfileTarget } from './MemberProfile'
import UpdateButton from './UpdateButton'
import type { ShareSource, ShareAudioMode } from './SharePicker'
import { readCallPing } from './callPing'
import { MicrophoneController, configureMicrophoneNoise, loadNoiseMode, microphoneCaptureOptions, noiseModeLabels } from './noiseSuppression'
import type { NoiseMode } from './noiseSuppression'
import './App.css'
import './desktop.css'
import './rework.css'

const defaultUrl = import.meta.env.VITE_LIVEKIT_URL ?? ''
const defaultTokenEndpoint = import.meta.env.VITE_TOKEN_ENDPOINT ?? 'http://localhost:3001/token'
const isDevelopment = import.meta.env.DEV
const fallbackAppVersion = '0.1.0-beta'
const defaultChannelCatalog = {
  text: [{ id: 'geral', name: 'geral', protected: true }, { id: 'clipes-e-memes', name: 'clipes-e-memes', protected: false }],
  voice: [{ id: 'geral', name: 'Geral', protected: true }, { id: 'jogatina', name: 'Jogatina', protected: false }, { id: 'filmes', name: 'Filmes', protected: false }, { id: 'afk', name: 'AFK', protected: false }],
}
type DesktopVideoConstraints = MediaTrackConstraints & {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
    maxWidth: number
    maxHeight: number
    maxFrameRate: number
  }
}
type HostStatus = { state: 'stopped' | 'starting' | 'running' | 'error'; message: string; tailnetIp: string | null; role: 'host' | 'guest' }
type ChannelPresence = Record<string, Array<{ identity: string; name: string }>>
type Channel = { id: string; name: string; protected: boolean }
type ChannelCatalog = { text: Channel[]; voice: Channel[] }
type TextMessage = { id: string; author: string; installationId: string; body: string; createdAt: string }
type PresenceMember = { installationId: string; name: string; status: 'online' | 'away' | 'em-call' | 'streaming' | 'offline'; channelId: string | null; avatarRevision?: string }
type AdminMember = { installationId: string; name: string; authorizedAt: string; networkLinked?: boolean }
type AdminInvite = { code: string; label: string; createdAt: string; expiresAt: string | null; usedAt: string | null; status: 'ativo' | 'usado' | 'revogado' | 'expirado'; activationReady?: boolean }
type AdminData = { members: AdminMember[]; presence: ChannelPresence; channels: ChannelCatalog; invites: AdminInvite[]; metrics?: { streamCount: number; estimatedUploadMbps: number } }
type SafeLogEntry = { at: string; level: 'info' | 'warning' | 'error'; event: string }
type ControlIconName = 'microphone' | 'microphoneOff' | 'headphones' | 'deafen' | 'screen' | 'fullscreen' | 'settings' | 'leave' | 'sound' | 'soundOff'

function ControlIcon({ name }: { name: ControlIconName }) {
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

function getInstallationId() {
  const stored = localStorage.getItem('barracord.installationId')
  if (stored) return stored
  const installationId = crypto.randomUUID()
  localStorage.setItem('barracord.installationId', installationId)
  return installationId
}

function getStoredNumber(key: string, fallback: number) {
  const stored = localStorage.getItem(key)
  if (stored === null || stored.trim() === '') return fallback
  const value = Number(stored)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
}

function avatarTone(value: string) {
  let hash = 0
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return `avatar-tone-${Math.abs(hash) % 6}`
}

function ChatMessageBody({ body }: { body: string }) {
  const parts = body.split(/((?:https?:\/\/|www\.)[^\s<]+|(?<![@\w])(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<]*)?)/gi)
  return <>{parts.map((part, index) => {
    if (!/^(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,63})/i.test(part)) return part
    const [, address = part, ending = ''] = part.match(/^(.*?)([.,!?:;)\]]*)$/) ?? []
    const href = /^https?:\/\//i.test(address) ? address : `https://${address}`
    return <span key={`${address}-${index}`}><a href={href} target="_blank" rel="noreferrer noopener">{address}</a>{ending}</span>
  })}</>
}

function inviteInsideActivation(value: string) {
  const match = value.trim().match(/^BARRACA1\.([A-Za-z0-9_-]+)$/i)
  if (!match) return value.trim().toUpperCase()
  try {
    const encoded = match[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(encoded.padEnd(encoded.length + (4 - encoded.length % 4) % 4, '=')))
    return typeof payload?.invite === 'string' ? payload.invite.toUpperCase() : ''
  } catch { return '' }
}

const safeLogStorageKey = 'barracord.safeEventLog'

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    void promise.then(
      (value) => { window.clearTimeout(timer); resolve(value) },
      (error) => { window.clearTimeout(timer); reject(error) },
    )
  })
}

function loadSafeLog() {
  try {
    const stored = JSON.parse(localStorage.getItem(safeLogStorageKey) ?? '[]') as unknown
    if (!Array.isArray(stored)) return [] as SafeLogEntry[]
    return stored.filter((entry): entry is SafeLogEntry => Boolean(entry) && typeof entry === 'object' && typeof entry.at === 'string' && typeof entry.event === 'string' && (entry.level === 'info' || entry.level === 'warning' || entry.level === 'error')).slice(0, 50)
  } catch { return [] as SafeLogEntry[] }
}

function App() {
  const roomRef = useRef<Room | null>(null)
  const localScreenTrackRef = useRef<LocalVideoTrack | null>(null)
  const localScreenAudioTrackRef = useRef<LocalAudioTrack | null>(null)
  const appAudioCaptureRef = useRef<AppAudioCapture | null>(null)
  const shareStartPendingRef = useRef(false)
  const remoteVideoRef = useRef<HTMLDivElement | null>(null)
  const localPreviewElementRef = useRef<HTMLMediaElement | null>(null)
  const streamStageRef = useRef<HTMLDivElement | null>(null)
  const streamMiniPlayerRef = useRef<HTMLDivElement | null>(null)
  const remoteVideoElementRef = useRef<HTMLMediaElement | null>(null)
  const remoteVideoPublicationRef = useRef<{ setVideoQuality: (quality: VideoQuality) => void; setVideoDimensions: (dimensions: { width: number; height: number }) => void } | null>(null)
  const watchingStreamRef = useRef(false)
  const remoteAudioRef = useRef<HTMLDivElement | null>(null)
  const remoteVolumeRef = useRef(100)
  const streamVolumeRef = useRef(100)
  const streamStartPreferenceRef = useRef<'notice' | 'open' | 'none'>('notice')
  const participantAudioRef = useRef<Record<string, { volume: number; muted: boolean }>>({})
  const microphoneOnRef = useRef(false)
  const shortcutRestoreMicrophoneRef = useRef(false)
  const deafenedRef = useRef(false)
  const microphoneTestStreamRef = useRef<MediaStream | null>(null)
  const microphoneTestContextRef = useRef<AudioContext | null>(null)
  const microphoneTestFrameRef = useRef<number | null>(null)
  const microphoneControllerRef = useRef<MicrophoneController | null>(null)
  const microphoneTestTrackRef = useRef<LocalAudioTrack | null>(null)
  const microphoneTestPlaybackRef = useRef<HTMLAudioElement | null>(null)
  const microphoneTestGenerationRef = useRef(0)
  const microphoneTestListenRef = useRef(false)
  const reconnectTimerRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const lastActivityRef = useRef(Date.now())
  const verifyBarracaAccessRef = useRef<() => Promise<void>>(async () => undefined)
  const hostAutoStartAttemptedRef = useRef(false)
  const previousHostStatusRef = useRef<HostStatus | null>(null)
  const hostRecoveryNoticeTimerRef = useRef<number | null>(null)
  const [serverUrl, setServerUrl] = useState(() => isDevelopment ? localStorage.getItem('barracord.serverUrl') ?? defaultUrl : defaultUrl)
  const [tokenEndpoint, setTokenEndpoint] = useState(() => isDevelopment ? localStorage.getItem('barracord.tokenEndpoint') ?? defaultTokenEndpoint : defaultTokenEndpoint)
  const [participantName, setParticipantName] = useState(() => localStorage.getItem('barracord.participantName') ?? '')
  const [invite, setInvite] = useState('')
  const [authorizedInstallation, setAuthorizedInstallation] = useState(() => localStorage.getItem('barracord.authorized') === 'true')
  const [roomName, setRoomName] = useState('geral')
  const [selectedTextChannel, setSelectedTextChannel] = useState('geral')
  const [stageView, setStageView] = useState<'text' | 'voice'>('text')
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<string | null>(null)
  const [pendingVoiceChannel, setPendingVoiceChannel] = useState<string | null>(null)
  const [channelCatalog, setChannelCatalog] = useState<ChannelCatalog>(defaultChannelCatalog)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminTab, setAdminTab] = useState<'overview' | 'invites' | 'channels' | 'members' | 'tools'>('overview')
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [hostUploadLimit, setHostUploadLimit] = useState(() => {
    const stored = Number(localStorage.getItem('barracord.hostUploadLimit'))
    return Number.isFinite(stored) && stored >= 5 && stored <= 1_000 && stored !== 20 ? stored : 300
  })
  const [adminCode, setAdminCode] = useState('')
  const [adminData, setAdminData] = useState<AdminData | null>(null)
  const [adminMessage, setAdminMessage] = useState('Informe sua chave para administrar a Barraca.')
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminInvite, setAdminInvite] = useState('')
  const [inviteManagerOpen, setInviteManagerOpen] = useState(false)
  const [channelOrderOpen, setChannelOrderOpen] = useState(false)
  const [newInviteLabel, setNewInviteLabel] = useState('')
  const [newInviteExpiry, setNewInviteExpiry] = useState<'never' | 'day' | 'week'>('day')
  const [inviteCopyMessage, setInviteCopyMessage] = useState('')
  const [diagnosticText, setDiagnosticText] = useState('')
  const [diagnosticCopyMessage, setDiagnosticCopyMessage] = useState('')
  const [eventLog, setEventLog] = useState<SafeLogEntry[]>(loadSafeLog)
  const [eventLogOpen, setEventLogOpen] = useState(false)
  const [eventLogCopyMessage, setEventLogCopyMessage] = useState('')
  const [connectionTestMessage, setConnectionTestMessage] = useState('')
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text')
  const [newChannelName, setNewChannelName] = useState('')
  const [editingChannel, setEditingChannel] = useState<{ type: 'text' | 'voice'; id: string } | null>(null)
  const [editingChannelName, setEditingChannelName] = useState('')
  const [channelPresence, setChannelPresence] = useState<ChannelPresence>({})
  const [presenceMembers, setPresenceMembers] = useState<PresenceMember[]>([])
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null)
  const [textMessages, setTextMessages] = useState<TextMessage[]>([])
  const [textDraft, setTextDraft] = useState('')
  const [copiedChatMessageId, setCopiedChatMessageId] = useState('')
  const [connected, setConnected] = useState(false)
  const [callPing, setCallPing] = useState<number | null>(null)
  const [isSharing, setIsSharing] = useState(false)
  const [showLocalPreview, setShowLocalPreview] = useState(() => localStorage.getItem('barracord.showLocalPreview') !== 'false')
  const [microphoneOn, setMicrophoneOn] = useState(false)
  const [voiceKeyMode, setVoiceKeyMode] = useState<'off' | 'push-to-talk' | 'push-to-mute'>(() => {
    const saved = localStorage.getItem('barracord.voiceKeyMode')
    return saved === 'push-to-talk' || saved === 'push-to-mute' ? saved : 'off'
  })
  const [voiceShortcut, setVoiceShortcut] = useState(() => localStorage.getItem('barracord.voiceShortcut') ?? 'Space')
  const [voiceShortcutPressed, setVoiceShortcutPressed] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const [microphoneTestActive, setMicrophoneTestActive] = useState(false)
  const [microphoneTestLevel, setMicrophoneTestLevel] = useState(0)
  const [microphoneTestStarting, setMicrophoneTestStarting] = useState(false)
  const [listenToMicrophoneTest, setListenToMicrophoneTest] = useState(false)
  const [noiseMode, setNoiseMode] = useState<NoiseMode>(loadNoiseMode)
  const noiseModeRef = useRef(noiseMode)
  const [noiseChanging, setNoiseChanging] = useState(false)
  const [noiseMessage, setNoiseMessage] = useState('')
  const [shareAudioMode, setShareAudioMode] = useState<'application' | 'system' | 'none'>(() => {
    const saved = localStorage.getItem('barracord.shareAudioMode')
    return saved === 'system' || saved === 'none' ? saved : localStorage.getItem('barracord.shareAudio') === 'false' ? 'none' : 'application'
  })
  const shareAudio = shareAudioMode !== 'none'
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'warning' | 'error' }>({ text: 'Entre para começar.', tone: 'info' })
  const message = notice.text
  function setMessage(text: string, tone: 'info' | 'warning' | 'error' = 'info') {
    setNotice({ text, tone })
  }
  const [screenAudioWarning, setScreenAudioWarning] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [connectionUnavailable, setConnectionUnavailable] = useState(false)
  const [barracaAccess, setBarracaAccess] = useState<'checking' | 'available' | 'unavailable'>(() => localStorage.getItem('barracord.authorized') === 'true' ? 'checking' : 'available')
  const [remoteStream, setRemoteStream] = useState(false)
  const [streamPublisher, setStreamPublisher] = useState('')
  const [watchingStream, setWatchingStream] = useState(false)
  const [speakingIdentities, setSpeakingIdentities] = useState<string[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'audio' | 'stream' | 'barraca'>('audio')
  const [memberAudioMenuId, setMemberAudioMenuId] = useState<string | null>(null)
  const [streamFullscreen, setStreamFullscreen] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [microphoneDevice, setMicrophoneDevice] = useState(() => localStorage.getItem('barracord.microphoneDevice') ?? 'default')
  const microphoneDeviceRef = useRef(microphoneDevice)
  const [speakerDevice, setSpeakerDevice] = useState(() => localStorage.getItem('barracord.speakerDevice') ?? 'default')
  const [remoteVolume, setRemoteVolume] = useState(() => getStoredNumber('barracord.remoteVolume', 100))
  const [streamVolume, setStreamVolume] = useState(() => getStoredNumber('barracord.streamVolume', 100))
  const [streamStartPreference, setStreamStartPreference] = useState<'notice' | 'open' | 'none'>(() => {
    const saved = localStorage.getItem('barracord.streamStartPreference')
    return saved === 'open' || saved === 'none' ? saved : 'notice'
  })
  const [participantAudio, setParticipantAudio] = useState<Record<string, { volume: number; muted: boolean }>>({})
  const [qualityProfile, setQualityProfile] = useState<'auto' | 'smooth' | 'gaming' | 'maximum'>(() => {
    const saved = localStorage.getItem('barracord.qualityProfile')
    return saved === 'auto' || saved === 'smooth' || saved === 'gaming' || saved === 'maximum' ? saved : 'maximum'
  })
  const [shareSources, setShareSources] = useState<ShareSource[] | null>(null)
  const [linuxShareOpen, setLinuxShareOpen] = useState(false)
  const [tailscaleStatus, setTailscaleStatus] = useState<'ready' | 'missing' | 'offline' | 'needs-attention' | null>(null)
  const [privateNetworkAction, setPrivateNetworkAction] = useState(false)
  const [privateNetworkChecking, setPrivateNetworkChecking] = useState(false)
  const [privateNetworkMessage, setPrivateNetworkMessage] = useState('')
  const [hostStatus, setHostStatus] = useState<HostStatus>({ state: 'stopped', message: 'A Barraca está fechada.', tailnetIp: null, role: 'host' })
  const [hostRecoveryNotice, setHostRecoveryNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [keepBarracaAvailable, setKeepBarracaAvailable] = useState(() => localStorage.getItem('barracord.keepBarracaAvailable') !== 'false')
  const [startWithWindows, setStartWithWindows] = useState(false)
  const [startWithWindowsAvailable, setStartWithWindowsAvailable] = useState(false)
  const [appVersion, setAppVersion] = useState(fallbackAppVersion)
  const [sharingQuality, setSharingQuality] = useState('')
  const nextShareQuality = { resolution: qualityProfile === 'smooth' || qualityProfile === 'gaming' ? 720 as const : 1080 as const, fps: qualityProfile === 'smooth' || qualityProfile === 'auto' ? 30 as const : 60 as const }

  useEffect(() => {
    const room = roomRef.current
    if (!connected || isReconnecting || !room) return
    let cancelled = false
    let reading = false
    const update = async () => {
      if (reading) return
      reading = true
      try {
        const ping = await readCallPing(room)
        if (!cancelled && roomRef.current === room) setCallPing(ping)
      } finally { reading = false }
    }
    void update()
    const interval = window.setInterval(() => void update(), 3000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [connected, isReconnecting, activeVoiceChannel])

  useEffect(() => () => {
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
    if (hostRecoveryNoticeTimerRef.current !== null) window.clearTimeout(hostRecoveryNoticeTimerRef.current)
    stopMicrophoneTest()
    microphoneControllerRef.current?.dispose()
    void roomRef.current?.disconnect()
  }, [])

  useEffect(() => { if (isDevelopment) localStorage.setItem('barracord.serverUrl', serverUrl) }, [serverUrl])
  useEffect(() => { if (isDevelopment) localStorage.setItem('barracord.tokenEndpoint', tokenEndpoint) }, [tokenEndpoint])
  useEffect(() => { if (participantName.trim()) localStorage.setItem('barracord.participantName', participantName.trim()) }, [participantName])
  useEffect(() => { localStorage.setItem('barracord.shareAudio', String(shareAudio)) }, [shareAudio])
  useEffect(() => { localStorage.setItem('barracord.shareAudioMode', shareAudioMode) }, [shareAudioMode])
  useEffect(() => { localStorage.setItem('barracord.showLocalPreview', String(showLocalPreview)) }, [showLocalPreview])
  useEffect(() => { localStorage.setItem('barracord.microphoneDevice', microphoneDevice) }, [microphoneDevice])
  useEffect(() => { localStorage.setItem('barracord.speakerDevice', speakerDevice) }, [speakerDevice])
  useEffect(() => { localStorage.setItem('barracord.remoteVolume', String(remoteVolume)) }, [remoteVolume])
  useEffect(() => { localStorage.setItem('barracord.streamVolume', String(streamVolume)) }, [streamVolume])
  useEffect(() => { streamStartPreferenceRef.current = streamStartPreference; localStorage.setItem('barracord.streamStartPreference', streamStartPreference) }, [streamStartPreference])
  useEffect(() => { localStorage.setItem('barracord.qualityProfile', qualityProfile) }, [qualityProfile])
  useEffect(() => { localStorage.setItem('barracord.hostUploadLimit', String(hostUploadLimit)) }, [hostUploadLimit])
  useEffect(() => { localStorage.setItem('barracord.voiceKeyMode', voiceKeyMode) }, [voiceKeyMode])
  useEffect(() => { localStorage.setItem('barracord.voiceShortcut', voiceShortcut) }, [voiceShortcut])
  useEffect(() => { localStorage.setItem('barracord.keepBarracaAvailable', String(keepBarracaAvailable)) }, [keepBarracaAvailable])
  useEffect(() => { microphoneOnRef.current = microphoneOn }, [microphoneOn])
  useEffect(() => { noiseModeRef.current = noiseMode; localStorage.setItem('barracord.noiseSuppression', noiseMode) }, [noiseMode])
  useEffect(() => { microphoneDeviceRef.current = microphoneDevice }, [microphoneDevice])
  useEffect(() => {
    microphoneTestListenRef.current = listenToMicrophoneTest
    if (microphoneTestPlaybackRef.current) microphoneTestPlaybackRef.current.muted = !listenToMicrophoneTest
  }, [listenToMicrophoneTest])

  useEffect(() => {
    if (!connected || voiceKeyMode === 'off') return
    const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
    const changeMicrophone = async (enabled: boolean) => {
      const room = roomRef.current
      if (!room) return
      try { const actual = await microphoneController(room).setEnabled(enabled); if (roomRef.current === room) setMicrophoneOn(actual) }
      catch { setMessage('Não foi possível alterar o microfone pelo atalho.', 'error') }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== voiceShortcut || event.repeat || isEditableTarget(event.target)) return
      event.preventDefault()
      setVoiceShortcutPressed(true)
      if (voiceKeyMode === 'push-to-talk') void changeMicrophone(true)
      if (voiceKeyMode === 'push-to-mute') {
        shortcutRestoreMicrophoneRef.current = microphoneOnRef.current
        if (microphoneOnRef.current) void changeMicrophone(false)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== voiceShortcut) return
      event.preventDefault()
      setVoiceShortcutPressed(false)
      if (voiceKeyMode === 'push-to-talk') void changeMicrophone(false)
      if (voiceKeyMode === 'push-to-mute' && shortcutRestoreMicrophoneRef.current) void changeMicrophone(true)
      shortcutRestoreMicrophoneRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [connected, voiceKeyMode, voiceShortcut])

  useEffect(() => {
    remoteVolumeRef.current = remoteVolume
    remoteAudioRef.current?.querySelectorAll('audio').forEach((audio) => {
      if (audio.dataset.streamAudio === 'true') return
      const setting = participantAudioRef.current[audio.dataset.participant ?? ''] ?? { volume: 100, muted: false }
      audio.volume = (remoteVolume / 100) * (setting.volume / 100)
    })
  }, [remoteVolume, participantAudio])

  useEffect(() => {
    streamVolumeRef.current = streamVolume
    remoteAudioRef.current?.querySelectorAll('audio').forEach((audio) => {
      if (audio.dataset.streamAudio === 'true') audio.volume = streamVolume / 100
    })
  }, [streamVolume])

  useEffect(() => {
    deafenedRef.current = deafened
    remoteAudioRef.current?.querySelectorAll('audio').forEach((audio) => {
      const setting = participantAudioRef.current[audio.dataset.participant ?? ''] ?? { volume: 100, muted: false }
      audio.muted = deafened || (audio.dataset.streamAudio !== 'true' && setting.muted)
    })
  }, [deafened])

  useEffect(() => {
    const container = remoteVideoRef.current
    if (!container || !isSharing || !showLocalPreview) {
      localPreviewElementRef.current?.remove()
      localPreviewElementRef.current = null
      return
    }
    let cancelled = false
    let retry: number | null = null
    const attachPreview = () => {
      const track = roomRef.current?.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track
      if (!track) {
        retry = window.setTimeout(attachPreview, 120)
        return
      }
      const preview = track.attach()
      preview.autoplay = true
      preview.muted = true
      if (preview instanceof HTMLVideoElement) preview.playsInline = true
      preview.className = 'local-share-preview'
      if (cancelled) { preview.remove(); return }
      localPreviewElementRef.current?.remove()
      localPreviewElementRef.current = preview
      container.replaceChildren(preview)
    }
    attachPreview()
    return () => {
      cancelled = true
      if (retry !== null) window.clearTimeout(retry)
      localPreviewElementRef.current?.remove()
      localPreviewElementRef.current = null
    }
  }, [isSharing, showLocalPreview])

  useEffect(() => {
    if (!watchingStream || !remoteStream) return
    const video = remoteVideoElementRef.current
    const target = stageView === 'voice' ? remoteVideoRef.current : streamMiniPlayerRef.current
    if (!video || !target) return
    target.replaceChildren(video)
    void video.play().catch(() => undefined)
  }, [stageView, watchingStream, remoteStream])

  async function refreshDevices() {
    try { setDevices(await navigator.mediaDevices.enumerateDevices()) }
    catch { setMessage('Não foi possível listar os dispositivos de áudio.', 'error') }
  }

  function openSettings() {
    setSettingsTab('audio')
    setSettingsOpen(true)
    void refreshDevices()
  }

  function closeSettings() {
    stopMicrophoneTest()
    setSettingsOpen(false)
  }

  async function refreshPrivateNetworkStatus(confirmWithWindows = false) {
    if (!window.chriscordDesktop) return
    setPrivateNetworkChecking(true)
    try {
      const check = confirmWithWindows ? window.chriscordDesktop.verifyTailscaleStatus() : window.chriscordDesktop.tailscaleStatus()
      const status = await withTimeout(check, 30_000, `A confirmação ${systemText.of} demorou mais que o esperado.`)
      const nextStatus = !status.installed ? 'missing' : status.connected ? 'ready' : status.diagnostic === 'wrong-network' || status.diagnostic === 'access-denied' || status.diagnostic === 'service-unavailable' || status.diagnostic === 'unavailable' ? 'needs-attention' : 'offline'
      setTailscaleStatus(nextStatus)
      if (status.connected) setPrivateNetworkMessage('Conexão privada pronta. Agora informe seu nome e convite.')
      else if (status.diagnostic === 'wrong-network') setPrivateNetworkMessage('Este PC está conectado a uma rede privada diferente. Por segurança, o Barracord não vai trocar essa rede sozinho. Desconecte-a antes de usar a ativação.')
      else if ('verification' in status && 'verificationError' in status && status.verification === 'elevated-failed' && status.verificationError === 'cancelled') setPrivateNetworkMessage(`A confirmação ${systemText.of} foi cancelada. Nenhuma ativação foi usada.`)
      else if ('verification' in status && status.verification === 'elevated-failed') setPrivateNetworkMessage(`${systemText.The} autorizou a consulta, mas o Barracord não conseguiu ler o estado da Rede da Barraca. O código pode já ter sido usado; não o envie novamente. Feche e abra o app e confirme uma vez.`)
      else if ('verification' in status && status.verification === 'needs-reconnect') setPrivateNetworkMessage('A Rede da Barraca ainda não terminou de iniciar. O Barracord tentou religar este computador sem usar uma nova ativação. Aguarde alguns segundos e confirme novamente.')
      else if (status.diagnostic === 'access-denied') setPrivateNetworkMessage(`${systemText.The} bloqueou a consulta ao serviço da Rede da Barraca. Clique em “${systemText.confirm}” para verificar sem usar uma ativação.`)
      else if (status.diagnostic === 'service-unavailable') setPrivateNetworkMessage(`A Rede da Barraca está instalada, mas o serviço ${systemText.of} não respondeu. Aguarde a instalação terminar antes de tentar ativar novamente.`)
      else if (status.installed) setPrivateNetworkMessage(`A Rede da Barraca ainda está iniciando (${status.backendState}). Esta verificação foi refeita agora.`)
      else setPrivateNetworkMessage('A Rede da Barraca ainda não está instalada neste computador.')
    } catch (error) {
      setTailscaleStatus('needs-attention')
      if (error instanceof Error && error.message === `A confirmação ${systemText.of} demorou mais que o esperado.`) {
        setPrivateNetworkMessage(`A confirmação ${systemText.of} demorou mais que o esperado. Procure uma janela de confirmação escondida; se não houver, feche e abra o Barracord e tente “${systemText.confirm}” uma vez.`)
      } else setPrivateNetworkMessage('Não foi possível consultar a Rede da Barraca neste momento.')
    }
    finally { setPrivateNetworkChecking(false) }
  }

  function returnToActivation(messageText = 'Este computador não está mais autorizado na Barraca. Use uma nova ativação para entrar novamente.') {
    localStorage.removeItem('barracord.authorized')
    setAuthorizedInstallation(false)
    setBarracaAccess('available')
    setInvite('')
    resetRoom(messageText)
  }

  async function verifyBarracaAccess() {
    if (!authorizedInstallation) return
    setBarracaAccess('checking')
    try {
      const endpoint = tokenEndpoint.trim().replace(/\/token\/?$/, '/channels')
      const response = await fetch(`${endpoint}?${new URLSearchParams({ installationId: getInstallationId() }).toString()}`, { cache: 'no-store' })
      if (response.status === 401) {
        returnToActivation('Este computador não está mais autorizado na Barraca. Use uma nova ativação para entrar novamente.')
        return
      }
      if (!response.ok) throw new Error('A Barraca não respondeu aos canais.')
      const result = await response.json() as { channels?: ChannelCatalog }
      if (!result.channels) throw new Error('A Barraca respondeu sem os canais.')
      setChannelCatalog(result.channels)
      setBarracaAccess('available')
    } catch {
      setBarracaAccess('unavailable')
      setMessage('Não foi possível falar com a Barraca. Ela pode estar fechada ou a conexão privada ainda não terminou de iniciar.')
    }
  }
  verifyBarracaAccessRef.current = verifyBarracaAccess

  async function preparePrivateNetwork() {
    if (!window.chriscordDesktop) return
    if (!invite.trim()) { setPrivateNetworkMessage('Cole o código de ativação que o anfitrião enviou.'); return }
    setPrivateNetworkAction(true)
    try {
      const result = await window.chriscordDesktop.activatePrivateNetwork(invite)
      setPrivateNetworkMessage(result.message)
      if (result.ok) await refreshPrivateNetworkStatus()
    } catch { setPrivateNetworkMessage('Não foi possível abrir a Rede da Barraca. Tente novamente.') }
    finally { setPrivateNetworkAction(false) }
  }

  useEffect(() => {
    void refreshPrivateNetworkStatus()
  }, [])

  useEffect(() => {
    const noteActivity = () => { lastActivityRef.current = Date.now() }
    const noteVisibleActivity = () => { if (!document.hidden) noteActivity() }
    window.addEventListener('focus', noteActivity)
    window.addEventListener('pointerdown', noteActivity)
    window.addEventListener('keydown', noteActivity)
    document.addEventListener('visibilitychange', noteVisibleActivity)
    return () => {
      window.removeEventListener('focus', noteActivity)
      window.removeEventListener('pointerdown', noteActivity)
      window.removeEventListener('keydown', noteActivity)
      document.removeEventListener('visibilitychange', noteVisibleActivity)
    }
  }, [])

  useEffect(() => {
    if (!authorizedInstallation) return
    let cancelled = false
    const refreshPresence = async () => {
      try {
        const presenceEndpoint = tokenEndpoint.trim().replace(/\/token\/?$/, '/presence')
        const installationId = getInstallationId()
        const away = document.hidden || Date.now() - lastActivityRef.current >= 5 * 60_000
        const heartbeat = await fetch(`${presenceEndpoint}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId, away }) })
        if (heartbeat.status === 401) { if (!cancelled) returnToActivation(); return }
        const response = await fetch(`${presenceEndpoint}?${new URLSearchParams({ installationId }).toString()}`, { cache: 'no-store' })
        if (response.status === 401) { if (!cancelled) returnToActivation(); return }
        if (!response.ok || cancelled) return
        const body = await response.json() as { channels?: ChannelPresence; members?: PresenceMember[] }
        if (body.channels && !cancelled) setChannelPresence(body.channels)
        if (body.members && !cancelled) setPresenceMembers(body.members)
      } catch {
        // Presence is optional; the room itself still reports connection errors.
      }
    }
    const start = window.setTimeout(() => void refreshPresence(), 0)
    const interval = window.setInterval(() => void refreshPresence(), 4_000)
    return () => { cancelled = true; window.clearTimeout(start); window.clearInterval(interval) }
  }, [authorizedInstallation, tokenEndpoint])

  useEffect(() => {
    if (!authorizedInstallation) return
    void verifyBarracaAccessRef.current()
    const interval = window.setInterval(() => void verifyBarracaAccessRef.current(), 5_000)
    return () => window.clearInterval(interval)
  }, [authorizedInstallation, tokenEndpoint])

  useEffect(() => {
    if (!authorizedInstallation) return
    let cancelled = false
    const loadMessages = async () => {
      try {
        const messagesEndpoint = tokenEndpoint.trim().replace(/\/token\/?$/, '/messages')
        const params = new URLSearchParams({ channel: selectedTextChannel, installationId: getInstallationId() })
        const response = await fetch(`${messagesEndpoint}?${params.toString()}`, { cache: 'no-store' })
        if (response.status === 401) { if (!cancelled) returnToActivation(); return }
        if (!response.ok || cancelled) return
        const body = await response.json() as { messages?: TextMessage[] }
        if (!cancelled && body.messages) setTextMessages(body.messages)
      } catch {
        // The text channel will refresh when the Barraca is available again.
      }
    }
    void loadMessages()
    const interval = window.setInterval(() => void loadMessages(), 4_000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [authorizedInstallation, selectedTextChannel, tokenEndpoint])

  useEffect(() => {
    if (!window.chriscordDesktop) return
    void window.chriscordDesktop.hostStatus().then(setHostStatus)
    void window.chriscordDesktop.appVersion().then(setAppVersion).catch(() => undefined)
    return window.chriscordDesktop.onHostStatus(setHostStatus)
  }, [])

  useEffect(() => {
    const previous = previousHostStatusRef.current
    const wasRecovering = previous?.state === 'starting' && /recuperando/i.test(previous.message)
    previousHostStatusRef.current = hostStatus
    if (!wasRecovering || (hostStatus.state !== 'running' && hostStatus.state !== 'error')) return

    const notice = hostStatus.state === 'running'
      ? { kind: 'success' as const, text: 'Barraca reconectada. A galera pode continuar entrando.' }
      : { kind: 'error' as const, text: 'A Barraca não conseguiu voltar sozinha. Abra ou tente novamente.' }
    if (hostRecoveryNoticeTimerRef.current !== null) window.clearTimeout(hostRecoveryNoticeTimerRef.current)
    setHostRecoveryNotice(notice)
    setMessage(notice.text)
    recordSafeEvent(hostStatus.state === 'running' ? 'info' : 'error', notice.text)
    hostRecoveryNoticeTimerRef.current = window.setTimeout(() => setHostRecoveryNotice(null), 8_000)
  }, [hostStatus])

  useEffect(() => {
    if (!window.chriscordDesktop || hostStatus.role !== 'host' || !keepBarracaAvailable || hostAutoStartAttemptedRef.current) return
    hostAutoStartAttemptedRef.current = true
    if (hostStatus.state !== 'stopped') return
    void window.chriscordDesktop.startHost().then((nextStatus) => {
      setHostStatus(nextStatus)
      recordSafeEvent(nextStatus.state === 'error' ? 'error' : 'info', nextStatus.state === 'running' ? 'A Barraca foi aberta automaticamente neste computador.' : 'Não foi possível abrir a Barraca automaticamente.')
    }).catch(() => recordSafeEvent('error', 'Não foi possível abrir a Barraca automaticamente.'))
  }, [hostStatus.role, hostStatus.state, keepBarracaAvailable])

  useEffect(() => {
    if (!window.chriscordDesktop || hostStatus.role !== 'host') return
    void window.chriscordDesktop.hostAdminCode().then((code) => { if (code) setAdminCode(code) })
  }, [hostStatus.role])

  useEffect(() => {
    if (!window.chriscordDesktop || hostStatus.role !== 'host') return
    void window.chriscordDesktop.hostStartOnLogin().then((status) => {
      setStartWithWindows(status.enabled)
      setStartWithWindowsAvailable(status.available)
    }).catch(() => undefined)
  }, [hostStatus.role])

  useEffect(() => {
    if (!window.chriscordDesktop) return
    return window.chriscordDesktop.onShareRequest((sources) => setShareSources(sources))
  }, [])

  useEffect(() => {
    if (!window.chriscordDesktop) return
    return window.chriscordDesktop.onStreamFullscreen(setStreamFullscreen)
  }, [])

  function recordSafeEvent(level: SafeLogEntry['level'], event: string) {
    const entry: SafeLogEntry = { at: new Date().toISOString(), level, event }
    setEventLog((current) => {
      const next = [entry, ...current].slice(0, 50)
      localStorage.setItem(safeLogStorageKey, JSON.stringify(next))
      return next
    })
  }

  async function toggleHost() {
    if (!window.chriscordDesktop) return
    const opening = hostStatus.state !== 'running'
    try {
      const nextStatus = opening
        ? await window.chriscordDesktop.startHost()
        : await window.chriscordDesktop.stopHost()
      setHostStatus(nextStatus)
      recordSafeEvent(nextStatus.state === 'error' ? 'error' : 'info', nextStatus.state === 'error' ? 'A Barraca encontrou um problema ao mudar de estado.' : opening ? 'A Barraca foi aberta neste computador.' : 'A Barraca foi fechada neste computador.')
    } catch {
      recordSafeEvent('error', opening ? 'Não foi possível abrir a Barraca.' : 'Não foi possível fechar a Barraca.')
    }
  }

  async function changeStartWithWindows(enabled: boolean) {
    if (!window.chriscordDesktop) return
    try {
      const status = await window.chriscordDesktop.setHostStartOnLogin(enabled)
      setStartWithWindows(status.enabled)
      setStartWithWindowsAvailable(status.available)
      if (!status.available) setMessage('Essa opção estará disponível no instalador do Anfitrião.')
    } catch { setMessage(`Não foi possível alterar a inicialização com ${systemText.the}.`) }
  }

  function resetRoom(messageText: string) {
    microphoneControllerRef.current?.dispose()
    microphoneControllerRef.current = null
    setConnected(false)
    setCallPing(null)
    setIsSharing(false)
    setMicrophoneOn(false)
    setDeafened(false)
    setRemoteStream(false)
    setStreamPublisher('')
    watchingStreamRef.current = false
    setWatchingStream(false)
    setActiveVoiceChannel(null)
    setStageView('text')
    setSpeakingIdentities([])
    participantAudioRef.current = {}
    setParticipantAudio({})
    remoteVideoRef.current?.replaceChildren()
    localPreviewElementRef.current = null
    localScreenTrackRef.current = null
    localScreenAudioTrackRef.current = null
    appAudioCaptureRef.current?.stop()
    appAudioCaptureRef.current = null
    remoteVideoElementRef.current = null
    remoteAudioRef.current?.replaceChildren()
    setMessage(messageText)
  }

  async function connect(event?: FormEvent, targetRoom = roomName, isReconnect = false): Promise<boolean> {
    event?.preventDefault()
    if (!serverUrl.trim() || !tokenEndpoint.trim() || !participantName.trim() || (!authorizedInstallation && !invite.trim())) {
      setMessage(authorizedInstallation ? 'Informe seu nome.' : 'Informe seu nome e o convite da Barraca.')
      return false
    }
    stopMicrophoneTest()
    setIsConnecting(true)
    setMessage('Abrindo a Barraca…')
    try {
      const tokenResponse = await fetch(tokenEndpoint.trim(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: targetRoom, participantName, installationId: getInstallationId() }),
      })
      const tokenText = await tokenResponse.text()
      let tokenBody: { token?: string; error?: string }
      try { tokenBody = JSON.parse(tokenText) as { token?: string; error?: string } }
      catch { throw new Error(`O servidor de convites respondeu algo inesperado (${tokenResponse.status}).`) }
      if (!tokenResponse.ok || !tokenBody.token) throw new Error(tokenBody.error ?? 'Não foi possível validar o convite.')

      // Explicit subscription matters for screen shares from guests. It also
      // makes the behaviour independent from SDK defaults between releases.
      const room = new Room({ adaptiveStream: false, dynacast: true })
      room.on(RoomEvent.Reconnecting, () => {
        if (roomRef.current === room) {
          setIsReconnecting(true)
          setCallPing(null)
          setConnectionUnavailable(false)
          setMessage('Conexão oscilando. Tentando recuperar a call…')
          recordSafeEvent('warning', 'A conexão da call oscilou; recuperação automática iniciada.')
        }
      })
      room.on(RoomEvent.Reconnected, () => {
        if (roomRef.current === room) {
          setIsReconnecting(false)
          reconnectAttemptsRef.current = 0
          setMessage('Conexão recuperada.')
          recordSafeEvent('info', 'A conexão da call foi recuperada.')
        }
      })
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) {
          roomRef.current = null
          resetRoom('Conexão perdida. Tentando voltar para a call…')
          recordSafeEvent('warning', 'A conexão da call foi perdida; tentando reconectar.')
          scheduleReconnect(targetRoom)
        }
      })
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        const name = participant.name || participant.identity
        setMessage(`${name} chegou na sala.`)
      })
      room.on(RoomEvent.ActiveSpeakersChanged, (activeSpeakers) => {
        setSpeakingIdentities(activeSpeakers.map((participant) => participant.identity))
      })
      room.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.source !== Track.Source.ScreenShare) return
        setIsSharing(true)
        setMessage('Sua tela está ao vivo.')
        recordSafeEvent('info', 'A transmissão de tela foi publicada.')
      })
      room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.source !== Track.Source.ScreenShare) return
        appAudioCaptureRef.current?.stop()
        appAudioCaptureRef.current = null
        const audio = localScreenAudioTrackRef.current
        localScreenAudioTrackRef.current = null
        if (audio) void room.localParticipant.unpublishTrack(audio, true).catch(() => {})
        setIsSharing(false)
        localPreviewElementRef.current?.remove()
        localPreviewElementRef.current = null
        setMessage('Sua transmissão foi encerrada.')
        recordSafeEvent('info', 'A transmissão de tela foi encerrada.')
      })
      room.on(RoomEvent.TrackPublished, (publication, participant) => {
        if (publication.kind !== Track.Kind.Video || publication.source !== Track.Source.ScreenShare) return
        // Ask the SFU for the track immediately. Previously the UI only
        // learned about a stream after an implicit subscription completed.
        publication.setSubscribed(true)
        setRemoteStream(true)
        setStreamPublisher(participant.name || participant.identity)
        setMessage(`${participant.name || participant.identity} começou uma transmissão. Carregando…`)
        recordSafeEvent('info', `Transmissão de ${participant.name || participant.identity} detectada; assinatura solicitada.`)
      })
      room.on(RoomEvent.TrackSubscriptionFailed, (_trackSid, participant) => {
        const name = participant.name || participant.identity
        setMessage(`Não foi possível receber a transmissão de ${name}. Peça para ele encerrar e compartilhar novamente.`)
        recordSafeEvent('error', `A assinatura da transmissão de ${name} falhou.`)
      })
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Video) {
          const video = track.attach()
          video.autoplay = true
          if (video instanceof HTMLVideoElement) video.playsInline = true
          video.className = 'remote-video'
          remoteVideoElementRef.current = video
          remoteVideoPublicationRef.current = publication
          const shouldOpenStream = streamStartPreferenceRef.current === 'open'
          if (watchingStreamRef.current || shouldOpenStream) remoteVideoRef.current?.replaceChildren(video)
          setRemoteStream(true)
          setStreamPublisher(participant.name || participant.identity)
          if (shouldOpenStream) {
            remoteVideoPublicationRef.current?.setVideoDimensions({ width: 1920, height: 1080 })
            watchingStreamRef.current = true
            setWatchingStream(true)
            setStageView('voice')
            setMessage(`Abrindo a transmissão de ${participant.name || participant.identity}.`)
          } else if (streamStartPreferenceRef.current === 'notice') setMessage(`${participant.name || participant.identity} começou uma transmissão.`)
        }
        if (track.kind === Track.Kind.Audio) {
          const identity = participant.identity
          const setting = participantAudioRef.current[identity] ?? { volume: 100, muted: false }
          const isStreamAudio = publication.source === Track.Source.ScreenShareAudio
          const audio = track.attach()
          audio.autoplay = true
          audio.dataset.participant = identity
          audio.dataset.streamAudio = String(isStreamAudio)
          audio.volume = isStreamAudio ? streamVolumeRef.current / 100 : (remoteVolumeRef.current / 100) * (setting.volume / 100)
          audio.muted = deafenedRef.current || (!isStreamAudio && setting.muted)
          audio.className = 'remote-audio'
          remoteAudioRef.current?.append(audio)
          // `attach()` connects the MediaStream, but Chromium does not always
          // begin playback for an audio track that arrives after the join
          // gesture. Explicitly starting it is essential for screen-share
          // audio, which is published after the video track.
          void audio.play().catch((error) => {
            const label = isStreamAudio ? 'da transmissão' : 'da call'
            recordSafeEvent('error', `O áudio ${label} de ${participant.name || identity} foi recebido, mas ${systemText.the} bloqueou a reprodução: ${error instanceof Error ? error.message : 'erro desconhecido'}.`)
            if (isStreamAudio) setMessage(`O som da transmissão de ${participant.name || identity} chegou, mas este computador bloqueou a reprodução. Clique na transmissão para liberar o áudio.`)
          })
        }
      })
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove())
        if (track.kind === Track.Kind.Video) {
          remoteVideoElementRef.current = null
          remoteVideoPublicationRef.current = null
          watchingStreamRef.current = false
          setWatchingStream(false)
          setRemoteStream(false)
          setStreamPublisher('')
        }
      })

      await room.connect(serverUrl.trim(), tokenBody.token, { autoSubscribe: true })
      await Promise.all([
        room.switchActiveDevice('audioinput', microphoneDevice).catch(() => undefined),
        room.switchActiveDevice('audiooutput', speakerDevice).catch(() => undefined),
      ])
      let microphoneEnabled = false
      if (!isReconnect && voiceKeyMode !== 'push-to-talk') {
        try {
          microphoneEnabled = await microphoneController(room).setEnabled(true)
        } catch { setMessage(`Você entrou, mas ${systemText.the} bloqueou o microfone.`, 'warning') }
      }
      roomRef.current = room
      setRoomName(targetRoom)
      setActiveVoiceChannel(targetRoom)
      setStageView('voice')
      setAuthorizedInstallation(true)
      localStorage.setItem('barracord.authorized', 'true')
      setConnected(true)
      setMicrophoneOn(microphoneEnabled)
      setIsReconnecting(false)
      setConnectionUnavailable(false)
      reconnectAttemptsRef.current = 0
      setMessage(isReconnect ? 'Conexão recuperada. Microfone desligado por segurança.' : microphoneEnabled ? 'Você entrou com o microfone ligado.' : voiceKeyMode === 'push-to-talk' ? 'Você entrou no modo apertar para falar.' : 'Você entrou. Ligue o microfone quando estiver pronto.')
      recordSafeEvent('info', isReconnect ? 'Reconexão com a call concluída.' : 'Entrada em uma call concluída.')
      return true
    } catch (error) {
      if (error instanceof Error && error.message.includes('ainda não está autorizado')) {
        returnToActivation()
        return false
      }
      setMessage(`Não foi possível entrar: ${error instanceof Error ? error.message : 'verifique a conexão.'}`, 'error')
      recordSafeEvent('error', isReconnect ? 'Uma tentativa de reconexão com a call falhou.' : 'Não foi possível entrar na call.')
      return false
    } finally { setIsConnecting(false) }
  }

  async function authorizeInstallation(event: FormEvent) {
    event.preventDefault()
    if (window.chriscordDesktop && !isHostApp && tailscaleStatus !== 'ready') {
      setMessage('Prepare a Rede da Barraca antes de usar o convite.')
      return
    }
    const registrationInvite = inviteInsideActivation(invite)
    if (!participantName.trim() || !registrationInvite || !tokenEndpoint.trim()) {
      setMessage('Informe seu nome e o convite da Barraca.')
      return
    }
    setIsConnecting(true)
    setMessage('Autorizando este computador…')
    try {
      let networkDeviceId: string | undefined
      if (window.chriscordDesktop && !isHostApp) {
        const status = await window.chriscordDesktop.tailscaleStatus()
        if (!status.connected || !status.taggedForBarraca || !status.deviceId) throw new Error(`A Rede da Barraca não confirmou a identidade deste computador. Clique em “${systemText.confirm}” e tente novamente.`)
        networkDeviceId = status.deviceId
      }
      const registerEndpoint = tokenEndpoint.trim().replace(/\/token\/?$/, '/register')
      const response = await fetch(registerEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantName, invite: registrationInvite, installationId: getInstallationId(), networkDeviceId }),
      })
      const text = await response.text()
      let body: { ok?: boolean; error?: string }
      try { body = JSON.parse(text) as { ok?: boolean; error?: string } }
      catch { throw new Error(`O servidor de convites respondeu algo inesperado (${response.status}).`) }
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Não foi possível autorizar este computador.')
      setAuthorizedInstallation(true)
      setBarracaAccess('available')
      localStorage.setItem('barracord.authorized', 'true')
      setInvite('')
      setMessage('Computador autorizado. Escolha um canal para entrar.')
    } catch (error) {
      setMessage(`Não foi possível entrar: ${error instanceof Error ? error.message : 'verifique a conexão.'}`, 'error')
    } finally { setIsConnecting(false) }
  }

  async function bootstrapThisHost() {
    if (!window.chriscordDesktop) return
    if (!participantName.trim()) { setMessage('Informe seu nome para preparar o computador do anfitrião.'); return }
    setIsConnecting(true)
    setMessage('Preparando o computador do anfitrião…')
    try {
      const result = await window.chriscordDesktop.bootstrapHost(participantName, getInstallationId())
      if (!result.ok) throw new Error(result.error || 'Não foi possível preparar este computador.')
      setAuthorizedInstallation(true)
      setBarracaAccess('available')
      localStorage.setItem('barracord.authorized', 'true')
      setMessage('Você é o anfitrião. Abra Administração para gerar o primeiro convite.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível preparar este computador.') }
    finally { setIsConnecting(false) }
  }

  function microphoneController(room: Room) {
    if (microphoneControllerRef.current?.room === room) return microphoneControllerRef.current
    microphoneControllerRef.current?.dispose()
    const controller = new MicrophoneController(room, noiseModeRef.current, () => microphoneDeviceRef.current, () => {
      if (microphoneControllerRef.current !== controller) return
      noiseModeRef.current = 'basic'
      setNoiseMode('basic')
      setNoiseMessage('RNNoise não ficou disponível. O modo Básico foi ativado para manter sua voz funcionando.')
      setMessage('O supressor RNNoise falhou; seu microfone está usando o modo Básico.', 'warning')
      recordSafeEvent('warning', 'microphone-rnnoise-fallback-basic')
    })
    microphoneControllerRef.current = controller
    return controller
  }

  async function changeNoiseMode(mode: NoiseMode) {
    if (noiseChanging) return
    setNoiseChanging(true)
    setNoiseMessage('')
    try {
      let actual = mode
      const room = roomRef.current
      if (room) actual = await microphoneController(room).setMode(mode)
      noiseModeRef.current = actual
      setNoiseMode(actual)
      if (microphoneTestActive) { stopMicrophoneTest(); await startMicrophoneTest(actual) }
      if (actual !== mode) setNoiseMessage('RNNoise não ficou disponível. O modo Básico foi ativado.')
    } catch {
      setNoiseMessage('Não foi possível alterar o supressor. Confira o microfone e tente novamente.')
      recordSafeEvent('error', 'microphone-noise-mode-change-failed')
    } finally { setNoiseChanging(false) }
  }

  async function toggleMicrophone() {
    const room = roomRef.current
    if (!room) return
    try {
      const actual = await microphoneController(room).setEnabled(!microphoneOn)
      if (roomRef.current === room) setMicrophoneOn(actual)
    } catch { setMessage(`${systemText.The} bloqueou o acesso ao microfone.`, 'error') }
  }

  async function toggleDeafen() {
    const room = roomRef.current
    if (!room) return
    const next = !deafened
    try {
      if (next && microphoneOn) {
        await microphoneController(room).setEnabled(false)
        setMicrophoneOn(false)
      }
      setDeafened(next)
      setMessage(next ? 'Você silenciou tudo. O microfone foi desligado.' : 'Você voltou a ouvir a call. Seu microfone continua desligado.')
    } catch { setMessage('Não foi possível alterar o modo silencioso.', 'error') }
  }

  async function changeVoiceKeyMode(mode: 'off' | 'push-to-talk' | 'push-to-mute') {
    setVoiceKeyMode(mode)
    if (mode !== 'push-to-talk' || !microphoneOnRef.current || !roomRef.current) return
    try {
      await microphoneController(roomRef.current).setEnabled(false)
      setMicrophoneOn(false)
      setMessage('Aperte a tecla configurada para falar.')
    } catch { setMessage('Não foi possível preparar o modo apertar para falar.') }
  }

  function changeParticipantAudio(identity: string, patch: Partial<{ volume: number; muted: boolean }>) {
    const current = participantAudioRef.current[identity] ?? { volume: 100, muted: false }
    const next = { ...current, ...patch }
    participantAudioRef.current = { ...participantAudioRef.current, [identity]: next }
    setParticipantAudio(participantAudioRef.current)
    remoteAudioRef.current?.querySelectorAll('audio').forEach((audio) => {
      if (audio.dataset.participant !== identity || audio.dataset.streamAudio === 'true') return
      audio.volume = (remoteVolumeRef.current / 100) * (next.volume / 100)
      audio.muted = deafenedRef.current || next.muted
    })
  }

  function stopMicrophoneTest() {
    ++microphoneTestGenerationRef.current
    microphoneTestTrackRef.current?.stop()
    microphoneTestTrackRef.current = null
    const playback = microphoneTestPlaybackRef.current
    if (playback) { playback.pause(); playback.srcObject = null; playback.remove() }
    microphoneTestPlaybackRef.current = null
    if (microphoneTestFrameRef.current !== null) window.cancelAnimationFrame(microphoneTestFrameRef.current)
    microphoneTestFrameRef.current = null
    microphoneTestStreamRef.current?.getTracks().forEach((track) => track.stop())
    microphoneTestStreamRef.current = null
    void microphoneTestContextRef.current?.close()
    microphoneTestContextRef.current = null
    setMicrophoneTestActive(false)
    setMicrophoneTestStarting(false)
    setMicrophoneTestLevel(0)
  }

  async function toggleMicrophoneTest() {
    if (microphoneTestStarting) return
    if (microphoneTestActive) { stopMicrophoneTest(); return }
    if (connected) { setMessage('O teste de microfone fica disponível antes de entrar na call.'); return }
    await startMicrophoneTest(noiseModeRef.current)
  }

  async function startMicrophoneTest(mode: NoiseMode) {
    const generation = ++microphoneTestGenerationRef.current
    setMicrophoneTestStarting(true)
    let localTrack: LocalAudioTrack | undefined
    let stream: MediaStream | undefined
    let context: AudioContext | undefined
    try {
      const options = microphoneCaptureOptions(mode, microphoneDeviceRef.current)
      stream = await navigator.mediaDevices.getUserMedia({ audio: options })
      if (generation !== microphoneTestGenerationRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      context = new AudioContext({ sampleRate: 48000 })
      localTrack = new LocalAudioTrack(stream.getAudioTracks()[0], options)
      localTrack.source = Track.Source.Microphone
      localTrack.setAudioContext(context)
      microphoneTestStreamRef.current = stream
      microphoneTestTrackRef.current = localTrack
      microphoneTestContextRef.current = context
      const actual = await configureMicrophoneNoise(localTrack, mode, () => {
        if (generation !== microphoneTestGenerationRef.current) return
        stopMicrophoneTest()
        setNoiseMessage('O filtro falhou durante o teste. Selecione Básico e teste novamente.')
      })
      if (generation !== microphoneTestGenerationRef.current) { localTrack.stop(); await context.close().catch(() => {}); return }
      if (actual !== mode) {
        noiseModeRef.current = actual
        setNoiseMode(actual)
        setNoiseMessage('RNNoise não ficou disponível no teste. O modo Básico foi ativado.')
      }
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      const filteredStream = new MediaStream([localTrack.mediaStreamTrack])
      context.createMediaStreamSource(filteredStream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      await context.resume()
      const playback = document.createElement('audio')
      playback.hidden = true
      playback.srcObject = filteredStream
      playback.muted = !microphoneTestListenRef.current
      document.body.append(playback)
      microphoneTestPlaybackRef.current = playback
      const output = playback as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
      await output.setSinkId?.(speakerDevice).catch(() => {})
      if (generation !== microphoneTestGenerationRef.current) { playback.remove(); return }
      void playback.play().catch(() => setNoiseMessage('A reprodução do teste foi bloqueada. Confira o dispositivo de saída e tente novamente.'))
      setMicrophoneTestActive(true)
      const sample = () => {
        if (generation !== microphoneTestGenerationRef.current) return
        analyser.getByteTimeDomainData(samples)
        let energy = 0
        for (const value of samples) energy += Math.abs(value - 128)
        setMicrophoneTestLevel(Math.min(100, Math.round((energy / samples.length) * 5)))
        microphoneTestFrameRef.current = window.requestAnimationFrame(sample)
      }
      sample()
    } catch {
      localTrack?.stop()
      stream?.getTracks().forEach((track) => track.stop())
      await context?.close().catch(() => {})
      if (generation === microphoneTestGenerationRef.current) {
        stopMicrophoneTest()
        setMessage('Não foi possível iniciar o teste de microfone. Confira as permissões e tente novamente.', 'error')
      }
    } finally { if (generation === microphoneTestGenerationRef.current) setMicrophoneTestStarting(false) }
  }

  function getScreenShareProfile() {
    return qualityProfile === 'smooth'
      ? { width: 1280, height: 720, frameRate: 30, maxBitrate: 3_000_000, maxFramerate: 30 }
      : qualityProfile === 'gaming'
        ? { width: 1280, height: 720, frameRate: 60, maxBitrate: 6_000_000, maxFramerate: 60 }
      : qualityProfile === 'auto'
        ? { width: 1920, height: 1080, frameRate: 30, maxBitrate: 6_000_000, maxFramerate: 30 }
        : { width: 1920, height: 1080, frameRate: 60, maxBitrate: 12_000_000, maxFramerate: 60 }
  }

  async function startScreenShare(room: Room) {
    setScreenAudioWarning('')
    if (shareAudioMode === 'application') throw new Error('Para escolher o áudio de um aplicativo, use o Barracord para Windows.')
    const profile = getScreenShareProfile()
    setSharingQuality(`${profile.height}p · até ${profile.frameRate} fps`)
    const publication = await room.localParticipant.setScreenShareEnabled(
      true,
      { audio: shareAudio, resolution: { width: profile.width, height: profile.height, frameRate: profile.frameRate } },
      { screenShareEncoding: { maxBitrate: profile.maxBitrate, maxFramerate: profile.maxFramerate } },
    )
    if (!publication || publication.source !== Track.Source.ScreenShare) throw new Error('A tela não foi publicada.')
    setIsSharing(true)
    setMessage('Sua tela está ao vivo.')
  }

  async function startScreenShareFromSource(room: Room, sourceId: string, audioSourceIds: string[], audioMode: ShareAudioMode) {
    const shareAudio = audioMode !== 'none'
    setScreenAudioWarning('')
    const profile = getScreenShareProfile()
    setSharingQuality(`${profile.height}p · até ${profile.frameRate} fps`)
    const video: DesktopVideoConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: profile.width,
        maxHeight: profile.height,
        maxFrameRate: profile.frameRate,
      },
    }
    setMessage(isLinuxDesktop ? 'Escolha a tela ou janela na janela do sistema…' : 'O Windows está iniciando a captura da tela…')
    let systemAudioWarning = ''
    let stream: MediaStream
    if (isLinuxDesktop) {
      // The desktop portal's dialog opens here and waits for the person, so
      // there is no timeout. Sound never comes from the portal: PipeWire
      // provides it below through the app-audio bridge.
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { width: profile.width, height: profile.height, frameRate: profile.frameRate } })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('A escolha de tela foi cancelada.')
        throw error
      }
    } else if (audioMode === 'system' && window.chriscordDesktop) {
      const prepared = await window.chriscordDesktop.prepareShareCapture(sourceId, true)
      if (!prepared.ok) throw new Error('O Windows não preparou o áudio do sistema para esta transmissão.')
      try {
        stream = await withTimeout(
          // System sound is not a microphone. Chromium otherwise enables its
          // voice pipeline (AEC, noise suppression and AGC) for this loopback
          // source, which can suppress game/music audio entirely.
          navigator.mediaDevices.getDisplayMedia({
            audio: {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              channelCount: 2,
              sampleRate: 48_000,
            },
            video: { width: profile.width, height: profile.height, frameRate: profile.frameRate },
          }),
          15_000,
          'O Windows não iniciou a captura da tela e do som em 15 segundos.',
        )
      } catch {
        systemAudioWarning = 'A tela está ao vivo, mas o Windows não liberou o som do sistema.'
        recordSafeEvent('warning', 'screen-audio-capture-failed-video-only')
        stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({ audio: false, video }),
          15_000,
          'O Windows não iniciou a captura da tela em 15 segundos.',
        )
      }
    } else {
      stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: false, video }),
        15_000,
        'O Windows não iniciou a captura da tela em 15 segundos.',
      )
    }
    const mediaTrack = stream.getVideoTracks()[0]
    if (!mediaTrack || roomRef.current !== room) {
      stream.getTracks().forEach((track) => track.stop())
      throw new Error(`A captura foi cancelada ou ${systemText.the} não devolveu vídeo.`)
    }
    mediaTrack.contentHint = 'detail'
    const localTrack = new LocalVideoTrack(mediaTrack, video, true)
    localTrack.source = Track.Source.ScreenShare
    let systemAudioTrack = stream.getAudioTracks()[0]
    let appCapture: AppAudioCapture | null = null
    let localAudioTrack: LocalAudioTrack | null = null
    try {
      if (audioMode === 'application' || (isLinuxDesktop && audioMode === 'system')) {
        try {
          // On Linux, "system" means every application except Barracord itself.
          appCapture = await captureAppAudio(isLinuxDesktop && audioMode === 'system' ? ['pipewire:all'] : audioSourceIds, (detail) => {
            const audio = localScreenAudioTrackRef.current
            if (audio && audio.mediaStreamTrack === appCapture?.track) {
              localScreenAudioTrackRef.current = null
              void room.localParticipant.unpublishTrack(audio, true).catch(() => {})
            }
            if (appAudioCaptureRef.current === appCapture) appAudioCaptureRef.current = null
            setScreenAudioWarning(detail)
            recordSafeEvent('warning', 'application-audio-capture-ended')
          })
          systemAudioTrack = appCapture.track
          appAudioCaptureRef.current = appCapture
        } catch (error) {
          systemAudioWarning = `A transmissão seguirá sem áudio. ${error instanceof Error ? error.message : `${systemText.The} não iniciou a captura do aplicativo.`}`
          recordSafeEvent('warning', 'application-audio-capture-failed')
        }
      }
      if (roomRef.current !== room) throw new Error('A call foi encerrada durante a captura.')
      const publication = await withTimeout(
        room.localParticipant.publishTrack(localTrack, {
          source: Track.Source.ScreenShare,
          screenShareEncoding: { maxBitrate: profile.maxBitrate, maxFramerate: profile.maxFramerate },
        }),
        15_000,
        'A tela foi capturada, mas não foi publicada na call em 15 segundos.',
      )
      if (publication.source !== Track.Source.ScreenShare) throw new Error('A call recusou a tela escolhida.')
      localScreenTrackRef.current = localTrack
      if (systemAudioTrack) {
        systemAudioTrack.contentHint = 'music'
        // Some Windows drivers ignore the initial display-media constraints.
        // Apply them again on the returned loopback track before LiveKit reads
        // its settings and advertises voice-processing features to the SFU.
        await systemAudioTrack.applyConstraints({
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 2,
          sampleRate: 48_000,
        }).catch(() => undefined)
        localAudioTrack = new LocalAudioTrack(systemAudioTrack, {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 2,
          sampleRate: 48_000,
        }, true)
        localAudioTrack.source = Track.Source.ScreenShareAudio
        try {
          await withTimeout(
            room.localParticipant.publishTrack(localAudioTrack, {
              source: Track.Source.ScreenShareAudio,
              dtx: false,
              forceStereo: true,
              audioPreset: { maxBitrate: 128_000 },
            }),
            10_000,
            'O áudio da transmissão demorou demais para entrar na call.',
          )
          localScreenAudioTrackRef.current = localAudioTrack
        } catch {
          localAudioTrack.stop()
          appCapture?.stop()
          if (appAudioCaptureRef.current === appCapture) appAudioCaptureRef.current = null
          appCapture = null
          systemAudioWarning = 'A tela está ao vivo, mas o áudio escolhido não entrou na call.'
          recordSafeEvent('warning', 'screen-audio-publish-failed')
        }
      } else if (shareAudio && !systemAudioWarning) {
        systemAudioWarning = `A tela está ao vivo, mas ${systemText.the} não devolveu áudio do sistema.`
        recordSafeEvent('warning', 'screen-audio-track-missing')
      }
      if (roomRef.current !== room || mediaTrack.readyState !== 'live' || (appCapture && systemAudioTrack?.readyState !== 'live')) {
        throw new Error('A captura foi encerrada durante o início da transmissão.')
      }
    } catch (error) {
      appCapture?.stop()
      if (appAudioCaptureRef.current === appCapture) appAudioCaptureRef.current = null
      if (localScreenTrackRef.current === localTrack) localScreenTrackRef.current = null
      if (localScreenAudioTrackRef.current === localAudioTrack) localScreenAudioTrackRef.current = null
      void room.localParticipant.unpublishTrack(localTrack, true).catch(() => {})
      if (localAudioTrack) void room.localParticipant.unpublishTrack(localAudioTrack, true).catch(() => {})
      stream.getTracks().forEach((track) => track.stop())
      localTrack.stop()
      localAudioTrack?.stop()
      throw error
    }
    setIsSharing(true)
    setScreenAudioWarning(systemAudioWarning)
    setMessage(systemAudioWarning || (audioMode === 'application' ? 'Sua tela e o áudio dos aplicativos escolhidos estão ao vivo.' : shareAudio ? 'Sua tela e o som do sistema estão ao vivo.' : 'Sua tela está ao vivo, sem áudio.'), systemAudioWarning ? 'warning' : 'info')
  }

  async function toggleScreenShare() {
    if (shareStartPendingRef.current) { setMessage(`Aguarde ${systemText.the} concluir o início da transmissão.`); return }
    const room = roomRef.current
    if (!room) return
    try {
      if (isSharing) {
        const localTrack = localScreenTrackRef.current
        if (localTrack) await room.localParticipant.unpublishTrack(localTrack, true)
        else await room.localParticipant.setScreenShareEnabled(false)
        const localAudioTrack = localScreenAudioTrackRef.current
        if (localAudioTrack) await room.localParticipant.unpublishTrack(localAudioTrack, true)
        localScreenTrackRef.current = null
        localScreenAudioTrackRef.current = null
        // LocalTrackUnpublished keeps the visual state in sync, including when
        // Windows ends a capture outside of the Barracord.
      } else if (window.chriscordDesktop && !isLinuxDesktop) {
        const sources = await window.chriscordDesktop.getShareSources()
        if (!sources.length) throw new Error('O Windows não encontrou telas ou janelas para compartilhar.')
        setShareSources(sources)
        setMessage('Escolha uma tela ou janela para transmitir.')
      } else if (isLinuxDesktop) setLinuxShareOpen(true)
      else await startScreenShare(room)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Escolha uma tela ou janela e permita o acesso para transmitir.'
      setMessage(detail, 'error')
      recordSafeEvent('error', `Falha ao iniciar transmissão: ${detail}`)
    }
  }

  async function switchScreenShareSource() {
    const room = roomRef.current
    if (!room || !isSharing) return
    try {
      setMessage('Escolha a nova tela ou janela. A transmissão volta em seguida.')
      const localTrack = localScreenTrackRef.current
      if (localTrack) await room.localParticipant.unpublishTrack(localTrack, true)
      else await room.localParticipant.setScreenShareEnabled(false)
      const localAudioTrack = localScreenAudioTrackRef.current
      if (localAudioTrack) await room.localParticipant.unpublishTrack(localAudioTrack, true)
      localScreenTrackRef.current = null
      localScreenAudioTrackRef.current = null
      if (window.chriscordDesktop && !isLinuxDesktop) {
        const sources = await window.chriscordDesktop.getShareSources()
        if (!sources.length) throw new Error('O Windows não encontrou telas ou janelas para compartilhar.')
        setShareSources(sources)
      } else if (isLinuxDesktop) setLinuxShareOpen(true)
      else await startScreenShare(room)
    } catch { setMessage('A troca foi cancelada. Sua transmissão foi encerrada.') }
  }

  async function openStreamWindow() {
    const video = remoteVideoElementRef.current
    if (!(video instanceof HTMLVideoElement)) return setMessage('A janela da transmissão ainda está carregando.')
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch { setMessage('Este computador não permite abrir a transmissão em janela flutuante.', 'warning') }
  }

  function watchRemoteStream() {
    const video = remoteVideoElementRef.current
    if (!video) {
      setMessage('A transmissão ainda está carregando. Tente novamente em instantes.')
      return
    }
    // This is also a user gesture fallback for Windows builds that keep a
    // remotely attached audio element paused until the viewer interacts with
    // the stream.
    remoteAudioRef.current?.querySelectorAll('audio').forEach((audio) => {
      void audio.play().catch(() => undefined)
    })
    remoteVideoPublicationRef.current?.setVideoDimensions({ width: 1920, height: 1080 })
    watchingStreamRef.current = true
    setWatchingStream(true)
    remoteVideoRef.current?.replaceChildren(video)
    setMessage(`Você está assistindo à transmissão de ${streamPublisher || 'um membro'}.`)
  }

  function stopWatchingStream() {
    remoteVideoPublicationRef.current?.setVideoQuality(VideoQuality.HIGH)
    watchingStreamRef.current = false
    setWatchingStream(false)
    remoteVideoRef.current?.replaceChildren()
    streamMiniPlayerRef.current?.replaceChildren()
    if (streamFullscreen && window.chriscordDesktop) void window.chriscordDesktop.setStreamFullscreen(false).then(setStreamFullscreen).catch(() => setMessage('Não foi possível sair da tela cheia.', 'error'))
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    setMessage('Você parou de assistir à transmissão.')
  }

  function openStreamFullscreen() {
    if (stageView === 'voice') return void toggleStreamFullscreen()
    setStageView('voice')
    window.setTimeout(() => void toggleStreamFullscreen(), 0)
  }

  async function toggleStreamFullscreen() {
    const stage = streamStageRef.current
    if (window.chriscordDesktop) {
      try { setStreamFullscreen(await window.chriscordDesktop.setStreamFullscreen(!streamFullscreen)) }
      catch { setMessage('Não foi possível abrir a transmissão em tela cheia.', 'error') }
      return
    }
    if (!stage) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await stage.requestFullscreen()
    } catch { setMessage('Não foi possível abrir a transmissão em tela cheia.', 'error') }
  }

  function disconnect() {
    cancelReconnect()
    setConnectionUnavailable(false)
    const room = roomRef.current
    roomRef.current = null
    void room?.disconnect()
    resetRoom('Você saiu da call.')
  }

  async function switchVoiceChannel(targetRoom: string) {
    if (!connected) {
      await connect(undefined, targetRoom)
      return
    }
    if (activeVoiceChannel === targetRoom) {
      setStageView('voice')
      return
    }
    const oldRoom = roomRef.current
    cancelReconnect()
    roomRef.current = null
    void oldRoom?.disconnect()
    resetRoom(`Trocando para ${voiceChannels.find((channel) => channel.id === targetRoom)?.name ?? 'o canal'}…`)
    await connect(undefined, targetRoom)
  }

  function cancelReconnect() {
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = null
    reconnectAttemptsRef.current = 0
    setIsReconnecting(false)
  }

  function scheduleReconnect(targetRoom: string) {
    if (reconnectTimerRef.current !== null) return
    if (reconnectAttemptsRef.current >= 3) {
      setIsReconnecting(false)
      setConnectionUnavailable(true)
      setMessage('Não foi possível recuperar a call. Entre no canal novamente quando a conexão voltar.')
      recordSafeEvent('error', 'A recuperação automática da call não foi concluída após 3 tentativas.')
      return
    }
    reconnectAttemptsRef.current += 1
    const attempt = reconnectAttemptsRef.current
    setIsReconnecting(true)
    setConnectionUnavailable(false)
    setMessage(`Conexão perdida. Tentando voltar para a call (${attempt}/3)…`)
    recordSafeEvent('warning', `Tentativa ${attempt} de recuperar a call agendada.`)
    reconnectTimerRef.current = window.setTimeout(async () => {
      reconnectTimerRef.current = null
      const recovered = await connect(undefined, targetRoom, true)
      if (!recovered) scheduleReconnect(targetRoom)
    }, attempt * 2_000)
  }

  function requestVoiceChannel(targetRoom: string) {
    if (!connected || activeVoiceChannel === targetRoom) {
      void switchVoiceChannel(targetRoom)
      return
    }
    setPendingVoiceChannel(targetRoom)
  }

  async function sendTextMessage(event: FormEvent) {
    event.preventDefault()
    const body = textDraft.trim()
    if (!body) return
    try {
      const messagesEndpoint = tokenEndpoint.trim().replace(/\/token\/?$/, '/messages')
      const response = await fetch(messagesEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: selectedTextChannel, body, installationId: getInstallationId() }),
      })
      const result = await response.json() as { message?: TextMessage; error?: string }
      if (response.status === 401) { returnToActivation(); return }
      if (!response.ok || !result.message) throw new Error(result.error ?? 'Não foi possível enviar a mensagem.')
      setTextMessages((messages) => [...messages, result.message!])
      setTextDraft('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.', 'error') }
  }

  async function copyChatMessage(chat: TextMessage) {
    try {
      const copied = window.chriscordDesktop
        ? await window.chriscordDesktop.writeClipboard(chat.body)
        : await navigator.clipboard.writeText(chat.body).then(() => true)
      if (!copied) throw new Error('Não foi possível copiar.')
      setCopiedChatMessageId(chat.id)
      window.setTimeout(() => setCopiedChatMessageId((current) => current === chat.id ? '' : current), 1_800)
    } catch { setMessage('Não foi possível copiar esta mensagem.') }
  }

  function adminEndpoint(pathname: string) { return tokenEndpoint.trim().replace(/\/token\/?$/, pathname) }

  async function refreshAdmin() {
    if (!adminCode.trim()) { setAdminMessage('Informe a chave do anfitrião.'); return }
    setAdminLoading(true)
    try {
      const response = await fetch(adminEndpoint('/admin/status'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostCode: adminCode }) })
      const result = await response.json() as AdminData & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Não foi possível abrir a administração.')
      setAdminData(result)
      setChannelCatalog(result.channels)
      setAdminMessage('Painel atualizado.')
    } catch (error) { setAdminMessage(error instanceof Error ? error.message : 'Não foi possível abrir a administração.') }
    finally { setAdminLoading(false) }
  }

  async function createAdminInvite() {
    if (!adminCode.trim()) { setAdminMessage('Informe a chave do anfitrião.'); return }
    setAdminLoading(true)
    try {
      const response = await fetch(adminEndpoint('/admin/invites'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostCode: adminCode, label: newInviteLabel, expiresIn: newInviteExpiry }) })
      const result = await response.json() as { activationCode?: string; invites?: AdminInvite[]; error?: string }
      if (!response.ok || !result.activationCode) throw new Error(result.error ?? 'Não foi possível criar a ativação.')
      setAdminInvite(result.activationCode)
      if (result.invites) setAdminData((data) => data ? { ...data, invites: result.invites! } : data)
      setNewInviteLabel('')
      setNewInviteExpiry('day')
      setAdminMessage('Ativação única pronta para copiar. Ela não poderá ser exibida novamente.')
    } catch (error) { setAdminMessage(error instanceof Error ? error.message : 'Não foi possível criar o convite.') }
    finally { setAdminLoading(false) }
  }

  async function copyInvite(invite: string) {
    try {
      const copied = window.chriscordDesktop
        ? await window.chriscordDesktop.writeClipboard(invite)
        : await navigator.clipboard.writeText(invite).then(() => true)
      if (!copied) throw new Error('Não foi possível copiar.')
      setInviteCopyMessage('Convite copiado.')
    } catch { setInviteCopyMessage('Não foi possível copiar automaticamente.') }
  }

  async function revokeInvite(invite: AdminInvite) {
    if (!window.confirm(`Revogar o convite ${invite.code}? Ele não poderá mais autorizar novos computadores.`)) return
    setAdminLoading(true)
    try {
      const response = await fetch(`${adminEndpoint('/admin/invites')}/${encodeURIComponent(invite.code)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostCode: adminCode }) })
      const result = await response.json() as { invites?: AdminInvite[]; error?: string }
      if (!response.ok || !result.invites) throw new Error(result.error ?? 'Não foi possível revogar o convite.')
      setAdminData((data) => data ? { ...data, invites: result.invites! } : data)
      setAdminMessage('Convite revogado.')
    } catch (error) { setAdminMessage(error instanceof Error ? error.message : 'Não foi possível revogar o convite.') }
    finally { setAdminLoading(false) }
  }

  async function testBarracaConnection() {
    setAdminLoading(true)
    try {
      const response = await fetch(adminEndpoint('/health'), { cache: 'no-store' })
      if (!response.ok) throw new Error('A Barraca não respondeu.')
      if (tailscaleStatus === 'missing') throw new Error('A conexão privada não está instalada neste computador.')
      if (tailscaleStatus === 'offline') throw new Error('A conexão privada está desligada neste computador.')
      if (tailscaleStatus === 'needs-attention') throw new Error('A conexão privada não pôde ser confirmada neste computador.')
      const result = '✓ Conexão pronta: Barraca e rede privada estão respondendo.'
      setConnectionTestMessage(result)
      setAdminMessage(result)
      recordSafeEvent('info', 'Teste de conexão da Barraca concluído com sucesso.')
    } catch (error) {
      const result = error instanceof Error ? error.message : 'Não foi possível testar a conexão.'
      setConnectionTestMessage(`× ${result}`)
      setAdminMessage(result)
      recordSafeEvent('error', 'O teste de conexão da Barraca encontrou um problema.')
    }
    finally { setAdminLoading(false) }
  }

  async function copyDiagnostic() {
    try {
      const copied = window.chriscordDesktop
        ? await window.chriscordDesktop.writeClipboard(diagnosticText)
        : await navigator.clipboard.writeText(diagnosticText).then(() => true)
      if (!copied) throw new Error(`${systemText.The} não permitiu copiar o texto.`)
      setDiagnosticCopyMessage('Copiado para a área de transferência.')
    } catch { setDiagnosticCopyMessage('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.') }
  }

  async function copyEventLog() {
    const text = [
      'BARRACORD — REGISTRO LOCAL SEGURO',
      `Gerado: ${new Date().toLocaleString('pt-BR')}`,
      '',
      ...(eventLog.length ? eventLog.map((entry) => `${new Date(entry.at).toLocaleString('pt-BR')} — ${entry.level === 'error' ? 'ERRO' : entry.level === 'warning' ? 'AVISO' : 'INFO'} — ${entry.event}`) : ['Nenhum evento registrado neste computador ainda.']),
      '',
      'Este registro não inclui convites, chaves, tokens, endereços IP, hostnames ou nomes de membros.',
    ].join('\n')
    try {
      const copied = window.chriscordDesktop
        ? await window.chriscordDesktop.writeClipboard(text)
        : await navigator.clipboard.writeText(text).then(() => true)
      if (!copied) throw new Error('Não foi possível copiar.')
      setEventLogCopyMessage('Registro copiado para a área de transferência.')
    } catch { setEventLogCopyMessage('Não foi possível copiar automaticamente.') }
  }

  function clearEventLog() {
    localStorage.removeItem(safeLogStorageKey)
    setEventLog([])
    setEventLogCopyMessage('Registro local apagado deste computador.')
  }

  async function generateDiagnostic() {
    setAdminLoading(true)
    let voiceServer = 'não respondeu'
    try {
      const response = await fetch(adminEndpoint('/health'), { cache: 'no-store' })
      voiceServer = response.ok ? 'respondendo' : 'com problema'
    } catch { voiceServer = 'não respondeu' }

    const privateNetwork = tailscaleStatus === 'ready' ? 'pronta' : tailscaleStatus === 'missing' ? 'não instalada' : tailscaleStatus === 'offline' ? 'desligada' : tailscaleStatus === 'needs-attention' ? 'precisa de atenção' : 'não verificada'
    const activePeople = Object.values(channelPresence).reduce((total, people) => total + people.length, 0)
    const text = [
      'BARRACORD — DIAGNÓSTICO SEGURO',
      `Gerado: ${new Date().toLocaleString('pt-BR')}`,
      `Versão do app: ${appVersion}`,
      `Barraca: ${hostStatus.state === 'running' ? 'aberta' : hostStatus.state === 'starting' ? 'iniciando' : hostStatus.state === 'error' ? 'com problema' : 'fechada'}`,
      `Rede privada: ${privateNetwork}`,
      `Servidor de voz: ${voiceServer}`,
      `Canais de texto: ${channelCatalog.text.length}`,
      `Canais de voz: ${channelCatalog.voice.length}`,
      `Pessoas em calls: ${activePeople}`,
      '',
      'Este diagnóstico não inclui convites, chaves, tokens, endereços IP, hostnames ou nomes de membros.',
    ].join('\n')
    setDiagnosticText(text)
    setDiagnosticCopyMessage('')
    setAdminMessage('Diagnóstico seguro gerado. Você pode copiá-lo para suporte.')
    setAdminLoading(false)
  }

  async function removeMember(member: AdminMember) {
    const scope = member.networkLinked ? 'O computador também será removido imediatamente da Rede da Barraca.' : 'Este registro antigo não tem vínculo automático com a Rede da Barraca; o acesso ao app será removido, mas o dispositivo deverá ser removido manualmente no Tailscale.'
    if (!window.confirm(`Remover ${member.name} da Barraca? ${scope}`)) return
    setAdminLoading(true)
    try {
      const response = await fetch(`${adminEndpoint('/admin/members')}/${encodeURIComponent(member.installationId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostCode: adminCode }) })
      const result = await response.json() as { error?: string; networkRemoved?: boolean }
      if (!response.ok) throw new Error(result.error ?? 'Não foi possível remover o membro.')
      setAdminMessage(result.networkRemoved ? `${member.name} foi removido da Barraca e da Rede privada.` : `${member.name} foi removido do Barracord. O dispositivo de rede desse registro antigo não foi alterado.`)
      await refreshAdmin()
    } catch (error) { setAdminMessage(error instanceof Error ? error.message : 'Não foi possível remover o membro.') }
    finally { setAdminLoading(false) }
  }

  async function createAdminChannel() {
    if (!newChannelName.trim()) { setAdminMessage('Dê um nome ao novo canal.'); return }
    setAdminLoading(true)
    try {
      const response = await fetch(adminEndpoint('/admin/channels'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostCode: adminCode, type: newChannelType, name: newChannelName }) })
      const result = await response.json() as { channels?: ChannelCatalog; error?: string }
      if (!response.ok || !result.channels) throw new Error(result.error ?? 'Não foi possível criar o canal.')
      setChannelCatalog(result.channels)
      setAdminData((data) => data ? { ...data, channels: result.channels! } : data)
      setNewChannelName('')
      setAdminMessage('Canal criado para toda a Barraca.')
    } catch (error) { setAdminMessage(error instanceof Error ? error.message : 'Não foi possível criar o canal.') }
    finally { setAdminLoading(false) }
  }

  async function renameAdminChannel() {
    if (!editingChannel || !editingChannelName.trim()) return
    setAdminLoading(true)
    try {
      const response = await fetch(`${adminEndpoint('/admin/channels')}/${encodeURIComponent(editingChannel.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostCode: adminCode, type: editingChannel.type, name: editingChannelName }) })
      const result = await response.json() as { channels?: ChannelCatalog; error?: string }
      if (!response.ok || !result.channels) throw new Error(result.error ?? 'Não foi possível renomear o canal.')
      setChannelCatalog(result.channels)
      setAdminData((data) => data ? { ...data, channels: result.channels! } : data)
      setEditingChannel(null)
      setAdminMessage('Canal renomeado.')
    } catch (error) { setAdminMessage(error instanceof Error ? error.message : 'Não foi possível renomear o canal.') }
    finally { setAdminLoading(false) }
  }

  async function deleteAdminChannel(type: 'text' | 'voice', channel: Channel) {
    if (!window.confirm(`Remover o canal ${channel.name}? Essa ação não pode ser desfeita.`)) return
    setAdminLoading(true)
    try {
      const response = await fetch(`${adminEndpoint('/admin/channels')}/${encodeURIComponent(channel.id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostCode: adminCode, type }) })
      const result = await response.json() as { channels?: ChannelCatalog; error?: string }
      if (!response.ok || !result.channels) throw new Error(result.error ?? 'Não foi possível remover o canal.')
      setChannelCatalog(result.channels)
      setAdminData((data) => data ? { ...data, channels: result.channels! } : data)
      if (type === 'text' && selectedTextChannel === channel.id) setSelectedTextChannel('geral')
      setAdminMessage('Canal removido.')
    } catch (error) { setAdminMessage(error instanceof Error ? error.message : 'Não foi possível remover o canal.') }
    finally { setAdminLoading(false) }
  }

  async function moveAdminChannel(type: 'text' | 'voice', channel: Channel, direction: 'up' | 'down') {
    setAdminLoading(true)
    try {
      const response = await fetch(`${adminEndpoint('/admin/channels')}/${encodeURIComponent(channel.id)}/order`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostCode: adminCode, type, direction }) })
      const result = await response.json() as { channels?: ChannelCatalog; error?: string }
      if (!response.ok || !result.channels) throw new Error(result.error ?? 'Não foi possível mover o canal.')
      setChannelCatalog(result.channels)
      setAdminData((data) => data ? { ...data, channels: result.channels! } : data)
      setAdminMessage('Ordem dos canais atualizada.')
    } catch (error) { setAdminMessage(error instanceof Error ? error.message : 'Não foi possível mover o canal.') }
    finally { setAdminLoading(false) }
  }

  async function changeDevice(kind: 'audioinput' | 'audiooutput', deviceId: string) {
    const room = roomRef.current
    if (!room) {
      if (kind === 'audioinput') {
        microphoneDeviceRef.current = deviceId
        setMicrophoneDevice(deviceId)
        if (microphoneTestActive) { stopMicrophoneTest(); await startMicrophoneTest(noiseModeRef.current) }
      } else {
        setSpeakerDevice(deviceId)
        const playback = microphoneTestPlaybackRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
        void playback?.setSinkId?.(deviceId).catch(() => setNoiseMessage('Não foi possível trocar a saída do teste.'))
      }
      setMessage('Preferência salva. Ela será aplicada ao entrar em uma call.')
      return
    }
    try {
      await room.switchActiveDevice(kind, deviceId)
      if (kind === 'audiooutput') {
        await Promise.all([...(remoteAudioRef.current?.querySelectorAll('audio') ?? [])].map(async (audio) => {
          const output = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
          await output.setSinkId?.(deviceId)
        }))
      }
      if (kind === 'audioinput') setMicrophoneDevice(deviceId)
      else setSpeakerDevice(deviceId)
    } catch { setMessage(`${systemText.The} não permitiu trocar esse dispositivo de áudio.`, 'error') }
  }

  async function startLinuxShare(audioMode: ShareAudioMode, audioSourceIds: string[]) {
    setLinuxShareOpen(false)
    const room = roomRef.current
    if (!room || shareStartPendingRef.current) return
    shareStartPendingRef.current = true
    try {
      await startScreenShareFromSource(room, '', audioSourceIds, audioMode)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'A tela escolhida não foi confirmada.'
      const cancelled = detail === 'A escolha de tela foi cancelada.'
      setMessage(detail, cancelled ? 'info' : 'error')
      if (!cancelled) recordSafeEvent('error', `Falha ao capturar a tela escolhida: ${detail}`)
    } finally { shareStartPendingRef.current = false }
  }

  async function chooseShareSource(sourceId: string | null, audioSourceIds: string[] = [], audioMode: ShareAudioMode = shareAudioMode) {
    if (!window.chriscordDesktop) return
    if (shareStartPendingRef.current) return
    if (sourceId !== null && audioMode === 'application' && (!audioSourceIds.length || audioSourceIds.length > 8 || audioSourceIds.some((id) => !shareSources?.some((source) => !source.isScreen && source.id === id)))) {
      setMessage('Escolha de 1 a 8 aplicativos de áudio disponíveis antes de transmitir.')
      return
    }
    setShareSources(null)
    if (sourceId === null) {
      setMessage('A escolha de tela foi cancelada.')
      return
    }
    const room = roomRef.current
    if (!room) return
    shareStartPendingRef.current = true
    try {
      await startScreenShareFromSource(room, sourceId, audioSourceIds, audioMode)
    } catch (error) {
      const detail = error instanceof Error ? error.message : `${systemText.The} não confirmou a tela escolhida.`
      setMessage(detail, 'error')
      recordSafeEvent('error', `Falha ao capturar a tela escolhida: ${detail}`)
    } finally { shareStartPendingRef.current = false }
  }

  const networkText = tailscaleStatus === 'ready' ? 'Conexão privada pronta' : tailscaleStatus === 'missing' ? 'Conexão privada ausente' : tailscaleStatus === 'offline' ? 'Conexão privada desligada' : tailscaleStatus === 'needs-attention' ? 'Conexão privada precisa de atenção' : 'Sala particular'
  const isHostApp = !window.chriscordDesktop || hostStatus.role === 'host'
  const hostIsRecovering = hostStatus.state === 'starting' && /recuperando/i.test(hostStatus.message)
  const hostStateLabel = hostStatus.state === 'running'
    ? 'Barraca aberta'
    : hostStatus.state === 'starting'
      ? hostIsRecovering ? 'Reconectando Barraca' : 'Abrindo Barraca'
      : hostStatus.state === 'error'
        ? 'Barraca com problema'
        : 'Barraca fechada'
  const hostStateDetail = hostStatus.state === 'running'
    ? 'Pronta para receber a galera neste computador.'
    : hostStatus.message
  const hostActionLabel = hostStatus.state === 'running'
    ? 'Fechar Barraca'
    : hostStatus.state === 'starting'
      ? hostIsRecovering ? 'Reconectando…' : 'Abrindo…'
      : hostStatus.state === 'error'
        ? 'Tentar novamente'
        : 'Abrir Barraca'

  function renderStreamPlaybackControls(compact = false) {
    return <div className={`stream-playback-controls ${compact ? 'compact' : ''}`} role="group" aria-label="Controles da transmissão" onDoubleClick={(event) => event.stopPropagation()}>
      <label className="stream-playback-volume"><ControlIcon name={streamVolume === 0 ? 'soundOff' : 'sound'} /><span>Volume</span><input type="range" min="0" max="100" value={streamVolume} onChange={(event) => setStreamVolume(Number(event.target.value))} aria-label="Volume da transmissão" /><output>{streamVolume}%</output></label>
      {compact && <button type="button" onClick={() => setStageView('voice')}>Expandir</button>}
      <button type="button" onClick={() => void openStreamWindow()} title="Abrir transmissão em janela flutuante" aria-label="Abrir transmissão em janela flutuante">↗<span>Janela</span></button>
      <button type="button" onClick={openStreamFullscreen} title={streamFullscreen || Boolean(document.fullscreenElement) ? 'Sair da tela cheia' : 'Tela cheia'} aria-label={streamFullscreen || Boolean(document.fullscreenElement) ? 'Sair da tela cheia' : 'Tela cheia'}><ControlIcon name="fullscreen" /><span>{streamFullscreen ? 'Reduzir' : 'Tela cheia'}</span></button>
      <button className="stop" type="button" onClick={stopWatchingStream}>Parar de assistir</button>
    </div>
  }

  function renderSettingsReworkPanel() {
    const qualityPresets = [
      { id: 'smooth', label: 'Fluidez', detail: 'Até 720p · 30 fps' },
      { id: 'gaming', label: 'Jogos HD', detail: 'Até 720p · 60 fps' },
      { id: 'auto', label: 'Equilibrado', detail: 'Até 1080p · 30 fps' },
      { id: 'maximum', label: 'Qualidade', detail: 'Até 1080p · 60 fps' },
    ] as const
    return <div className="settings-rework-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-rework-title">
      <section className="settings-rework-card">
        <header><div><small>AJUSTES DA SALA</small><h2 id="settings-rework-title">Configurações</h2></div><button type="button" onClick={closeSettings} aria-label="Fechar">×</button></header>
        <nav className="settings-tabs" aria-label="Categorias de configurações">
          <button type="button" className={settingsTab === 'audio' ? 'active' : ''} onClick={() => setSettingsTab('audio')}>Áudio</button>
          <button type="button" className={settingsTab === 'stream' ? 'active' : ''} onClick={() => setSettingsTab('stream')}>Transmissão</button>
          {isHostApp && <button type="button" className={settingsTab === 'barraca' ? 'active' : ''} onClick={() => setSettingsTab('barraca')}>Barraca</button>}
        </nav>
        <div className="settings-tab-content">
          {settingsTab === 'audio' && <>
            <section className="settings-section"><div className="settings-title"><strong>Dispositivos</strong><button type="button" onClick={() => void refreshDevices()}>Atualizar lista</button></div><label>Microfone<select value={microphoneDevice} onChange={(event) => void changeDevice('audioinput', event.target.value)} disabled={noiseChanging || microphoneTestStarting}><option value="default">Padrão do sistema</option>{devices.filter((device) => device.kind === 'audioinput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}</select></label><label>Saída de áudio<select value={speakerDevice} onChange={(event) => void changeDevice('audiooutput', event.target.value)}><option value="default">Padrão do sistema</option>{devices.filter((device) => device.kind === 'audiooutput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Saída ${index + 1}`}</option>)}</select></label><label className="volume-setting">Volume da galera <strong>{remoteVolume}%</strong><input type="range" min="0" max="100" value={remoteVolume} onChange={(event) => setRemoteVolume(Number(event.target.value))} /></label></section>
            <section className="settings-section noise-suppression-settings"><strong>Supressão de ruído do microfone</strong><label>Modo<select value={noiseMode} onChange={(event) => void changeNoiseMode(event.target.value as NoiseMode)} disabled={noiseChanging || microphoneTestStarting}><option value="off">Desligado</option><option value="basic">Básico · WebRTC</option><option value="rnnoise">RNNoise · avançado local</option></select></label><p>{noiseMode === 'rnnoise' ? 'Reduz ruídos no seu computador, sem enviar áudio a um serviço externo.' : noiseMode === 'basic' ? 'Usa a redução de ruído padrão do navegador/Electron.' : 'Sem supressão de ruído. O cancelamento de eco continua ativo.'} O áudio dos jogos e das transmissões não passa por este filtro.</p><p className="noise-mode-status" role="status">{noiseChanging || microphoneTestStarting ? 'Preparando áudio…' : connected && microphoneOn ? `Microfone usando ${noiseModeLabels[noiseMode]}.` : microphoneTestActive ? `Teste usando ${noiseModeLabels[noiseMode]}.` : `Preferência salva: ${noiseModeLabels[noiseMode]}. Será aplicada ao ligar o microfone.`}</p>{noiseMessage && <p className="noise-mode-warning" role="status">{noiseMessage}</p>}
              <div className="microphone-test"><div><small>TESTE DE MICROFONE</small><strong>{connected ? 'Saia da call para comparar o som do microfone.' : microphoneTestActive ? 'Fale normalmente e compare os modos.' : 'Teste antes de entrar em uma call.'}</strong></div><div className="microphone-level" aria-label="Nível do microfone após o filtro"><i style={{ width: `${microphoneTestLevel}%` }} /></div><label className="microphone-listen-option"><input type="checkbox" checked={listenToMicrophoneTest} onChange={(event) => setListenToMicrophoneTest(event.target.checked)} disabled={connected} />Ouvir minha voz no teste (use fones)</label><button type="button" onClick={() => void toggleMicrophoneTest()} disabled={connected || microphoneTestStarting || noiseChanging}>{microphoneTestStarting ? 'Preparando…' : microphoneTestActive ? 'Parar teste' : 'Testar microfone'}</button></div>
            </section>
            <section className="settings-section voice-shortcut-settings"><strong>Atalho de voz</strong><p>Funciona com o Barracord em foco. A tecla nunca é capturada enquanto você está digitando no chat.</p><label>Modo<select value={voiceKeyMode} onChange={(event) => void changeVoiceKeyMode(event.target.value as 'off' | 'push-to-talk' | 'push-to-mute')}><option value="off">Desligado</option><option value="push-to-talk">Apertar para falar</option><option value="push-to-mute">Apertar para mutar</option></select></label><label>Tecla<select value={voiceShortcut} onChange={(event) => setVoiceShortcut(event.target.value)} disabled={voiceKeyMode === 'off'}><option value="Space">Espaço</option><option value="KeyV">V</option><option value="KeyC">C</option><option value="CapsLock">Caps Lock</option></select></label>{voiceKeyMode !== 'off' && <div className="voice-shortcut-preview"><kbd>{voiceShortcutLabel}</kbd><span>{voiceKeyMode === 'push-to-talk' ? 'Segure para falar' : 'Segure para mutar'}</span></div>}</section>
          </>}
          {settingsTab === 'stream' && <section className="settings-section settings-streaming"><strong>Qualidade da próxima transmissão</strong><p>O perfil define os limites de captura e envio; a resolução e a fluidez podem variar conforme a janela e a conexão. Alterações valem para a próxima transmissão.</p><div className="quality-options">{qualityPresets.map((preset) => <button key={preset.id} className={qualityProfile === preset.id ? 'selected' : ''} type="button" onClick={() => setQualityProfile(preset.id)}><b>{preset.label}</b><span>{preset.detail}</span></button>)}</div><div className="settings-help-card"><strong>Som da transmissão</strong><p>{isLinuxDesktop ? 'No Linux, escolha ao compartilhar os aplicativos que estão tocando som, ou todo o som do computador. A call do Barracord nunca entra na transmissão.' : window.chriscordDesktop ? 'No Windows, marque os aplicativos de áudio ao compartilhar. A captura isolada é experimental. Sistema inteiro inclui todos os sons, inclusive outras calls.' : 'A captura isolada por aplicativo está disponível no cliente Windows. No navegador, as opções de áudio dependem do seletor de compartilhamento.'} O microfone é controlado separadamente.</p></div></section>}
          {settingsTab === 'stream' && <section className="settings-section"><strong>Ao assistir</strong><label>Quando alguém iniciar uma transmissão<select value={streamStartPreference} onChange={(event) => setStreamStartPreference(event.target.value as 'notice' | 'open' | 'none')}><option value="notice">Mostrar aviso para eu escolher assistir</option><option value="open">Abrir automaticamente</option><option value="none">Não abrir nem avisar automaticamente</option></select></label><p>Esta preferência controla a recepção das transmissões dos outros e é salva neste computador.</p></section>}
          {settingsTab === 'barraca' && isHostApp && <section className="settings-section host-availability-setting"><strong>Barraca neste computador</strong><p>Quando o Barracord Anfitrião abrir, deixe a Barraca pronta para a galera. Fechar o app ainda encerra a Barraca.</p><label><input type="checkbox" checked={keepBarracaAvailable} onChange={(event) => setKeepBarracaAvailable(event.target.checked)} /> Manter a Barraca disponível ao abrir</label></section>}
        </div>
        <footer><button className="settings-done" type="button" onClick={closeSettings}>Pronto</button></footer>
      </section>
    </div>
  }

  function renderAdminReworkPanel() {
    const tabs: Array<{ id: typeof adminTab; label: string }> = [
      { id: 'overview', label: 'Visão geral' }, { id: 'invites', label: 'Convites' }, { id: 'channels', label: 'Canais' }, { id: 'members', label: 'Membros' }, { id: 'tools', label: 'Ferramentas' },
    ]
    return <div className="admin-rework-overlay" role="dialog" aria-modal="true" aria-labelledby="admin-rework-title"><section className="admin-rework-card">
      <header><div><small>PAINEL DO ANFITRIÃO</small><h2 id="admin-rework-title">Administrar a Barraca</h2></div><button type="button" onClick={() => setAdminOpen(false)} aria-label="Fechar">×</button></header>
      {!adminData ? <div className="admin-unlock-rework"><p>Use a chave do anfitrião para organizar convites, canais e membros.</p><label>Chave do anfitrião<input value={adminCode} onChange={(event) => setAdminCode(event.target.value)} type="password" placeholder="Digite a chave" autoFocus /></label><button type="button" onClick={() => void refreshAdmin()} disabled={adminLoading}>{adminLoading ? 'Abrindo…' : 'Abrir painel'}</button><small>{adminMessage}</small></div> : <>
        <nav className="admin-tabs" aria-label="Categorias de administração">{tabs.map((tab) => <button key={tab.id} type="button" className={adminTab === tab.id ? 'active' : ''} onClick={() => setAdminTab(tab.id)}>{tab.label}</button>)}</nav>
        <div className="admin-tab-content">
          {adminTab === 'overview' && <section className="admin-tab-section"><div className="admin-overview-intro"><strong>Barraca agora</strong><p>Veja o estado atual e atualize os dados quando precisar.</p></div><div className="admin-summary admin-summary-rework"><span><b>{adminData.members.length}</b> autorizados</span><span><b>{Object.values(adminData.presence).reduce((total, people) => total + people.length, 0)}</b> na call</span><span><b>{adminData.metrics?.streamCount ?? 0}</b> transmissões</span></div><div className="admin-overview-actions"><button type="button" onClick={() => void refreshAdmin()} disabled={adminLoading}>{adminLoading ? 'Atualizando…' : 'Atualizar agora'}</button><button type="button" onClick={() => void testBarracaConnection()} disabled={adminLoading}>Testar conexão</button></div></section>}
          {adminTab === 'invites' && <section className="admin-tab-section"><div className="admin-section-head"><div><small>ATIVAÇÕES</small><strong>Chame alguém para a Barraca</strong></div></div><div className="invite-create-form"><input value={newInviteLabel} onChange={(event) => setNewInviteLabel(event.target.value)} maxLength={32} placeholder="Para quem é? (opcional)" /><select value={newInviteExpiry} onChange={(event) => setNewInviteExpiry(event.target.value as 'day' | 'week')}><option value="day">Expira em 24h</option><option value="week">Expira em 7 dias</option></select><button type="button" onClick={() => void createAdminInvite()} disabled={adminLoading}>Gerar ativação</button></div>{adminInvite && <div className="new-invite-highlight"><div><small>ATIVAÇÃO NOVA — COPIE AGORA</small><code>{adminInvite}</code></div><button type="button" onClick={() => void copyInvite(adminInvite)}>Copiar</button></div>}<div className="invite-list">{adminData.invites.length ? adminData.invites.map((invite) => <article key={invite.code}><div><header><code>{invite.code}</code><span className={`invite-status ${invite.status}`}>{invite.status}</span></header><p>{invite.label || 'Sem observação'} · criado em {new Date(invite.createdAt).toLocaleDateString('pt-BR')}{invite.expiresAt ? ` · expira em ${new Date(invite.expiresAt).toLocaleDateString('pt-BR')}` : ''}</p></div><aside>{invite.status === 'ativo' && <button type="button" onClick={() => void revokeInvite(invite)} disabled={adminLoading}>Revogar</button>}</aside></article>) : <p className="invite-empty">Nenhuma ativação criada ainda.</p>}</div></section>}
          {adminTab === 'channels' && <section className="admin-tab-section"><div className="admin-section-head"><div><small>CANAIS</small><strong>Organize a Barraca</strong></div><button type="button" onClick={() => setChannelOrderOpen(true)}>Ordenar</button></div><div className="admin-channel-create"><select value={newChannelType} onChange={(event) => setNewChannelType(event.target.value as 'text' | 'voice')}><option value="text">Canal de texto</option><option value="voice">Canal de voz</option></select><input value={newChannelName} onChange={(event) => setNewChannelName(event.target.value)} placeholder="Nome do canal" maxLength={32} /><button type="button" onClick={() => void createAdminChannel()} disabled={adminLoading}>Criar</button></div><div className="admin-channel-groups">{(['text', 'voice'] as const).map((type) => <div className="admin-channel-group" key={type}><small>{type === 'text' ? 'TEXTO' : 'VOZ'}</small>{adminData.channels[type].map((channel) => <article key={channel.id}>{editingChannel?.type === type && editingChannel.id === channel.id ? <><input value={editingChannelName} onChange={(event) => setEditingChannelName(event.target.value)} maxLength={32} autoFocus /><button type="button" onClick={() => void renameAdminChannel()} disabled={adminLoading}>Salvar</button><button type="button" onClick={() => setEditingChannel(null)}>Cancelar</button></> : <><span>{type === 'text' ? '#' : '◉'}</span><strong>{channel.name}</strong>{channel.protected ? <em>padrão</em> : <div><button type="button" onClick={() => { setEditingChannel({ type, id: channel.id }); setEditingChannelName(channel.name) }}>Renomear</button><button type="button" onClick={() => void deleteAdminChannel(type, channel)} disabled={adminLoading}>Remover</button></div>}</>}</article>)}</div>)}</div></section>}
          {adminTab === 'members' && <section className="admin-tab-section"><div className="admin-section-head"><div><small>MEMBROS</small><strong>Computadores autorizados</strong></div></div><div className="admin-members">{adminData.members.map((member) => <article key={member.installationId}><span>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>Autorizado em {new Date(member.authorizedAt).toLocaleDateString('pt-BR')}</small></div><button type="button" onClick={() => void removeMember(member)} disabled={adminLoading}>Remover</button></article>)}</div></section>}
          {adminTab === 'tools' && <section className="admin-tab-section admin-tools"><strong>Ferramentas do anfitrião</strong><p>Use estas ações para acompanhar e diagnosticar a Barraca sem sair do app.</p><button type="button" onClick={() => setDashboardOpen(true)}>Abrir painel ao vivo</button><button type="button" onClick={() => void generateDiagnostic()} disabled={adminLoading}>Gerar diagnóstico</button><button type="button" onClick={() => setEventLogOpen(true)}>Ver registros locais</button></section>}
        </div>
      </>}
      <footer><span>{adminData ? adminMessage : 'Apenas o anfitrião consegue alterar a Barraca.'}</span><button type="button" onClick={() => setAdminOpen(false)}>Fechar</button></footer>
    </section></div>
  }

  const hostControl = window.chriscordDesktop && isHostApp && <section className={`host-control ${hostStatus.state}`}><div><small>ESTE COMPUTADOR</small><strong>{hostStateDetail}</strong></div><button type="button" onClick={() => void toggleHost()} disabled={hostStatus.state === 'starting'}>{hostActionLabel}</button></section>
  const textChannels = channelCatalog.text
  const voiceChannels = channelCatalog.voice.map((channel) => ({ ...channel, icon: channel.id === 'afk' ? '◌' : '◉' }))
  const voiceChannelName = voiceChannels.find((channel) => channel.id === activeVoiceChannel)?.name
  const onlineVoiceCount = Object.values(channelPresence).reduce((total, people) => total + people.length, 0)
  const fallbackMembers: PresenceMember[] = Object.entries(channelPresence).flatMap(([channelId, people]) => people.map((person) => ({ installationId: person.identity, name: person.name, status: 'em-call' as const, channelId })))
  const directoryMembers = presenceMembers.length ? presenceMembers : fallbackMembers
  const viewerId = getInstallationId()
  const profileMembers = new Map(presenceMembers.map((member) => [member.installationId, member]))
  function profileUrl(id: string, avatarRevision?: string) {
    const query = new URLSearchParams({ installationId: viewerId, ...(avatarRevision ? { v: avatarRevision } : {}) })
    const endpoint = tokenEndpoint.trim().replace(/\/token\/?$/, '/profiles')
    return `${endpoint}/${encodeURIComponent(id)}${avatarRevision ? '/avatar' : ''}?${query}`
  }
  function memberAvatar(id: string, name: string, className: string) {
    const member = profileMembers.get(id)
    const revision = member?.avatarRevision
    return <ProfileAvatar name={member?.name || name} className={className + ' ' + avatarTone(id)}
      image={revision ? profileUrl(id, revision) : undefined}
      onClick={() => setProfileTarget({ id, name: member?.name || name })} />
  }
  const memberGroups = (['streaming', 'em-call', 'online', 'away', 'offline'] as const).map((status) => ({ status, members: directoryMembers.filter((member) => member.status === status).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) })).filter((group) => group.members.length)
  const estimatedUploadMbps = adminData?.metrics?.estimatedUploadMbps ?? 0
  const uploadLoad = estimatedUploadMbps / hostUploadLimit
  const uploadAlert = estimatedUploadMbps === 0 ? 'normal' : uploadLoad >= .9 ? 'critical' : uploadLoad >= .7 ? 'warning' : 'normal'
  const showingVoiceStage = connected && stageView === 'voice'
  const voiceShortcutLabel = voiceShortcut === 'Space' ? 'Espaço' : voiceShortcut === 'CapsLock' ? 'Caps Lock' : voiceShortcut === 'KeyV' ? 'V' : voiceShortcut === 'KeyC' ? 'C' : voiceShortcut
  const barracaUnavailable = authorizedInstallation && barracaAccess === 'unavailable'
  const barracaChecking = authorizedInstallation && barracaAccess === 'checking'
  const connectionLabel = isReconnecting ? 'Reconectando…' : barracaChecking ? 'Conferindo acesso…' : barracaUnavailable ? 'Barraca indisponível' : connectionUnavailable ? 'Sem conexão' : connected ? `Em ${voiceChannelName}` : authorizedInstallation ? 'Na Barraca' : networkText

  return <main className={`barracord-app ${streamFullscreen ? 'stream-window-fullscreen' : ''}`}>
    <header className="app-header">
      <div className="brand"><span className="brand-symbol">B</span><span>BARRACORD</span><small>v{appVersion}</small></div>
      <div className={`network-status ${isReconnecting ? 'reconnecting' : barracaUnavailable || connectionUnavailable ? 'offline' : tailscaleStatus === 'ready' || authorizedInstallation ? 'online' : ''}`}><i />{connectionLabel}</div>
      {window.chriscordDesktop && isHostApp && <button className={`host-header-action ${hostStatus.state}`} type="button" onClick={() => void toggleHost()} disabled={hostStatus.state === 'starting'} title={hostStateDetail}><i />{hostStateLabel}</button>}
      {window.chriscordDesktop && isHostApp && startWithWindowsAvailable && <button className={`host-header-action startup-action ${startWithWindows ? 'running' : ''}`} type="button" onClick={() => void changeStartWithWindows(!startWithWindows)}>{startWithWindows ? 'Inicia com Windows' : 'Iniciar com Windows'}</button>}
      {window.chriscordDesktop && isHostApp && <button className="host-header-action admin-trigger" type="button" onClick={() => setAdminOpen(true)}>Administrar</button>}
      {authorizedInstallation && !isHostApp && <button className="host-header-action" type="button" onClick={() => returnToActivation('Este computador foi desvinculado. Use uma ativação para entrar novamente.')}>Trocar acesso</button>}
      <button className="header-action" type="button" title="Configurações" onClick={openSettings}>⚙</button>
      <UpdateButton inCall={connected || isConnecting || isReconnecting} />
    </header>

    {settingsOpen && renderSettingsReworkPanel()}
    {adminOpen && renderAdminReworkPanel()}

    {window.chriscordDesktop && isHostApp && hostStatus.state !== 'running' && <section className={`host-availability-notice ${hostStatus.state}`} role="status"><div><small>{isDevelopment ? 'TESTE LOCAL' : 'ANFITRIÃO'}</small><strong>{hostStateLabel}</strong><span>{hostStatus.state === 'starting' ? hostIsRecovering ? 'A Barraca caiu, mas está tentando voltar sozinha. Aguarde alguns segundos.' : 'Preparando voz, chat e transmissão para a galera.' : hostStatus.state === 'error' ? hostStateDetail : 'Abra a Barraca neste PC para deixar a galera entrar.'}</span></div>{hostStatus.state !== 'starting' && <button type="button" onClick={() => void toggleHost()}>{hostActionLabel} →</button>}</section>}
    {hostRecoveryNotice && <aside className={`host-recovery-toast ${hostRecoveryNotice.kind}`} role="status"><i>{hostRecoveryNotice.kind === 'success' ? '✓' : '!'}</i><div><small>{hostRecoveryNotice.kind === 'success' ? 'RECUPERAÇÃO CONCLUÍDA' : 'AÇÃO NECESSÁRIA'}</small><strong>{hostRecoveryNotice.text}</strong></div><button type="button" onClick={() => setHostRecoveryNotice(null)} aria-label="Fechar aviso">×</button></aside>}
    {barracaUnavailable && <section className="barraca-unavailable-notice" role="status"><div><small>CONEXÃO COM A BARRACA</small><strong>A Barraca não respondeu.</strong><span>Ela pode estar fechada, ou a Rede da Barraca ainda pode estar iniciando neste computador.</span></div><button type="button" onClick={() => void verifyBarracaAccess()}>Tentar novamente</button></section>}

    <section className="room-layout">
      <aside className="room-nav">
        <div className="room-nav-title"><span className="room-nav-mark">B</span><strong>Barraca</strong><button type="button" onClick={openSettings} title="Configurações da Barraca" aria-label="Configurações da Barraca">⚙</button></div>
        <div className="channel-navigation">
          <div className="nav-label">CANAIS DE TEXTO</div>
          {textChannels.map((channel) => <button key={channel.id} className={`room-pill ${selectedTextChannel === channel.id && stageView === 'text' ? 'active' : ''}`} type="button" onClick={() => { setSelectedTextChannel(channel.id); setStageView('text') }}><span>#</span>{channel.name}</button>)}
          <div className="nav-label voice-nav-label">CANAIS DE VOZ</div>
          {voiceChannels.map((channel) => {
            const people = channelPresence[channel.id] ?? []
            const active = activeVoiceChannel === channel.id && stageView === 'voice'
            return <section className={`voice-channel-entry ${active ? 'active' : ''}`} key={channel.id}>
              <button className={`room-pill voice-pill ${active ? 'active' : ''}`} type="button" onClick={() => requestVoiceChannel(channel.id)} disabled={isConnecting || barracaAccess !== 'available'} title={people.map((person) => person.name).join(', ')}><span>◉</span>{channel.name}<b>{activeVoiceChannel === channel.id ? 'na call' : people.length || ''}</b></button>
              {people.length > 0 && <div className="voice-channel-members" aria-label={`Pessoas em ${channel.name}`}>{people.map((person) => {
                const speaking = activeVoiceChannel === channel.id && speakingIdentities.includes(person.identity)
                return <div className={`voice-channel-member ${person.identity === getInstallationId() ? 'self' : ''} ${speaking ? 'speaking' : ''}`} key={person.identity} aria-label={`${person.name}${speaking ? ', falando' : ''}`}>{memberAvatar(person.identity, person.name, 'voice-channel-avatar')}<strong>{person.name}{person.identity === getInstallationId() && <small> você</small>}</strong>{speaking && <span className="voice-speaking-indicator" aria-hidden="true">▂▅▃</span>}</div>
              })}</div>}
            </section>
          })}
        </div>
        <footer className="room-nav-footer">
          <section className="nav-call-panel">
            {connected && <div className={`nav-call-status ${isReconnecting ? 'reconnecting' : ''}`}><i /><span className="nav-call-description"><strong>{isReconnecting ? 'Reconectando…' : 'Voz conectada'}</strong><small>{voiceChannelName}</small></span>
              <span className={`call-ping ${isReconnecting || callPing === null ? 'unknown' : callPing < 100 ? 'good' : callPing < 200 ? 'fair' : 'poor'}`} title={isReconnecting ? 'Reconectando à call' : callPing === null ? 'Ping da call ainda indisponível' : 'Ping da call: ida e volta até o servidor de mídia. Atualizado a cada 3 segundos.'}><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="10" width="3" height="5" rx="1" /><rect x="6" y="6" width="3" height="9" rx="1" /><rect x="11" y="1" width="3" height="14" rx="1" /></svg><span>{isReconnecting || callPing === null ? '— ms' : `${callPing} ms`}</span></span>
            </div>}
            <div className={`control-dock ${connected ? 'voice-actions' : ''}`}>
              {connected && <>
                <button className={`round-control ${microphoneOn ? 'enabled' : ''}`} type="button" onClick={toggleMicrophone} disabled={!connected} title={microphoneOn ? 'Microfone ligado' : 'Microfone desligado'} aria-label={microphoneOn ? 'Desligar microfone' : 'Ligar microfone'}><ControlIcon name={microphoneOn ? 'microphone' : 'microphoneOff'} /></button>
                <button className={`round-control deafen-control ${deafened ? 'deafened' : ''}`} type="button" onClick={() => void toggleDeafen()} disabled={!connected} title={deafened ? 'Voltar a ouvir' : 'Silenciar tudo'} aria-label={deafened ? 'Voltar a ouvir a call' : 'Silenciar tudo'} aria-pressed={deafened}><ControlIcon name={deafened ? 'deafen' : 'headphones'} /></button>
              </>}
              <Soundboard endpoint={tokenEndpoint} installationId={getInstallationId()} room={connected && !isReconnecting ? roomRef.current : null} deafened={deafened} speaker={speakerDevice} compact={connected} />
              {connected && <button className="leave-button" type="button" onClick={disconnect} title="Sair da call" aria-label="Sair da call"><ControlIcon name="leave" /></button>}
            </div>
            {connected && <button className={`screen-control ${isSharing ? 'broadcasting' : ''}`} type="button" onClick={toggleScreenShare} title={isSharing ? 'Encerrar transmissão' : 'Compartilhar tela'} aria-label={isSharing ? 'Encerrar transmissão' : 'Compartilhar tela'}><ControlIcon name="screen" /><span>{isSharing ? 'Encerrar transmissão' : 'Compartilhar tela'}</span></button>}
          </section>
          <div className="nav-user">{memberAvatar(viewerId, participantName || 'Você', 'mini-avatar')}<div><strong>{participantName || 'Você'}</strong><small>{connected ? `em ${voiceChannelName}` : 'na Barraca'}</small></div><button type="button" onClick={openSettings} title="Configurações" aria-label="Configurações"><ControlIcon name="settings" /></button></div>
        </footer>
      </aside>

      <section className="stage-card">
        {showingVoiceStage ? <>
          <div className="stage-head"><div><p>◉ {voiceChannelName}</p><span>{watchingStream ? `Assistindo ${streamPublisher}${isSharing ? ' · Você também está transmitindo' : ''}` : isSharing ? 'Você está transmitindo' : remoteStream ? 'Transmissão disponível' : 'Canal de voz'}</span></div>{isSharing && !watchingStream && <div className="quality" title="Limite configurado para o envio, não uma medição da transmissão">Perfil de envio: {sharingQuality}</div>}</div>
          <div ref={streamStageRef} className={`stream-stage ${isSharing ? 'own-stream' : ''} ${watchingStream ? 'watching-stream' : ''}`} onDoubleClick={() => { if (watchingStream) void toggleStreamFullscreen() }}>
            <div ref={remoteVideoRef} className="remote-video-frame" />
            {remoteStream && !watchingStream && <div className="stream-invite-card"><span className="stream-invite-icon"><ControlIcon name="screen" /></span><small>TRANSMISSÃO AO VIVO</small><strong>{streamPublisher || 'Alguém'} está transmitindo</strong><p>Entre para assistir ao jogo sem interromper a conversa.</p><button type="button" onClick={watchRemoteStream}>Assistir <span>→</span></button></div>}
            {!remoteStream && <div className="stage-empty"><span className="camp-icon">⌁</span><strong>{isSharing ? 'Sua tela está ao vivo' : `Você está em ${voiceChannelName}`}</strong><p>{isSharing ? 'Sua imagem está sendo compartilhada na call.' : 'Converse com a turma ou compartilhe uma tela para assistir juntos.'}</p></div>}
            {isSharing && <span className="live-label"><i /> VOCÊ ESTÁ AO VIVO</span>}
            {watchingStream && renderStreamPlaybackControls()}
          </div>
          {isSharing && <div className="stream-publisher-controls" role="group" aria-label="Controles da sua transmissão"><span>Sua transmissão</span><button type="button" onClick={() => setShowLocalPreview((value) => !value)}>{showLocalPreview ? 'Ocultar prévia' : 'Mostrar prévia'}</button><button type="button" onClick={() => void switchScreenShareSource()}>Trocar fonte</button><button className="stop" type="button" onClick={toggleScreenShare}>Encerrar transmissão</button></div>}
        </> : <>
          <div className="stage-head"><div><p>#{selectedTextChannel}</p><span>Canal de texto da Barraca</span></div></div>
          <div className="text-channel-stage">
            {watchingStream && <section className="text-stream-mini-player" aria-label={`Transmissão de ${streamPublisher || 'um membro'}`}>
              <header><span><i /> AO VIVO</span><strong>{streamPublisher || 'Alguém'} está transmitindo</strong></header>
              <div ref={streamMiniPlayerRef} className="text-stream-mini-video" />
              {renderStreamPlaybackControls(true)}
            </section>}
            {remoteStream && !watchingStream && <button className="stream-channel-notice" type="button" onClick={() => { setStageView('voice'); watchRemoteStream() }}><span><ControlIcon name="screen" /></span><div><small>TRANSMISSÃO AO VIVO</small><strong>{streamPublisher || 'Alguém'} está transmitindo agora</strong></div><b>Assistir →</b></button>}
            <div className="text-channel-intro"><span>#</span><div><strong>Bem-vindo a #{selectedTextChannel}</strong><p>Este é o começo do canal. As mensagens ficam guardadas na Barraca.</p></div></div>
            <div className="text-message-list">
              {textMessages.length ? textMessages.map((chat) => <article className={`text-message ${chat.installationId === getInstallationId() ? 'mine' : ''}`} key={chat.id}>
                {memberAvatar(chat.installationId, chat.author, 'text-avatar')}
                <div><header><strong>{chat.installationId === getInstallationId() ? 'Você' : chat.author}</strong><time>{new Date(chat.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time><button type="button" className="copy-chat-message" onClick={() => void copyChatMessage(chat)}>{copiedChatMessageId === chat.id ? 'Copiado' : 'Copiar'}</button></header><p><ChatMessageBody body={chat.body} /></p></div>
              </article>) : <p className="text-chat-empty">Esse canal ainda está quieto. Manda o primeiro salve.</p>}
            </div>
            <form className="text-composer" onSubmit={sendTextMessage}><input value={textDraft} onChange={(event) => setTextDraft(event.target.value)} maxLength={1_000} disabled={barracaAccess !== 'available'} placeholder={barracaAccess === 'available' ? `Conversar em #${selectedTextChannel}` : 'Aguardando conexão com a Barraca…'} aria-label={`Conversar em #${selectedTextChannel}. Emojis: ${systemText.emojiKeys}`} /><span className="emoji-hint" title={systemText.emojiHint}>☺</span><button type="submit" disabled={!textDraft.trim() || barracaAccess !== 'available'} title="Enviar mensagem">Enviar <span>↑</span></button></form>
          </div>
        </>}
        {isSharing && screenAudioWarning && <div className="stream-audio-notice" role="status">{screenAudioWarning}</div>}
        {watchingStream && streamVolume === 0 && <div className="stream-audio-notice" role="status"><span>O volume da transmissão está em 0%. Você não ouvirá o som compartilhado.</span><button type="button" onClick={() => setStreamVolume(100)}>Ativar som da transmissão</button></div>}
        <div className={`stage-message ${notice.tone} ${isConnecting || isReconnecting ? 'pending' : ''}`} role={notice.tone === 'error' ? 'alert' : 'status'}><i />{notice.tone === 'error' ? 'Erro: ' : notice.tone === 'warning' ? 'Atenção: ' : ''}{message}</div>
      </section>

      <aside className="members-panel">
        <div className="members-head"><span>Membros</span><b>{directoryMembers.length || onlineVoiceCount}</b></div>
        <div className="member-directory">{memberGroups.length ? memberGroups.map((group) => <section className={`member-group ${group.status}`} key={group.status}>
          <small>{group.status === 'streaming' ? 'TRANSMITINDO' : group.status === 'em-call' ? 'EM CALL' : group.status === 'online' ? 'ONLINE NA BARRACA' : group.status === 'away' ? 'AUSENTE' : 'OFFLINE'} <b>{group.members.length}</b></small>
          {group.members.map((member) => {
            const isSelf = member.installationId === getInstallationId()
            const channelName = voiceChannels.find((channel) => channel.id === member.channelId)?.name ?? 'uma call'
            const canAdjustAudio = !isSelf && (member.status === 'em-call' || member.status === 'streaming')
            const audio = participantAudio[member.installationId] ?? { volume: 100, muted: false }
            const statusText = member.status === 'streaming' ? `transmitindo em ${channelName}` : member.status === 'em-call' ? `em ${channelName}` : member.status === 'online' ? 'na Barraca' : member.status === 'away' ? 'ausente' : 'offline'
            return <article className={`member directory-member ${isSelf ? 'self' : ''}`} key={member.installationId} onContextMenu={(event) => { if (!canAdjustAudio) return; event.preventDefault(); setMemberAudioMenuId((current) => current === member.installationId ? null : member.installationId) }} title={canAdjustAudio ? 'Clique com o botão direito para ajustar o áudio' : undefined}>
              {memberAvatar(member.installationId, member.name, 'member-avatar')}
              <div className="remote-member-info"><strong>{member.name} {isSelf && <small>você</small>}</strong><span className={`member-status ${member.status}`}>{statusText}</span></div>
              {canAdjustAudio && memberAudioMenuId === member.installationId && <section className="member-audio-menu" role="menu" aria-label={`Áudio de ${member.name}`} onContextMenu={(event) => event.preventDefault()}><header><strong>Áudio de {member.name}</strong><button type="button" onClick={() => setMemberAudioMenuId(null)} aria-label="Fechar">×</button></header><button type="button" className={audio.muted ? 'muted' : ''} onClick={() => changeParticipantAudio(member.installationId, { muted: !audio.muted })}><ControlIcon name={audio.muted ? 'soundOff' : 'sound'} />{audio.muted ? 'Ouvir novamente' : 'Silenciar para mim'}</button><label>Volume <output>{audio.volume}%</output><input type="range" min="0" max="100" value={audio.volume} onChange={(event) => changeParticipantAudio(member.installationId, { volume: Number(event.target.value) })} aria-label={`Volume de ${member.name}`} /></label></section>}
            </article>
          })}
        </section>) : <div className="members-empty">A turma aparece aqui quando alguém entrar na Barraca.</div>}</div>
      </aside>
    </section>

    {connected && voiceShortcutPressed && <div className={`voice-shortcut-active ${voiceKeyMode}`} role="status"><span><ControlIcon name={voiceKeyMode === 'push-to-talk' ? 'microphone' : 'microphoneOff'} /></span><div><small>{voiceShortcutLabel}</small><strong>{voiceKeyMode === 'push-to-talk' ? 'VOCÊ ESTÁ FALANDO' : 'MICROFONE MUTADO'}</strong></div></div>}
    <div ref={remoteAudioRef} className="remote-audio-frame" aria-hidden="true" />
    {authorizedInstallation && profileTarget && <MemberProfile key={profileTarget.id} target={profileTarget} viewerId={viewerId}
      url={profileUrl(profileTarget.id)} close={() => setProfileTarget(null)}
      saved={(avatarRevision) => setPresenceMembers((members) => members.map((member) => member.installationId === viewerId ? { ...member, avatarRevision } : member))} />}

    {linuxShareOpen && <LinuxSharePicker audioMode={shareAudioMode} onAudioModeChange={setShareAudioMode} quality={nextShareQuality} onQualityChange={({ resolution, fps }) => setQualityProfile(resolution === 720 ? fps === 60 ? 'gaming' : 'smooth' : fps === 30 ? 'auto' : 'maximum')} onClose={() => { setLinuxShareOpen(false); setMessage('A escolha de tela foi cancelada.') }} onStart={(mode, ids) => void startLinuxShare(mode, ids)} />}
    {shareSources && <SharePicker sources={shareSources} audioMode={shareAudioMode} onAudioModeChange={setShareAudioMode} quality={nextShareQuality} onQualityChange={({ resolution, fps }) => setQualityProfile(resolution === 720 ? fps === 60 ? 'gaming' : 'smooth' : fps === 30 ? 'auto' : 'maximum')} onClose={() => void chooseShareSource(null)} onStart={(sourceId, audioSourceIds, mode) => void chooseShareSource(sourceId, audioSourceIds, mode)} onRefresh={async () => {
      const sources = await window.chriscordDesktop!.getShareSources()
      setShareSources((current) => current === null ? null : sources)
    }} />}

    {pendingVoiceChannel && <div className="voice-switch-overlay" role="dialog" aria-modal="true" aria-labelledby="voice-switch-title"><section className="voice-switch-card"><span className="voice-switch-icon">◉</span><small>TROCAR DE CANAL DE VOZ</small><h2 id="voice-switch-title">Ir para {voiceChannels.find((channel) => channel.id === pendingVoiceChannel)?.name}?</h2><p>Você vai sair de <b>{voiceChannelName}</b> e entrar no novo canal.</p>{isSharing && <div className="voice-switch-warning"><span>↗</span><p>Sua transmissão será encerrada ao trocar de canal.</p></div>}<div className="voice-switch-actions"><button type="button" onClick={() => setPendingVoiceChannel(null)}>Ficar em {voiceChannelName}</button><button type="button" className="confirm" onClick={() => { const nextChannel = pendingVoiceChannel; setPendingVoiceChannel(null); void switchVoiceChannel(nextChannel) }}>Trocar de canal <span>→</span></button></div></section></div>}

    {adminOpen && <div className="admin-overlay" role="dialog" aria-modal="true" aria-labelledby="admin-title"><section className="admin-card"><header><div><small>PAINEL DO ANFITRIÃO</small><h2 id="admin-title">Administrar a Barraca</h2></div><button type="button" onClick={() => setAdminOpen(false)} aria-label="Fechar">×</button></header><p className="admin-intro">Convites, membros e canais ficam sob seu controle.</p><div className="admin-unlock"><input value={adminCode} onChange={(event) => setAdminCode(event.target.value)} type="password" placeholder="Chave do anfitrião" /><button type="button" onClick={() => void refreshAdmin()} disabled={adminLoading}>{adminLoading ? 'Abrindo…' : adminData ? 'Atualizar' : 'Abrir painel'}</button></div>{adminData && <><div className="admin-summary"><span><b>{adminData.members.length}</b> autorizados</span><span><b>{Object.values(adminData.presence).reduce((total, people) => total + people.length, 0)}</b> na call</span></div><button className="admin-health" type="button" onClick={() => void testBarracaConnection()} disabled={adminLoading}>⌁ Testar conexão da Barraca</button><section className="admin-section"><div className="admin-section-head"><div><small>CONVITES</small><strong>Chame alguém para a Barraca</strong></div><button type="button" onClick={() => void createAdminInvite()} disabled={adminLoading}>＋ Gerar convite</button></div>{adminInvite && <div className="admin-invite"><code>{adminInvite}</code><button type="button" onClick={() => void navigator.clipboard.writeText(adminInvite)}>Copiar</button></div>}</section><section className="admin-section"><div className="admin-section-head"><div><small>CANAIS</small><strong>Organize a Barraca</strong></div></div><div className="admin-channel-create"><select value={newChannelType} onChange={(event) => setNewChannelType(event.target.value as 'text' | 'voice')}><option value="text">Canal de texto</option><option value="voice">Canal de voz</option></select><input value={newChannelName} onChange={(event) => setNewChannelName(event.target.value)} placeholder="Nome do canal" maxLength={32} /><button type="button" onClick={() => void createAdminChannel()} disabled={adminLoading}>Criar</button></div><div className="admin-channel-groups">{(['text', 'voice'] as const).map((type) => <div className="admin-channel-group" key={type}><small>{type === 'text' ? 'TEXTO' : 'VOZ'}</small>{adminData.channels[type].map((channel) => <article key={channel.id}>{editingChannel?.type === type && editingChannel.id === channel.id ? <><input value={editingChannelName} onChange={(event) => setEditingChannelName(event.target.value)} maxLength={32} autoFocus /><button type="button" onClick={() => void renameAdminChannel()} disabled={adminLoading}>Salvar</button><button type="button" onClick={() => setEditingChannel(null)}>Cancelar</button></> : <><span>{type === 'text' ? '#' : '◉'}</span><strong>{channel.name}</strong>{channel.protected ? <em>padrão</em> : <div><button type="button" onClick={() => { setEditingChannel({ type, id: channel.id }); setEditingChannelName(channel.name) }}>Renomear</button><button type="button" onClick={() => void deleteAdminChannel(type, channel)} disabled={adminLoading}>Remover</button></div>}</>}</article>)}</div>)}</div></section><section className="admin-section"><div className="admin-section-head"><div><small>MEMBROS</small><strong>Computadores autorizados</strong></div></div><div className="admin-members">{adminData.members.map((member) => <article key={member.installationId}><span>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>Autorizado em {new Date(member.authorizedAt).toLocaleDateString('pt-BR')}</small></div><button type="button" onClick={() => void removeMember(member)} disabled={adminLoading}>Remover</button></article>)}</div></section></>}<p className="admin-feedback">{adminMessage}</p></section></div>}

    {settingsOpen && <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Configurações"><section className="settings-card"><header><div><small>AJUSTES DA SALA</small><h2>Configurações</h2></div><button type="button" onClick={closeSettings} aria-label="Fechar">×</button></header><div className="settings-section"><div className="settings-title"><strong>Áudio</strong><button type="button" onClick={() => void refreshDevices()}>Atualizar</button></div><label>Microfone<select value={microphoneDevice} onChange={(event) => void changeDevice('audioinput', event.target.value)}><option value="default">Padrão do sistema</option>{devices.filter((device) => device.kind === 'audioinput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microfone ${index + 1}`}</option>)}</select></label><label>Saída de áudio<select value={speakerDevice} onChange={(event) => void changeDevice('audiooutput', event.target.value)}><option value="default">Padrão do sistema</option>{devices.filter((device) => device.kind === 'audiooutput').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Saída ${index + 1}`}</option>)}</select></label><label className="volume-setting">Volume da galera <strong>{remoteVolume}%</strong><input type="range" min="0" max="100" value={remoteVolume} onChange={(event) => setRemoteVolume(Number(event.target.value))} /></label><div className="microphone-test"><div><small>TESTE DE MICROFONE</small><strong>{connected ? (microphoneOn ? 'Seu microfone está ligado.' : 'Seu microfone está desligado.') : microphoneTestActive ? 'Fale normalmente para testar.' : 'Teste antes de entrar em uma call.'}</strong></div><div className="microphone-level" aria-label="Nível do microfone"><i style={{ width: `${microphoneTestLevel}%` }} /></div><button type="button" onClick={() => void toggleMicrophoneTest()} disabled={connected}>{microphoneTestActive ? 'Parar teste' : 'Testar microfone'}</button></div></div><div className="settings-section voice-shortcut-settings"><strong>Atalho de voz</strong><p>Funciona com o Barracord em foco. A tecla nunca é capturada enquanto você está digitando no chat.</p><label>Modo<select value={voiceKeyMode} onChange={(event) => void changeVoiceKeyMode(event.target.value as 'off' | 'push-to-talk' | 'push-to-mute')}><option value="off">Desligado</option><option value="push-to-talk">Apertar para falar</option><option value="push-to-mute">Apertar para mutar</option></select></label><label>Tecla<select value={voiceShortcut} onChange={(event) => setVoiceShortcut(event.target.value)} disabled={voiceKeyMode === 'off'}><option value="Space">Espaço</option><option value="KeyV">V</option><option value="KeyC">C</option><option value="CapsLock">Caps Lock</option></select></label>{voiceKeyMode !== 'off' && <div className="voice-shortcut-preview"><kbd>{voiceShortcutLabel}</kbd><span>{voiceKeyMode === 'push-to-talk' ? 'Segure para falar' : 'Segure para mutar'}</span></div>}</div><div className="settings-section"><strong>Qualidade da transmissão</strong><div className="quality-options"><button className={qualityProfile === 'smooth' ? 'selected' : ''} type="button" onClick={() => setQualityProfile('smooth')}><b>Suave</b><span>720p · 30 fps</span></button><button className={qualityProfile === 'auto' ? 'selected' : ''} type="button" onClick={() => setQualityProfile('auto')}><b>Automática</b><span>1080p · 30 fps</span></button><button className={qualityProfile === 'maximum' ? 'selected' : ''} type="button" onClick={() => setQualityProfile('maximum')}><b>Máxima</b><span>1080p · 60 fps</span></button></div><p>As preferências são salvas neste computador e valem na próxima call ou transmissão.</p></div>{isHostApp && <div className="settings-section host-availability-setting"><strong>Barraca neste computador</strong><p>Quando o Barracord Anfitrião abrir, deixe a Barraca pronta para a galera. Fechar o app ainda encerra a Barraca.</p><label><input type="checkbox" checked={keepBarracaAvailable} onChange={(event) => setKeepBarracaAvailable(event.target.checked)} /> Manter a Barraca disponível ao abrir</label></div>}<button className="settings-done" type="button" onClick={closeSettings}>Pronto</button></section></div>}

    {!authorizedInstallation && <div className="join-overlay"><form className="join-card" onSubmit={authorizeInstallation}>
      <div className="join-brand"><span className="brand-symbol">B</span><div><small>BEM-VINDO À</small><strong>BARRACORD</strong></div></div>
      <h1>{window.chriscordDesktop && !isHostApp && tailscaleStatus !== 'ready' ? <>Prepare seu acesso<br /><em>à Barraca.</em></> : <>A turma está<br /><em>na Barraca.</em></>}</h1>
      {window.chriscordDesktop && !isHostApp && tailscaleStatus !== 'ready' && <><label>Seu nome<input value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Como a galera te chama?" autoFocus /></label><label>Código de ativação<input value={invite} onChange={(event) => setInvite(event.target.value.trim())} placeholder="BARRACA1.…" type="text" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label></>}
      {window.chriscordDesktop && !isHostApp && tailscaleStatus !== 'ready' ? <section className="private-network-setup"><span className="network-setup-icon">⌁</span><div><small>REDE DA BARRACA</small><strong>{tailscaleStatus === 'missing' ? 'Vamos instalar a conexão privada.' : tailscaleStatus === 'offline' ? 'Vamos conectar este computador.' : tailscaleStatus === 'needs-attention' ? 'A conexão privada precisa de atenção.' : 'Vamos conferir sua conexão privada.'}</strong></div><p>O Barracord usa o código de ativação para conectar este PC. {systemText.The} pode pedir uma única confirmação de administrador; não é preciso criar nem acessar uma conta Tailscale.</p><div className="private-network-actions"><button type="button" onClick={() => void preparePrivateNetwork()} disabled={privateNetworkAction || privateNetworkChecking || !invite.trim() || tailscaleStatus === 'needs-attention'}>{privateNetworkAction ? 'Preparando…' : tailscaleStatus === 'needs-attention' ? 'Verifique a conexão' : 'Instalar e conectar'}</button><button className="secondary" type="button" onClick={() => void refreshPrivateNetworkStatus(tailscaleStatus === 'needs-attention' || tailscaleStatus === 'offline')} disabled={privateNetworkAction || privateNetworkChecking}>{privateNetworkChecking ? 'Verificando…' : tailscaleStatus === 'needs-attention' || tailscaleStatus === 'offline' ? systemText.confirm : 'Verificar novamente'}</button></div>{privateNetworkMessage && <em>{privateNetworkMessage}</em>}</section> : <><p>Use a ativação que recebeu para autorizar este computador uma única vez.</p><label>Seu nome<input value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Como a galera te chama?" autoFocus /></label><label>Código de ativação<input value={invite} onChange={(event) => setInvite(event.target.value.trim())} placeholder="BARRACA1.…" type="text" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>{isDevelopment ? <details><summary>Configuração avançada</summary><label>Servidor<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} /></label><label>Convites<input value={tokenEndpoint} onChange={(event) => setTokenEndpoint(event.target.value)} /></label></details> : <p className="private-setup"><i /> Conexão privada pronta.</p>}</>}
      {isDevelopment && hostControl}
      {isDevelopment && tailscaleStatus && tailscaleStatus !== 'ready' && <p className="network-note">{tailscaleStatus === 'missing' ? 'A conexão privada ainda não está instalada neste PC.' : 'Conecte a rede privada antes de entrar na sala.'}</p>}
      <p className="join-feedback">{message}</p>
      {window.chriscordDesktop && isHostApp && <button className="join-host-button" type="button" onClick={() => void bootstrapThisHost()} disabled={isConnecting}>{isConnecting ? 'Preparando…' : 'Entrar como anfitrião'}</button>}
      {!(window.chriscordDesktop && !isHostApp && tailscaleStatus !== 'ready') && <button className="join-button" type="submit" disabled={isConnecting}>{isConnecting ? 'Autorizando…' : 'Entrar na Barraca'} <span>→</span></button>}
    </form></div>}
    {adminOpen && adminData && <div className="admin-quick-actions" aria-label="Ações rápidas do anfitrião"><span>AÇÕES RÁPIDAS</span><button type="button" onClick={() => setDashboardOpen(true)}>▦ Painel</button><button type="button" onClick={() => setChannelOrderOpen(true)}>↕ Canais</button><button type="button" onClick={() => { setInviteManagerOpen(true); setInviteCopyMessage('') }}>✦ Convites</button><button type="button" onClick={() => void generateDiagnostic()} disabled={adminLoading}>▣ Diagnóstico</button><button type="button" onClick={() => { setEventLogOpen(true); setEventLogCopyMessage('') }}>☷ Registros</button>{connectionTestMessage && <div className={`connection-test-result ${connectionTestMessage.startsWith('✓') ? 'success' : 'error'}`}>{connectionTestMessage}</div>}</div>}
    {dashboardOpen && adminData && <div className="host-dashboard-overlay" role="dialog" aria-modal="true" aria-labelledby="host-dashboard-title"><section><header><div><small>VISÃO DO ANFITRIÃO</small><h2 id="host-dashboard-title">Barraca agora</h2></div><button type="button" onClick={() => setDashboardOpen(false)} aria-label="Fechar">×</button></header><p>Resumo ao vivo da Barraca. O upload é uma estimativa para ajudar a prever travamentos.</p><div className="host-dashboard-grid"><article><small>STATUS</small><strong className={hostStatus.state === 'running' ? 'good' : ''}>{hostStatus.state === 'running' ? 'Aberta' : 'Fechada'}</strong></article><article><small>ONLINE</small><strong>{adminData.members.length}</strong><span>computadores autorizados</span></article><article><small>EM CALL</small><strong>{Object.values(adminData.presence).reduce((total, people) => total + people.length, 0)}</strong><span>pessoas em voz</span></article><article><small>STREAMS</small><strong>{adminData.metrics?.streamCount ?? 0}</strong><span>{adminData.metrics?.estimatedUploadMbps ?? 0} Mbps estimados</span></article></div><section className="host-dashboard-rooms"><small>SALAS ATIVAS</small>{channelCatalog.voice.map((channel) => { const people = adminData.presence[channel.id] ?? []; return <div key={channel.id}><span>◉ {channel.name}</span><b>{people.length ? `${people.length} na call` : 'vazia'}</b></div> })}</section><div className="host-dashboard-actions"><button type="button" onClick={() => void refreshAdmin()} disabled={adminLoading}>{adminLoading ? 'Atualizando…' : 'Atualizar agora'}</button><button type="button" onClick={() => void testBarracaConnection()} disabled={adminLoading}>Testar Barraca</button><button type="button" onClick={() => void generateDiagnostic()} disabled={adminLoading}>Diagnóstico</button></div></section></div>}
    {diagnosticText && <div className="diagnostic-overlay" role="dialog" aria-modal="true" aria-labelledby="diagnostic-title"><section><header><div><small>SUPORTE SEGURO</small><h2 id="diagnostic-title">Diagnóstico da Barraca</h2></div><button type="button" onClick={() => setDiagnosticText('')} aria-label="Fechar">×</button></header><p>Este resumo pode ser copiado sem expor informações privadas.</p><pre>{diagnosticText}</pre><button className="diagnostic-copy" type="button" onClick={() => void copyDiagnostic()}>Copiar diagnóstico</button>{diagnosticCopyMessage && <small className="diagnostic-copy-message">{diagnosticCopyMessage}</small>}</section></div>}
    {eventLogOpen && <div className="event-log-overlay" role="dialog" aria-modal="true" aria-labelledby="event-log-title"><section><header><div><small>REGISTRO LOCAL</small><h2 id="event-log-title">Eventos da Barraca</h2></div><button type="button" onClick={() => setEventLogOpen(false)} aria-label="Fechar">×</button></header><p>Histórico deste computador para ajudar no diagnóstico. Não registra convites, dados de rede ou nomes de membros.</p><div className="event-log-list">{eventLog.length ? eventLog.map((entry, index) => <article className={entry.level} key={`${entry.at}-${index}`}><time>{new Date(entry.at).toLocaleString('pt-BR')}</time><strong>{entry.level === 'error' ? 'Erro' : entry.level === 'warning' ? 'Aviso' : 'Info'}</strong><span>{entry.event}</span></article>) : <div className="event-log-empty">Nenhum evento registrado neste computador ainda.</div>}</div><footer><button type="button" onClick={() => void copyEventLog()}>Copiar registro</button><button type="button" onClick={clearEventLog} disabled={!eventLog.length}>Apagar localmente</button></footer>{eventLogCopyMessage && <small className="event-log-feedback">{eventLogCopyMessage}</small>}</section></div>}
    {inviteManagerOpen && adminData && <div className="invite-manager-overlay" role="dialog" aria-modal="true" aria-labelledby="invite-manager-title"><section>
      <header><div><small>ACESSO À BARRACA</small><h2 id="invite-manager-title">Convites de ativação</h2></div><button type="button" onClick={() => setInviteManagerOpen(false)} aria-label="Fechar">×</button></header>
      <p>Cada ativação conecta somente um PC, expira e só pode ser copiada no momento em que é criada.</p>
      <div className="invite-create-form"><input value={newInviteLabel} onChange={(event) => setNewInviteLabel(event.target.value)} maxLength={32} placeholder="Para quem é? (opcional)" /><select value={newInviteExpiry} onChange={(event) => setNewInviteExpiry(event.target.value as 'day' | 'week')}><option value="day">Expira em 24h</option><option value="week">Expira em 7 dias</option></select><button type="button" onClick={() => void createAdminInvite()} disabled={adminLoading}>Gerar ativação</button></div>
      {adminInvite && <div className="new-invite-highlight"><div><small>ATIVAÇÃO NOVA — COPIE AGORA</small><code>{adminInvite}</code></div><button type="button" onClick={() => void copyInvite(adminInvite)}>Copiar</button></div>}
      {inviteCopyMessage && <p className="invite-copy-message">{inviteCopyMessage}</p>}
      <div className="invite-list">{adminData.invites.length ? adminData.invites.map((invite) => <article key={invite.code}><div><header><code>{invite.code}</code><span className={`invite-status ${invite.status}`}>{invite.status}</span></header><p>{invite.label || 'Sem observação'} · criado em {new Date(invite.createdAt).toLocaleDateString('pt-BR')}{invite.expiresAt ? ` · expira em ${new Date(invite.expiresAt).toLocaleDateString('pt-BR')}` : ''}{invite.activationReady && invite.status === 'ativo' ? ' · código exibido apenas na criação' : ''}</p></div><aside>{invite.status === 'ativo' && <button type="button" onClick={() => void revokeInvite(invite)} disabled={adminLoading}>Revogar</button>}</aside></article>) : <p className="invite-empty">Nenhuma ativação criada ainda.</p>}</div>
    </section></div>}
    {channelOrderOpen && adminData && <div className="channel-order-overlay" role="dialog" aria-modal="true" aria-labelledby="channel-order-title"><section><header><div><small>ORGANIZAÇÃO DA BARRACA</small><h2 id="channel-order-title">Ordem dos canais</h2></div><button type="button" onClick={() => setChannelOrderOpen(false)} aria-label="Fechar">×</button></header><p>O canal Geral fica protegido no topo. As mudanças aparecem para todos em instantes.</p><div className="channel-order-groups">{(['text', 'voice'] as const).map((type) => <section key={type}><small>{type === 'text' ? 'CANAIS DE TEXTO' : 'CANAIS DE VOZ'}</small>{adminData.channels[type].map((channel, index) => <article key={channel.id}><span>{type === 'text' ? '#' : '◉'}</span><strong>{channel.name}</strong>{channel.protected ? <em>fixo</em> : <div><button type="button" title="Subir" disabled={adminLoading || index <= 1} onClick={() => void moveAdminChannel(type, channel, 'up')}>↑</button><button type="button" title="Descer" disabled={adminLoading || index === adminData.channels[type].length - 1} onClick={() => void moveAdminChannel(type, channel, 'down')}>↓</button></div>}</article>)}</section>)}</div></section></div>}
    {dashboardOpen && adminData && <aside className={`host-upload-alert ${uploadAlert}`}><div><small>UPLOAD ESTIMADO</small><strong>{estimatedUploadMbps} de {hostUploadLimit} Mbps</strong><span>{uploadAlert === 'critical' ? 'A transmissão pode engasgar. Reduza a qualidade ou encerre uma stream.' : uploadAlert === 'warning' ? 'A Barraca está perto do limite. Fique de olho na transmissão.' : 'Uso confortável no momento.'}</span></div><label>Limite<input type="number" min="5" max="1000" value={hostUploadLimit} onChange={(event) => setHostUploadLimit(Math.max(5, Math.min(1000, Number(event.target.value) || 5)))} /> Mbps</label></aside>}
  </main>
}

export default App
