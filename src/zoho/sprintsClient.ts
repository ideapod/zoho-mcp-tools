import type { ZohoTokenManager } from "./oauth.js";
import type {
  SprintsComment,
  SprintsEpic,
  SprintsItem,
  SprintsPortal,
  SprintsSprint,
  SprintsStatus,
} from "./types.js";

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

interface SprintsResponse {
  status: string;
  [key: string]: unknown;
}

export class SprintsApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "SprintsApiError";
  }
}

/**
 * Thin, typed wrapper around the Zoho Sprints REST API
 * (https://sprints.zoho.com/apidoc.html). Only covers the endpoints needed
 * for backlog/kanban management of a single workspace.
 */
export class SprintsClient {
  private moduleIdCache: string | undefined;

  constructor(
    private readonly tokenManager: ZohoTokenManager,
    private readonly apiBaseUrl: string,
    public teamId?: string,
  ) {}

  async ensureTeamId(): Promise<string> {
    if (this.teamId) return this.teamId;
    const { portals } = await this.listWorkspaces();
    if (portals.length === 0) {
      throw new Error("No Zoho Sprints workspaces are accessible with this account.");
    }
    if (portals.length > 1) {
      throw new Error(
        `Multiple Zoho Sprints workspaces found (${portals.map((p) => `${p.teamName}=${p.zsoid}`).join(", ")}). ` +
          "Set a specific team ID in the server configuration.",
      );
    }
    this.teamId = portals[0]!.zsoid;
    return this.teamId;
  }

  private async request<T = SprintsResponse>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.apiBaseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const doFetch = async (token: string) =>
      fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "x-convert-response": "true",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

    let token = await this.tokenManager.getAccessToken();
    let res = await doFetch(token);

    if (res.status === 401) {
      token = await this.tokenManager.refresh();
      res = await doFetch(token);
    }

    const text = await res.text();
    const data = text ? (JSON.parse(text) as T & { status?: string }) : ({} as T);

    if (!res.ok || (data as { status?: string }).status === "failure") {
      throw new SprintsApiError(`Zoho Sprints API error on ${path} (HTTP ${res.status})`, res.status, data);
    }
    return data;
  }

  async listWorkspaces(): Promise<{ portals: SprintsPortal[] }> {
    const data = await this.request<{ portals: SprintsPortal[] }>("/teams/");
    return { portals: data.portals ?? [] };
  }

  async listProjects(): Promise<unknown[]> {
    const teamId = await this.ensureTeamId();
    // action/index/range are mandatory query params for this endpoint -
    // omitting them returns a misleading "Given URL is wrong" 404.
    const data = await this.request<{ projects: unknown[] }>(`/team/${teamId}/projects/`, {
      query: { action: "data", index: 1, range: 100 },
    });
    return data.projects ?? [];
  }

  async getProjectDetails(projectId: string): Promise<Record<string, unknown>> {
    const teamId = await this.ensureTeamId();
    return this.request(`/team/${teamId}/projects/${projectId}/`);
  }

  async getProjectBacklogId(projectId: string): Promise<string> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ backlogId: string }>(`/team/${teamId}/projects/${projectId}/`, {
      query: { action: "getbacklog" },
    });
    return data.backlogId;
  }

  async listSprints(projectId: string): Promise<SprintsSprint[]> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ sprints: SprintsSprint[] }>(`/team/${teamId}/projects/${projectId}/sprints/`, {
      query: { type: "all" },
    });
    return data.sprints ?? [];
  }

  async listEpics(projectId: string): Promise<SprintsEpic[]> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ epic: SprintsEpic[] }>(`/team/${teamId}/projects/${projectId}/epic/`);
    return data.epic ?? [];
  }

  async getItemStatuses(projectId: string): Promise<SprintsStatus[]> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ itemstatus: SprintsStatus[] }>(
      `/team/${teamId}/projects/${projectId}/itemstatus/`,
    );
    return data.itemstatus ?? [];
  }

  async getItemTypes(projectId: string): Promise<Array<{ id: string; name: string }>> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ itemtype: Array<{ id: string; name: string }> }>(
      `/team/${teamId}/projects/${projectId}/itemtype/`,
    );
    return data.itemtype ?? [];
  }

  async getPriorities(projectId: string): Promise<Array<{ id: string; name: string }>> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ priority: Array<{ id: string; name: string }> }>(
      `/team/${teamId}/projects/${projectId}/priority/`,
    );
    return data.priority ?? [];
  }

  async listItems(
    projectId: string,
    sprintOrBacklogId: string,
    opts: { index?: number; range?: number; searchby?: "id" | "name"; searchvalue?: string } = {},
  ): Promise<SprintsItem[]> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ item: SprintsItem[] }>(
      `/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/`,
      {
        query: {
          action: "data",
          index: opts.index ?? 1,
          range: opts.range ?? 100,
          searchby: opts.searchby,
          searchvalue: opts.searchvalue,
        },
      },
    );
    return data.item ?? [];
  }

  async getItem(projectId: string, sprintOrBacklogId: string, itemId: string): Promise<SprintsItem> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ item: SprintsItem }>(
      `/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/${itemId}/`,
    );
    return data.item;
  }

  async createItem(
    projectId: string,
    sprintOrBacklogId: string,
    fields: Record<string, unknown>,
  ): Promise<SprintsItem> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ item: SprintsItem }>(
      `/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/`,
      { method: "POST", body: fields },
    );
    return data.item;
  }

  async updateItem(
    projectId: string,
    sprintOrBacklogId: string,
    itemId: string,
    fields: Record<string, unknown>,
  ): Promise<SprintsItem> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ item: SprintsItem }>(
      `/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/${itemId}/`,
      { method: "POST", body: fields },
    );
    return data.item;
  }

  /** Resolves the moduleId Sprints uses for work-item comments/notes (cached per process). */
  private async getItemModuleId(): Promise<string> {
    if (this.moduleIdCache) return this.moduleIdCache;
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ modules: Array<{ id: string; name: string }> }>(
      `/team/${teamId}/settings/customization/modules/`,
    );
    const modules = data.modules ?? [];
    const match = modules.find((m) => /^(work)?item$/i.test(m.name));
    if (!match) {
      throw new Error(
        `Could not find an "Item" module in this workspace's module list (${modules.map((m) => m.name).join(", ")}).`,
      );
    }
    this.moduleIdCache = match.id;
    return match.id;
  }

  async listItemComments(projectId: string, itemId: string): Promise<SprintsComment[]> {
    const teamId = await this.ensureTeamId();
    const moduleId = await this.getItemModuleId();
    const data = await this.request<{ notes: SprintsComment[] }>(
      `/team/${teamId}/projects/${projectId}/modules/${moduleId}/entity/${itemId}/notes/`,
    );
    return data.notes ?? [];
  }

  async addItemComment(projectId: string, itemId: string, text: string): Promise<SprintsComment> {
    const teamId = await this.ensureTeamId();
    const moduleId = await this.getItemModuleId();
    const data = await this.request<{ notes: SprintsComment }>(
      `/team/${teamId}/projects/${projectId}/modules/${moduleId}/entity/${itemId}/notes/`,
      { method: "POST", body: { action: "addnotes", name: text } },
    );
    return data.notes;
  }
}
