#!/usr/bin/env tsx
import { App } from "aws-cdk-lib";
import { ZohoMcpStack } from "../lib/zoho-mcp-stack.js";

const app = new App();

// Pinned to ap-southeast-2 (Sydney) regardless of the deployer's default AWS
// CLI region/profile, since Zoho's API is reached over the public internet
// either way and the user wants their data in this region specifically.
new ZohoMcpStack(app, "ZohoSprintsMcpStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-southeast-2",
  },
});
