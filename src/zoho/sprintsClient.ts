import type { ZohoTokenManager } from "./oauth.js";
import type {
  SprintsComment,
  SprintsEpic,
  SprintsItem,
  SprintsPortal,
  SprintsSprint,
  SprintsStatus,
  SprintsTag,
} from "./types.js";

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  /**
   * Most write endpoints want application/x-www-form-urlencoded (confirmed
   * live for items/statuses). Epic creation is the odd one out: its own
   * apidoc example sends a raw JSON body, and confirmed live too - form-
   * encoding it gets back {code: 7600, message: "Given JSON is invalid"}.
   */
  bodyFormat?: "form" | "json";
}

interface SprintsResponse {
  status: string;
  [key: string]: unknown;
}

/**
 * Zoho Sprints' write endpoints expect application/x-www-form-urlencoded
 * bodies (its docs show curl --data-urlencode, not a JSON payload) - array
 * and object values are individually JSON-stringified within the form
 * field (e.g. users=["123"]), everything else is sent as a plain string.
 */
function toFormBody(body: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return params.toString();
}

/**
 * With x-convert-response: true, Zoho returns each entity as a flat object
 * under its own oddly-specific field names (e.g. statusId/statusName,
 * projItemTypeId/itemTypeName) rather than a generic id/name pair - none of
 * this is documented (the docs only show the raw, unconverted response
 * shape), so these were reverse-engineered against the live API. This adds
 * plain id/name fields on top so resolveEntityId (name -> ID lookup) keeps
 * working, while leaving the original fields in place for anything else
 * that wants them.
 */
