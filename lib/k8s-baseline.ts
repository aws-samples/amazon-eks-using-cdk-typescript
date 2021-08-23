import * as fs from 'fs';
import { Cluster, HelmChart, KubernetesManifest, ServiceAccount } from '@aws-cdk/aws-eks';
import { ManagedPolicy } from '@aws-cdk/aws-iam';
import * as cdk from '@aws-cdk/core';
import { CfnCondition, CfnParameter, CfnResource, Fn, IConstruct } from '@aws-cdk/core';
import * as yaml from 'js-yaml';
import * as genPolicy from './policies/policies';

interface k8sBaselineProps extends cdk.StackProps {
  eksCluster: Cluster,
}

export class K8sBaselineStack extends cdk.Stack {
  constructor (scope: cdk.Construct,
    id: string,
    props: k8sBaselineProps) {
    super(scope, id, props);
    // ============================================================================================================================================
    // Parameters
    // ============================================================================================================================================
    const ebsDriver = new CfnParameter(this, 'ebsDriver', {
      type: 'String',
      default: 'false',
      description: 'Deploy EBS CSI Driver',
      allowedValues: ['true', 'false'],
    });
    const albDriver = new CfnParameter(this, 'albDriver', {
      type: 'String',
      default: 'true',
      description: 'Deploy Application Load Balancer Ingress ',
      allowedValues: ['true', 'false'],
    });
    const efsDriver = new CfnParameter(this, 'efsDriver', {
      type: 'String',
      default: 'false',
      description: 'Deploy EFS CSI Driver',
      allowedValues: ['true', 'false'],
    });
    // FluentBit needs to implement IMDSv2
    // https://github.com/fluent/fluent-bit/issues/2840#issuecomment-774393238
    const fluentBitDriver = new CfnParameter(this, 'fluentBit', {
      type: 'String',
      default: 'true',
      description: 'Deploy FluentBit Log Collection Driver',
      allowedValues: ['true', 'false'],
    });
    const secretsDriver = new CfnParameter(this, 'secretsDriver', {
      type: 'String',
      default: 'false',
      description: 'Deploy AWS Secrets CSI Driver',
      allowedValues: ['true', 'false'],
    });

    const networkPolicyEngineDriver = new CfnParameter(this, 'networkPolicyEngine', {
      type: 'String',
      default: 'false',
      description: 'Deploy Calico Network Policy Engine Driver',
      allowedValues: ['true', 'false'],
    });

    const clusterAutoscalerDriver = new CfnParameter(this, 'clusterAutoscaler', {
      type: 'String',
      default: 'true',
      description: 'Deploy Cluster Autoscaler',
      allowedValues: ['true', 'false'],
    });
    const containerInsightsDriver = new CfnParameter(this, 'containerInsights', {
      type: 'String',
      default: 'false',
      description: 'Deploy Container Insights',
      allowedValues: ['true', 'false'],
    });
    const metricServerDriver = new CfnParameter(this, 'metricServer', {
      type: 'String',
      default: 'true',
      description: 'Deploy Metric Server',
      allowedValues: ['true', 'false'],
    });

    // ============================================================================================================================================
    // Conditions
    // ============================================================================================================================================

    const ebsDriverCondition = new CfnCondition(this, 'ebsDriverCondition', {
      expression: Fn.conditionEquals(ebsDriver.valueAsString, 'true'),
    });

    const albDriverCondition = new CfnCondition(this, 'albDriverCondition', {
      expression: Fn.conditionEquals(albDriver.valueAsString, 'true'),
    });
    const efsDriverCondition = new CfnCondition(this, 'efsDriverCondition', {
      expression: Fn.conditionEquals(efsDriver.valueAsString, 'true'),
    });
    const fluentBitDriverCondition = new CfnCondition(this, 'fluentBitDriverCondition', {
      expression: Fn.conditionEquals(fluentBitDriver.valueAsString, 'true'),
    });
    const secretsDriverCondition = new CfnCondition(this, 'secretsDriverCondition', {
      expression: Fn.conditionEquals(secretsDriver.valueAsString, 'true'),
    });
    const networkPolicyDriverCondition = new CfnCondition(this, 'networkPolicyEngineDriverCondition', {
      expression: Fn.conditionEquals(networkPolicyEngineDriver.valueAsString, 'true'),
    });
    const clusterAutoscalerDriverCondition = new CfnCondition(this, 'clusterAutoscalerDriverCondition', {
      expression: Fn.conditionEquals(clusterAutoscalerDriver.valueAsString, 'true'),
    });
    const containerInsightsDriverCondition = new CfnCondition(this, 'containerInsightsDriverCondition', {
      expression: Fn.conditionEquals(containerInsightsDriver.valueAsString, 'true'),
    });
    const metricServerDriverCondition = new CfnCondition(this, 'metricServerDriverCondition', {
      expression: Fn.conditionEquals(metricServerDriver.valueAsString, 'true'),
    });

    // ============================================================================================================================================
    // Resource Creation
    // ============================================================================================================================================
    /*
    Service Account Resources will be created in CDK to ensure proper IAM to K8s RBAC Mapping
    Helm Chart Version are taken from cdk.json file or from command line parameter -c
    Helm Chart full version list can be found via helm repo list or viewing yaml file on github directly, see README.
    */

    /*
    Resources needed to create Cluster Autoscaler
    Service Account Role
    IAM Policy
    Helm Chart
    */
    const clusterAutoscalerSA = new ServiceAccount(this, 'clusterAutoscalerSA', {
      name: 'cluster-autoscaler-sa',
      cluster: props.eksCluster,
      namespace: 'kube-system',
    });
    this.addConditions(clusterAutoscalerSA, clusterAutoscalerDriverCondition);
    const clusterAutoscalerDeploy = new HelmChart(this, 'clusterautoscaler-deploy', {
      repository: 'https://kubernetes.github.io/autoscaler',
      release: 'cluster-autoscaler',
      cluster: props.eksCluster,
      chart: 'cluster-autoscaler',
      namespace: 'kube-system',
      wait: true,
      // https://github.com/kubernetes/autoscaler/blob/gh-pages/index.yaml
      version: this.node.tryGetContext('cluster-autoscaler-helm-version'),
      // https://github.com/kubernetes/autoscaler/tree/master/charts/cluster-autoscaler#values
      values: {
        cloudProvider: 'aws',
        awsRegion: this.region,
        autoDiscovery: {
          clusterName: props.eksCluster.clusterName,
        },
        rbac: {
          serviceAccount: {
            create: false,
            name: clusterAutoscalerSA.serviceAccountName,
          },
        },
        extraArgs: {
          // https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md#what-are-the-parameters-to-ca
          'skip-nodes-with-system-pods': false,
          'skip-nodes-with-local-storage': false,
          'balance-similar-node-groups': true,
          // How long a node should be unneeded before it is eligible for scale down
          'scale-down-unneeded-time': '300s',
          // How long after scale up that scale down evaluation resumes
          'scale-down-delay-after-add': '300s',
        },

      },
    });
    // Generate IAM Policy with scoped permissions
    const clusterAutoscalerPolicy = genPolicy.createClusterAutoscalerPolicy(this, props.eksCluster.clusterName, clusterAutoscalerSA.role);
    // Add condition to deploy clusterAutoscaler Resources only if condition is true
    this.addConditions(clusterAutoscalerDeploy, clusterAutoscalerDriverCondition);
    this.addConditions(clusterAutoscalerPolicy, clusterAutoscalerDriverCondition);
    /*
    Resources needed to create Fluent Bit DaemonSet
    Namespace
    Service Account Role
    IAM Policy
    K8s Manifest

    Current Config pushes to Cloudwatch , other outputs found here https://docs.fluentbit.io/manual/pipeline/outputs
    Fluentbit does not support IMDSv2
    https://github.com/fluent/fluent-bit/issues/2840#issuecomment-774393238
    */

    // YAML contains fluentbit parser configurations, remove namespace and serviceaccount from yaml to properly annotate with IAM Role
    const manifestFluentBitSetup = this.cleanManifest('manifests/fluentBitSetup.yaml');
    const fluentBitNamespace = new KubernetesManifest(this, 'amazon-cloudwatch-namespace', {
      cluster: props.eksCluster,
      manifest: [{
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: 'amazon-cloudwatch',
          labels: {
            name: 'amazon-cloudwatch',
          },
        },
      }],
    });
    this.addConditions(fluentBitNamespace, fluentBitDriverCondition);
    const fluentBitSA = new ServiceAccount(this, 'fluentbit-sa', {
      name: 'fluent-bit',
      namespace: 'amazon-cloudwatch',
      cluster: props.eksCluster,
    });
    // Ensure Namespace is created first before fluentBitSA resource
    fluentBitSA.node.addDependency(fluentBitNamespace);
    const fluentbitPolicy = genPolicy.createFluentbitPolicy(this, props.eksCluster.clusterName, fluentBitSA.role);
    this.addConditions(fluentbitPolicy, fluentBitDriverCondition);
    this.addConditions(fluentBitSA, fluentBitDriverCondition);
    // Configurable variables for  manifests/fluentBitSetup.yaml
    const fluentBitClusterInfo = new KubernetesManifest(this, 'fluentbit-cluster-info', {
      cluster: props.eksCluster,
      manifest: [{
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: {
          name: 'fluent-bit-cluster-info',
          namespace: 'amazon-cloudwatch',
          labels: {
            name: 'fluent-bit-cluster-info',
          },
        },
        data: {
          'cluster.name': props.eksCluster.clusterName,
          'http.port': '2020',
          'http.server': 'On',
          'logs.region': this.region,
          'read.head': 'Off',
          'read.tail': 'On',
        },

      }],

    });
    fluentBitClusterInfo.node.addDependency(fluentBitNamespace);
    this.addConditions(fluentBitClusterInfo, fluentBitDriverCondition);
    const fluentBitResource = new KubernetesManifest(this, 'fluentbit-resource', {
      cluster: props.eksCluster,
      manifest: manifestFluentBitSetup,
    });
    fluentBitResource.node.addDependency(fluentBitSA);
    fluentBitResource.node.addDependency(fluentBitClusterInfo);
    this.addConditions(fluentBitResource, fluentBitDriverCondition);

