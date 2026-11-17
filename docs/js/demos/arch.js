// Demo 2: arquitetura da HealthTrack (estudo, seção 6.1) e fluxo de uma requisição (seção 6.2).
import { reducedMotion, runGuard, sleep } from './util.js';

const ZONES = [
  { id: 'clients', title: 'Clientes', area: '1 / 1 / 2 / 2' },
  { id: 'edge', title: 'Borda (fora da VPC)', area: '1 / 2 / 2 / 3' },
  { id: 'vpc', title: 'VPC · sub-redes privadas', area: '1 / 3 / 3 / 4' },
  { id: 'data', title: 'Dados', area: '1 / 4 / 2 / 5' },
  { id: 'msg', title: 'Mensageria', area: '2 / 4 / 3 / 5' },
  { id: 'sec', title: 'Segurança', area: '2 / 1 / 3 / 3' },
  { id: 'obs', title: 'Observabilidade', area: '3 / 1 / 4 / 3' },
  { id: 'cicd', title: 'CI/CD', area: '3 / 3 / 4 / 5' },
];

// Papel de cada componente e etapa(s) do ciclo, conforme o estudo.
const COMPONENTS = [
  ['web', 'clients', 'App Web', '—', 'Clínicas e hospitais acessam a plataforma.'],
  ['mobile', 'clients', 'App Mobile', '—', 'O paciente agenda a consulta (cenário da seção 6.2).'],
  ['waf', 'edge', 'AWS WAF', 'SEC · CD', 'Web ACL no stage da API REST; avaliado antes de qualquer outro controle. Bloqueia padrões de ataque (SQL Injection, XSS) e excessos por IP com regras de taxa (rate-based).'],
  ['apigw', 'edge', 'API Gateway (REST)', 'CD · SEC', 'Ponto de entrada único. O autorizador valida o JWT uma única vez (assinatura, iss, aud, exp); aplica throttling; repassa a identidade validada ao backend.'],
  ['vpclink', 'vpc', 'VPC Link (V2)', 'CD', 'Integração privada: liga o API Gateway ao ALB interno sem expor a VPC à internet.'],
  ['alb', 'vpc', 'ALB interno', 'CD', 'Avalia as regras do listener uma vez e envia a requisição a UM target group (ex.: /v1/appointments* → scheduling-service). Não encadeia serviços.'],
  ['auth', 'vpc', 'auth-service', 'DEV · CD', 'Login e emissão/renovação de tokens (/auth/*). Não fica no caminho de cada requisição.'],
  ['patient', 'vpc', 'patient-service', 'DEV · CD', 'Pacientes e prontuários; um dos dois serviços que acessam dados de pacientes (LGPD).'],
  ['sched', 'vpc', 'scheduling-service', 'DEV · CD', 'Agendamentos e disponibilidade. Aplica a autorização de negócio com a identidade repassada pelo gateway. É o serviço implementado neste repositório.'],
  ['presc', 'vpc', 'prescription-service', 'DEV · CD', 'Prescrições médicas e interações medicamentosas.'],
  ['notif', 'vpc', 'notification-service', 'DEV · CD', 'Consome eventos da fila SQS e envia SMS, e-mail e push.'],
  ['rds', 'data', 'RDS PostgreSQL', 'CD', 'Banco relacional Multi-AZ com read replicas; criptografado com KMS.'],
  ['redis', 'data', 'ElastiCache (Redis)', 'CD', 'Cache de horários disponíveis e perfis de médicos, para reduzir a carga no banco.'],
  ['s3', 'data', 'S3', 'CD', 'Documentos; criptografia server-side.'],
  ['sqs', 'msg', 'Amazon SQS', 'CD', 'Fila que desacopla os microsserviços: o agendamento publica um evento e segue.'],
  ['sns', 'msg', 'Amazon SNS', 'CD · MON', 'SMS de confirmação ao paciente; também notifica a equipe quando um alarme dispara.'],
  ['ses', 'msg', 'Amazon SES', 'CD', 'E-mail de confirmação.'],
  ['iam', 'sec', 'IAM', 'SEC', 'Menor privilégio: cada task ECS tem sua Task Role; ARNs específicos em vez de *.'],
  ['sm', 'sec', 'Secrets Manager', 'SEC · CI', 'Credenciais com rotação automática; o buildspec lê tokens por env.secrets-manager.'],
  ['kms', 'sec', 'AWS KMS', 'SEC', 'Chaves de criptografia em repouso (RDS, S3, ElastiCache).'],
  ['gd', 'sec', 'GuardDuty', 'SEC · MON', 'Detecção de ameaças e anomalias.'],
  ['sh', 'sec', 'Security Hub', 'SEC · MON', 'Visão consolidada da postura de segurança.'],
  ['cw', 'obs', 'CloudWatch', 'MON · FEEDBACK', 'Métricas, logs (Logs Insights) e alarmes: erros > 2% e latência p99 > 2 s.'],
  ['xray', 'obs', 'X-Ray (traces OTel/ADOT)', 'MON · FEEDBACK', 'Recebe os spans OpenTelemetry/ADOT enviados por um coletor sidecar; Trace Map mostra onde está o gargalo. O SDK do X-Ray está em manutenção desde 25/02/2026.'],
  ['ct', 'obs', 'CloudTrail', 'MON · SEC', 'Auditoria: registra as chamadas de API AWS (quem fez o quê, quando e de onde).'],
  ['gh', 'cicd', 'GitHub', 'DEV · CI', 'Código e PRs com branch protection; integrado via AWS CodeConnections.'],
  ['cp', 'cicd', 'CodePipeline', 'CI · CD', 'Orquestra Source → Build → Security Scan → Deploy.'],
  ['cb', 'cicd', 'CodeBuild', 'CI · SEC', 'Executa testes, SAST, SCA, IaC scan e o scan da imagem antes do push.'],
  ['ecr', 'cicd', 'Amazon ECR', 'CI · CD', 'Registro de imagens com tag imutável = SHA do commit; Enhanced Scanning (Inspector).'],
  ['cdp', 'cicd', 'CodeDeploy', 'CD', 'Canary 10% → 100%, health check e rollback automático.'],
];

