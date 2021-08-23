import time
import boto3,botocore
import json
import logging

import botocore
boto3.set_stream_logger('botocore.waiter', logging.DEBUG)

client = boto3.client('eks')

ALL_LOGGING_OPTS = [ 'api','audit','authenticator','controllerManager','scheduler']

def on_event(event, context):
  print(json.dumps(event))
  request_type = event['RequestType']
  if request_type == 'Create': return on_create(event)
  if request_type == 'Update': return on_update(event)
  if request_type == 'Delete': return on_delete(event)
  raise Exception("Invalid request type: %s" % request_type)

def on_create(event):
  props = event["ResourceProperties"]
  print("Update %s with logging configuration %s" % (props['eksCluster'], props['loggingOpts']))
  try:
      currentLoggingOpts = {
          'enabled': [],
          'disabled': []
      }
      eks_info = client.describe_cluster(
          name=props['eksCluster']
      )
      for item in eks_info['cluster']['logging']['clusterLogging']:
            if (item['enabled']== True):
                currentLoggingOpts['enabled'] = item
            elif (item['enabled'] == False):
                currentLoggingOpts['disabled'] = item
            else:
                print("Unable to parse current eks logging configuration %s" % eks_info['cluster']['logging']['clusterLogging'])
                raise ValueError()
      updateLogOpts=log_config_diff(currentLoggingOpts,props['loggingOpts'])
      print(updateLogOpts)          
      eks=client.update_cluster_config(
            name= props['eksCluster'],
            logging={
            'clusterLogging': updateLogOpts
        })
      print("%s" % eks)
  except client.exceptions.InvalidParameterException as i:
        if ('No changes needed for the logging config provided' == i.response['Error']['Message']):
              print('No changes needed for the logging config provided, current config is valid, skipping action returning success')
              pass     
  except Exception as e:
        print(e)
        raise 
  return {'Status': 'SUCCESS',    'PhysicalResourceId': props['eksCluster'],      'StackId': event['StackId'], 'LogicalResourceId': event['LogicalResourceId']}

def on_update(event):
  physical_id = event["PhysicalResourceId"]
  props = event["ResourceProperties"]
  print("update resource %s with props %s" % (physical_id, props))
  on_create(event)

def on_delete(event):
  physical_id = event["PhysicalResourceId"]
  print("Skip delete since eks cluster will be deleted %s" % physical_id)
  return {'Status': 'SUCCESS',    'PhysicalResourceId': physical_id,      'StackId': event['StackId'],  'LogicalResourceId': event['LogicalResourceId']}



def is_complete(event,context):
    print(event)
    props = event["ResourceProperties"]
    print("Starting Waiter")
    # Sleep for 30 seconds before checking for cluster status to change
    time.sleep(30)
    print("Waited 30 seconds")
    try:
        waiter = client.get_waiter('cluster_active')
        waiter.wait(
            name=props['eksCluster'],
            WaiterConfig={
                'Delay': 10,
                'MaxAttempts' : 40
            }
        )
        eks_info = client.describe_cluster(
          name=props['eksCluster']
        )
        print(eks_info['cluster']['logging'])
        print("Completed wait")
    except botocore.exceptions.WaiterError as e:
        print(e)
        if "Max attempts exceeded" in e.message:
            return {'IsComplete': False}
    except Exception as e:
        print(e)    
        raise
        
    return { 'IsComplete': True }


def log_config_diff(currentOpts,newOpts):
    print ("Evaluate for updated logging to be enabled")
    if "" in newOpts:
        newOpts.remove("")
    if 'types' not in currentOpts['enabled']:
        currentOpts['enabled'] = {'types': []}

    enabledOpts =  set(newOpts) - set(currentOpts['enabled']['types'])
    print("Need \"%s\" logging to be enabled" % list(enabledOpts))
    disabledOpts = set(ALL_LOGGING_OPTS) - set(newOpts)
    print ("Need \"%s\" logging to be disabled" % list(disabledOpts))
    return [{
                'types': list(enabledOpts),
                'enabled': True
            },
            {
                'types': list(disabledOpts),
                'enabled': False
            }]

if __name__ == "__main__":
    jsonObj = """{ 
    "RequestType": "Create",
    "ServiceToken": "EXAMPLE",
    "ResponseURL": "EXAMPLE",
    "StackId": "arn:aws:cloudformation:us-west-2:ACCOUNT_ID:stack/EKS_STACK/EXAMPLE",
    "RequestId": "EXAMPLE",
    "LogicalResourceId": "eksLoggingCustomResource",
    "ResourceType": "AWS::CloudFormation::CustomResource",
    "ResourceProperties": {
        "ServiceToken": "test",
        "eksCluster": "myekscluster",
        "enable": "true",
        "loggingOpts": [ ""
        ]
    }
}"""
    print(on_event(json.loads(jsonObj),''))
    print(is_complete(json.loads(jsonObj),''))