// Messages name the system the person is actually using. Windows (and the
// browser build) keeps the original wording; the Linux desktop app says
// "o sistema", since the answer there may come from the portal, PipeWire,
// polkit or tailscaled rather than from one vendor.

export const isLinuxDesktop = typeof window !== 'undefined' && window.chriscordDesktop?.platform === 'linux'

export const systemText = isLinuxDesktop
  ? {
      the: 'o sistema',
      The: 'O sistema',
      of: 'do sistema',
      confirm: 'Reconectar a rede',
      emojiKeys: 'use Meta e ponto',
      emojiHint: 'No KDE Plasma, pressione Meta + . para abrir os emojis',
    }
  : {
      the: 'o Windows',
      The: 'O Windows',
      of: 'do Windows',
      confirm: 'Confirmar com Windows',
      emojiKeys: 'use Windows e ponto',
      emojiHint: 'No Windows, pressione Windows + . para abrir os emojis',
    }
