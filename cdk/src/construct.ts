import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import type * as efs from 'aws-cdk-lib/aws-efs'

interface DockerProps {
  name: string
  context: string
  dockerfile?: string
  environment?: { [key: string]: string }
}

export interface HeyAmplifyAppProps {
  /**
   * ECS Cluster the Application Load Balanced Fargate Service will be deployed to.
   */
  cluster: ecs.Cluster

  /**
   * Asset path to the directory with the Dockerfile.
   */
  docker: DockerProps

  /**
   * Filesystem to be used for storing the application's data.
   */
  filesystem?: efs.FileSystem

  /**
   * Filesystem container mount point
   */
  filesystemMountPoint?: string

  /**
   * Discord Bot secrets
   *
   * Discord bots can be managed in the {@link https://discord.com/developers/applications Developer Portal}.
   */
  secrets: {
    DISCORD_BOT_TOKEN: ssm.IParameter
    // [name: string]: ssm.IParameter
  }
}

export class HeyAmplifyApp extends Construct {
  public readonly service: ecs_patterns.ApplicationLoadBalancedFargateService

  constructor(scope: Construct, id: string, props: HeyAmplifyAppProps) {
    super(scope, id)

    const { cluster, filesystem, filesystemMountPoint, docker } = props

    const secrets = {}
    for (const [name, param] of Object.entries(props.secrets)) {
      secrets[name] = ecs.Secret.fromSsmParameter(param)
    }

    this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      `fargate-service`,
      {
        cluster,
        cpu: 256,
        memoryLimitMiB: 512,
        desiredCount: 1,
        taskImageOptions: {
          containerName: docker.name,
          image: ecs.ContainerImage.fromAsset(docker.context, {
            file: docker.dockerfile || 'Dockerfile',
          }),
          environment: docker.environment,
          enableLogging: true,
          secrets,
        },
        assignPublicIp: false,
        publicLoadBalancer: true,
      }
    )

    if (filesystem && filesystemMountPoint) {
      const volumeName = 'efs-volume'
      const mountPath = filesystemMountPoint

      this.service.taskDefinition.addVolume({
        name: volumeName,
        efsVolumeConfiguration: {
          fileSystemId: filesystem.fileSystemId,
        },
      })

      filesystem.grant(
        this.service.taskDefinition.taskRole,
        'elasticfilesystem:ClientRootAccess',
        'elasticfilesystem:ClientWrite',
        'elasticfilesystem:ClientMount',
        'elasticfilesystem:DescribeMountTargets'
      )

      const container = this.service.taskDefinition.findContainer(
        props.docker.name
      ) as ecs.ContainerDefinition

      container.addMountPoints({
        containerPath: mountPath,
        sourceVolume: volumeName,
        readOnly: false,
      })
    }
  }
}