function withIdName<T extends Record<string, unknown>, K extends string = "name">(
  raw: T,
  idKey: string,
  nameKey: string,
  as: K = "name" as K,
): T & { id: string } & Record<K, string> {
  return { ...raw, id: String(raw[idKey]), [as]: String(raw[nameKey]) } as T & { id: string } & Record<K, string>;
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

    const isJsonBody = options.bodyFormat === "json";

    const doFetch = async (token: string) => {
      const res = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "x-convert-response": "true",
          ...(options.body
            ? { "Content-Type": isJsonBody ? "application/json" : "application/x-www-form-urlencoded" }
            : {}),
        },
        body: options.body ? (isJsonBody ? JSON.stringify(options.body) : toFormBody(options.body)) : undefined,
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as T & { status?: string; code?: number }) : ({} as T);
      return { res, data };
    };

    let token = await this.tokenManager.getAccessToken();
    let { res, data } = await doFetch(token);

    // Zoho signals an invalid/expired access token as HTTP 400 with
    // {code: 7601, message: "Invalid oauthToken"} (confirmed live) - not the
    // 401 its own OAuth token-refresh endpoint uses - so a bare `res.status
    // === 401` check misses this in practice. This matters more since
    // access tokens are now persisted across cold starts (see
    // ZohoTokenManager's seed/onRefresh): a token that Zoho invalidates
    // before its stated expiry (e.g. superseded by a refresh from another
    // process) needs this to self-heal instead of failing outright.
    const isInvalidToken = res.status === 401 || (res.status === 400 && (data as { code?: number }).code === 7601);
    if (isInvalidToken) {
      token = await this.tokenManager.refresh();
      ({ res, data } = await doFetch(token));
    }

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
    return this.request(`/team/${teamId}/projects/${projectId}/`, { query: { action: "details" } });
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
    // action/index/range are mandatory query params for this endpoint (same
    // gotcha as listProjects). type must be a JSON array of sprint-type
    // codes (1=upcoming, 2=active, 3=completed, 4=canceled) - omitting it
    // silently restricts results to upcoming sprints only, so pass all four
    // to genuinely list every sprint.
    const data = await this.request<{ sprints: SprintsSprint[] }>(`/team/${teamId}/projects/${projectId}/sprints/`, {
      query: { action: "data", index: 1, range: 100, type: JSON.stringify([1, 2, 3, 4]) },
    });
    return data.sprints ?? [];
  }

  async listEpics(projectId: string): Promise<SprintsEpic[]> {
    const teamId = await this.ensureTeamId();
    // Response key is "epics" (plural) - not documented; the docs only show
    // the raw/unconverted shape. Field names (epicId/epicName) follow the
    // same convention confirmed live for statuses/item types/priorities
    // below, but haven't been directly verified against a real epic.
    const data = await this.request<{ epics: Array<Record<string, unknown>> }>(
      `/team/${teamId}/projects/${projectId}/epic/`,
      { query: { action: "data", index: 1, range: 100 } },
    );
    return (data.epics ?? []).map((e) => withIdName(e, "epicId", "epicName", "title")) as unknown as SprintsEpic[];
  }

  async createEpic(projectId: string, fields: Record<string, unknown>): Promise<SprintsEpic> {
    const teamId = await this.ensureTeamId();
    // Docs show the raw/unconverted response as {epicJObj, epicIds, status},
    // and docs' example body is a raw JSON payload rather than the
    // form-urlencoded body every other write endpoint wants - both
    // confirmed live. With x-convert-response, the actual response reuses
    // listEpics' shape: {epics: [<full epic, including epicId>], ...}.
    const data = await this.request<{ epics?: Array<Record<string, unknown>> }>(
      `/team/${teamId}/projects/${projectId}/epic/`,
      { method: "POST", body: fields, bodyFormat: "json" },
    );
    const epicId = data.epics?.[0]?.epicId;
    if (!epicId) {
      throw new Error("Zoho did not return the newly created epic's ID.");
    }
    const epics = await this.listEpics(projectId);
    const epic = epics.find((e) => e.id === epicId);
    if (!epic) {
      throw new Error(`Epic ${epicId} was created but could not be fetched back.`);
    }
    return epic;
  }

  async deleteEpic(projectId: string, epicId: string): Promise<void> {
    const teamId = await this.ensureTeamId();
    // Response is just {status: "success"} - confirmed live, nothing to return.
    await this.request(`/team/${teamId}/projects/${projectId}/epic/${epicId}/`, { method: "DELETE" });
  }

  async getItemStatuses(projectId: string): Promise<SprintsStatus[]> {
    const teamId = await this.ensureTeamId();
    // Response key is "statuses", not "itemstatus" - confirmed live.
    const data = await this.request<{ statuses: Array<Record<string, unknown>> }>(
      `/team/${teamId}/projects/${projectId}/itemstatus/`,
      { query: { action: "data", index: 1, range: 100 } },
    );
    return (data.statuses ?? []).map((s) => withIdName(s, "statusId", "statusName")) as unknown as SprintsStatus[];
  }

  async getItemTypes(projectId: string): Promise<Array<{ id: string; name: string }>> {
    const teamId = await this.ensureTeamId();
    // Response key is "projItemTypes", not "itemtype" - confirmed live. The
    // id used here (projItemTypeId) is deliberately the project-scoped one,
    // not the workspace-global itemTypeId also present on each record -
    // Create/Update item's projitemtypeid field expects the former.
    const data = await this.request<{ projItemTypes: Array<Record<string, unknown>> }>(
      `/team/${teamId}/projects/${projectId}/itemtype/`,
      { query: { action: "data", index: 1, range: 100 } },
    );
    return (data.projItemTypes ?? []).map((t) => withIdName(t, "projItemTypeId", "itemTypeName"));
  }

  async getPriorities(projectId: string): Promise<Array<{ id: string; name: string }>> {
    const teamId = await this.ensureTeamId();
    // Response key is "projPriorities", not "priority" - confirmed live.
    // Same project-scoped-vs-global ID distinction as getItemTypes above:
    // projPriorityId is what Create/Update item's projpriorityid expects.
    const data = await this.request<{ projPriorities: Array<Record<string, unknown>> }>(
      `/team/${teamId}/projects/${projectId}/priority/`,
      { query: { action: "data", index: 1, range: 100 } },
    );
    return (data.projPriorities ?? []).map((p) => withIdName(p, "projPriorityId", "priorityName"));
  }

  /**
   * Fetches all custom tags defined in the workspace (tags are workspace-scoped, not
   * per-project - see apidoc.html#Gettags). Response key is "zsTags" (not "tags" or the
   * "zsTagJObj" map the docs' example response shows) - confirmed live. Each record carries two
   * different tag identifiers - "tagId" and "zsTagId" - and only "zsTagId" is what the
   * associate-tag endpoint's newtags param accepts and what getItemTagIds's associateTagIds
   * echoes back, also confirmed live by round-tripping an association.
   */
  async listTags(): Promise<SprintsTag[]> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ zsTags?: Array<Record<string, unknown>> }>(`/team/${teamId}/tags/`, {
      query: { action: "data", index: 1, range: 1000 },
    });
    return (data.zsTags ?? []).map((t) => withIdName(t, "zsTagId", "tagName")) as unknown as SprintsTag[];
  }

  /** Normalizes a raw item record (itemId/itemName/statusId/...) - see withIdName. */
  private normalizeItem(raw: Record<string, unknown>): SprintsItem {
    return withIdName(raw, "itemId", "itemName", "title") as unknown as SprintsItem;
  }

  async listItems(
    projectId: string,
    sprintOrBacklogId: string,
    opts: { index?: number; range?: number; searchby?: "id" | "name"; searchvalue?: string } = {},
  ): Promise<SprintsItem[]> {
    const teamId = await this.ensureTeamId();
    // Response key is "items" (plural) - not "item" - confirmed live.
    const data = await this.request<{ items: Array<Record<string, unknown>> }>(
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
    return (data.items ?? []).map((i) => this.normalizeItem(i));
  }

  async getItem(projectId: string, sprintOrBacklogId: string, itemId: string): Promise<SprintsItem> {
    const teamId = await this.ensureTeamId();
    // Even for a single item, action=details wraps the result in an
    // "items" array of length 1 (confirmed live) - there is no bare "item".
    const data = await this.request<{ items: Array<Record<string, unknown>> }>(
      `/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/${itemId}/`,
      { query: { action: "details" } },
    );
    const item = data.items?.[0];
    if (!item) throw new Error(`Item ${itemId} not found.`);
    return this.normalizeItem(item);
  }

  async createItem(
    projectId: string,
    sprintOrBacklogId: string,
    fields: Record<string, unknown>,
  ): Promise<SprintsItem> {
    const teamId = await this.ensureTeamId();
    // The create response is just {addedItemId, statusId, itemNo, status} -
    // confirmed live, no item payload - so fetch the full item afterward.
    const data = await this.request<{ addedItemId: string }>(
      `/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/`,
      { method: "POST", body: fields },
    );
    return this.getItem(projectId, sprintOrBacklogId, data.addedItemId);
  }

  async updateItem(
    projectId: string,
    sprintOrBacklogId: string,
    itemId: string,
    fields: Record<string, unknown>,
  ): Promise<SprintsItem> {
    const teamId = await this.ensureTeamId();
    // The update response just echoes back the changed fields (confirmed
    // live), not the full item, so fetch it afterward like createItem.
    await this.request(`/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/${itemId}/`, {
      method: "POST",
      body: fields,
    });
    return this.getItem(projectId, sprintOrBacklogId, itemId);
  }

  /** Fetches the tag IDs currently associated with an item (see apidoc.html#Gettagsassociatedwithitem). */
  async getItemTagIds(projectId: string, sprintOrBacklogId: string, itemId: string): Promise<string[]> {
    const teamId = await this.ensureTeamId();
    const data = await this.request<{ associateTagIds?: string[] }>(
      `/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/${itemId}/tags/`,
      { query: { action: "itemassociatedtagIds" } },
    );
    return data.associateTagIds ?? [];
  }

  /**
   * Associates the given tag IDs with an item (see apidoc.html#Associateorupdateitemtag).
   * `reassociate: true` replaces the item's existing tags with `tagIds`; `false` adds `tagIds`
   * to whatever tags are already associated.
   */
  async updateItemTags(
    projectId: string,
    sprintOrBacklogId: string,
    itemId: string,
    tagIds: string[],
    reassociate: boolean,
  ): Promise<void> {
    const teamId = await this.ensureTeamId();
    await this.request(`/team/${teamId}/projects/${projectId}/sprints/${sprintOrBacklogId}/item/${itemId}/tags/`, {
      method: "POST",
      body: { action: "associateupdate", newtags: tagIds, reassociate },
    });
  }

  /** Resolves the moduleId Sprints uses for work-item comments/notes (cached per process). */
  private async getItemModuleId(): Promise<string> {
    if (this.moduleIdCache) return this.moduleIdCache;
    const teamId = await this.ensureTeamId();
    // Response key is "custommodules", and each record uses
    // moduleId/moduleName (not id/name) - confirmed live, despite this
    // being the *default* module list, not just custom ones.
    const data = await this.request<{ custommodules: Array<{ moduleId: string; moduleName: string }> }>(
      `/team/${teamId}/settings/customization/modules/`,
      { query: { action: "data", index: 1, range: 100 } },
    );
    const modules = data.custommodules ?? [];
    const match = modules.find((m) => /^(work)?item$/i.test(m.moduleName));
    if (!match) {
      throw new Error(
        `Could not find an "Item" module in this workspace's module list (${modules.map((m) => m.moduleName).join(", ")}).`,
      );
    }
    this.moduleIdCache = match.moduleId;
    return match.moduleId;
  }

  /** Normalizes a raw comment/note record (noteId/notes text/...) - see withIdName. */
  private normalizeComment(raw: Record<string, unknown>): SprintsComment {
    return withIdName(raw, "noteId", "notes", "content") as unknown as SprintsComment;
  }

  async listItemComments(projectId: string, itemId: string): Promise<SprintsComment[]> {
    const teamId = await this.ensureTeamId();
    const moduleId = await this.getItemModuleId();
    // Response key is "notess" (double s - yes, that's really what Zoho
    // returns) - confirmed live, not "notes".
    const data = await this.request<{ notess: Array<Record<string, unknown>> }>(
      `/team/${teamId}/projects/${projectId}/modules/${moduleId}/entity/${itemId}/notes/`,
      { query: { action: "data", index: 1, range: 100 } },
    );
    return (data.notess ?? []).map((n) => this.normalizeComment(n));
  }

  async addItemComment(projectId: string, itemId: string, text: string): Promise<SprintsComment> {
    const teamId = await this.ensureTeamId();
    const moduleId = await this.getItemModuleId();
    const data = await this.request<{ notess: Array<Record<string, unknown>> }>(
      `/team/${teamId}/projects/${projectId}/modules/${moduleId}/entity/${itemId}/notes/`,
      { method: "POST", body: { action: "addnotes", name: text } },
    );
    const note = data.notess?.[0];
    if (!note) throw new Error("Zoho did not return the newly added comment.");
    return this.normalizeComment(note);
  }
}