    /*
    Resources needed to create ALB Ingress Controller
    Namespace
    Service Account Role
    IAM Policy
    Helm Chart
    AddOn: https://github.com/aws/containers-roadmap/issues/1162
    */

    // Create Namespace and Service Account for ALB Ingress
    const albNamespace = new KubernetesManifest(this, 'alb-ingress-controller-namespace', {
      cluster: props.eksCluster,
      manifest: [{
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: 'alb-ingress-controller',
          labels: {
            name: 'alb-ingress-controller',
          },
        },
      }],
    });
    const albSA = new ServiceAccount(this, 'alb-ingress-controller-sa', {
      name: 'alb-ingress-controller-sa',
      namespace: 'alb-ingress-controller',
      cluster: props.eksCluster,
    });
    this.addConditions(albNamespace, albDriverCondition);
    albSA.node.addDependency(albNamespace);
    this.addConditions(albSA, albDriverCondition);

    // ALB Controller IAMPolicy
    const albIamTest = genPolicy.createAlbIngressPolicy(this, props.eksCluster.clusterName, albSA.role);
    this.addConditions(albIamTest, albDriverCondition);
    // https://github.com/aws/eks-charts/blob/master/stable/aws-load-balancer-controller/values.yaml
    const albIngressHelmChart = new HelmChart(this, 'alb-ingress-controller-chart', {
      chart: 'aws-load-balancer-controller',
      cluster: props.eksCluster,
      repository: 'https://aws.github.io/eks-charts',
      wait: true,
      release: 'aws-load-balancer-controller',
      createNamespace: true,
      namespace: 'alb-ingress-controller',
      // https://github.com/aws/eks-charts/blob/gh-pages/index.yaml
      version: this.node.tryGetContext('aws-load-balancer-controller-helm-version'),
      values: {
        clusterName: props.eksCluster.clusterName,
        defaultTags: {
          'eks:cluster-name': props.eksCluster.clusterName,
        },
        // Start - values needed if ec2metadata endpoint is unavailable - https://github.com/aws/eks-charts/tree/master/stable/aws-load-balancer-controller#configuration
        region: this.region,
        vpcId: props.eksCluster.vpc.vpcId,
        // End - values needed if ec2metadata endpoint is unavailable
        serviceAccount: {
          create: false,
          name: albSA.serviceAccountName,
        },
      },
    });
    albIngressHelmChart.node.addDependency(albSA);
    this.addConditions(albIngressHelmChart, albDriverCondition);
    /*
    Resources needed to create EBS CSI Driver
    Service Account Role
    IAM Policy
    Helm Chart
    Add On: https://github.com/aws/containers-roadmap/issues/247
    */

    // Create Service Account (Pod IAM Role Mapping) for EBS Controller
    const ebsSA = new ServiceAccount(this, 'ebs-csi-controller-sa', {
      name: 'ebs-csi-controller-sa',
      namespace: 'kube-system',
      cluster: props.eksCluster,
    });
    this.addConditions(ebsSA, ebsDriverCondition);

    // EBS Controller IAMPolicyDoc
    const ebsIamPolicyTest = genPolicy.createEBSPolicy(this, props.eksCluster.clusterName, ebsSA.role);
    this.addConditions(ebsIamPolicyTest, ebsDriverCondition);
    // Helm Chart Values: https://github.com/kubernetes-sigs/aws-ebs-csi-driver/blob/master/charts/aws-ebs-csi-driver/values.yaml
    const ebsCsiHelmChart = new HelmChart(this, 'ebs-csi-helm-chart', {
      chart: 'aws-ebs-csi-driver',
      cluster: props.eksCluster,
      createNamespace: true,
      repository: 'https://kubernetes-sigs.github.io/aws-ebs-csi-driver',
      release: 'aws-ebs-csi-driver',
      namespace: 'kube-system',
      wait: true,
      // Helm Chart Versions: https://github.com/kubernetes-sigs/aws-ebs-csi-driver/blob/gh-pages/index.yaml
      version: this.node.tryGetContext('aws-ebs-csi-driver-helm-version'),
      values: {
        controller: {
          serviceAccount: {
            create: false,
            name: ebsSA.serviceAccountName,
          },
          extraVolumeTags: {
            'eks:cluster-name': props.eksCluster.clusterName,
          },
        },

      },

    });

    ebsCsiHelmChart.node.addDependency(ebsSA);
    this.addConditions(ebsCsiHelmChart, ebsDriverCondition);

    /*
       Resources needed to create EFS Controller
       Service Account Role
       IAM Policy
       Helm Chart
       */

    const efsSA = new ServiceAccount(this, 'efs-csi-controller-sa', {
      name: 'efs-csi-controller-sa',
      namespace: 'kube-system',
      cluster: props.eksCluster,
    });
    this.addConditions(efsSA, efsDriverCondition);

    // Make sure to allow traffic on port 2049 on the security group associated to your EFS file system from the CIDR assigned to your EKS cluster.
    // https://docs.aws.amazon.com/efs/latest/ug/network-access.html
    // Ensure EFS connections are using TLS when provisioning EFS PersistentVolume
    // https://docs.aws.amazon.com/eks/latest/userguide/efs-csi.html#efs-install-driver
    const efsPolicy = genPolicy.createEFSPolicy(this, props.eksCluster.clusterName, efsSA.role);
    this.addConditions(efsPolicy, efsDriverCondition);
    // Helm Chart Values: https://github.com/kubernetes-sigs/aws-efs-csi-driver/blob/master/charts/aws-efs-csi-driver/values.yaml
    const efsCsiHelmChart = new HelmChart(this, 'efs-csi-helm-chart', {
      chart: 'aws-efs-csi-driver',
      cluster: props.eksCluster,
      createNamespace: true,
      repository: 'https://kubernetes-sigs.github.io/aws-efs-csi-driver',
      release: 'aws-efs-csi-driver',
      namespace: 'kube-system',
      wait: true,
      // Helm Chart Versions: https://github.com/kubernetes-sigs/aws-efs-csi-driver/blob/gh-pages/index.yaml
      version: this.node.tryGetContext('aws-efs-csi-driver-helm-version'),
      values: {
        controller: {
          logLevel: 10,
          serviceAccount: {
            create: false,
            name: efsSA.serviceAccountName,
          },
          tags: {
            // Unable to use ":" in tags due to EFS CSI Driver splitting string by ":" eks:cluster-name: myclustername -> eks: cluster-name
            // https://github.com/kubernetes-sigs/aws-efs-csi-driver/blob/388c3f90f21f9c550935815bc8af25ddce4c7f32/pkg/driver/driver.go#L145
            'eks/cluster-name': props.eksCluster.clusterName,
          },
        },

      },

    });

    efsCsiHelmChart.node.addDependency(efsSA);
    this.addConditions(efsCsiHelmChart, efsDriverCondition);

    /*
       Resources needed to create Secrets Manager
       Service Account Role
       Helm Chart
       Kubernetes Manifest
    */

    const awsSecretSa = new ServiceAccount(this, 'aws-secrets-sa', {
      cluster: props.eksCluster,
      name: 'csi-secrets-store-provider-aws',
      namespace: 'kube-system',
    });

    this.addConditions(awsSecretSa, secretsDriverCondition);

    // https://github.com/kubernetes-sigs/secrets-store-csi-driver/blob/master/charts/secrets-store-csi-driver/values.yaml
    // Deploys Secrets Store CSI Driver
    const secretsCsiHelmChart = new HelmChart(this, 'secrets-csi-helm-chart', {
      chart: 'secrets-store-csi-driver',
      cluster: props.eksCluster,
      createNamespace: true,
      repository: 'https://raw.githubusercontent.com/kubernetes-sigs/secrets-store-csi-driver/master/charts',
      release: 'csi-secrets-store',
      namespace: 'kube-system',
      wait: true,
      // Helm Chart Values: https://github.com/kubernetes-sigs/secrets-store-csi-driver/blob/master/charts/index.yaml
      version: this.node.tryGetContext('secrets-store-csi-helm-version'),
      values: {
        grpcSupportedProviders: 'aws',
        // alpha feature reconciler feature
        // rotationPollInterval: 3600
        // enableSecretRotation: true
      },

    });

    this.addConditions(secretsCsiHelmChart, secretsDriverCondition);
    // Deploys AWS Secrets and Configuration Provider (ASCP)
    const awsSecretsManifest = this.cleanManifest('manifests/awsSecretsManifest.yaml');
    const awsSecretsManifestDeploy = new KubernetesManifest(this, 'aws-secrets-manifest', {
      cluster: props.eksCluster,
      manifest: awsSecretsManifest,
    });

    awsSecretsManifestDeploy.node.addDependency(secretsCsiHelmChart);
    this.addConditions(awsSecretsManifestDeploy, secretsDriverCondition);

    /*
       Resources needed to create Calico Policy Engine
       Helm Chart
    */
    // https://github.com/aws/eks-charts/blob/master/stable/aws-calico/values.yaml
    // https://github.com/aws/amazon-vpc-cni-k8s/issues/1517
    const calicoPolicyEngine = new HelmChart(this, 'calico-policy-engine', {
      chart: 'aws-calico',
      cluster: props.eksCluster,
      createNamespace: true,
      repository: 'https://aws.github.io/eks-charts',
      release: 'aws-calico',
      namespace: 'kube-system',
      wait: true,
      // https://github.com/aws/eks-charts/blob/gh-pages/index.yaml
      version: this.node.tryGetContext('aws-calico-helm-version'),
      // increase limits for calico pods, more needed as number of nodes/pods increase. Uses default Requests values in values.yaml in above comment
      values: {
        calico: {
          node: {
            logseverity: 'Debug',
            resources: {
              limits: {
                memory: '256Mi',
                cpu: '500m',
              },
            },
          },
        },
      },

    });
    this.addConditions(calicoPolicyEngine, networkPolicyDriverCondition);

    /*
    Resources needed to create Container Insights using OpenTelemetry
    Service Account Role
    IAM Policy
    Kubernetes Manifest

    OpenTelemetry is configured to emit all public available metrics for ContainerInsights, to reduce CloudWatch Metric cost customize the ADOT collector
    https://aws-otel.github.io/docs/getting-started/container-insights/eks-infra#advanced-usage
    */
    // Create Namespace for Container Insights components
    const containerInsightsNamespace = new KubernetesManifest(this, 'container-insights-namespace', {
      cluster: props.eksCluster,
      manifest: [{
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: 'aws-otel-eks',
          labels: {
            name: 'aws-otel-eks',
          },
        },
      }],
    });
    this.addConditions(containerInsightsNamespace, containerInsightsDriverCondition);

    const containerInsightsSA = new ServiceAccount(this, 'container-insights-sa', {
      name: 'aws-otel-sa',
      namespace: 'aws-otel-eks',
      cluster: props.eksCluster,
    });
    containerInsightsSA.role.addManagedPolicy(ManagedPolicy.fromManagedPolicyArn(this, 'CloudWatchAgentServerPolicyManaged', 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy'));
    this.addConditions(containerInsightsSA, containerInsightsDriverCondition);

    containerInsightsSA.node.addDependency(containerInsightsNamespace);
    const manifestcontainerInsightsSetup = this.cleanManifest('manifests/otelContainerInsights.yaml');
    const containerInsightsDeploy = new KubernetesManifest(this, 'container-insights-deploy', {
      cluster: props.eksCluster,
      manifest: [
        ...manifestcontainerInsightsSetup,
      ],
    });
    containerInsightsDeploy.node.addDependency(containerInsightsSA);
    this.addConditions(containerInsightsDeploy, containerInsightsDriverCondition);
    /* Resources needed to create Metric Server
        Manifest

        Metric Server Scaling Requirements -> https://github.com/kubernetes-sigs/metrics-server#scaling
        AddOn: https://github.com/aws/containers-roadmap/issues/261
    */
    // version is based on default metric server manifest see file for origin, does not require clean up function as namespace service account does not reply on IAM Role creation dependency.
    const manifestMetricServer = yaml.loadAll(fs.readFileSync('manifests/metricServerManifest.yaml', 'utf-8'), null, { schema: yaml.JSON_SCHEMA });
    const metricServerManifestDeploy = new KubernetesManifest(this, 'metric-server', {
      cluster: props.eksCluster,
      manifest: [
        ...manifestMetricServer,
      ],
    });
    this.addConditions(metricServerManifestDeploy, metricServerDriverCondition);
  }

  // Takes a CDK Abstract Resource and adds CFN Conditions to the underlying CFN Resources to ensure proper resource creation/deletion
  addConditions (resource: IConstruct, cond: CfnCondition) {
    // Add Conditions to Cfn type resources only, which map directly to Cloudformation resource type AWS::TYPE::RESOURCE
    // https://docs.aws.amazon.com/cdk/api/latest/docs/core-readme.html#intrinsic-functions-and-condition-expressions
    if (resource.node.defaultChild !== undefined && resource.node.defaultChild.constructor.name.match(/^Cfn+/)) {
      (resource.node.defaultChild as CfnResource).cfnOptions.condition = cond;
    } else {
      resource.node.children.forEach(node => {
        this.addConditions(node, cond);
      });
    }
  }

  // Removes namespace and ServiceAccount objects from manifests, performing this in code to keep original manifest files.
  cleanManifest (file: string) {
    const manifest = yaml.loadAll(fs.readFileSync(file, 'utf-8'), null, { schema: yaml.JSON_SCHEMA });
    return manifest.filter(element => (element.kind !== 'Namespace' && element.kind !== 'ServiceAccount'));
  }
}
