import * as aws from '@pulumi/aws'
import {
  CloudFrontRequestEvent as Event,
  CloudFrontRequestResult as Result,
} from 'aws-lambda'

export type DistributionArgs = {
  domain: string
  certificateArn?: string
}

export const distribution = (
  args: DistributionArgs
): {
  distribution: aws.cloudfront.Distribution
  originRequest: aws.lambda.CallbackFunction<Event, Result>
  lambdaAtEdgeRole: aws.iam.Role
} => {
  const usEast1 = new aws.Provider('us-east-1', {
    profile: aws.config.profile,
    region: 'us-east-1',
  })

  // Useless HTTPS endpoint to satisfy CloudFront's default behaviour origin.
  // We'll be routing all requests ourselves and this will never be used.
  const nullBucket = new aws.s3.Bucket('NullBucket', {})

  const lambdaAtEdgeRole = new aws.iam.Role('Lambda@EdgeRole', {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: ['lambda.amazonaws.com', 'edgelambda.amazonaws.com'],
    }),
  })

  new aws.iam.RolePolicyAttachment(
    'Lambda@EdgeRolePolicy',
    {
      role: lambdaAtEdgeRole,
      policyArn: aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
    },
    { parent: lambdaAtEdgeRole }
  )

  const originRequest = new aws.lambda.CallbackFunction(
    'OriginRequest',
    {
      publish: true,
      role: lambdaAtEdgeRole,
      timeout: 5,
      callback: async (event: Event): Promise<Result> => {
        const { request } = event.Records[0].cf
        console.log('request', request)

        const host = request.headers.host[0].value
        const deploymentName = host.substring(
          0,
          host.length - args.domain.length - 1
        )
        const newHost = `${deploymentName}.raw.${args.domain}`

        // Routes to a IP address (API Gateway)
        if (request.origin && request.origin.custom)
          request.origin.custom.domainName = newHost

        // Specifies the API name (API Gateway needs this to resolve)
        request.headers.host[0].value = newHost

        console.log('request after translation', request)
        return request
      },
    },
    { provider: usEast1 }
  )

  const distribution = new aws.cloudfront.Distribution('Distribution', {
    enabled: true,
    aliases: [`*.${args.domain}`],
    origins: [
      {
        originId: 'Default',
        domainName: nullBucket.bucketRegionalDomainName,
        customOriginConfig: {
          originProtocolPolicy: 'https-only',
          httpPort: 80,
          httpsPort: 443,
          originSslProtocols: ['TLSv1.2'],
        },
      },
    ],
    defaultCacheBehavior: {
      lambdaFunctionAssociations: [
        {
          eventType: 'origin-request',
          lambdaArn: originRequest.qualifiedArn,
        },
      ],
      targetOriginId: 'Default',
      viewerProtocolPolicy: 'allow-all',
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      cachedMethods: ['GET', 'HEAD', 'OPTIONS'],
      forwardedValues: {
        cookies: { forward: 'none' },
        headers: ['Host'],
        queryString: false,
      },
    },
    priceClass: 'PriceClass_All',
    restrictions: {
      geoRestriction: {
        restrictionType: 'none',
      },
    },
    viewerCertificate: {
      acmCertificateArn: args.certificateArn,
      sslSupportMethod: 'sni-only',
    },
  })

  return { distribution, originRequest, lambdaAtEdgeRole }
}

export default distribution
