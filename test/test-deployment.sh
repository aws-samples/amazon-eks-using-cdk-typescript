#!/bin/bash
set -e -o pipefail 
set -o errtrace

function err_report() {
    tput setaf 1
    echo "`date` - ERROR CODE:$1 LINE:$2 COMMAND:$BASH_COMMAND"
    tput sgr 0
}
function printVar(){

    logger "$1 = $2"

}
# trap "err_report $FUNCNAME $LINENO " ERR
trap 'err_report $? $LINENO $BASH_LINENO' ERR


function logger (){
    echo "`date` - $1"
}


function verifyDependencies(){
command -v jq >> /dev/null || $(echo 'jq command not found' && false)
command -v kubectl >> /dev/null || $(echo 'kubectl command not found' && false)
command -v aws >> /dev/null || $(echo 'aws command not found' && false)
command -v cdk >> /dev/null || $(echo 'cdk command not found' && false)
}

function cdkCreate(){
if [ "$SKIP_CDK" = "false" ];then
logger "Starting Test, deploy cluster"
printVar \$CUSTOM_VPC "$CUSTOM_VPC"
printVar \$CUSTOM_VPC_COMMAND "$CUSTOM_VPC_COMMAND"
printVar \$STACK_PREFIX_COMMAND "$STACK_PREFIX_COMMAND"
printVar \$STACK_PREFIX "$STACK_PREFIX"
# Needs cdk.json for cdk commands
cd ../
logger "CDK diff"
cdk diff -c cluster_name=$EKS_CLUSTER $CUSTOM_VPC_COMMAND $STACK_PREFIX_COMMAND
logger "Disable all EKSK8sBaseline parameters"
cdk deploy  -c cluster_name=$EKS_CLUSTER --require-approval never EKSK8sBaseline --parameters "$STACK_PREFIX"EKSK8sBaseline:ebsDriver=false --parameters "$STACK_PREFIX"EKSK8sBaseline:albDriver=false --parameters "$STACK_PREFIX"EKSK8sBaseline:efsDriver=false --parameters "$STACK_PREFIX"EKSK8sBaseline:fluentBit=false --parameters "$STACK_PREFIX"EKSK8sBaseline:secretsDriver=false --parameters "$STACK_PREFIX"EKSK8sBaseline:networkPolicyEngine=false --parameters "$STACK_PREFIX"EKSK8sBaseline:clusterAutoscaler=false --parameters "$STACK_PREFIX"EKSK8sBaseline:containerInsights=false --parameters "$STACK_PREFIX"EKSK8sBaseline:metricServer=false $CUSTOM_VPC_COMMAND $STACK_PREFIX_COMMAND
logger "Finished CDK Deployment"
logger "Enabling all EKSK8sBaseline parameters"
cdk deploy  -c cluster_name=$EKS_CLUSTER --require-approval never EKSK8sBaseline --parameters "$STACK_PREFIX"EKSK8sBaseline:ebsDriver=true  --parameters "$STACK_PREFIX"EKSK8sBaseline:albDriver=true  --parameters "$STACK_PREFIX"EKSK8sBaseline:efsDriver=true  --parameters "$STACK_PREFIX"EKSK8sBaseline:fluentBit=true  --parameters "$STACK_PREFIX"EKSK8sBaseline:secretsDriver=true  --parameters "$STACK_PREFIX"EKSK8sBaseline:networkPolicyEngine=true  --parameters "$STACK_PREFIX"EKSK8sBaseline:clusterAutoscaler=true  --parameters "$STACK_PREFIX"EKSK8sBaseline:containerInsights=true --parameters "$STACK_PREFIX"EKSK8sBaseline:metricServer=true $CUSTOM_VPC_COMMAND $STACK_PREFIX_COMMAND
logger "Finished CDK Deployment"
cd test/
fi
}

