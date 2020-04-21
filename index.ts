import * as pulumi from '@pulumi/pulumi'
import * as provision from './lib/provision'

const config = new pulumi.Config()

const { distribution } = provision.distribution({
  domain: config.require('domain'),
  certificateArn: config.get('certificateArn'),
})

export const hostedZoneId = distribution.hostedZoneId
export const domainName = distribution.domainName
