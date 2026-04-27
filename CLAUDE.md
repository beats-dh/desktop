# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Este arquivo orienta o Claude Code (claude.ai/code) ao trabalhar neste repositório.

## Regras Obrigatórias

- Sempre responder em **PT-BR**, independentemente do idioma da pergunta ou comando usado.
- Nunca compilar, empacotar ou rodar o app (`yarn start`, `yarn build:*`, `yarn package`, `yarn test:e2e:*`) sem o usuário pedir explicitamente — esse projeto é Electron e os builds são caros (webpack + electron-packager).
- Branch atual é `linux-update-3.5.8` (fork Linux). A branch base para PRs é `linux`, **não** `main` nem `development`. Sempre conferir antes de abrir PR.

## Sobre o Projeto

**GitHub Desktop — Linux Fork** (`shiftkey/desktop`). É um fork do upstream `desktop/desktop` que aplica patches específicos para suportar Linux (AppImage, `.deb`, `.rpm`) e gera releases para distros Linux. Stack: **Electron + TypeScript + React 16 + SCSS**, build com **webpack** e empacotamento com **electron-packager** / `electron-winstaller` / `electron-builder` (Linux).

> Este repositório aplica patches sobre o GitHub Desktop oficial. Mudanças em geral devem preservar compatibilidade com o upstream — divergir do upstream só quando necessário para Linux. Patches manuais ficam em `patches/` (ex.: `electron-installer-redhat+3.4.0.patch`).

## Comandos de Build

Node `>= 10` (na prática 20.17.0, ver `docs/contributing/setup.md`), Yarn `>= 1.9` (clássico), Python 3.9+ disponível (usado por algumas deps nativas no `postinstall`).

```bash
# Instalar dependências (roda postinstall que compila deps nativas e aplica patches)
yarn

# Desenvolvimento — compila + sobe app com HMR
yarn build:dev
yarn start                  # NODE_ENV=development; recarregar com Ctrl+Alt+R

# Produção (sem empacotar instaladores ainda)
yarn build:prod
yarn start:prod

# Apenas o passo de webpack (sem electron-packager)
yarn compile:dev
yarn compile:prod

# Empacotar instaladores para a plataforma atual
yarn package                # invoca script/package.ts → debian / redhat / electron-builder

# Reset completo (apaga out/ e node_modules/)
yarn rebuild-hard:dev
yarn rebuild-hard:prod
```

`NODE_OPTIONS=--max_old_space_size=4096` é fixo no script de compile — necessário para o webpack não estourar memória.

### Lint e Formatação

```bash
yarn lint                   # prettier --check + eslint
yarn lint:fix               # prettier --write + eslint --fix
yarn prettier               # apenas Prettier (check)
yarn eslint                 # apenas ESLint
yarn markdownlint           # lint dos .md
```

ESLint usa regras customizadas em `eslint-rules/` (TypeScript, compiladas via `yarn check:eslint`) além de `eslint-plugin-github`, `eslint-plugin-react`, `eslint-plugin-jsdoc`. Prettier 2.x.

### Testes

Runner é o `node --test` nativo (Node test runner), invocado por `script/test.mjs`. **Não usa Jest.**

```bash
yarn test                   # alias para test:unit
yarn test:unit              # todos os testes unitários
yarn test:unit <file>       # apenas um arquivo
yarn test:unit <directory>  # casa testes no diretório
yarn test:unit --test-name-pattern <pattern>   # filtro por nome
yarn test:script            # testes do diretório script/
yarn test:eslint            # testes das regras ESLint customizadas

# E2E (Playwright; roda contra o app empacotado por padrão)
yarn test:e2e:packaged      # build + run
yarn test:e2e:unpackaged    # build sem package + run
yarn test:e2e:run           # apenas run (precisa de build prévio)
```

Fixtures unitárias em `app/test/fixtures/`, ambiente em `app/test/unit-test-env.ts` (seta autor/committer Git fixos e força `dugite` a usar Git embarcado via `TEST_ENV=1`).

## Arquitetura

### Layout dos Pacotes

```
desktop/
├── app/                    # Pacote principal do Electron (renderer + main)
│   ├── package.json        # ⚠ contém productName, bundleID, version (canônica)
│   ├── src/
│   │   ├── main-process/   # Processo main do Electron (window, IPC, menus, updater)
│   │   ├── ui/             # Renderer: React 16 + componentes (.tsx)
│   │   ├── lib/            # Lógica compartilhada (git, stores, helpers, hooks, ...)
│   │   ├── models/         # Tipos de domínio compartilhados
│   │   ├── cli/            # CLI `github` (binário separado embutido no app)
│   │   ├── highlighter/    # Worker de syntax highlighting (CodeMirror modes)
│   │   └── crash/          # UI mínima para tela de crash
│   ├── styles/             # SCSS (bundlado pelo webpack)
│   ├── static/             # Assets copiados como-estão (ícones, logos, html)
│   ├── test/
│   │   ├── unit/           # Testes node:test
│   │   ├── e2e/            # Testes Playwright
│   │   ├── fixtures/       # Repos Git de teste, snapshots, etc.
│   │   └── helpers/
│   └── webpack.{common,development,production}.ts
├── script/                 # Scripts TS de build/package/release/lint
├── eslint-rules/           # Regras ESLint customizadas (compiladas separadas)
├── docs/                   # Docs de contribuição e arquitetura
├── vendor/                 # Pacotes locais (desktop-trampoline, desktop-notifications, printenvz)
├── patches/                # Patches aplicados a deps via patch-package
├── changelog.json          # Mudanças por versão (validar com yarn validate-changelog)
└── tsconfig.json           # Único tsconfig de raiz; compila app/**/*.ts(x)
```

