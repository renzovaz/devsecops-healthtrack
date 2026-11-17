import { Duration, RemovalPolicy, Stack, Validations, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';

export interface SchedulingServiceStackProps extends StackProps {
  /** Tag imutável da imagem = SHA do commit (seção 5.6 do estudo). */
  imageTag: string;
  /** Certificado ACM do listener HTTPS do ALB interno (ARN fictício no exemplo). */
  certificateArn: string;
}

/**
 * scheduling-service na AWS, inspirado na seção 6.3 do estudo:
 * VPC com sub-redes privadas, ECS Fargate, ALB INTERNO (alcançado pelo API Gateway via VPC Link,
 * seção 6.2), segredo no Secrets Manager, logs no CloudWatch Logs e alarmes da seção 5.8.
 * Validado só com `cdk synth` + cdk-nag; nunca implantado.
 */
export class SchedulingServiceStack extends Stack {
  constructor(scope: Construct, id: string, props: SchedulingServiceStackProps) {
    super(scope, id, props);

    if (!/^[0-9a-f]{40}$/.test(props.imageTag)) {
      throw new Error('imageTag deve ser um SHA de commit (40 caracteres hexadecimais), nunca "latest".');
    }

    const key = new kms.Key(this, 'DataKey', { enableKeyRotation: true, description: 'Chave do scheduling-service (logs e segredos)' });

    // ---------- Rede: sub-redes públicas só para o NAT; serviços e ALB em sub-redes privadas ----------
    const flowLogGroup = new logs.LogGroup(this, 'VpcFlowLogs', { retention: logs.RetentionDays.ONE_YEAR, encryptionKey: key, removalPolicy: RemovalPolicy.RETAIN });
    // CIDR e AZs fixos: o synth não precisa consultar a conta (funciona offline, sem credenciais).
    const vpcCidr = '10.20.0.0/16';
    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(vpcCidr),
      availabilityZones: ['sa-east-1a', 'sa-east-1b'],
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
      ],
      flowLogs: { all: { destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup), trafficType: ec2.FlowLogTrafficType.ALL } },
    });

    // ---------- Artefato: repositório ECR com tags imutáveis ----------
    const repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'scheduling-service',
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---------- Segredo: chave de assinatura do JWT gerada pelo Secrets Manager ----------
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSigningSecret', {
      description: 'Chave HMAC do JWT do scheduling-service',
      encryptionKey: key,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });
    Validations.of(jwtSecret).acknowledge({
      id: 'AwsSolutions::AwsSolutions-SMG4',
      reason:
        'A rotação automática exige uma função Lambda de rotação e, para uma chave HMAC de JWT, uma troca coordenada de chaves (aceitar a antiga e a nova durante a transição). Isso está fora do escopo deste exemplo, que nunca é implantado; o estudo (seção 7.2) registra que a rotação precisa ser testada antes de ser habilitada.',
    });

    // ---------- Computação: ECS Fargate ----------
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

    const appLogGroup = new logs.LogGroup(this, 'AppLogs', { retention: logs.RetentionDays.ONE_YEAR, encryptionKey: key, removalPolicy: RemovalPolicy.RETAIN });
    key.grantEncryptDecrypt(new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`));

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    taskDef.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag),
      portMappings: [{ containerPort: 3000 }],
      user: 'node',
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: appLogGroup, streamPrefix: 'scheduling' }),
      // Injetado pelo ECS a partir do Secrets Manager: o valor nunca aparece no template.
      secrets: { JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret) },
      healthCheck: { command: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:3000/health || exit 1'], interval: Duration.seconds(30), timeout: Duration.seconds(5), retries: 3, startPeriod: Duration.seconds(15) },
    });

    // A política padrão da execution role inclui ecr:GetAuthorizationToken, que só aceita Resource "*".
    Validations.of(taskDef.obtainExecutionRole()).acknowledge({
      id: 'AwsSolutions::AwsSolutions-IAM5[Resource::*]',
      reason:
        'O curinga vem de ecr:GetAuthorizationToken, ação que não suporta restrição por recurso (a API exige Resource "*"). As demais permissões (pull da imagem, leitura do segredo e escrita de logs) são restritas aos ARNs específicos gerados pelo CDK.',
    });

    // ---------- ALB interno (só acessível de dentro da VPC, ex.: VPC Link do API Gateway) ----------
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, description: 'Internal ALB: HTTPS only from inside the VPC', allowAllOutbound: false });
    albSg.addIngressRule(ec2.Peer.ipv4(vpcCidr), ec2.Port.tcp(443), 'HTTPS vindo da VPC (VPC Link)');
    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', { vpc, description: 'Tasks: traffic only from the internal ALB', allowAllOutbound: true });
    serviceSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'Somente do ALB interno');
    albSg.addEgressRule(serviceSg, ec2.Port.tcp(3000), 'Para as tasks');

    const accessLogs = new s3.Bucket(this, 'AlbAccessLogs', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(365) }],
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'InternalAlb', {
      vpc,
      internetFacing: false,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      dropInvalidHeaderFields: true,
    });
    alb.logAccessLogs(accessLogs, 'internal-alb');
    Validations.of(accessLogs).acknowledge({
      id: 'AwsSolutions::AwsSolutions-S1',
      reason:
        'Este bucket é o destino dos logs de acesso do ALB. Ativar server access logs nele exigiria outro bucket de logs, que por sua vez exigiria outro (recursão). O bucket tem acesso público bloqueado, SSL obrigatório, criptografia e versionamento.',
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 2,
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    const listener = alb.addListener('Https', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      certificates: [acm.Certificate.fromCertificateArn(this, 'Cert', props.certificateArn)],
      open: false,
    });
    const targetGroup = listener.addTargets('Scheduling', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: { path: '/health', healthyHttpCodes: '200' },
      deregistrationDelay: Duration.seconds(30),
    });

    // ---------- Alarmes da seção 5.8: erros > 2% e latência p99 > 2 s, notificando via SNS ----------
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', { masterKey: key, enforceSSL: true });
    key.grantEncryptDecrypt(new iam.ServicePrincipal('cloudwatch.amazonaws.com'));
    const action = new cwActions.SnsAction(alarmTopic);

    const errorRate = new cloudwatch.MathExpression({
      expression: '100 * IF(requests > 0, errors / requests, 0)',
      usingMetrics: {
        errors: targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { statistic: 'Sum' }),
        requests: targetGroup.metrics.requestCount({ statistic: 'Sum' }),
      },
      period: Duration.minutes(1),
      label: 'Taxa de erros 5xx (%)',
    });
    errorRate
      .createAlarm(this, 'ErrorRateAlarm', { threshold: 2, evaluationPeriods: 3, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, alarmDescription: 'Taxa de erros > 2% (seção 5.8)', treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING })
      .addAlarmAction(action);

    targetGroup.metrics
      .targetResponseTime({ statistic: 'p99', period: Duration.minutes(1) })
      .createAlarm(this, 'LatencyP99Alarm', { threshold: 2, evaluationPeriods: 3, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD, alarmDescription: 'Latência p99 > 2 s (seção 5.8)', treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING })
      .addAlarmAction(action);
  }
}
