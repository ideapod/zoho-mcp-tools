export interface ZohoCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface ZohoConfig extends ZohoCredentials {
  /** Zoho accounts (OAuth) host, e.g. https://accounts.zoho.com */
  accountsBaseUrl: string;
  /** Zoho Sprints API host, e.g. https://sprintsapi.zoho.com/zsapi */
  apiBaseUrl: string;
  /** Workspace (team) ID. Auto-detected on first use if omitted. */
  teamId?: string;
  /** Shared-secret bearer token required on the /mcp endpoint, if set. */
  mcpApiKey?: string;
  /** A still-valid access token to seed ZohoTokenManager with, persisted from a previous execution environment. */
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

export interface AccessTokenResponse {
  access_token: string;
  api_domain?: string;
  token_type: string;
  expires_in: number;
}

export interface SprintsPortal {
  zsoid: string;
  teamName: string;
  isShowTeam?: boolean;
  orgName?: string;
}

export interface SprintsItem {
  id: string;
  title: string;
  description?: string;
  status?: { id: string; name: string };
  priority?: { id: string; name: string };
  itemType?: { id: string; name: string };
  epic?: { id: string; name: string } | null;
  [key: string]: unknown;
}

export interface SprintsEpic {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface SprintsSprint {
  id: string;
  name: string;
  status?: string;
  [key: string]: unknown;
}

export interface SprintsComment {
  id: string;
  content: string;
  [key: string]: unknown;
}

export interface SprintsStatus {
  id: string;
  name: string;
  [key: string]: unknown;
}
