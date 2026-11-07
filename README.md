# Barracord

Cliente desktop para voz, chat, compartilhamento de tela e soundboard. O anfitrião roda o servidor da Barraca e o LiveKit. A rede privada usa Tailscale.

[Instaladores de convidado para Windows](https://github.com/ChrisRL95/barracord/releases)

## Atualizações do convidado no Windows

A partir da beta.20, o instalador NSIS do convidado verifica o canal beta no GitHub. A seta no cabeçalho baixa e instala a versão disponível. Durante uma call, o download pode terminar, e a instalação fica para um clique depois de sair.

Para publicar uma nova beta, aumente a versão em `package.json` e no lockfile, gere o instalador convidado e anexe o `.exe`, o `.exe.blockmap` e o `beta.yml` da mesma compilação à pré-release `v<versão>`. Publique os três arquivos juntos para que os clientes encontrem o manifesto e o instalador correspondente.

O atualizador é ativado no convidado Windows empacotado. A partir da beta.21, a verificação acontece ao abrir o app e a cada minuto enquanto ele estiver aberto. A versão de anfitrião usa um instalador próprio. Quem ainda usa a beta.19 precisa instalar manualmente uma versão com o atualizador.

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

## Cliente convidado para Linux

No Linux, instale as dependências com `npm ci` e configure `.env.tailnet` com os endereços do anfitrião. Use o comando de teste para abrir o convidado ou o comando de empacotamento para gerar AppImage e RPM em `release/guest-linux/`.

```sh
npm run desktop:guest:linux:test
npm run desktop:build:guest:linux
```

Os perfis funcionam nos dois clientes quando a Barraca usa o servidor atualizado. No Fedora com KDE Plasma, valide também o compartilhamento pelo seletor Wayland e o áudio pelo PipeWire.