const FLOW = [
  [['mobile'], '1. O app mobile envia POST /v1/appointments com o JWT no cabeçalho Authorization.'],
  [['waf'], '2. O AWS WAF avalia as regras antes de tudo: padrões de ataque e regras de taxa por IP.'],
  [['apigw'], '3. O autorizador do API Gateway valida o JWT UMA vez. Token inválido recebe 401 aqui e nunca entra na VPC. Throttling por cliente.'],
  [['vpclink', 'alb'], '4. Integração privada via VPC Link até o ALB interno, que envia a requisição a um único target group.'],
  [['sched'], '5. O scheduling-service usa a identidade repassada pelo gateway para a autorização de negócio (sem revalidar a assinatura).'],
  [['redis'], '6. Consulta o ElastiCache para confirmar que o horário ainda está livre.'],
  [['rds'], '7. Registra o agendamento no RDS PostgreSQL.'],
  [['sqs'], '8. Publica o evento do agendamento confirmado na fila SQS.'],
  [['notif', 'sns', 'ses'], '9. O notification-service consome o evento: SMS (SNS), e-mail (SES) e push.'],
  [['cw', 'xray', 'ct'], '10. Durante todo o fluxo: métricas e logs no CloudWatch, spans OpenTelemetry no X-Ray (mesmo Trace ID) e auditoria no CloudTrail.'],
];

export function initArchDemo() {
  const root = document.getElementById('arch-demo');
  const arch = document.getElementById('arch');
  const info = document.getElementById('arch-info');
  const guard = runGuard();
  const buttons = {};

  for (const z of ZONES) {
    const zone = document.createElement('div');
    zone.className = 'zone';
    zone.style.gridArea = z.area;
    const title = document.createElement('span');
    title.className = 'zt';
    title.textContent = z.title;
    zone.append(title);
    for (const [id, zid, name, stage, role] of COMPONENTS) {
      if (zid !== z.id) continue;
      const b = document.createElement('button');
      b.className = 'comp';
      b.type = 'button';
      b.textContent = name;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => select(id, name, stage, role));
      buttons[id] = b;
      zone.append(b);
    }
    arch.append(zone);
  }

  function clearFlow() {
    Object.values(buttons).forEach((b) => b.classList.remove('flow'));
  }

  function select(id, name, stage, role) {
    guard.cancel();
    clearFlow();
    Object.values(buttons).forEach((b) => b.setAttribute('aria-pressed', 'false'));
    buttons[id].setAttribute('aria-pressed', 'true');
    info.replaceChildren();
    const h = document.createElement('strong');
    h.textContent = name;
    const st = document.createElement('p');
    st.className = 'muted';
    st.textContent = `Etapa do ciclo: ${stage}`;
    const p = document.createElement('p');
    p.textContent = role;
    info.append(h, st, p);
  }

  async function flow() {
    const t = guard.start();
    Object.values(buttons).forEach((b) => b.setAttribute('aria-pressed', 'false'));
    for (const [ids, text] of FLOW) {
      if (!guard.alive(t)) return;
      clearFlow();
      ids.forEach((id) => buttons[id].classList.add('flow'));
      info.textContent = text;
      await sleep(reducedMotion() ? 1800 : 2000);
    }
    if (guard.alive(t)) info.textContent += ' Fim do fluxo.';
  }

  root.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button[data-action]') : null;
    if (!btn) return;
    if (btn.dataset.action === 'flow') flow();
    if (btn.dataset.action === 'reset') {
      guard.cancel();
      clearFlow();
      Object.values(buttons).forEach((b) => b.setAttribute('aria-pressed', 'false'));
      info.textContent = 'Fluxo POST /v1/appointments (seção 6.2): acione o modo rápido ou escolha um componente.';
    }
  });
}