function updateKube(){
logger "Configure Kubectl"
printVar \$EKS_CLUSTER $EKS_CLUSTER
aws eks update-kubeconfig --name $EKS_CLUSTER 
logger "Test kubectl command"
kubectl get nodes

}
################################################################################################################
#                                                                                                              #
#   ContainerInsights Testing                                                                                  #
#                                                                                                              # 
################################################################################################################
function containerInsights(){
logger "Start Container Insights Testing"
logger "Identity Log Groups for Container Insights"
NODES=$(kubectl get nodes -o=json | jq '.items[].metadata.name' --raw-output)
NODES=( $NODES )
for node in "${NODES[@]}"
do
   logger "Verify Logstream /aws/containerinsights/$EKS_CLUSTER/performance/$node"
   aws logs describe-log-streams --log-group-name "/aws/containerinsights/$EKS_CLUSTER/performance" --log-stream-name-prefix "$node"

done
logger "Successful Container Insight"
}
################################################################################################################
#                                                                                                              #
#   ClusterAutoscaling Testing                                                                                 #
#                                                                                                              # 
################################################################################################################
function clusterAutoscalingTesting(){
logger "Start Cluster Autoscaling Testing"
logger "Deploy httpd with replicas 1"
kubectl apply -f "manifests/cluster_autoscaling_example.yaml"
logger "Wait for deployment"
kubectl wait -n cluster-autoscaler-test deploy/httpd-deploy --for=condition=available --timeout 10m
logger "Scale Deployment to 10"
kubectl scale --replicas=10 -n cluster-autoscaler-test deployment/httpd-deploy
logger "Wait for ec2 scaling"
kubectl wait -n cluster-autoscaler-test deploy/httpd-deploy --for=condition=available --timeout 10m
logger "Verify number of nodes greater than default 2"
NODES=$(kubectl get nodes -o jsonpath='{range .items[*]}{@.metadata.name}:{range @.status.conditions[3]} {@.type}={@.status};{end}{end}' | grep -o True | wc -l)
if [ "$NODES" -gt 2 ];then
    logger "Number of Nodes $NODES greater than 2"
else
    logger "Number of Nodes $NODES not greater than 2"
    false
fi
logger "Scale httpd deployment to 1"
kubectl scale --replicas=1 -n cluster-autoscaler-test deployment/httpd-deploy 
logger "Wait for Deployment to complete"
kubectl wait -n cluster-autoscaler-test deploy/httpd-deploy --for=condition=available --timeout 10m
logger "Wait 15 minutes for cooldown between scaling operations"
sleep 900
logger "Verify number of nodes has decreased"
LOW_NODES=$(kubectl get nodes -o jsonpath='{range .items[*]}{@.metadata.name}:{range @.status.conditions[3]} {@.type}={@.status};{end}{end}' | grep -o True | wc -l)
if [ "$NODES" -gt "$LOW_NODES" ];then
    logger "Current number of nodes: $LOW_NODE less than previous $NODES"
else
    logger "Current number of nodes: $LOW_NODE Not less than previous $NODES"
    false
fi
logger "Success ClusterAutoscaler Test"
kubectl delete -f "manifests/cluster_autoscaling_example.yaml"
logger "End of ClusterAutoscaler Test"
}

