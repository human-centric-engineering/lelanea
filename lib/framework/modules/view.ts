/**
 * View / wire types for the framework module admin surfaces (f-ops-views).
 *
 * The list/detail pages fetch modules over HTTP (`serverFetch` → `response.json()`),
 * so a Prisma `DateTime` column arrives as an ISO **string**, not a `Date`. Typing
 * the fetched rows as the raw `Module` Prisma model (which declares `Date`) would
 * misdescribe that at the client boundary — a latent trap for any later code that
 * calls a `Date` method on what is actually a string. These view types are the
 * honest wire shape the pages consume, mirroring the orchestration `*ListItem`
 * convention (e.g. `AiCapabilityListItem`).
 */

import type { FieldDescriptor } from '@/lib/framework/modules/config/schema-descriptors';

/** A framework module as it appears in the admin list (JSON-serialized wire shape). */
export interface ModuleListItem {
  id: string;
  slug: string;
  name: string;
  /** Free-form lifecycle status (X1): draft | active | scheduled | retired | … */
  status: string;
  /** Free-form audience (X1): all | invite | flag-gated | … */
  audience: string;
  /** false = code removed but the row is retained for audit. */
  isRegistered: boolean;
  /** ISO 8601 string (a JSON-serialized `DateTime`), not a `Date`. */
  updatedAt: string;
}

/**
 * A framework module's operator-editable settings (`GET /modules/[slug]`) as the client
 * consumes it. The superset of {@link ModuleListItem} — it adds the liveness-window inputs
 * (`featureFlagName`, `availableFrom`, `availableUntil`) the Settings form edits, so the
 * detail page fetches this single-module shape instead of finding the row in the list.
 * `availableFrom` / `availableUntil` are ISO strings (JSON-serialized `DateTime`s) or null
 * (open-ended); the config values themselves live behind the separate `/config` endpoint.
 */
export interface ModuleSettingsView {
  id: string;
  slug: string;
  name: string;
  /** Free-form lifecycle status (X1): draft | active | scheduled | retired | … */
  status: string;
  /** Free-form audience (X1): all | invite | flag-gated | … */
  audience: string;
  /** Optional feature-flag binding gating liveness; null = unbound. */
  featureFlagName: string | null;
  /** Availability-window start — ISO 8601 string, or null for open-ended. */
  availableFrom: string | null;
  /** Availability-window end — ISO 8601 string, or null for open-ended. */
  availableUntil: string | null;
  /** false = code removed but the row is retained for audit. */
  isRegistered: boolean;
  /** ISO 8601 string (a JSON-serialized `DateTime`), not a `Date`. */
  updatedAt: string;
}

/**
 * The config-form payload (`GET /modules/[slug]/config`) as the client consumes it —
 * the server `ModuleConfigForm` with its `Prisma.JsonValue` values narrowed to a plain
 * object (a module's config is always a JSON object; the `{}` default holds for a fresh
 * or unregistered module).
 */
export interface ModuleConfigFormView {
  /** Whether the module's code is still registered (its schema is available to render). */
  registered: boolean;
  /** Field descriptors for the generic form; `[]` when the module is unregistered. */
  descriptors: FieldDescriptor[];
  /** The module's current stored config values. */
  values: Record<string, unknown>;
}

/**
 * One immutable config version as the client consumes it — a `ModuleVersion` row with an
 * ISO-string `createdAt`. It omits the `snapshot` blob from the TYPE (the list view doesn't
 * render it); note 06's `GET .../versions` still sends the full rows over the wire, so the
 * omission is a type narrowing, not a payload reduction. The newest version is always the
 * live config (no draft/published split).
 */
export interface ModuleVersionSummary {
  id: string;
  version: number;
  changeSummary: string | null;
  /** The admin user id that wrote this version, or null if since erased. */
  createdBy: string | null;
  /** ISO 8601 string (a JSON-serialized `DateTime`). */
  createdAt: string;
}

/** The `GET /modules/[slug]/versions` payload as the client consumes it. */
export interface ModuleVersionsView {
  versions: ModuleVersionSummary[];
  nextCursor: string | null;
}

/**
 * A module's agent binding as the Agents tab consumes it (`GET /modules/[slug]/agents`) —
 * the server `ModuleAgentBindingView` with its `DateTime`s narrowed to ISO strings and the
 * opaque `config` override narrowed to a plain object (the bind schema stores a JSON object
 * or null). `agent` is the stitched display fields, or `null` when the bound agent was
 * removed (a stale binding surfaced for cleanup rather than silently dropped).
 */
export interface ModuleAgentBindingListItem {
  id: string;
  agentId: string;
  /** The declared seat this agent fills. */
  role: string;
  /** The module's single lead seat (≤ 1 per module). */
  isPrimary: boolean;
  /** Opaque per-binding override, or null. */
  config: Record<string, unknown> | null;
  /** ISO 8601 string (a JSON-serialized `DateTime`). */
  createdAt: string;
  updatedAt: string;
  agent: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    /** Non-null ⇒ the agent was soft-deleted (tombstoned) after being bound. */
    deletedAt: string | null;
  } | null;
}

/** The `GET /modules/[slug]/agent-roles` payload — the bindable seats the module declares. */
export interface ModuleAgentRolesView {
  /** false ⇒ the module's code is removed, so no seats are bindable right now. */
  registered: boolean;
  roles: string[];
}

/**
 * A module's workflow binding as the Workflows tab consumes it (`GET /modules/[slug]/workflows`)
 * — the server `ModuleWorkflowBindingView` with its `DateTime`s narrowed to ISO strings and the
 * opaque `inputTemplate` narrowed to a plain object (the bind schema stores a JSON object or
 * null). `workflow` is the stitched display fields, or `null` when the bound workflow was
 * removed. `hasPublishedVersion === false` means the binding "won't fire yet" (dispatch skips a
 * workflow with no published version).
 */
export interface ModuleWorkflowBindingListItem {
  id: string;
  workflowId: string;
  /** The module-lifecycle event that fires this binding (free-form, X1). */
  eventType: string;
  /** Gate firing without deleting the binding. */
  enabled: boolean;
  /** The operator's static run input, or null. */
  inputTemplate: Record<string, unknown> | null;
  /** The template's version: what a save of `inputTemplate` sends back as `If-Match` (t-151). */
  version: string;
  /** ISO 8601 string (a JSON-serialized `DateTime`). */
  createdAt: string;
  updatedAt: string;
  workflow: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    /** false ⇒ the binding won't fire yet (dispatch skips an unpublished workflow). */
    hasPublishedVersion: boolean;
  } | null;
}

/**
 * A module's knowledge scope as the Knowledge tab consumes it (`GET /modules/[slug]/knowledge`)
 * — the server `ModuleKnowledgeScope` with its grant `createdAt`s narrowed to ISO strings. Each
 * grant stitches the document/tag display fields, or `null` when it was removed (the grant was
 * FK-cascaded away, so a stale row shouldn't appear — `null` is defensive).
 */
export interface ModuleKnowledgeDocumentListItem {
  documentId: string;
  createdAt: string;
  document: { id: string; name: string; slug: string; status: string } | null;
}

export interface ModuleKnowledgeTagListItem {
  tagId: string;
  createdAt: string;
  tag: { id: string; name: string; slug: string } | null;
}

export interface ModuleKnowledgeScopeView {
  documents: ModuleKnowledgeDocumentListItem[];
  tags: ModuleKnowledgeTagListItem[];
}