`app/` tem seu próprio `package.json` com as deps **runtime** (React, dugite, codemirror, keytar, etc.). O `package.json` raiz contém apenas **deps de build/dev** (webpack, electron, eslint, ts-node, …). Esta separação é necessária para `electron-packager`: só `app/node_modules` entra no bundle final.

### Targets do Webpack

Definidos em `app/webpack.common.ts`. Cada um vira um chunk separado em `out/`:

| Target          | Entrada                            | Onde roda                      |
| --------------- | ---------------------------------- | ------------------------------ |
| `main.js`       | `app/src/main-process/main.ts`     | Processo main do Electron      |
| `renderer.js`   | `app/src/ui/index.tsx`             | Janela principal (BrowserWindow) |
| `crash.js`      | `app/src/crash/index.tsx`          | Janela de crash                |
| `highlighter.js`| `app/src/highlighter/index.ts`     | Web Worker                     |
| `cli.js`        | `app/src/cli/main.ts`              | CLI `github` (Node)            |

Webpack também substitui placeholders por valores específicos da plataforma (`app/app-info.ts`, `git-info.ts`, `package-info.ts`) e transpila o SCSS de `app/styles/`.

### Camadas Principais

- **`app/src/main-process/`** — controla janela, menus, IPC, autenticação OAuth, Squirrel updater, transports de log (Winston). `main.ts` é o entry-point que o Electron carrega.
- **`app/src/ui/`** — toda a UI React (renderer process). Estado global vai pelo `Dispatcher` em `app/src/ui/dispatcher/` que delega ao `AppStore`.
- **`app/src/lib/stores/`** — fonte da verdade do estado da app: `AppStore` (estado central), `GitStore` (cache por repo), `RepositoriesStore`, `AccountsStore`, `CopilotStore`, `PullRequestStore`, etc. Stores estendem `BaseStore` e emitem eventos via `event-kit`. **Não acessar `app-store.ts` direto da UI** — sempre via `Dispatcher`.
- **`app/src/lib/git/`** — wrappers tipados em volta do `dugite` (Git embedado). Cada arquivo cobre um comando (`commit.ts`, `push.ts`, `rebase.ts`, …). Erros vão por `git-error-context.ts`.
- **`app/src/lib/databases/`** — IndexedDB via `dexie` (repositórios, PRs, issues, stats).
- **`app/src/lib/trampoline/`** — proxy para credentials/SSH askpass (Git chama esses helpers em vez de prompts interativos).
- **`vendor/desktop-trampoline`** e **`vendor/desktop-notifications`** — binários nativos do projeto, linkados via `file:` em `app/package.json`.

### Fluxo de Build → Pacote (Linux)

1. `yarn build:prod` → webpack gera `out/` + `script/build.ts` chama `electron-packager` produzindo `dist/<platform>/`.
2. `yarn package` → `script/package.ts` decide a plataforma:
   - Linux: `script/package-debian.ts`, `script/package-redhat.ts`, e `script/package-electron-builder.ts` (config em `script/electron-builder-linux.yml`) geram `.deb`, `.rpm`, `.AppImage`.
   - Windows: `electron-winstaller` em `script/package.ts`.
   - macOS: zip do `.app` assinado.

## Convenções

### TypeScript / React

- Padrão **strict** (`strict: true`, `noImplicitReturns`, `noUnusedLocals`). Target ES2022, módulo ESNext, JSX `react` (clássico — **não** `react-jsx`).
- React 16 com classes ainda majoritárias (não migrar para hooks sem motivo).
- Não introduzir libs novas casualmente — o app é distribuído offline e cada dep vira diff no upstream.
- Imports nunca usam path aliases — apenas relativos.
- Arquivos em `kebab-case.ts(x)`. Classes/Components em `PascalCase`. Tipos exportados sem prefixo `I`.

### SCSS

- Stylesheets em `app/styles/`, organizados por feature. Variáveis e mixins em `_globals.scss` / `_variables.scss`.

### Git

- **Commits sem co-autor.**
- Branches sempre com prefixo `beats` (ex.: `beats/fix-titlebar-restart`).
- PRs alvo `linux` (branch base do fork), **não** `main` upstream.
- Antes de mexer em qualquer coisa que toca o upstream, verificar se já existe patch correspondente em `patches/` ou em commits recentes da branch `linux-*`.

## Configuração

- `app/package.json` → `version` é a versão canônica exibida no **Sobre**.
- `changelog.json` → mudanças por release (validar com `yarn validate-changelog`).
- `script/electron-builder-linux.yml` → metadata dos pacotes Linux (`.deb` / `.rpm` / `.AppImage`).
- `script/dist-info.ts` → resolve nomes de release/canal/plataforma.
- Variáveis de ambiente úteis em dev: `NODE_ENV`, `RELEASE_CHANNEL`, `DESKTOP_E2E*`, `DESKTOP_SKIP_PACKAGE`.