################################################################################################################
#                                                                                                              #
#   LogConfig Testing                                                                                          #
#                                                                                                              # 
################################################################################################################
function logConfigTesting(){
    logger "Start EKS Log Parameter Testing"
    logger "Update Stack and disable EKS Logging"
    cd ../
    cdk deploy  -c cluster_name=$EKS_CLUSTER  EKSStack --require-approval never --parameters "$STACK_PREFIX"EKSStack:eksLoggingOpts="" $CUSTOM_VPC_COMMAND $STACK_PREFIX_COMMAND
    ALL_LOGGING_EKS_OPTS='[
    "authenticator",
    "controllerManager",
    "scheduler",
    "audit",
    "api"
    ]'
    ## Extra API call and sleep since the results are not always up to date right after logging update
    CURRENT_LOGGING_EKS_OPTS=$(aws  eks describe-cluster --name $EKS_CLUSTER  --query 'cluster.logging.clusterLogging[?enabled==`false`].types[]' --output json )
    sleep 15
    CURRENT_LOGGING_EKS_OPTS=$(aws  eks describe-cluster --name $EKS_CLUSTER  --query 'cluster.logging.clusterLogging[?enabled==`false`].types[]' --output json )
    COMPARE_OUTPUT=$(python -c "print(len(set($ALL_LOGGING_EKS_OPTS) - set($CURRENT_LOGGING_EKS_OPTS)));")
    printVar \$ALL_LOGGING_EKS_OPTS "$ALL_LOGGING_EKS_OPTS"
    printVar \$CURRENT_LOGGING_EKS_OPTS "$CURRENT_LOGGING_EKS_OPTS"
    if [[ $COMPARE_OUTPUT -eq "0" ]]; then 
        logger "Valid Logging Configuration for no logging" 
    else 
        logger "Invalid Logging Configuration DISABLED Options $CURRENT_LOGGING_EKS_OPTS != $ALL_LOGGING_EKS_OPTS" 
        false
    fi 
    cdk deploy -c cluster_name=$EKS_CLUSTER EKSStack --require-approval never --parameters "$STACK_PREFIX"EKSStack:eksLoggingOpts="authenticator,controllerManager,scheduler" $CUSTOM_VPC_COMMAND $STACK_PREFIX_COMMAND
    ALL_LOGGING_EKS_OPTS='[
    "authenticator",
    "controllerManager",
    "scheduler"
    ]'
    CURRENT_LOGGING_EKS_OPTS=$(aws  eks describe-cluster --name $EKS_CLUSTER --query 'cluster.logging.clusterLogging[?enabled==`true`].types[]' --output json )
    COMPARE_OUTPUT=$(python -c "print(len(set($ALL_LOGGING_EKS_OPTS) - set($CURRENT_LOGGING_EKS_OPTS)));")
    printVar \$ALL_LOGGING_EKS_OPTS "$ALL_LOGGING_EKS_OPTS"
    printVar \$CURRENT_LOGGING_EKS_OPTS "$CURRENT_LOGGING_EKS_OPTS"
    if [[ $COMPARE_OUTPUT -eq "0" ]]; then 
        logger "Valid Logging Configuration for $CURRENT_LOGGING_EKS_OPTS"
    else
        logger "Invalid Logging Configuration $COMPARE_OUTPUT != $ALL_LOGGING_EKS_OPTS"
        false
    fi
    cd test/
    logger "Successful Log Config Testing"
    logger "End of Log Config Testing"

}
################################################################################################################
#                                                                                                              #
#   NetworkPolicyEngine Testing                                                                                #
#                                                                                                              # 
################################################################################################################
function networkPolicyTesting(){
logger "Start Network Policy Testing"
kubectl create ns policy-test
kubectl create deployment --namespace=policy-test httpd --image=httpd:2.4
kubectl expose --namespace=policy-test deployment httpd --port=80
logger "Verify if httpd is running"
kubectl wait --namespace=policy-test deployment/httpd --for=condition=available
logger "Run busybox pod to verify network path to httpd pod"
kubectl run --restart=Never --rm --namespace=policy-test access -ti --image busybox -- wget --server-response --spider httpd
logger "Apply NetworkPolicy Default Deny"
kubectl apply -f "manifests/network_policy_example.yaml"
logger "Verify for timed out when connecting to httpd"
# omit --restart=Never to prevent exit code from container to return instead of grep
kubectl run --namespace=policy-test access-denied --rm -ti --image busybox -- wget --server-response --spider --timeout=5 httpd | grep "wget: download timed out"
logger "Remove network policy and check for successful network path"
kubectl delete -f "manifests/network_policy_example.yaml"
kubectl run --restart=Never --rm --namespace=policy-test access-allow -ti --image busybox -- wget --server-response --spider httpd
logger "Successful Network Policy Testing"
logger "Remove Network Policy Testing Resources"
kubectl delete ns policy-test
}

