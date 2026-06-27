# Guia essencial do projeto

Este repositório é um starter kit de Feed Generator para AT Protocol/Bluesky.
Na prática, ele sobe um serviço HTTP/XRPC que:

1. assina o firehose da rede ATProto;
2. filtra eventos de posts;
3. grava no SQLite os posts que interessam ao algoritmo;
4. responde para o Bluesky uma lista de URIs de posts, chamada de feed skeleton.

O cliente Bluesky/PDS depois hidrata esses URIs com autor, texto, imagens, métricas e outros dados. Este serviço não precisa retornar posts completos.

## Visão rápida

O caminho principal do projeto é a implementação TypeScript em `src/`.
A pasta `go/` contém uma implementação alternativa em Go do mesmo starter kit.

Arquivos mais importantes:

- `src/index.ts`: entrada da aplicação. Carrega `.env`, monta a configuração e inicia o servidor.
- `src/server.ts`: cria Express, banco SQLite, assinatura do firehose e servidor XRPC.
- `src/subscription.ts`: regra atual de indexação dos eventos vindos do firehose.
- `src/util/subscription.ts`: infraestrutura para consumir `com.atproto.sync.subscribeRepos` e separar operações por tipo.
- `src/algos/index.ts`: registro dos algoritmos disponíveis.
- `src/algos/whats-alf.ts`: algoritmo de feed existente.
- `src/algos/pt-regex.ts`: feed personalizado em português filtrado por regex.
- `src/methods/feed-generation.ts`: endpoint `app.bsky.feed.getFeedSkeleton`.
- `src/methods/describe-generator.ts`: endpoint `app.bsky.feed.describeFeedGenerator`.
- `src/db/*`: schema, criação do SQLite e migrações.
- `src/well-known.ts`: expõe `/.well-known/did.json` para `did:web`.
- `scripts/publishFeedGen.ts`: publica ou atualiza o registro do feed no Bluesky.
- `scripts/unpublishFeedGen.ts`: remove o registro publicado.

## Como o fluxo funciona

Ao rodar `yarn start`, `src/index.ts` chama `FeedGenerator.create(...)` e depois `server.start()`.

`server.start()` faz três coisas:

1. roda as migrações do SQLite;
2. inicia a assinatura do firehose;
3. sobe o servidor HTTP.

O firehose é consumido por `FirehoseSubscription`, em `src/subscription.ts`.
Quando chega um commit do ATProto, o código chama `getOpsByType(evt)`, que separa creates/deletes de:

- posts;
- reposts;
- likes;
- follows.

Hoje o projeto só usa posts. Para cada post criado, ele verifica se o texto contém `alf`. Se contiver, grava na tabela `post`. Se receber deleção de post, remove a URI correspondente da tabela.

Depois, quando alguém chama:

```text
/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://did:example:alice/app.bsky.feed.generator/whats-alf
```

o arquivo `src/methods/feed-generation.ts`:

1. lê a URI do feed;
2. valida se o DID da URI é o `FEEDGEN_PUBLISHER_DID`;
3. valida se a collection é `app.bsky.feed.generator`;
4. pega o `rkey`, por exemplo `whats-alf`;
5. procura esse `rkey` no mapa `algos`;
6. executa o handler do algoritmo.

O algoritmo atual, `src/algos/whats-alf.ts`, consulta os posts salvos no banco, ordena do mais recente para o mais antigo e retorna:

```ts
{
  cursor,
  feed: [
    { post: 'at://...' }
  ]
}
```

## Banco de dados

O projeto usa SQLite com Kysely.

Schema atual:

```ts
post: {
  uri: string
  cid: string
  indexedAt: string
}

sub_state: {
  service: string
  cursor: number
}
```

A tabela `post` é o índice usado pelo feed.
A tabela `sub_state` guarda o cursor do firehose para o serviço conseguir retomar a assinatura de onde parou.

Por padrão, `.env.example` usa:

```env
FEEDGEN_SQLITE_LOCATION=":memory:"
```

Isso significa que os dados somem ao reiniciar. Para desenvolvimento persistente, use algo como:

