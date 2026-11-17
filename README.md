# DevOps e DevSecOps na AWS: estudo de caso HealthTrack Solutions

Trabalho acadêmico da disciplina **Desenvolvimento Back-end**, curso de **Engenharia de Software (CEUB)**, novembro de 2026.
Autores: Renzo Machado Alves Vaz, Eric Kelvin Silva e Kaio Vinicius Aguiar Franca.

- **Apresentação (GitHub Pages):** https://renzovaz.github.io/devsecops-healthtrack/
- **Run verde da `main` (6/6 jobs):** https://github.com/renzovaz/devsecops-healthtrack/actions/runs/44114966187
- **Run vermelho do [PR #1](https://github.com/renzovaz/devsecops-healthtrack/pull/1) com dependência vulnerável** (`sca` falhou; `image` não executou): https://github.com/renzovaz/devsecops-healthtrack/actions/runs/44115104708

> **A API roda no navegador e em container local; a AWS está representada pela arquitetura e pelo CDK validado, sem deploy.**
> A HealthTrack Solutions é uma empresa **fictícia**, e todas as métricas do estudo de caso são **hipotéticas**. As ferramentas, serviços e práticas são reais.

## O que é real e o que é simulado

| Parte | Real | Simulado / apenas representado |
|:--|:--|:--|
| Núcleo de domínio (`core/`) | TypeScript puro, testes Jest, JS compilado em `docs/js/core/` | Banco (RDS), cache (ElastiCache) e fila (SQS) são adapters em memória |
| Cliente de API na apresentação | Executa o núcleo real no navegador (Web Crypto) | Sem rede; o "SQS" é só o evento montado |
| API Express (`api/`) | Roda localmente e em container Docker | Sem deploy |
| GitHub Actions (`.github/workflows/ci.yml`) | Jobs e runs reais | Equivalente didático do CodePipeline/CodeBuild; sem push para registry e sem deploy |
| CDK (`infra/`) | `cdk synth` + cdk-nag (AwsSolutions) + testes Jest | Conta fictícia `111111111111`; sem `deploy`, sem `bootstrap`, sem credenciais |
| Demo do pipeline | Mesmos jobs e mesma dependência do PR real | Execução animada no navegador; o "segredo" é falso e gerado em tempo de execução |
| Demos de arquitetura e diagnóstico | Conteúdo das seções 5.8, 6.1 e 6.2 do estudo | Métricas, traces e logs fictícios |

Nenhum segredo, nem falso, está no repositório. As chaves de JWT usadas nos testes e no navegador são geradas a cada execução, e a API exige `JWT_SECRET` por variável de ambiente.

## Estrutura

```
core/     núcleo do scheduling-service (TypeScript puro: JWT HS256 via Web Crypto, disponibilidade,
          agendamento, rate limit, evento SQS, logger JSON; ports + adapters em memória)
api/      Express sobre o mesmo núcleo + testes Jest/supertest + Dockerfile multi-stage
infra/    stack AWS CDK (VPC, ECS Fargate, ALB interno, Secrets Manager, logs, alarmes) + cdk-nag
docs/     apresentação (HTML/CSS/JS puros, servida pelo GitHub Pages) e capturas do plano C
scripts/  cópia do núcleo compilado para docs/ e servidor local
```

O núcleo é compilado pelo `tsc` (`npm run build:core`) e copiado para `docs/js/core/`, que é **commitado** porque o site não tem etapa de build. O job `test` do CI recompila o núcleo e **falha se o JS commitado estiver desatualizado** (`npm run check:core-drift`).

## Como rodar localmente

Pré-requisitos: Node 20 ou superior (o Dockerfile e o CI usam Node 20) e Docker.

```bash
npm ci                      # dependências do núcleo e da API
npm test                    # testes Jest do núcleo e da API
npm run build:core          # recompila o núcleo e atualiza docs/js/core
```

### Apresentação (plano B: sem internet)

```bash
npm run serve               # http://localhost:8080
```

Abra **exatamente** `http://localhost:8080`. Não abra o `index.html` com duplo clique (`file://`) nem por um IP da rede (`http://192.168...`): nesses casos o navegador bloqueia os módulos JavaScript ou o Web Crypto, e a página mostra um aviso.

Navegação: ← → / espaço / PageUp / PageDown / Home / End, ou deslizar o dedo. Cada slide tem uma âncora na URL, então recarregar a página mantém a posição. Cada demo tem um botão **▶ Modo rápido** que executa a demo inteira.

### Plano C

`docs/plano-c/` tem capturas de cada slide e de cada demo funcionando, em 1920×1080.

### API em container

```bash
docker build -f api/Dockerfile -t scheduling-service:$(git rev-parse HEAD) .
export JWT_SECRET=$(openssl rand -hex 32)          # valor local, nunca commitado
docker run --rm -p 3000:3000 -e JWT_SECRET scheduling-service:$(git rev-parse HEAD)

TOKEN=$(docker run --rm -e JWT_SECRET --entrypoint node scheduling-service:$(git rev-parse HEAD) api/dist/token.js)
curl -i -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"doctorId":"doctor-001","date":"2026-11-20","time":"09:00"}' http://localhost:3000/v1/appointments
```

Endpoints: `GET /health`, `GET /v1/availability?doctorId=doctor-001&date=AAAA-MM-DD` e `POST /v1/appointments`. Médicos e IDs (`doctor-001`, "Dra. Exemplo A") são fictícios.

A imagem é multi-stage, usa `node:20-alpine`, roda como o usuário não-root `node`, tem `HEALTHCHECK`, contém só dependências de produção e não inclui npm/yarn.

### Infraestrutura (CDK)

```bash
cd infra
npm ci
npm test                    # asserções sobre o template gerado
npx cdk synth --quiet       # synth + cdk-nag; nunca use deploy/bootstrap neste projeto
```

A conta (`111111111111`), a região (`sa-east-1`), as zonas de disponibilidade e o ARN do certificado são **valores fixos de exemplo** em `infra/cdk.json`, para o synth funcionar offline e sem credenciais.

## Pipeline (GitHub Actions)

Equivalente didático do CodePipeline + CodeBuild do estudo (seção 5.6):

| Job | O que faz | Correspondente no estudo |
|:--|:--|:--|
| `test` | Jest (núcleo e API) + verificação do JS commitado | `npm test` |
| `sast` | CodeQL (`security-extended`) | SonarQube |
| `sca` | `npm audit --omit=dev --audit-level=high` (app e infra) + Trivy fs; relatório completo (com devDependencies) só informativo | Snyk |
| `secrets` | gitleaks em todo o histórico | git-secrets |
| `iac` | Jest da stack + `cdk synth` com cdk-nag | `cdk synth` + Checkov |
| `image` | `docker build` com tag = SHA do commit + Trivy (HIGH/CRITICAL com correção bloqueiam); só roda se todos os gates passaram | build, Trivy e push para o ECR |

Boas práticas: `permissions: {}` no topo e permissões mínimas por job; actions fixadas por SHA de commit; Trivy e gitleaks executados por imagem fixada por versão + digest; cache de dependências do npm. **Não há push para registry nem deploy na AWS.**

## Supressões do cdk-nag (AwsSolutions)

Dois achados foram **corrigidos**, não suprimidos: `AwsSolutions-ECS2` (as variáveis de ambiente foram removidas da task) e `AwsSolutions-EC23` (o CIDR da VPC passou a ser literal, para a regra conseguir avaliá-lo). Os três reconhecimentos restantes, com justificativa no código (`infra/lib/scheduling-service-stack.ts`):

| Regra | Recurso | Justificativa |
|:--|:--|:--|
| `AwsSolutions-SMG4` | Segredo do JWT | A rotação automática exige uma Lambda de rotação e, para uma chave HMAC de JWT, troca coordenada de chaves (aceitar a antiga e a nova durante a transição). Fora do escopo de um exemplo nunca implantado; o estudo (seção 7.2) registra que a rotação precisa ser testada antes de ser habilitada. |
| `AwsSolutions-IAM5[Resource::*]` | Política da execution role | O curinga vem de `ecr:GetAuthorizationToken`, ação que não aceita restrição por recurso. Verificado no template: é o único `Resource: "*"`. As demais permissões usam ARNs específicos. |
| `AwsSolutions-S1` | Bucket de logs de acesso do ALB | Ele já é o destino de logs; ativar server access logs nele exigiria outro bucket de logs (recursão). O bucket tem acesso público bloqueado, SSL obrigatório, criptografia e versionamento. |

Observações do `npm audit`:

- **Gate só em dependências de produção.** Em novembro de 2026 surgiu um alerta high no `picomatch` ([GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), ReDoS), ainda sem versão corrigida. Ele chega apenas pelas ferramentas de teste (Jest), que não vão para a imagem nem para o synth. Por isso o gate usa `--omit=dev`; o relatório completo continua no log, como passo informativo. A `lodash` da demonstração é dependência de **produção** da API, então continua bloqueada.
- Na infraestrutura há 3 vulnerabilidades **moderadas** no `minimatch`, dependência transitiva do `aws-cdk-lib`. A única correção sugerida rebaixa o `aws-cdk-lib` (mudança incompatível). O gate bloqueia a partir de **high**.

## Demonstração de falha proposital

O branch `demo/dependencia-vulneravel` (PR aberto e **não** mesclado) adiciona apenas `lodash@4.17.20`, versão legítima e antiga com vulnerabilidades **high** conhecidas ([GHSA-35jh-r3h4-6jhm](https://github.com/advisories/GHSA-35jh-r3h4-6jhm), [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)). O job `sca` falha e o job `image` não executa. Não há pacote malicioso nem segredo nesse branch.

## Licença

MIT.