################################################################################################################
#                                                                                                              #
#   FluentBit Testing                                                                                          #
#                                                                                                              # 
################################################################################################################
function fluentBitTesting(){
logger "Start Fluentbit Testing"
logger "Verify if Fluent-Bit pods are running"
kubectl wait -namazon-cloudwatch pods -l k8s-app=fluent-bit --for=condition=Ready
LOG_GROUPS=$(aws logs describe-log-groups --log-group-name-prefix /aws/containerinsights/$EKS_CLUSTER/ --query logGroups[*].logGroupName --output json)
logger "Verifying /aws/containerinsights/$EKS_CLUSTER/* LogGroups are created"
echo $LOG_GROUPS | jq " . | contains([\"/aws/containerinsights/$EKS_CLUSTER/application\"])"
echo $LOG_GROUPS | jq " . | contains([\"/aws/containerinsights/$EKS_CLUSTER/dataplane\"])"
echo $LOG_GROUPS | jq " . | contains([\"/aws/containerinsights/$EKS_CLUSTER/host\"])"
logger "LogGroups are created"
logger "Run sample httpd pod with log export to Cloudwatch"
kubectl run --image=httpd:2.4 httpd-fluentbit-test
kubectl wait pod/httpd-fluentbit-test --for=condition=Ready
sleep 20
httpd_fluentbit_output=$(kubectl get pod httpd-fluentbit-test -o json)

LOG_STREAMS=$(aws logs get-log-events --log-group-name "/aws/containerinsights/$EKS_CLUSTER/application" --log-stream-name $(echo $httpd_fluentbit_output| jq --raw-output  '.spec.nodeName')-application.var.log.containers.httpd-fluentbit-test_default_httpd-fluentbit-test-$(echo $httpd_fluentbit_output | jq --raw-output '.status.containerStatuses[0].containerID' | awk -F// '{print $2}').log)
LOG_STREAMS_COUNT=$(echo $LOG_STREAMS | jq '.events' | jq length)
if [ "$LOG_STREAMS_COUNT" -gt 3 ]; then
    logger "Number of Log Streams $LOG_STREAMS_COUNT greater than 3 - Pass"
else
    logger "Number of Log Streams $LOG_STREAMS_COUNT not greater than 3 - Fail"
    false
fi
logger "Success Log Records found in LogStream $(echo $httpd_fluentbit_output| jq --raw-output  '.spec.nodeName')-application.var.log.containers.httpd-fluentbit-test_default_httpd-fluentbit-test-$(echo $httpd_fluentbit_output | jq --raw-output '.status.containerStatuses[0].containerID' | awk -F// '{print $2}').log"
logger "Removal of fluentBit Testing resources"
kubectl delete pod/httpd-fluentbit-test
logger "End of FluentBit testing"
}

################################################################################################################
#                                                                                                              #
#   Secrets Manager Testing                                                                                    #
#                                                                                                              # 
################################################################################################################
function secretsTesting(){
    logger "Start SecretsManager Testing"
    logger "Create AWS Secrets called httpd-secrets-store"
    secrets_arn=$(aws secretsmanager  create-secret --name httpd-secrets-store --secret-string "hunter2" --query 'ARN' --output text)
    POLICY_ARN=$(aws iam create-policy --policy-name ekssecretstesting --query Policy.Arn --output text --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [ {
        \"Effect\": \"Allow\",
        \"Action\": [\"secretsmanager:GetSecretValue\", \"secretsmanager:DescribeSecret\"],
        \"Resource\": [\"$secrets_arn\"]
    } ]
}")
printVar \$POLICY_ARN $POLICY_ARN
ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
OIDC_PROVIDER=$(aws eks describe-cluster --name $EKS_CLUSTER --query "cluster.identity.oidc.issuer" --output text | sed -e "s/^https:\/\///")
cat <<-EOF > trust.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_PROVIDER}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_PROVIDER}:sub": "system:serviceaccount:aws-secrets-manager-test:httpd-deployment-sa"
        }
      }
    }
  ]
}
EOF
SECRETS_ROLE=$(aws iam create-role --role-name ekstestingsecrets --assume-role-policy-document file://trust.json --description "eks cdk testing suite secrets manager")
rm trust.json
aws iam attach-role-policy --role-name ekstestingsecrets --policy-arn=$POLICY_ARN
kubectl create ns aws-secrets-manager-test
kubectl create serviceaccount -n aws-secrets-manager-test httpd-deployment-sa
kubectl annotate serviceaccount -n aws-secrets-manager-test httpd-deployment-sa eks.amazonaws.com/role-arn=arn:aws:iam::$ACCOUNT_ID:role/ekstestingsecrets
# kubectl apply -f  manifests/secrets_providerclass_example.yaml
kubectl apply -f  manifests/secrets_providerdeployment_example.yaml
logger "wait for secrets deployment"
kubectl wait -n aws-secrets-manager-test --for=condition=available deployment/httpd-deployment --timeout 10m
output=$(kubectl -n aws-secrets-manager-test exec -it $(kubectl -n aws-secrets-manager-test get pods | awk '/httpd-deployment/{print $1}' | head -1) -- cat /mount/secrets-store/httpd-secrets-store; echo)
if [ "$output" = "hunter2" ]; then
    logger "Secrets matched"
else
    logger "Secrets do not match \"$ouput\" !=hunter2"
    aws secretsmanager delete-secret --secret-id httpd-secrets-store --force-delete-without-recovery
    aws iam detach-role-policy --role-name ekstestingsecrets --policy-arn $POLICY_ARN
    aws iam delete-role --role-name ekstestingsecrets
    aws iam delete-policy --policy-arn $POLICY_ARN
    exit 125
fi
logger "Success End Secrets Testing"
logger "Remove Secrets Testing Resources"
kubectl delete -f manifests/secrets_providerdeployment_example.yaml
aws secretsmanager delete-secret --secret-id httpd-secrets-store --force-delete-without-recovery
aws iam detach-role-policy --role-name ekstestingsecrets --policy-arn $POLICY_ARN
aws iam delete-role --role-name ekstestingsecrets
aws iam delete-policy --policy-arn $POLICY_ARN
}