```env
FEEDGEN_SQLITE_LOCATION="db.sqlite"
```

## Configuração

As variáveis vêm de `.env`.

Principais:

- `FEEDGEN_PORT`: porta HTTP local, padrão `3000`.
- `FEEDGEN_LISTENHOST`: host de bind, padrão `localhost`.
- `FEEDGEN_SQLITE_LOCATION`: arquivo SQLite ou `:memory:`.
- `FEEDGEN_SUBSCRIPTION_ENDPOINT`: endpoint do firehose, normalmente `wss://bsky.network`.
- `FEEDGEN_HOSTNAME`: domínio público do serviço.
- `FEEDGEN_PUBLISHER_DID`: DID da conta que publicará o feed.
- `FEEDGEN_SERVICE_DID`: opcional; se ausente, usa `did:web:${FEEDGEN_HOSTNAME}`.
- `FEEDGEN_SUBSCRIPTION_RECONNECT_DELAY`: espera entre reconexões do firehose.
- `FEEDGEN_MATCH_REGEX`: regex usado para decidir quais posts entram no feed `pt-regex`.
- `FEEDGEN_REFRESH_INTERVAL_MINUTES`: intervalo de atualização aproximado do feed, padrão `20`.

Não publique `.env`: ele pode conter dados sensíveis dependendo de como você configurar o projeto.

## Comandos

Instalar dependências:

```bash
yarn
```

Rodar em modo simples:

```bash
yarn start
```

Rodar em desenvolvimento com restart:

```bash
yarn dev
```

Compilar TypeScript:

```bash
yarn build
```

Publicar ou atualizar um feed no Bluesky:

```bash
yarn publishFeed
```

Remover um feed publicado:

```bash
yarn unpublishFeed
```

Observação: o `package.json` declara Yarn 1 como gerenciador. O repositório também tem um `package-lock.json`, mas o caminho esperado pelo projeto é `yarn.lock`.

## Como criar um novo feed

O ponto mais comum de customização é criar um algoritmo novo.

1. Crie um arquivo em `src/algos`, por exemplo `meu-feed.ts`.
2. Exporte um `shortname`.
3. Exporte um `handler(ctx, params)`.
4. Registre o algoritmo em `src/algos/index.ts`.
5. Ajuste `src/subscription.ts` se precisar indexar outros dados.

Exemplo de formato:

```ts
export const shortname = 'meu-feed'

export const handler = async (ctx, params) => {
  const rows = await ctx.db
    .selectFrom('post')
    .selectAll()
    .limit(params.limit)
    .execute()

  return {
    feed: rows.map((row) => ({ post: row.uri })),
  }
}
```

O `shortname` vira o `rkey` da URI:

```text
at://DID_DO_PUBLICADOR/app.bsky.feed.generator/meu-feed
```

## Feed personalizado atual

O projeto agora tem o feed `pt-regex`.

URI local de exemplo:

```text
http://localhost:3000/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://did:example:alice/app.bsky.feed.generator/pt-regex
```

Em produção, troque `did:example:alice` pelo valor de `FEEDGEN_PUBLISHER_DID`.

Ele indexa apenas:

- registros do tipo post;
- posts que declaram idioma `pt` ou variantes como `pt-BR`;
- posts cujo texto casa com `FEEDGEN_MATCH_REGEX`.

Exemplo de `.env`:

```env
FEEDGEN_MATCH_REGEX="/\\b(openai|typescript|bluesky)\\b/i"
FEEDGEN_REFRESH_INTERVAL_MINUTES=20
```

Também é possível usar só o padrão bruto:

```env
FEEDGEN_MATCH_REGEX="openai|typescript|bluesky"
```

Nesse formato bruto, o código aplica flag `i`, deixando a busca case-insensitive.

A atualização de aproximadamente 20 minutos funciona assim: o indexador continua lendo o firehose em tempo real, mas o algoritmo só expõe posts até o último intervalo fechado. Por exemplo, entre 10:00 e 10:19, ele não mostra posts da janela atual; quando chega 10:20, essa nova janela passa a aparecer. Isso deixa o feed estável dentro de cada bloco de tempo.

