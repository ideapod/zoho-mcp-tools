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
import { pathToFileURL } from "node:url";
import {
  CreateSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

/** Data centers Zoho Sprints is hosted on (https://sprints.zoho.com/apidoc.html#MultipleDC). */
const DATA_CENTERS: Record<string, { accountsBaseUrl: string; apiBaseUrl: string }> = {
  com: { accountsBaseUrl: "https://accounts.zoho.com", apiBaseUrl: "https://sprintsapi.zoho.com/zsapi" },
  eu: { accountsBaseUrl: "https://accounts.zoho.eu", apiBaseUrl: "https://sprintsapi.zoho.eu/zsapi" },
  in: { accountsBaseUrl: "https://accounts.zoho.in", apiBaseUrl: "https://sprintsapi.zoho.in/zsapi" },
  "com.au": { accountsBaseUrl: "https://accounts.zoho.com.au", apiBaseUrl: "https://sprintsapi.zoho.com.au/zsapi" },
  "com.cn": { accountsBaseUrl: "https://accounts.zoho.com.cn", apiBaseUrl: "https://sprintsapi.zoho.com.cn/zsapi" },
  jp: { accountsBaseUrl: "https://accounts.zoho.jp", apiBaseUrl: "https://sprintsapi.zoho.jp/zsapi" },
  sa: { accountsBaseUrl: "https://accounts.zoho.sa", apiBaseUrl: "https://sprintsapi.zoho.sa/zsapi" },
  // Canada is irregular: zohocloud.ca, not zoho.ca.
  ca: { accountsBaseUrl: "https://accounts.zohocloud.ca", apiBaseUrl: "https://sprintsapi.zohocloud.ca/zsapi" },
};

/**
 * Accepts whatever format someone reasonably types: a bare suffix ("com",
 * "com.au"), a host with the zoho/accounts/sprints prefix already on it
 * ("zoho.com.au", "accounts.zoho.eu", "sprints.zoho.in"), or a full URL.
 */
export function resolveDataCenter(input: string): { accountsBaseUrl: string; apiBaseUrl: string } {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/^(accounts|sprints|api)\.zoho\./, "")
    .replace(/^zoho\./, "")
    .replace(/\.$/, "");

  const key = cleaned === "" ? "com" : cleaned === "zohocloud.ca" ? "ca" : cleaned;
  const match = DATA_CENTERS[key];
  if (!match) {
    throw new Error(
      `Unrecognized Zoho data center "${input}". Known values: ${Object.keys(DATA_CENTERS).join(", ")}. ` +
        "Check the URL when logged into Zoho Sprints, or see https://sprints.zoho.com/apidoc.html#MultipleDC.",
    );
  }
  return match;
}

const REQUIRED_SCOPES = [
  "ZohoSprints.teams.READ",
  "ZohoSprints.projects.READ",
  "ZohoSprints.sprints.READ",
  "ZohoSprints.epic.READ",
  "ZohoSprints.epic.CREATE",
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

  console.log("  Check the URL when logged into Zoho Sprints in a browser to find yours, e.g.:");
  console.log("  sprints.zoho.com -> com | sprints.zoho.com.au -> com.au | sprints.zoho.eu -> eu\n");
  const domainInput = (await ask("Zoho data center [com]: ")) || "com";
  const { accountsBaseUrl, apiBaseUrl } = resolveDataCenter(domainInput);
  console.log(`Using accounts host ${accountsBaseUrl} and API host ${apiBaseUrl}.\n`);

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
    accountsBaseUrl,
    apiBaseUrl,
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
      `ZOHO_API_BASE_URL=${apiBaseUrl}`,
      `MCP_API_KEY=${secret.mcpApiKey}`,
    ].join("\n");
    await writeFile(".env", envContents + "\n", { mode: 0o600 });
    console.log("Wrote .env (git-ignored).");
  }

  rl.close();
}

// Guard so this can be imported (e.g. by tests, for resolveDataCenter)
// without kicking off the interactive CLI flow.
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