################################################################################################################
#                                                                                                              #
#   ALB Ingress Testing                                                                                        #
#                                                                                                              # 
################################################################################################################
function albTesting(){
logger "Start ALB Testing"
logger "Deploy ALB pods"
kubectl apply -f  "manifests/alb_example.yaml"
logger "Wait 5 minutes for ALB creations and target registration"
sleep 300
logger "Waiting for TargetGroups to be healthy"
aws elbv2 wait target-in-service --target-group-arn $(kubectl get targetgroupbindings -n alb-ingress-test -o=jsonpath='{.items[0].spec.targetGroupARN}')
aws elbv2 describe-target-health --target-group-arn $(kubectl get targetgroupbindings -n alb-ingress-test -o=jsonpath='{.items[0].spec.targetGroupARN}')
ALB_ENDPOINT=$(kubectl get  ingress ingress-httpd -n alb-ingress-test -o=jsonpath='{.status.loadBalancer.ingress[0].hostname}')
logger "Test ALB Endpoint $ALB_ENDPOINT"
kubectl run -n alb-ingress-test --restart=Never -it alb-pod --image=busybox -- wget --server-response --spider $ALB_ENDPOINT
logger "Success End ALB Testing"
kubectl delete -f "manifests/alb_example.yaml"
}
################################################################################################################
#                                                                                                              #
#   EFS Testing                                                                                                #
#                                                                                                              # 
################################################################################################################
function efsTesting(){
logger "Start EFS Testing"
vpc_id=$(aws eks describe-cluster \
    --name $EKS_CLUSTER \
    --query "cluster.resourcesVpcConfig.vpcId" \
    --output text)
    printVar \$vpc_id $vpc_id
cidr_range=$(aws ec2 describe-vpcs \
    --vpc-ids $vpc_id \
    --query "Vpcs[].CidrBlock" \
    --output text)
    printVar \$cidr_range $cidr_range
list_subnets=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpc_id"  | jq --raw-output '.Subnets[].SubnetId')
printVar \$list_subnets $list_subnets
logger "Create EFS Security Group"
security_group_id=$(aws ec2 create-security-group \
    --group-name MyEfsSecurityGroup \
    --description "My EFS security group" \
    --vpc-id $vpc_id \
    --output text)
printVar \$security_group_id $security_group_id
aws ec2 authorize-security-group-ingress --group-id $security_group_id --protocol tcp --port 2049 --cidr $cidr_range

file_system_id=$(aws efs create-file-system \
    --performance-mode generalPurpose \
    --tags Key=Name,Value=efs-csi-test \
    --query 'FileSystemId' \
    --output text)
printVar \$file_system_id $file_system_id
logger "wait 30 seconds for EFS system to be available"
sleep 30
for subnet in ${list_subnets[@]}
do
    echo "creating mount target in " $subnet
    aws efs create-mount-target --file-system-id $file_system_id --subnet-id $subnet --security-groups $security_group_id
done
logger "Wait 90 seconds for mount targets to be ready"
sleep 90
aws efs describe-mount-targets --file-system-id $file_system_id
sed -i "s/ fs-\w\+/ $file_system_id/" manifests/efs_storageclass_example.yaml
kubectl apply -f  "manifests/efs_storageclass_example.yaml"
logger "Verify EFS pods"
kubectl wait -n efs-csi-test --for=condition=Ready pod/efs-app --timeout 10m
kubectl get pods -n efs-csi-test
logger "Successful EFS Test"
logger "Deleting EFS sample app resoures"
kubectl delete -f "manifests/efs_storageclass_example.yaml"

mount_targets=$(aws efs describe-mount-targets --file-system-id $file_system_id | jq --raw-output  '.MountTargets[].MountTargetId')
for target in ${mount_targets[@]}
do
    logger "deleting mount target in $target and wait 30 seconds"
    aws efs delete-mount-target --mount-target-id $target
    sleep 30
done
logger "Deleting efs system $file_system_id"
aws efs delete-file-system --file-system-id $file_system_id
sleep 30
logger "EFS System $file_system_id deleted"
logger "Deleting EFS Security Group $security_group_id"
aws ec2 delete-security-group --group-id  $security_group_id     
logger "End EFS Testing"
}
################################################################################################################
#                                                                                                              #
#   EBS Testing                                                                                                #
#                                                                                                              # 
################################################################################################################
function ebsTesting(){
logger "Start EBS CSI Test"
kubectl apply -f  "manifests/ebs_pod_example.yaml"
kubectl wait -n ebs-csi-test --timeout 10m --for=condition=Ready  pod/ebs-app --for=condition=Ready
logger "Successful EBS Test"
kubectl get pods -n ebs-csi-test
logger "Removing EBS Deployment"
kubectl delete -f  "manifests/ebs_pod_example.yaml"
logger "End EBS CSI Test"
}
################################################################################################################
#                                                                                                              #
#   Metric Server                                                                                              #
#                                                                                                              # 
################################################################################################################
function hpaTesting(){
    logger "Start HPA Testing"
    logger "Verify Metric Server"
    kubectl wait -n kube-system deploy/metrics-server --for=condition=available --timeout 10m
    kubectl apply -f manifests/hpa_example.yaml
    kubectl wait -n hpa-test deploy/hpa-deployment --for=condition=available --timeout 10m
    logger "Wait for 60 seconds for HPA metrics to be populated"
    sleep 60
    logger "Start load-generator using Apache Benchmark"
    kubectl run -n hpa-test load-generator --image=httpd:2.4 --restart=Never -- ab -k -t 100000000 http://hpa-service/
    logger "Wait 60 seconds for Scaling"
    sleep 60
    logger "Verify desired count is greater than 1"
    DESIRED_COUNT=$(kubectl -n hpa-test get deploy hpa-deployment -o json | jq .status.replicas)
    if [ "$DESIRED_COUNT" -gt 1 ]; then
    logger "Number of Desired Replicas $DESIRED_COUNT greater than 1 - Pass"
    logger "Wait for full scale out"
    kubectl wait -n hpa-test deploy/hpa-deployment --for=condition=available --timeout 10m
    DESIRED_COUNT=$(kubectl -n hpa-test get deploy hpa-deployment -o json | jq .status.replicas)
    logger "Scaled up Desired Count: $DESIRED_COUNT"
    else
    logger "Number of Desired Replicas $DESIRED_COUNT not greater than 1 - Fail"
    false
    fi
    logger "Wait for scale down "
    sleep 330
    SCALE_DOWN=$(kubectl -n hpa-test get deploy hpa-deployment -o json | jq .status.replicas)
    if [ "$DESIRED_COUNT" -gt "$SCALE_DOWN" ]; then
    logger "Number of Desired Replicas $SCALE_DOWN less than previously $DESIRED_COUNT  - Pass"
    logger "Wait for full scale in"
    kubectl wait -n hpa-test deploy/hpa-deployment --for=condition=available --timeout 10m
    else
    logger "Number of Desired Replicas $SCALE_DOWN not less than previously $DESIRED_COUNT  - Fail"
    false
    fi
    logger "Stop Apache Benchmark"
    kubectl delete -n hpa-test pod load-generator
    logger "Successful HPA Test"
    logger "Removing HPA Deployment"
    kubectl delete -f manifests/hpa_example.yaml
    logger "End of HPA Test"
}