## Onde mexer para mudar a regra do feed

Se você quer mudar quais posts entram no índice, mexa em `src/subscription.ts`.
Hoje a regra é:

```ts
create.record.text.toLowerCase().includes('alf')
```

Você pode trocar isso por:

- filtro por palavra-chave;
- filtro por idioma;
- filtro por autor;
- filtro por hashtags;
- filtro por likes/reposts, desde que passe a indexar esses eventos;
- classificação externa, por exemplo um modelo ou API.

Se você precisa consultar dados já indexados de outro jeito, mexa no algoritmo em `src/algos/*`.

## Autenticação

`src/auth.ts` tem `validateAuth(...)`, que valida JWT assinado pelo usuário.
O endpoint de feed não usa isso atualmente; o trecho está comentado em `src/methods/feed-generation.ts`.

Para feeds públicos e iguais para todos, isso é aceitável.
Para feeds personalizados por usuário, você deve validar auth e usar o DID retornado:

```ts
const requesterDid = await validateAuth(
  req,
  ctx.cfg.serviceDid,
  ctx.didResolver,
)
```

## DID e publicação

O serviço pode usar `did:web`.
Nesse caso, `src/well-known.ts` responde:

```text
/.well-known/did.json
```

com um documento DID apontando para:

```text
https://FEEDGEN_HOSTNAME
```

Para o Bluesky encontrar seu serviço em produção:

1. o domínio de `FEEDGEN_HOSTNAME` precisa apontar para o servidor;
2. o serviço precisa responder via HTTPS na porta 443;
3. `/.well-known/did.json` precisa estar acessível;
4. o feed precisa estar publicado via `yarn publishFeed`.

O script de publicação cria um registro `app.bsky.feed.generator` no repositório da sua conta.
Esse registro contém o DID do serviço, nome, descrição, avatar e modo de conteúdo.

## Lexicons

A pasta `src/lexicon` contém tipos e servidor gerados a partir dos lexicons ATProto/Bluesky.
Em geral, você não precisa editar esses arquivos para criar um feed simples.

Use esses tipos para entender contratos de entrada e saída, especialmente:

- `app.bsky.feed.getFeedSkeleton`;
- `app.bsky.feed.describeFeedGenerator`;
- `com.atproto.sync.subscribeRepos`;
- `app.bsky.feed.post`;
- `app.bsky.feed.like`;
- `app.bsky.feed.repost`;
- `app.bsky.graph.follow`.

## Implementação Go

A pasta `go/` replica a ideia principal usando Go e a biblioteca `indigo`.
Ela tem servidor HTTP, assinatura do firehose, SQLite e o mesmo algoritmo `whats-alf`.

Use essa pasta como alternativa ou referência, mas ela não é acionada pelos comandos `yarn`.
Para rodar a versão Go:

```bash
cd go
go run .
```

## Pontos de atenção

- O feed atual é demonstrativo: ele indexa posts com a palavra `alf`.
- `src/subscription.ts` imprime o texto de todo post recebido no console; isso é útil para debug, mas ruidoso em produção.
- Com SQLite em memória, o feed começa vazio a cada restart.
- A paginação usa `indexedAt` convertido para timestamp em milissegundos como cursor.
- Se vários posts tiverem o mesmo `indexedAt`, a ordenação secundária por `cid` ajuda, mas o cursor só considera tempo; em um feed de produção, um cursor composto pode ser mais robusto.
- Se você criar feeds personalizados por usuário, valide autenticação.
- O projeto não tem testes automatizados configurados.

## Modelo mental para evoluir o projeto

Pense nele em duas metades:

1. Indexador: `src/subscription.ts` decide o que guardar quando eventos chegam do firehose.
2. Gerador: `src/algos/*` decide o que devolver quando o feed é solicitado.

Quase toda feature nova entra em uma dessas duas metades.
Se a informação necessária não está no banco, primeiro ajuste o indexador e o schema.
Se a informação já está no banco, ajuste ou crie um algoritmo.
