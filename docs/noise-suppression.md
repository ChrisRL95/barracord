# Supressão de ruído do microfone

Configurações → Áudio → Supressão de ruído do microfone oferece Desligado,
Básico (WebRTC) e RNNoise. RNNoise é o padrão quando não há preferência salva.
A escolha fica em `barracord.noiseSuppression` neste computador.
Cancelamento de eco e ganho automático continuam ativos nos três modos.
RNNoise desliga a supressão nativa para evitar dois supressores em sequência.
O filtro nunca é aplicado às trilhas de áudio das transmissões.

`src/noiseSuppression.ts` implementa o processador de áudio do LiveKit, em
48 kHz e mono. Os binários WASM são empacotados como data URLs e o worklet
como texto local; não há download do modelo nem serviço externo de áudio.
O adaptador de inicialização depende da propriedade `processor` da versão
fixada 0.4.1 de `@sapphi-red/web-noise-suppressor`; revisar o adaptador e executar
o teste abaixo antes de atualizar essa dependência. A publicação espera a
confirmação de inicialização, com limite de cinco segundos. Falhas de
inicialização usam Básico e mostram um aviso. O controller serializa mudanças
e impede publicar um microfone aberto depois de soltar o push-to-talk.
Trocas de dispositivo usam o restart do processador pelo SDK.

O teste local de microfone permite ouvir a própria voz com fones, comparando
os modos antes de entrar na call. O indicador lê a saída do filtro. O teste
é encerrado ao entrar na call e não publica o áudio no servidor.

Teste automatizado no Windows, com SAPI gerando fala diretamente em WAV,
sem capturar o microfone nem reproduzir som nos alto-falantes:

```powershell
npx electron scripts/test-noise-suppression-electron.cjs --production
```

Valida o código empacotado em file://, inicialização do WASM, redução de ruído
sintético, passagem de fala sintética, reinicialização, desligamento/limpeza,
modo Básico e liberação rápida de push-to-talk. Sem `--production`, usa Vite.
Os arquivos do teste ficam em `node_modules/.tmp`; nenhum login é necessário.
O teste sintético não substitui a avaliação de voz real, qualidade e CPU.

Validação manual: antes da call, abrir Configurações → Áudio, usar fones,
marcar Ouvir minha voz e iniciar o teste. Comparar Desligado/Básico/RNNoise
falando, digitando e com um ventilador ao fundo. Depois testar em call,
silenciar/reativar, trocar microfone, reconectar e usar push-to-talk. Conferir
que música e áudio de jogo compartilhados preservam seu som original.

Licenças completas são distribuídas em `public/licenses`, copiadas para
`dist/licenses` pelo Vite. Backup anterior à implementação:
`backups/before-noise-suppression-20261106-182652.zip`.
