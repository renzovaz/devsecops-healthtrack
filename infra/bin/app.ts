import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { SchedulingServiceStack } from '../lib/scheduling-service-stack';

/**
 * Conta e região FIXAS DE EXEMPLO: permitem `cdk synth` offline, sem credenciais.
 * A conta 111111111111 é fictícia. Este projeto nunca executa `cdk deploy` nem `cdk bootstrap`.
 */
const app = new App();
new SchedulingServiceStack(app, 'HealthTrackSchedulingService', {
  env: { account: '111111111111', region: 'sa-east-1' },
  imageTag: app.node.tryGetContext('imageTag'),
  certificateArn: app.node.tryGetContext('certificateArn'),
});

// cdk-nag v3 (plugin de validação nativo do CDK): violações AwsSolutions não reconhecidas
// fazem o `cdk synth` falhar. Cada reconhecimento tem justificativa escrita na stack.
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true, writeSuppressionsToCloudFormation: true }));
