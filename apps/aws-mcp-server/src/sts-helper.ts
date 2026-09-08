import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

const stsClient = new STSClient({});

export interface AssumedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
}

export async function getAssumedCredentials(
  developerEmail: string,
  jobId: string
): Promise<AssumedCredentials | null> {
  const targetRoleArn = process.env['AWS_EXECUTION_ROLE_ARN'];
  if (!targetRoleArn) {
    // No target role specified (e.g. running in local development sandbox)
    // Return null to use the environment's default credentials
    return null;
  }

  try {
    const cleanSessionName = `mcp-${jobId.substring(0, 8)}`;
    const command = new AssumeRoleCommand({
      RoleArn: targetRoleArn,
      RoleSessionName: cleanSessionName,
      Tags: [
        {
          Key: 'DeveloperEmail',
          Value: developerEmail,
        },
      ],
      TransitiveTagKeys: ['DeveloperEmail'],
    });

    const response = await stsClient.send(command);

    if (
      !response.Credentials?.AccessKeyId ||
      !response.Credentials?.SecretAccessKey
    ) {
      throw new Error('STS assumeRole response did not contain credentials.');
    }

    return {
      accessKeyId: response.Credentials.AccessKeyId,
      secretAccessKey: response.Credentials.SecretAccessKey,
      sessionToken: response.Credentials.SessionToken ?? undefined,
    };
  } catch (err) {
    process.stderr.write(`STS AssumeRole failed for ${developerEmail}: ${String(err)}\n`);
    throw err;
  }
}
