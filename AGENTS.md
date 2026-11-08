# Barracord: instruções para agentes

O Barracord roda em **Windows e Linux**. O anfitrião (servidor, LiveKit,
convites) é só Windows; o convidado sai para Windows (instalador NSIS) e para
Linux (AppImage e RPM, testado no Fedora com KDE Plasma no Wayland). Toda
mudança precisa funcionar nos dois sistemas: considere o Linux em todo plano,
código e PR, mesmo quando o pedido só falar do Windows.

## Antes de mudar algo
- Procure se a área já tem um caminho para cada sistema e mexa nos dois:
  - `electron/main.cjs`: `isWindows` e `process.platform`;
  - `src/`: `isLinuxDesktop` e `systemText`, em `src/platformText.ts`.
- Não mude o comportamento do Windows para encaixar o Linux (nem o contrário).
  Separe por sistema quando o jeito de fazer for diferente.
- Se uma função não tiver como existir num dos sistemas, deixe isso claro na
  interface (texto ou botão desativado) e no PR. Ela não pode só quebrar.

## Partes que já são diferentes no Linux
- **Textos:** quando uma mensagem citar o sistema, use `systemText`
  ("o Windows" ou "o sistema"); não escreva "Windows" direto na interface.
- **Compartilhar tela:**
  - a imagem vem do diálogo do portal do desktop (`xdg-desktop-portal`), e a
    escolha de som e qualidade fica em `src/LinuxSharePicker.tsx`;
  - o som por aplicativo vem do PipeWire, em `electron/app-audio-linux.cjs`;
  - no Windows, a captura usa o `.exe` de `tools/app-audio` (`electron/app-audio.cjs`).
- **Rede da Barraca (Tailscale):** no Linux o `tailscale` vem do gerenciador de
  pacotes e roda como serviço do sistema (`linuxTailscalePaths` e
  `linuxUpFlags` em `electron/main.cjs`). Não existe instalador embutido.
- **Atualização automática** (`electron/app-update.cjs`):
  - Windows: o instalador NSIS, com `quitAndInstall`;
  - Linux: o próprio app troca o arquivo do AppImage e abre a cópia nova por
    um bash auxiliar. Não troque isso por `app.relaunch` nem pelo relaunch do
    electron-updater (o comentário no arquivo explica por quê);
  - o RPM não se atualiza sozinho.
- **Releases:** anexe também o `.AppImage` e o `beta-linux.yml` de
  `release/guest-linux/`. Sem o `beta-linux.yml`, quem usa Linux não recebe a
  versão nova.

## Cuidados de código
- **Maiúsculas e minúsculas:** o Linux diferencia nomes de arquivo.
  `import './appaudio'` funciona no Windows e quebra no Linux; confira a grafia
  de imports e de arquivos em `public/`.
- **Caminhos:**
  - use `path.join`, nunca barra invertida escrita no código;
  - no front, use caminhos relativos (`new URL('sounds/x.wav', document.baseURI)`),
    porque o app empacotado abre por `file://`.
- **Scripts do `package.json`:** os de Windows usam `set X=1&&` e `%TEMP%`, que
  não funcionam no shell do Linux. Ao criar ou mudar um script de teste ou
  build do convidado, crie ou ajuste também a versão `:linux`
  (`desktop:guest:linux:test`, `desktop:build:guest:linux`).
- **Recursos do Chromium:** saída de áudio (`setSinkId`), captura de tela e
  atalhos globais se comportam diferente no Wayland. Prefira APIs que já
  funcionam nos dois sistemas.
- **Instância única:** a trava é por perfil (`~/.config/barracord` no Linux).
  Com o Barracord instalado aberto, o `npm run desktop:guest:linux:test` só
  traz a janela dele para a frente e fecha.

## Testar
- Windows: `npm run desktop:guest:test`
- Linux: `npm run desktop:guest:linux:test`, e para empacotar,
  `npm run desktop:build:guest:linux`

Se não der para testar no Linux, diga isso no PR e liste o que precisa ser
conferido lá. O Ricardo testa o Linux.
