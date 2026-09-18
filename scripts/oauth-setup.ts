#!/usr/bin/env tsx
/**
 * One-time interactive setup: exchanges a Zoho "Self Client" grant token for
 * a long-lived refresh token, then (optionally) writes the resulting
 * credentials to an AWS Secrets Manager secret for the deployed Lambda, and/or
 * to a local .env file for local development.
 *
 * Self Client is Zoho's recommended OAuth flow for a single-user, personal
 * integration like this one: no redirect URI or multi-step user consent
 * screen is needed. See https://accounts.zoho.com/developerconsole ->
 * "Self Client".
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import {
  CreateSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const REQUIRED_SCOPES = [
  "ZohoSprints.teams.READ",
  "ZohoSprints.projects.READ",
  "ZohoSprints.sprints.READ",
  "ZohoSprints.epic.READ",
  "ZohoSprints.items.READ",
  "ZohoSprints.items.CREATE",
  "ZohoSprints.items.UPDATE",
  "ZohoSprints.comments.READ",
  "ZohoSprints.comments.CREATE",
  "ZohoSprints.settings.READ",
].join(",");

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string) => rl.question(question);

  console.log("\nZoho Sprints MCP - one-time OAuth setup (Self Client flow)\n");
  console.log("Step 1: Register (or reuse) a Self Client application:");
  console.log("  1. Go to https://api-console.zoho.com/ and create a 'Self Client'.");
  console.log("  2. Note its Client ID and Client Secret.");
  console.log("  3. In the Self Client's 'Generate Code' tab, enter this scope string exactly:\n");
  console.log(`     ${REQUIRED_SCOPES}\n`);
  console.log("  4. Set a description and duration (max 10 minutes), then generate the code.");
  console.log("  5. Copy the generated grant token/code - you'll need it below (it expires fast).\n");

  const domain = (await ask("Zoho data center domain [com]: ")) || "com";
  const accountsBaseUrl = `https://accounts.zoho.${domain}`;
  const clientId = await ask("Client ID: ");
  const clientSecret = await ask("Client Secret: ");
  const grantToken = await ask("Grant token/code (from the Self Client screen): ");

  console.log("\nExchanging grant token for an access + refresh token...");

  const tokenUrl = new URL("/oauth/v2/token", accountsBaseUrl);
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  tokenUrl.searchParams.set("client_id", clientId.trim());
  tokenUrl.searchParams.set("client_secret", clientSecret.trim());
  tokenUrl.searchParams.set("code", grantToken.trim());

  const res = await fetch(tokenUrl, { method: "POST" });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };

  if (!res.ok || !body.refresh_token) {
    console.error("\nToken exchange failed:", JSON.stringify(body, null, 2));
    rl.close();
    process.exit(1);
  }

  console.log("\nSuccess. Received a refresh token (this does not expire unless revoked).\n");

  const mcpApiKey = randomUUID() + randomUUID();
  const secret = {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    refreshToken: body.refresh_token,
    mcpApiKey,
  };

  console.log(`Generated an MCP bearer token (send it as "Authorization: Bearer ${mcpApiKey}"):\n`);
  console.log(`  ${mcpApiKey}\n`);
  console.log("Save this - you'll need it when adding the deployed server as a remote MCP connector.\n");

  const pushToAws = (await ask("Push these credentials to AWS Secrets Manager now? [Y/n]: ")) || "y";
  if (pushToAws.toLowerCase().startsWith("y")) {
    const region = (await ask("AWS region [ap-southeast-2]: ")) || "ap-southeast-2";
    const secretName = (await ask("Secret name [zoho-sprints-mcp/zoho-credentials]: ")) || "zoho-sprints-mcp/zoho-credentials";

    const client = new SecretsManagerClient({ region });
    try {
      await client.send(
        new PutSecretValueCommand({ SecretId: secretName, SecretString: JSON.stringify(secret) }),
      );
      console.log(`\nUpdated existing secret "${secretName}" in ${region}.`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        await client.send(
          new CreateSecretCommand({
            Name: secretName,
            Description: "Zoho OAuth credentials for the StoryTrail Sprints MCP server",
            SecretString: JSON.stringify(secret),
            ClientRequestToken: randomUUID(),
          }),
        );
        console.log(`\nCreated new secret "${secretName}" in ${region}.`);
      } else {
        throw error;
      }
    }
    console.log(`Pass this secret name/ARN as the ZOHO_SECRET_ID for the CDK stack.`);
  }

  const writeEnv = (await ask("\nAlso write a local .env file for local dev? [y/N]: ")) || "n";
  if (writeEnv.toLowerCase().startsWith("y")) {
    const envContents = [
      `ZOHO_CLIENT_ID=${secret.clientId}`,
      `ZOHO_CLIENT_SECRET=${secret.clientSecret}`,
      `ZOHO_REFRESH_TOKEN=${secret.refreshToken}`,
      `ZOHO_ACCOUNTS_BASE_URL=${accountsBaseUrl}`,
      `MCP_API_KEY=${secret.mcpApiKey}`,
    ].join("\n");
    await writeFile(".env", envContents + "\n", { mode: 0o600 });
    console.log("Wrote .env (git-ignored).");
  }

  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
