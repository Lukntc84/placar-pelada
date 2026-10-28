# ⚽ Placar da Pelada

App web em Node.js para futebol amador. Funciona no celular, pode ser instalado como app e sincroniza em tempo real entre todos os aparelhos.

## Funcionalidades

- **Contas (celular + senha)**: para usar o app é preciso entrar. Quem se cadastra escolhe o próprio nome na lista de jogadores, ou cria o seu se não estiver nela.
  - **Jogador**: acompanha placar e estatísticas ao vivo e confirma a própria presença.
  - **Organizador**: cuida da mesa (gols, cronômetro, times, presença, fila). Quem promove é o administrador.
  - **Administrador**: só você. Além de tudo acima, muda as regras, faz backups e gerencia as contas (promover, ligar ao jogador, criar nova senha, desativar).
- **Jogadores**: cadastro com nome, apelido, posição e nível (1 a 5).
- **Confirmação de presença**: o organizador abre a lista para a data do jogo e manda o link no grupo. Cada jogador entra na conta e toca em "Vou" ou "Não vou" na tela inicial; só dá para responder por si mesmo. Depois, um toque marca os confirmados como presentes.
- **Presença do dia (aba Hoje)**: marque quem veio, com busca e "marcar todos". O resumo mostra quantos goleiros e jogadores de linha vieram e quantos times dá para formar. Quem chega depois que o dia começou entra direto na fila de avulsos. "Novo dia" limpa a presença, a fila e os times de próximo, mas mantém o histórico.
- **Sorteio**: usa só os presentes. Monta times de 5 na linha mais um goleiro fixo, quando houver, e equilibra pelo nível (ou pelo nível automático). Os 2 primeiros times jogam, os outros ficam de próximo e quem sobrar fica avulso. Dá para ajustar tocando no jogador.
- **Próximos**: times formados esperando e fila de avulsos por ordem de chegada. Quando 5 avulsos de linha se juntam, o app **fecha um time automaticamente**.
- **Goleiro de próximo**: time sem goleiro fixo joga com um avulso no gol, que não perde o lugar na fila. O app reveza quem vai pro gol. Gol, assistência, jogo e vitória contam para ele.
- **Partida**: gols, assistências, gol contra, gol sem autor, substituições e troca de goleiro. "Desfazer" não apaga o gol: ele fica em "Gols desfeitos", com quem registrou, quem desfez e a hora.
- **Cronômetro** controlado pelo servidor: todos os aparelhos mostram o mesmo tempo. Tem ajuste de ±1 min.
- **No campo**: a tela fica acesa durante a partida, o **apito** toca no fim do tempo ou quando a partida acaba, e o **placar grande** (📺) mostra o placar em tela cheia para quem está de fora.
- **Regras (aba ⚙️ Ajustes)**: tudo salva na hora, com um resumo das regras atuais no topo.
  - Jogadores por time (com goleiro) e duração da partida.
  - **Partida acaba com X gols** ou pelo tempo. 0 = só tempo. Se o gol que fechou a partida for desfeito, ela reabre pausada.
  - **Empate**: regra da casa = com 2 times de próximo saem os dois; com menos, fica quem ganhou a partida anterior. A alternativa é "escolher na hora".
  - **Nível automático** no sorteio: calculado pelo desempenho a partir de 5 jogos.
- **Estatísticas**: jogos, vitórias, gols, assistências e G+A por período, ranking de goleiros (gols sofridos por jogo), perfil do jogador (V/E/D, sequências, últimos jogos, nível automático), histórico e **resumo para o WhatsApp**.
- **Dados (aba ⚙️ Ajustes)**: MySQL da Hostinger (visível no phpMyAdmin) ou arquivo local, mais um **backup automático diário** que guarda os últimos 7 dias. Na mesma aba dá para baixar uma cópia, ver as cópias automáticas e restaurar.

## Como evita estatística contada duas vezes

1. **O servidor é a fonte da verdade, com tempo real (SSE).** Toda alteração vai para todos os aparelhos na hora.
2. **Escritas atômicas e em fila.** O estado fica na memória do processo Node.js, que aplica uma alteração por vez (`src/store.js`). Se der erro no meio, a alteração é desfeita por completo. Depois o app grava no MySQL, em transação.
3. **Chave de idempotência.** Cada toque leva um `Idempotency-Key`. Se o celular reenviar por falha de rede, o servidor não aplica de novo.
4. **Detecção de gol duplicado.** O mesmo jogador marcando pelo mesmo time em menos de 30 s é recusado: *"Gol de Rafa já foi registrado há 3s por Mesa"*. Se foi mesmo outro gol, a pessoa confirma e ele entra.
5. **Ações idempotentes por natureza.** Iniciar, pausar, desfazer, marcar presença, confirmar pelo link e "próxima partida" têm o mesmo efeito se feitos em dois aparelhos.
6. **Controle de versão.** O ajuste de ±1 min no cronômetro só vale se ninguém mudou a partida antes.
7. **Contas e papéis.** Só organizadores e o administrador registram lances, e cada lance fica assinado pelo nome da conta, não por um nome digitado no aparelho.

## Testes

```bash
npm test
```

Os testes sobem o servidor de verdade e cobrem concorrência, regras de empate, limite de gols, desfazer, goleiro de próximo, presença, confirmação, contas e permissões, troca e redefinição de senha, conta de admin, backups e persistência após reiniciar. O teste do MySQL (`test/mysql.test.js`) só roda com um banco de teste configurado. Ele **apaga as tabelas** desse banco, então nunca aponte para o banco de produção:

```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD= TEST_DB_NAME=teste npm test
```

## Rodar localmente

Requer Node.js 18.17 ou superior.

```bash
npm install
```

```bash
npm start
```

Crie um arquivo `.env` a partir do `.env.example` com `ADMIN_PHONE` e `ADMIN_PASSWORD`, abra http://localhost:3000 e entre com esse celular e senha. Sem `DB_HOST`, os dados ficam em `data/db.json`.

## Publicar na Hostinger

### 1. Criar o banco MySQL

1. No hPanel: **Bancos de dados → Gerenciamento → Criar novo banco de dados MySQL**.
2. Anote o nome do banco, o usuário e a senha. Na Hostinger os dois primeiros têm prefixo, por exemplo `u123456789_pelada`.
3. O host aparece na mesma tela. Para apps na própria Hostinger geralmente é `localhost`.

O app cria as tabelas sozinho na primeira execução. No **phpMyAdmin** você vê:

| Tabela | Conteúdo |
|---|---|
| `users` | contas (nome, celular, papel; a senha fica só como hash) |
| `players` | jogadores |
| `matches` | partidas (times, placar, status; detalhes completos na coluna `data`) |
| `match_events` | gols e assistências, incluindo os desfeitos (`removed_at`, `removed_by`) |
| `app_state` | configurações, fila, times de próximo, presença e confirmação (JSON) |

> Edite pelo app, não direto no phpMyAdmin. O app mantém o estado em memória e regrava o que mudar, então uma edição feita direto no banco pode ser sobrescrita. Se precisar editar manualmente, pare o app antes e inicie de novo depois.

Se existir um `data/db.json` (de testes locais) e o MySQL estiver vazio, o app importa os dados na primeira execução.

### 2. Publicar o app (Node.js Web App, planos Business/Cloud)

1. **Websites → Adicionar site → Node.js Apps**.
2. Envie o projeto pelo GitHub ou em `.zip`, sem `node_modules` nem `data`.
3. Configure o build: Node 20 ou 22, arquivo de entrada `server.js`, instalação `npm install` e início `npm start`.
4. Em **Variáveis de ambiente**, defina:
   - `ADMIN_PHONE` e `ADMIN_PASSWORD`: o seu celular e a sua senha de administrador. A conta é criada na primeira vez que o app liga.
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
   - `DATA_DIR`: uma pasta fora da pasta do app, onde ficam os backups diários (ex.: `/home/SEU_USUARIO/pelada-data`)
5. Faça o deploy e **ative o SSL (HTTPS)**. A tela acesa e a instalação como app só funcionam com HTTPS.

### Opção VPS

```bash
git clone SEU_REPOSITORIO pelada && cd pelada && npm install --omit=dev
```

```bash
pm2 start server.js --name pelada
```

Use Nginx como proxy reverso para a porta 3000, com `proxy_http_version 1.1; proxy_set_header Connection ''; proxy_buffering off; proxy_read_timeout 1h;` para o tempo real.

### Conta de administrador

- A conta é criada a partir de `ADMIN_PHONE`/`ADMIN_PASSWORD` só na primeira vez. Depois disso, troque a senha pelo app (Ajustes → Minha conta → Trocar senha).
- **Esqueceu a senha de admin?** Defina `ADMIN_RESET_PASSWORD=1` com a nova `ADMIN_PASSWORD`, reinicie o app uma vez e depois **apague** `ADMIN_RESET_PASSWORD`.
- Se um jogador esquecer a senha, crie uma nova em Ajustes → Contas → "Criar nova senha" e passe para ele.

### Importante

- **Rode uma única instância** do app (sem modo cluster). O processo único é o que garante a proteção contra duplicidade.
- Para instalar no celular, abra o site no Chrome (Android) e use "Adicionar à tela inicial". No iPhone, use Safari → Compartilhar → "Adicionar à Tela de Início".

## Estrutura

```
server.js              API, tempo real (SSE), regras da pelada e anti-duplicidade
src/store.js           estado em memória, transações e gravação em segundo plano
src/persist-mysql.js   gravação no MySQL (só as linhas que mudaram, em transação)
src/persist-json.js    gravação em arquivo (sem MySQL)
src/backup.js          backup automático diário
src/auth.js            contas, senhas (scrypt), sessões e papéis
public/                app (HTML/CSS/JS), confirmar.html, PWA (manifest, sw.js, ícones)
test/                  testes de integração
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | 3000 | Porta HTTP |
| `ADMIN_PHONE` / `ADMIN_PASSWORD` | vazio | Celular e senha da conta de administrador (criada na 1ª vez) |
| `ADMIN_RESET_PASSWORD` | vazio | `1` = redefine a senha do admin para `ADMIN_PASSWORD` ao iniciar |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | vazio / 3306 | MySQL. Sem `DB_HOST`, usa arquivo |
| `DATA_DIR` | `./data` | Pasta do `db.json` (sem MySQL) e dos backups |
| `BACKUP_DIR` | `DATA_DIR/backups` | Pasta dos backups diários |
| `BACKUP_KEEP` | 7 | Quantos dias de backup guardar |
| `TZ_BACKUP` | `America/Sao_Paulo` | Fuso usado no nome do arquivo de backup |
| `DUP_WINDOW_SECONDS` | 30 | Janela de detecção de gol duplicado |
