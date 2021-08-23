import {
  GatewayVpcEndpointAwsService,
  Vpc,
  FlowLogTrafficType,
  FlowLogDestination,
  InterfaceVpcEndpoint,
} from '@aws-cdk/aws-ec2';
import { Stack } from '@aws-cdk/core';

// Private Endpoints
// https://docs.aws.amazon.com/eks/latest/userguide/private-clusters.html#vpc-endpoints-private-clusters
// EKS VPC Endpoint RoadMap https://github.com/aws/containers-roadmap/issues/298

export function addEndpoint (stack: Stack, vpc: Vpc): void {
  // Additional VPC Endpoint for EKS https://docs.aws.amazon.com/eks/latest/userguide/private-clusters.html#vpc-endpoints-private-clusters
  (() => new InterfaceVpcEndpoint(stack, 'ecrapiVpcEndpoint', {
    open: true,
    vpc: vpc,
    service: {
      name: `com.amazonaws.${stack.region}.ecr.api`,
      port: 443,
    },
    privateDnsEnabled: true,
  }))();

  (() => new InterfaceVpcEndpoint(stack, 'ecradkrVpcEndpoint', {
    open: true,
    vpc: vpc,
    service: {
      name: `com.amazonaws.${stack.region}.ecr.dkr`,
      port: 443,
    },
    privateDnsEnabled: true,
  }))();
}

export const eksVpc = {
  cidr: '10.0.0.0/16',
  maxAzs: 3,
  // S3/DynamoDB https://docs.aws.amazon.com/vpc/latest/privatelink/vpce-gateway.html
  gatewayEndpoints: {
    // S3 Gateway  https://docs.aws.amazon.com/AmazonS3/latest/userguide/privatelink-interface-endpoints.html#types-of-vpc-endpoints-for-s3
    // S3 Gateway vs Private Endpoint https://docs.aws.amazon.com/AmazonS3/latest/userguide/privatelink-interface-endpoints.html#types-of-vpc-endpoints-for-s3
    S3: {
      service: GatewayVpcEndpointAwsService.S3,
    },

  },
  flowLogs: {
    VpcFlowlogs: {
      destination: FlowLogDestination.toCloudWatchLogs(),
      trafficType: FlowLogTrafficType.ALL,
    },
  },
  // TWO Nat Gateways for higher availability
  natGateways: 2,
};
