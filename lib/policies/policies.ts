import { Policy, PolicyStatement, IRole } from 'aws-cdk-lib/aws-iam';
import { CfnJson, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Scope fluentbit to push logs to log-group /aws/containerinsights/CLUSTER_NAME/ only
export function createFluentbitPolicy(stack: Stack, clusterName: string, roleSA: IRole): Policy {
  const fluentBitSaRoleStatementPolicy = new PolicyStatement({
    resources: [
      `arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/containerinsights/${clusterName}/*`,
      `arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/containerinsights/${clusterName}/*:log-stream:*`,
    ],
    actions: [
      'logs:CreateLogStream',
      'logs:CreateLogGroup',
      'logs:DescribeLogStreams',
      'logs:PutLogEvents',
    ],
  });
  return new Policy(stack, 'fluentBitSaRolePolicy', {
    roles: [
      roleSA,
    ],
    statements: [
      fluentBitSaRoleStatementPolicy,
    ],
  });
}
// Scope ClusterAutoscaler to read/write to tags with cluster-name
export function createClusterAutoscalerPolicy(stack: Construct, clusterName: string, roleSA: IRole): Policy {
  const clusterAutoscalerSAPolicyStatementDescribe = new PolicyStatement({
    // https://docs.aws.amazon.com/eks/latest/userguide/cluster-autoscaler.html#ca-create-policy
    resources: [
      '*',
    ],
    actions: [
      'autoscaling:DescribeAutoScalingGroups',
      'autoscaling:DescribeAutoScalingInstances',
      'autoscaling:DescribeLaunchConfigurations',
      'autoscaling:DescribeTags',
      'ec2:DescribeLaunchTemplateVersions',
    ],

  });
  // Cluster Autoscaler tags resources using the tags below, so scope resources to those tags
  // Create CfnJson as variables are not allowed to be in keys for key:value pairs.
  const clusterAutoscalerPolicyStatementWriteJson = new CfnJson(stack, 'clusterAutoscalerPolicyStatementWriteJson', {
    value: {
      'autoscaling:ResourceTag/k8s.io/cluster-autoscaler/enabled': 'true',
      [`autoscaling:ResourceTag/kubernetes.io/cluster/${clusterName}`]: 'owned',
    },
  });
  const clusterAutoscalerPolicyStatementWrite = new PolicyStatement({
    resources: [
      '*',
    ],
    actions: [
      'autoscaling:SetDesiredCapacity',
      'autoscaling:TerminateInstanceInAutoScalingGroup',
      'autoscaling:UpdateAutoScalingGroup',
    ],
    conditions: {
      StringEquals: clusterAutoscalerPolicyStatementWriteJson,
    },
  },
  );
  return new Policy(stack, 'clusterAutoscalerPolicy', {
    statements: [
      clusterAutoscalerPolicyStatementWrite,
      clusterAutoscalerSAPolicyStatementDescribe,
    ],
    roles: [
      roleSA,
    ],
  });
}

export function createEFSPolicy(stack: Stack, clusterName: string, roleSA: IRole): Policy {
  // Scope EFS Permissions DescribeFileSystems,DescribeMountTargets on all, but limit create/delete AccessPoint to tag eks:clustername: <ClusterName>
  const readEFSResources = new PolicyStatement({
    resources: [
      '*',
    ],
    actions: [
      'elasticfilesystem:DescribeFileSystems',
      'elasticfilesystem:DescribeMountTargets',
    ],
  });
  const writeEFSResourcesRequest = new PolicyStatement({
    resources: [
      '*',
    ],
    actions: [
      'elasticfilesystem:CreateAccessPoint',
    ],
    // Requires tags in Request call
    conditions: {
      StringEquals: {
        'aws:RequestTag/eks/cluster-name': clusterName,
      },
    },
  });
  const writeEFSResourcesResource = new PolicyStatement({
    resources: [
      '*',
    ],
    actions: [
      'elasticfilesystem:DeleteAccessPoint',
    ],
    conditions: {
      // Requires already created resource to contain tags
      StringEquals: {
        'aws:ResourceTag/eks/cluster-name': clusterName,
      },
    },
  });
  return new Policy(stack, 'efsPolicy', {
    roles: [
      roleSA,
    ],
    statements: [
      readEFSResources,
      writeEFSResourcesRequest,
      writeEFSResourcesResource,
    ],
  });
}

export function createEBSPolicy(stack: Stack, clusterName: string, roleSA: IRole): Policy {
  // Scope permissions to describe on all resources, some APIs like ec2:DescribeAvailabilityZones do not Resource types
  // https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonec2.html#amazonec2-actions-as-permissions
  const readEBSPolicy = new PolicyStatement({
    resources: [
      '*',
    ],
    actions: [
      'ec2:DescribeAvailabilityZones',
      'ec2:DescribeInstances',
      'ec2:DescribeSnapshots',
      'ec2:DescribeTags',
      'ec2:DescribeVolumes',
      'ec2:DescribeVolumesModifications',
    ],
  });
  // Scope to createTags only creation of volumes and snapshots
  const createTags = new PolicyStatement({
    resources: [
      `arn:aws:ec2:${stack.region}:${stack.account}:volume/*`,
      `arn:aws:ec2:${stack.region}:${stack.account}:snapshot/*`,
    ],
    conditions: {
      StringEquals: {
        'ec2:CreateAction': [
          'CreateVolume',
          'CreateSnapshot',
        ],
      },
    },
    actions: [
      'ec2:CreateTags',
    ],
  });
  // Scope deletion of tags on volumes and snapshots that already contain eks:cluster-name: MY_CLUSTER_NAME
  const deleteTags = new PolicyStatement({
    resources: [
      `arn:aws:ec2:${stack.region}:${stack.account}:volume/*`,
      `arn:aws:ec2:${stack.region}:${stack.account}:snapshot/*`,
    ],
    conditions: {
      StringEquals: {
        'aws:ResourceTag/eks:cluster-name': clusterName,
      },
    },
    actions: [
      'ec2:DeleteTags',
    ],
  });
  // Scope Attach/Detach/Modify of EBS policies to tags eks:cluster-name': MY_CLUSTER_NAME
  const modifyVolume = new PolicyStatement({
    resources: [
      `arn:aws:ec2:${stack.region}:${stack.account}:instance/*`,
      `arn:aws:ec2:${stack.region}:${stack.account}:volume/*`,
    ],
    actions: [
      'ec2:AttachVolume',
      'ec2:DetachVolume',
      'ec2:ModifyVolume',
    ],
    conditions: {
      StringEquals: {
        'aws:ResourceTag/eks:cluster-name': clusterName,
      },
    },
  });
  // Scope CreateVolume only when Request contains tags eks:cluster-name: MY_CLUSTER_NAME
  const createVolume = new PolicyStatement({
    resources: [
      '*',
    ],
    conditions: {
      StringEquals: {
        'aws:RequestTag/eks:cluster-name': clusterName,
      },
    },
    actions: [
      'ec2:CreateVolume',
    ],
  });
  // Scope DeleteVolume only when Resource contains tag eks:cluster-name: MY_CLUSTER_NAME
  const deleteVolume = new PolicyStatement({
    resources: [
      '*',
    ],
    conditions: {
      StringEquals: {
        'aws:ResourceTag/eks:cluster-name': clusterName,
      },
    },
    actions: [
      'ec2:DeleteVolume',
      'ec2:DetachVolume',
      'ec2:AttachVolume',
      'ec2:ModifyVolume',
    ],
  });
  // Scope Permission to createsnapshot only when Request contains tag eks:cluster-name: MY_CLUSTER_NAME
  const createSnapshot = new PolicyStatement({
    resources: [
      '*',
    ],
    conditions: {
      StringEquals: {
        'aws:RequestTag/eks:cluster-name': clusterName,
      },
    },
    actions: [
      'ec2:CreateSnapshot',
    ],
  });
  // Scope Permission to DeleteSnapshot only when Resource contains tag eks:cluster-name: MY_CLUSTER_NAME
  const deleteSnapshot = new PolicyStatement({
    resources: [
      '*',
    ],
    conditions: {
      StringEquals: {
        'aws:ResourceTag/eks:cluster-name': clusterName,
      },
    },
    actions: [
      'ec2:DeleteSnapshot',
    ],
  });
  return new Policy(stack, 'ebsDriverPolicy', {
    roles: [
      roleSA,
    ],
    statements: [
      readEBSPolicy,
      createTags,
      deleteTags,
      createVolume,
      deleteVolume,
      modifyVolume,
      createSnapshot,
      deleteSnapshot,
    ],
  });
}

export function createAlbIngressPolicy(stack: Stack, clusterName: string, roleSA: IRole): Policy {
  /* Permissions are board to include all functionality of ALB, Permissions can be removed as fit, refer to annotations to see which actions are needed
  https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.2/guide/ingress/annotations/
  Custom Permission set can be generated by using IAM generated policy
  https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_generate-policy.html
  */

  // Permission to create ELB ServiceLinkRole if not already created, scoped to only elasticloadbalancing service role
  const serviceLinkedRole = new PolicyStatement({
    actions: [
      'iam:CreateServiceLinkedRole',
    ],
    resources: ['*'],
    conditions: {
      StringEquals: {
        'iam:AWSServiceName': 'elasticloadbalancing.amazonaws.com',
      },
    },
  });
  // Permission needs to self discovery networking attributes
  const readPolicy = new PolicyStatement({
    actions: [
      'ec2:DescribeAccountAttributes',
      'ec2:DescribeAddresses',
      'ec2:DescribeAvailabilityZones',
      'ec2:DescribeInternetGateways',
      'ec2:DescribeVpcs',
      'ec2:DescribeSubnets',
      'ec2:DescribeSecurityGroups',
      'ec2:DescribeInstances',
      'ec2:DescribeNetworkInterfaces',
      'ec2:DescribeTags',
      'ec2:GetCoipPoolUsage',
      'ec2:DescribeCoipPools',
      'elasticloadbalancing:DescribeLoadBalancers',
      'elasticloadbalancing:DescribeLoadBalancerAttributes',
      'elasticloadbalancing:DescribeListeners',
      'elasticloadbalancing:DescribeListenerCertificates',
      'elasticloadbalancing:DescribeSSLPolicies',
      'elasticloadbalancing:DescribeRules',
      'elasticloadbalancing:DescribeTargetGroups',
      'elasticloadbalancing:DescribeTargetGroupAttributes',
      'elasticloadbalancing:DescribeTargetHealth',
      'elasticloadbalancing:DescribeTags',
    ],
    resources: ['*'],
  });
  // Additional Permissions for shield, waf acm and cognito feature set enablement
  const readPolicyAdd = new PolicyStatement({
    actions: [
      'cognito-idp:DescribeUserPoolClient',
      'acm:ListCertificates',
      'acm:DescribeCertificate',
      'iam:ListServerCertificates',
      'iam:GetServerCertificate',
      'waf-regional:GetWebACL',
      'waf-regional:GetWebACLForResource',
      'waf-regional:AssociateWebACL',
      'waf-regional:DisassociateWebACL',
      'wafv2:GetWebACL',
      'wafv2:GetWebACLForResource',
      'wafv2:AssociateWebACL',
      'wafv2:DisassociateWebACL',
      'shield:GetSubscriptionState',
      'shield:DescribeProtection',
      'shield:CreateProtection',
      'shield:DeleteProtection',
    ],
    resources: ['*'],
  });
  // Enable usage of ingress rule for security groups created outside of controller
  const writeSG = new PolicyStatement({
    actions: [
      'ec2:AuthorizeSecurityGroupIngress',
      'ec2:RevokeSecurityGroupIngress',
    ],
    resources: ['*'],
  });
  // Enable controller to automatically create security groups, tags may be added later
  const createSG = new PolicyStatement({

    actions: [
      'ec2:CreateSecurityGroup',
    ],
    resources: ['*'],
  });
  // Give tagging permission to actions that create the resource, CreateSecurityGroup
  const createTags = new PolicyStatement({

    actions: [
      'ec2:CreateTags',
    ],
    resources: ['arn:aws:ec2:*:*:security-group/*'],
    conditions: {
      StringEquals: {
        'ec2:CreateAction': 'CreateSecurityGroup',
      },
      Null: {
        'aws:RequestTag/elbv2.k8s.aws/cluster': 'false',
      },
    },
  });
  // Create and Delete Tags for security groups when at time of authorization aws:RequestTag/elbv2.k8s.aws/cluster is null
  const createdeleteTags = new PolicyStatement({

    actions: [
      'ec2:CreateTags',
      'ec2:DeleteTags',
    ],
    resources: ['arn:aws:ec2:*:*:security-group/*'],
    conditions: {
      Null: {
        'aws:RequestTag/elbv2.k8s.aws/cluster': 'true',
        'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
      },
    },
  });
  // Management of SecurityGroup when at time of authorization aws:ResourceTag/elbv2.k8s.aws/cluster is not null
  const writeSGIngress = new PolicyStatement({

    actions: [
      'ec2:AuthorizeSecurityGroupIngress',
      'ec2:RevokeSecurityGroupIngress',
      'ec2:DeleteSecurityGroup',
    ],
    resources: ['*'],
    conditions: {
      Null: {
        'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
      },
    },
  });
  // Allow creation of LoadBalancer/TargetGroup only if Request contains Tags eks:cluster-name: MY_CLUSTER_NAME
  const createLoadBalancer = new PolicyStatement({

    actions: [
      'elasticloadbalancing:CreateLoadBalancer',
      'elasticloadbalancing:CreateTargetGroup',
    ],
    resources: ['*'],
    conditions: {
      StringEquals: {
        'aws:RequestTag/eks:cluster-name': clusterName,
      },
    },
  });
  // Management of LoadBalancer Listeners and Rules
  // TODO Scope to use tags with release of v2.2.0
  // https://github.com/kubernetes-sigs/aws-load-balancer-controller/issues/1966
  const createLoadBalancerAdd = new PolicyStatement({

    actions: [
      'elasticloadbalancing:CreateListener',
      'elasticloadbalancing:DeleteListener',
      'elasticloadbalancing:CreateRule',
      'elasticloadbalancing:DeleteRule',
    ],
    resources: ['*'],
  });
  // Management of ELB Tags when at authorization time aws:RequestTag/elbv2.k8s.aws/cluster is null
  const loadBalancerTags = new PolicyStatement(
    {

      actions: [
        'elasticloadbalancing:AddTags',
        'elasticloadbalancing:RemoveTags',
      ],
      resources: [
        'arn:aws:elasticloadbalancing:*:*:targetgroup/*/*',
        'arn:aws:elasticloadbalancing:*:*:loadbalancer/net/*/*',
        'arn:aws:elasticloadbalancing:*:*:loadbalancer/app/*/*',
      ],
      conditions: {
        Null: {
          'aws:RequestTag/elbv2.k8s.aws/cluster': 'true',
          'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
        },
      },
    });
  // Management of ListenerTags
  // TODO Scope using Tags RequestTags for AddTags
  // https://docs.aws.amazon.com/service-authorization/latest/reference/list_elasticloadbalancingv2.html#elasticloadbalancingv2-actions-as-permissions
  const loadBalancerListenersTags = new PolicyStatement({

    actions: [
      'elasticloadbalancing:AddTags',
      'elasticloadbalancing:RemoveTags',
    ],
    resources: [
      'arn:aws:elasticloadbalancing:*:*:listener/net/*/*/*',
      'arn:aws:elasticloadbalancing:*:*:listener/app/*/*/*',
      'arn:aws:elasticloadbalancing:*:*:listener-rule/net/*/*/*',
      'arn:aws:elasticloadbalancing:*:*:listener-rule/app/*/*/*',
    ],
  });
  // Management of LoadBalancer Targetgroup and Attributes, scoped to when at authorization time aws:ResourceTag/elbv2.k8s.aws/cluster is not null
  const modifyLoadBalancer = new PolicyStatement({

    actions: [
      'elasticloadbalancing:ModifyLoadBalancerAttributes',
      'elasticloadbalancing:SetIpAddressType',
      'elasticloadbalancing:SetSecurityGroups',
      'elasticloadbalancing:SetSubnets',
      'elasticloadbalancing:ModifyTargetGroup',
      'elasticloadbalancing:ModifyTargetGroupAttributes',
    ],
    resources: ['*'],
    conditions: {
      Null: {
        'aws:ResourceTag/elbv2.k8s.aws/cluster': 'false',
      },
    },
  });
  // Delete Load Balancer and TargetGroups to tag eks:cluster-name : MY_CLUSTER_NAME
  const deleteLoadBalancer = new PolicyStatement({
    resources: ['*'],
    actions: [
      'elasticloadbalancing:DeleteTargetGroup',
      'elasticloadbalancing:DeleteLoadBalancer',
    ],
    conditions: {
      StringEquals: {
        'aws:ResourceTag/eks:cluster-name': clusterName,
      },
    },
  });
  // Management of Target scoped to target-groups
  const registerTarget = new PolicyStatement({

    actions: [
      'elasticloadbalancing:RegisterTargets',
      'elasticloadbalancing:DeregisterTargets',
    ],
    resources: ['arn:aws:elasticloadbalancing:*:*:targetgroup/*/*'],
  });
  // Management of LoadBalancer Certs, WebACL and Rules
  const modifyLoadBalancerCerts = new PolicyStatement({

    actions: [
      'elasticloadbalancing:SetWebAcl',
      'elasticloadbalancing:ModifyListener',
      'elasticloadbalancing:AddListenerCertificates',
      'elasticloadbalancing:RemoveListenerCertificates',
      'elasticloadbalancing:ModifyRule',
    ],
    resources: ['*'],
  });

  return new Policy(stack, 'albIngressPolicy', {
    roles: [
      roleSA,
    ],
    statements: [
      modifyLoadBalancer,
      readPolicy,
      writeSG,
      createSG,
      readPolicyAdd,
      createTags,
      createdeleteTags,
      writeSGIngress,
      createLoadBalancer,
      loadBalancerTags,
      createLoadBalancerAdd,
      loadBalancerListenersTags,
      registerTarget,
      modifyLoadBalancer,
      modifyLoadBalancerCerts,
      deleteLoadBalancer,
      serviceLinkedRole,
    ],
  });
}
