#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { Ekstack } from '../lib/eks-cdk-js-stack';

import { K8sBaselineStack } from '../lib/k8s-baseline';
import { K8snodegroups } from '../lib/k8s-nodegroup';

const DEFAULT_CONFIG = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
};

const app = new cdk.App();
const prefix = stackPrefix(app);
const eks = new Ekstack(app, 'EKSStack', ({
  env: DEFAULT_CONFIG.env,
  stackName: `${prefix}EKSStack`,
}));

const nodegroups = new K8snodegroups(app, 'EKSNodeGroups', ({
  env: DEFAULT_CONFIG.env,
  stackName: `${prefix}EKSNodeGroups`,
  eksCluster: eks.cluster,
  nodeGroupRole: eks.createNodegroupRole('nodeGroup1'),
}));

const k8sbase = new K8sBaselineStack(app, 'EKSK8sBaseline', ({
  env: DEFAULT_CONFIG.env,
  stackName: `${prefix}EKSK8sBaseline`,
  eksCluster: eks.cluster,

}));

k8sbase.addDependency(nodegroups);
nodegroups.addDependency(eks);

function stackPrefix (stack: cdk.Construct): string {
  const prefixValue = stack.node.tryGetContext('stack_prefix');

  if (prefixValue !== undefined) {
    return prefixValue.trim();
  }
  // if no stack_prefix return empty string
  return '';
}
app.synth();
