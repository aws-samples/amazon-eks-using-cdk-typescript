import { CfnLaunchTemplate, MultipartBody, MultipartUserData, UserData } from '@aws-cdk/aws-ec2';
import { Cluster, Nodegroup } from '@aws-cdk/aws-eks';
import { Role, ManagedPolicy } from '@aws-cdk/aws-iam';
import * as cdk from '@aws-cdk/core';
import { CfnParameter, Fn } from '@aws-cdk/core';
interface k8snodegroupsProps extends cdk.StackProps {
  eksCluster: Cluster,
  nodeGroupRole: Role
}

export class K8snodegroups extends cdk.Stack {
  constructor (scope: cdk.Construct,
    id: string,
    props: k8snodegroupsProps) {
    super(scope, id, props);
    const nodegroupMax = new CfnParameter(this, 'nodegroupMax', {
      type: 'Number',
      description: 'Max number of EKS worker nodes to scale up to',
      default: 10,
    });
    const nodegroupCount = new CfnParameter(this, 'nodegroupCount', {
      type: 'Number',
      description: 'Desired Count of EKS Worker Nodes to launch',
      default: 2,
    });
    const nodegroupMin = new CfnParameter(this, 'nodegroupMin', {
      type: 'Number',
      description: 'Min number of EKS worker nodes to scale down to',
      default: 2,
    });
    const nodeType = new CfnParameter(this, 'nodegroupInstanceType', {
      type: 'String',
      description: 'Instance Type to be used with nodegroup ng-1',
      default: 't3.medium',
    });
    const nodeAMIVersion = new CfnParameter(this, 'nodeAMIVersion', {
      type: 'String',
      default: '1.21.2-20210722',
      description: 'AMI version used for EKS Worker nodes https://docs.aws.amazon.com/eks/latest/userguide/eks-linux-ami-versions.html',
    });

    const userdataCommands = UserData.forLinux();
    // SSH only allowed via SSM Session Manager - https://aws.github.io/aws-eks-best-practices/security/docs/hosts/#minimize-access-to-worker-nodes
    userdataCommands.addCommands(
      `sudo yum install -y https://s3.${this.region}.amazonaws.com/amazon-ssm-${this.region}/latest/linux_amd64/amazon-ssm-agent.rpm`,
    );
    const multipart = new MultipartUserData();
    // const part = MultipartBody
    multipart.addPart(
      MultipartBody.fromUserData(userdataCommands),
    );

    const launchtemplate = new CfnLaunchTemplate(this, 'LaunchTemplate', {
      launchTemplateData: {
        instanceType: nodeType.valueAsString,
        userData: Fn.base64(multipart.render()),
        // Ensure Managed Nodes Instances EBS Volumes are encrypted
        blockDeviceMappings: [
          {
            deviceName: '/dev/xvda',
            ebs: {
              encrypted: true,
              volumeType: 'gp3',
            },
          },
        ],
        // Restrict access to the instance profile assigned to the worker node (not enabled)
        // Not all components are IMDSv2 aware. Ex. Fluentbit
        // https://aws.github.io/aws-eks-best-practices/security/docs/iam/#restrict-access-to-the-instance-profile-assigned-to-the-worker-node
        // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ec2-launchtemplate-launchtemplatedata-metadataoptions.html#aws-properties-ec2-launchtemplate-launchtemplatedata-metadataoptions-properties
        // https://aws.github.io/aws-eks-best-practices/security/docs/iam/#when-your-application-needs-access-to-idms-use-imdsv2-and-increase-the-hop-limit-on-ec2-instances-to-2
        metadataOptions: {
          httpTokens: 'optional',
          httpPutResponseHopLimit: 2,

        },
        tagSpecifications: [{
          resourceType: 'instance',
          tags: [
            {
              key: 'Name',
              value: Fn.join('-', [props.eksCluster.clusterName, 'WorkerNodes']),
            },
          ],
        }],
      },
      launchTemplateName: Fn.join('-', ['ng-1', props.eksCluster.clusterName]),

    });
    props.nodeGroupRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

    (() => new Nodegroup(this, 'ng-1', {
      cluster: props.eksCluster,
      // https://docs.aws.amazon.com/eks/latest/userguide/eks-linux-ami-versions.html
      releaseVersion: nodeAMIVersion.valueAsString,
      nodegroupName: 'ng-1',
      // Require specific order of max,desired,min or generated CDK Tokens fail desired>min check
      // https://github.com/aws/aws-cdk/issues/15485
      nodeRole: props.nodeGroupRole,
      maxSize: nodegroupMax.valueAsNumber,
      desiredSize: nodegroupCount.valueAsNumber,
      minSize: nodegroupMin.valueAsNumber,
      // LaunchTemplate for custom userdata to install SSM Agent
      launchTemplateSpec: {
        id: launchtemplate.ref,
        version: launchtemplate.attrLatestVersionNumber,
      },
      tags: {
        Name: Fn.join('-', [props.eksCluster.clusterName, 'WorkerNodes']),
      },
    }))();
    // Permissions for SSM Manager for core functionality
    props.nodeGroupRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
  }
}
