import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SchedulingServiceStack } from '../lib/scheduling-service-stack';

const SHA = 'a'.repeat(40);
const CERT = 'arn:aws:acm:sa-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';

function synth(imageTag = SHA) {
  const app = new App({ context: { 'availability-zones:account=111111111111:region=sa-east-1': ['sa-east-1a', 'sa-east-1b', 'sa-east-1c'] } });
  const stack = new SchedulingServiceStack(app, 'Test', { env: { account: '111111111111', region: 'sa-east-1' }, imageTag, certificateArn: CERT });
  return Template.fromStack(stack);
}

describe('SchedulingServiceStack', () => {
  const t = synth();

  test('ALB é interno e o listener é HTTPS com política TLS recomendada', () => {
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: 443, Protocol: 'HTTPS', SslPolicy: Match.stringLikeRegexp('TLS') });
  });

  test('nenhuma regra de entrada aberta para a internet', () => {
    for (const sg of Object.values(t.findResources('AWS::EC2::SecurityGroup'))) {
      for (const rule of sg.Properties.SecurityGroupIngress ?? []) expect(rule.CidrIp).not.toBe('0.0.0.0/0');
    }
    for (const rule of Object.values(t.findResources('AWS::EC2::SecurityGroupIngress'))) expect(rule.Properties.CidrIp).not.toBe('0.0.0.0/0');
  });

  test('ECR com tags imutáveis e imagem referenciada pelo SHA do commit', () => {
    t.hasResourceProperties('AWS::ECR::Repository', { ImageTagMutability: 'IMMUTABLE' });
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [Match.objectLike({ Image: Match.objectLike({ 'Fn::Join': Match.arrayWith([Match.arrayWith([`:${SHA}`])]) }) })],
    });
  });

  test('container: não-root, sistema de arquivos somente leitura, segredo via Secrets Manager e sem variáveis de ambiente', () => {
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [
        Match.objectLike({ User: 'node', ReadonlyRootFilesystem: true, Secrets: [Match.objectLike({ Name: 'JWT_SECRET' })], Environment: Match.absent() }),
      ],
    });
  });

  test('tasks em sub-redes privadas, sem IP público, com rollback automático', () => {
    t.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'DISABLED' }) },
      DeploymentConfiguration: Match.objectLike({ DeploymentCircuitBreaker: { Enable: true, Rollback: true }, MinimumHealthyPercent: 100 }),
    });
  });

  test('alarmes da seção 5.8: erros > 2% e latência p99 > 2 s, com ação SNS', () => {
    t.resourceCountIs('AWS::CloudWatch::Alarm', 2);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { Threshold: 2, ExtendedStatistic: 'p99', MetricName: 'TargetResponseTime', AlarmActions: Match.anyValue() });
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { Threshold: 2, Metrics: Match.anyValue(), AlarmActions: Match.anyValue() });
  });

  test('logs com retenção e criptografia KMS', () => {
    t.allResourcesProperties('AWS::Logs::LogGroup', { RetentionInDays: 365, KmsKeyId: Match.anyValue() });
  });

  test('recusa tag "latest"', () => {
    expect(() => synth('latest')).toThrow(/SHA de commit/);
  });
});
