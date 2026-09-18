import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import {
  Architecture,
  DockerImageCode,
  DockerImageFunction,
  FunctionUrlAuthType,
  InvokeMode,
} from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import type { Construct } from "constructs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

export class ZohoMcpStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Placeholder secret: scripts/oauth-setup.ts populates the real value
    // (clientId, clientSecret, refreshToken, mcpApiKey) after this stack is
    // deployed. CDK only owns the secret's existence/permissions, not its
    // contents, so redeploys never clobber the live refresh token.
    const secret = new Secret(this, "ZohoCredentials", {
      secretName: "zoho-sprints-mcp/zoho-credentials",
      description: "Zoho OAuth credentials + MCP bearer token for the StoryTrail Sprints MCP server",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const logGroup = new LogGroup(this, "McpFunctionLogs", {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new DockerImageFunction(this, "McpFunction", {
      // Platform is pinned explicitly (rather than left to default to
      // whatever architecture the build host happens to be) so the image
      // built here, in CI, or on any other machine always matches the
      // Lambda function's `architecture` below.
      code: DockerImageCode.fromImageAsset(REPO_ROOT, { file: "Dockerfile", platform: Platform.LINUX_ARM64 }),
      memorySize: 512,
      timeout: Duration.seconds(30),
      architecture: Architecture.ARM_64,
      environment: {
        ZOHO_SECRET_ID: secret.secretArn,
      },
      logGroup,
    });

    secret.grantRead(fn);

    const fnUrl = fn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });

    new CfnOutput(this, "FunctionUrl", { value: fnUrl.url });
    new CfnOutput(this, "SecretArn", { value: secret.secretArn });
    // Function URLs always resolve with a trailing slash, so append the path without another one.
    new CfnOutput(this, "McpEndpoint", { value: `${fnUrl.url}mcp` });
  }
}
