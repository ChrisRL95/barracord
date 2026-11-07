# Barracord

Cliente desktop para voz, chat, compartilhamento de tela e soundboard. O anfitrião roda o servidor da Barraca e o LiveKit. A rede privada usa Tailscale.

[Instaladores de convidado para Windows](https://github.com/ChrisRL95/barracord/releases)

## Atualizações do convidado no Windows

A partir da beta.20, o instalador NSIS do convidado verifica o canal beta no GitHub. A seta no cabeçalho baixa e instala a versão disponível. Durante uma call, o download pode terminar, e a instalação fica para um clique depois de sair.

Para publicar uma nova beta, aumente a versão em `package.json` e no lockfile, gere o instalador convidado e anexe o `.exe`, o `.exe.blockmap` e o `beta.yml` da mesma compilação à pré-release `v<versão>`. Publique os três arquivos juntos para que os clientes encontrem o manifesto e o instalador correspondente.

O atualizador é ativado no convidado Windows empacotado. A versão de anfitrião usa um instalador próprio. A beta.19 precisa receber a beta.20 por instalação manual para começar a verificar as próximas versões.

## Desenvolvimento

Com Node.js 24 e npm, rode:

```sh
npm ci
npm run dev
```

Abra o endereço mostrado pelo Vite para trabalhar na interface. Para conectar a um anfitrião de teste, copie `.env.example` para `.env` e configure os endereços do LiveKit e do servidor de convites. Para abrir a janela Electron em desenvolvimento, rode `npm run desktop:dev`.

- `src/` contém a interface React e o cliente LiveKit.
- `electron/` contém a janela desktop, a integração de captura e o provisionamento Tailscale.
- `server/` contém o servidor do anfitrião, a biblioteca de sons e a gestão de membros.
- `native/app-audio/` contém o capturador WASAPI para Windows.

Para executar o servidor local, copie `.env.server.example` para `.env.server` e configure credenciais próprias. Use um servidor LiveKit compatível e os mesmos valores de API nos dois serviços. Os scripts Windows esperam o binário LiveKit em `tools/livekit/` e o MSI do Tailscale em `tools/tailscale/`. A captura por aplicativo pode ser compilada no Windows com `npm run audio:build`. Para builds conectados à sua rede, copie `.env.tailnet.example` para `.env.tailnet` e configure o seu anfitrião.

## Ponto de partida para o port Linux

A versão distribuída atualmente usa instaladores e integração de rede específicos do Windows. Para Fedora/KDE Plasma, o primeiro recorte é um cliente convidado com chat, voz e recepção de transmissões. A adaptação passa pela detecção e ativação do Tailscale, pelo empacotamento Linux e, numa etapa posterior, pela captura de tela e de áudio no ambiente Wayland/PipeWire. A interface web e o protocolo do servidor oferecem uma base para validar voz e chat antes de trabalhar no instalador.

```sh
npm run lint
npm run build
```
