import { App, Tags } from 'aws-cdk-lib';
import { ContestStack } from '../lib/contest-stack';

const app = new App();
new ContestStack(app, 'HalloweenContest', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-southeast-2' },
  budgetEmail: app.node.tryGetContext('budgetEmail'),
});
Tags.of(app).add('project', 'halloween-contest');
Tags.of(app).add('owner', 'donnie');
