# Captura de áudio por aplicativo (Windows)

Captura a árvore de processos da janela escolhida com `ActivateAudioInterfaceAsync`
e `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`. Não altera dispositivos,
não instala drivers e nunca faz fallback para o mixer global.

Aceita de 1 a 8 janelas na mesma captura. Janelas do mesmo PID e árvores de
processos já cobertas por outra seleção são deduplicadas. Cada processo produz
PCM independente; o AudioWorklet faz a mistura com limitador de picos.

Requer Windows com a API de process loopback (build 20348 ou superior; Windows 11
é o alvo recomendado). Duas janelas do mesmo processo/aplicativo não são isoladas
entre si. Conteúdo protegido e alguns aplicativos podem não fornecer amostras.

## Compilar

Instale Visual Studio Build Tools com C++ x64 e Windows SDK e execute na raiz:

```powershell
npm run audio:build
```

O binário fica em `tools/app-audio/barracord-app-audio.exe`, incluído como recurso
externo ao ASAR nos dois instaladores. A compilação usa CRT estática (`/MT`).
Não é necessário instalar compiladores nos computadores convidados.

## Cadeia de áudio

Janelas escolhidas → PIDs deduplicados → WASAPI process-loopback → PCM16 estéreo,
48 kHz por processo → pipe com pacotes identificados por fonte → IPC do Electron
→ AudioWorklet (mistura) → MediaStreamTrack
→ trilha LiveKit `ScreenShareAudio`.

O AudioWorklet tem buffer limitado a 200 ms e não toca nos alto-falantes locais.
Parar de compartilhar, fechar a janela de origem, sair da call, recarregar ou
fechar o Electron encerra a captura. Tokens separam sessões antigas das novas.
Nesta versão, fechar qualquer janela de origem interrompe todo o grupo de áudio
e mostra aviso; o vídeo continua, sem fallback para o sistema inteiro.

## Verificação automatizada

Os testes nativos emitem tons baixos pela saída padrão do Windows durante
alguns segundos. São processos com janelas ocultas, sem acesso à Barraca real.

```powershell
node scripts/build-app-audio.cjs --test-tools
node --test scripts/test-app-audio.cjs
npx electron scripts/test-app-audio-electron.cjs
```

O primeiro teste valida PCM estéreo, mistura/limitador, buffer limitado, silêncio sem dados e
isolamento entre processos com tons de 660/1110 Hz. Também valida encerramento
e proteção contra mensagens de sessões antigas. O segundo percorre preload,
AudioWorklet e uma conexão WebRTC local até o receptor; não utiliza o servidor
LiveKit nem substitui o teste manual do aplicativo completo. No teste WebRTC,
dois processos selecionados (660/1110 Hz) devem chegar e um terceiro (1680 Hz)
deve ficar fora. Duas janelas do primeiro processo não podem dobrar seu volume.

## Teste manual

1. Abra dois aplicativos independentes, com sons distintos (por exemplo jogo e Discord).
2. No Barracord, Compartilhar → escolha a imagem.
3. Em Áudio da transmissão escolha Aplicativos escolhidos e marque o jogo.
4. Inicie e assista com outra identidade; o jogo deve ser audível e o Discord não.
5. Pare a transmissão, troque de fonte e feche a janela do jogo; confirme aviso e
   ausência de som residual. Teste também Sem áudio e Sistema inteiro.
6. Marque jogo + outro programa, deixando Discord desmarcado. Ambos devem ser
   recebidos, sem a call do Discord. Confira também resolução e FPS no modal.

Ao testar sozinho, use aplicativos diferentes para gerar o som e assistir: duas
janelas de um mesmo navegador podem pertencer à mesma árvore de processos.

Referências: [Microsoft process loopback](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
e [parâmetros da API](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_process_loopback_params).