usage(){
    echo "Usage: $0 [-s] [-c] [-t]"
    echo "-t                - Specific testing method: $ALL_TESTS"
    echo "-s                - Skips creation of cdk stack"
    echo "-c value          - EKS Cluster name to run test against, default=myekscluster"
    echo "-v value          - Custom VPC - cdk deploy -c use_vpc_id=vpc-123456"
    echo "-p value          - Custom Prefix to stacks - cdk deploy stack_prefix"
    echo "Example: "
    echo "$0 -s -t all        Skip CDK creation and only run all tests"
    echo "$0 -t alb           Create CDK by only run alb test"
    echo "$0 -c mycluster -p dev- -v vpc-123456 -t all Create EKS Cluster called mycluster in vpc-123456 with stack prefix dev- and run all tests"
}

selectall(){
    efsTesting
    ebsTesting
    albTesting
    hpaTesting
    secretsTesting
    fluentBitTesting
    containerInsights
    networkPolicyTesting
    logConfigTesting
    clusterAutoscalingTesting
}

selector(){
    selectedOption=$(echo "$1" | tr '[:upper:]' '[:lower:]')
    logger "selected \"$selectedOption\" option"
    updateKube
    cdkCreate
    case $selectedOption in
    all)
        selectall
        ;;
    efs)
        efsTesting
        ;;
    ebs)
        ebsTesting
    ;;
    alb)
        albTesting
    ;;
    secrets)
        secretsTesting
        ;;
    fluentbit)
        fluentBitTesting
        ;;
    networkpolicy)
        networkPolicyTesting
        ;;
    log)
        logConfigTesting
        ;;
    clusterautoscaler)
        clusterAutoscalingTesting
        ;;
    containerinsights)
        containerInsights
        ;;
    hpa)
         hpaTesting
         ;;   
    *)
        logger "Invalid test $selectedOption, valid options are $ALL_TESTS"
        ;;
    esac
}


ALL_TESTS="all,alb,ebs,efs,ebs,secrets,networkpolicy,fluentbit,log,clusterautoscaler,containerInsights,hpa"
SKIP_CDK="false"
export AWS_DEFAULT_REGION=us-west-2
export EKS_CLUSTER=myekscluster
# for aws cli v2 stop output to less
export AWS_PAGER=""
TEST_SUITE=all
CUSTOM_VPC_COMMAND=""
CUSTOM_VPC=""
STACK_PREFIX_COMMAND=""
STACK_PREFIX=""
#change directory to directory script is in
cd "${0%/*}"
defaultOptions(){
    logger "Running Tests $1"
    cdkCreate
    selector $1
}
verifyDependencies
while getopts "hc:st:v:p:d" options; do
    case $options in
    c)
        EKS_CLUSTER=$OPTARG
        logger "EKS Cluster Name: $EKS_CLUSTER"
        ;;

    p)
        STACK_PREFIX_COMMAND="-c stack_prefix=$OPTARG"
        STACK_PREFIX="$OPTARG"
        ;;
    v)
        CUSTOM_VPC_COMMAND="-c use_vpc_id=$OPTARG"
        CUSTOM_VPC="$OPTARG"
        ;;
    s)
        SKIP_CDK="true"
        logger "Skipping CDK_Deploy=$SKIP_CDK"
        ;;
    t) 
        logger "Generating Test Suit for $OPTARG"
        TEST_SUITE=$OPTARG
        ;;
    d)
        logger "Delete Selected"
        DELETE_STACK=true
        ;;
    h | *)
    logger "Print help"
        usage
        exit
        ;; 
    esac
done
selector $TEST_SUITE
