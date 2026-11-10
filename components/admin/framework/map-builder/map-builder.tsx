'use client';

/**
 * MapBuilder (f-map-editor t-1) — the top-level client island the map editor page
 * mounts. Owns the canvas state (nodes / edges / selection) and the draft save flow;
 * a pattern-fork of the orchestration `WorkflowBuilder` shell, swapping its
 * workflow-bound leaves (step registry, block editors, cost/execution machinery) for
 * the map vocabulary.
 *
 * A map is always edited in place (it was created on the list page), so — unlike the
 * workflow builder — there is no create mode here: the canvas loads the in-progress
 * `draftDefinition` if present, else the published version's snapshot, else empty.
 * **Save** PATCHes the canvas to `draftDefinition` (`{ definition }`); **Discard**
 * PATCHes `{ definition: null }` and reloads from the published snapshot. Publish /
 * rollback / version history (t-4), the node inspector + validation (t-3), typed
 * edges + regions (t-2), and the dry-run (t-5) mount on this shell later.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FlaskConical } from 'lucide-react';
import {
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type OnNodeDrag,
} from '@xyflow/react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { headlineOnly } from '@/components/admin/framework/headline-only';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { logger } from '@/lib/logging';
import {
  mapDefinitionSchema,
  type EdgeType,
  type MapCondition,
} from '@/lib/framework/facilitation/map/schema';

import { MapCanvas } from '@/components/admin/framework/map-builder/map-canvas';
import { MapPalette } from '@/components/admin/framework/map-builder/map-palette';
import { NodeInspector } from '@/components/admin/framework/map-builder/node-inspector';
import { EdgeInspector } from '@/components/admin/framework/map-builder/edge-inspector';
import { ValidationPanel } from '@/components/admin/framework/map-builder/validation-panel';
import { PublishControls } from '@/components/admin/framework/map-builder/publish-controls';
import { VersionHistory } from '@/components/admin/framework/map-builder/version-history';
import { SimulatorPanel } from '@/components/admin/framework/map-builder/simulator-panel';
import { makeMapEdge } from '@/components/admin/framework/map-builder/add-map-edge';
import { MapEditorProvider } from '@/components/admin/framework/map-builder/map-editor-context';
import {
  collectMapIssues,
  issueNodeIds,
} from '@/components/admin/framework/map-builder/map-validation';
import {
  isDescendant,
  regionDepth,
  reparentNode,
  toggleRegionCollapse,
} from '@/components/admin/framework/map-builder/region-membership';
import {
  flowToMapDefinition,
  mapDefinitionToFlow,
  type MapEdgeData,
  type MapFlowEdge,
  type MapFlowNode,
  type MapNodeData,
} from '@/components/admin/framework/map-builder/map-mappers';

/** The subset of the map-detail API row the editor needs. Fields serialise as JSON
 *  over the page fetch, so this is a plain structural shape, not the Prisma row. */
export interface MapEditorGraph {
  slug: string;
  name: string;
  description: string | null;
  draftDefinition: unknown;
  publishedVersion: { version: number; definition: unknown } | null;
}

/** Prefer the in-progress draft; fall back to the published snapshot; else nothing. */
function pickEditableDefinition(graph: MapEditorGraph): unknown {
  if (graph.draftDefinition !== null && graph.draftDefinition !== undefined) {
    return graph.draftDefinition;
  }
  return graph.publishedVersion?.definition ?? null;
}

function toFlow(definition: unknown): { nodes: MapFlowNode[]; edges: MapFlowEdge[] } {
  const parsed = mapDefinitionSchema.safeParse(definition);
  if (!parsed.success) return { nodes: [], edges: [] };
  return mapDefinitionToFlow(parsed.data);
}

/** Seed the canvas from the editable definition (draft-first, then published). */
function seedFlow(graph: MapEditorGraph): { nodes: MapFlowNode[]; edges: MapFlowEdge[] } {
  return toFlow(pickEditableDefinition(graph));
}

/** Seed the canvas from the published snapshot only (the discard fallback). */
function publishedFlow(graph: MapEditorGraph): {
  nodes: MapFlowNode[];
  edges: MapFlowEdge[];
} {
  return toFlow(graph.publishedVersion?.definition ?? null);
}

function mapPath(slug: string): string {
  return `/api/v1/admin/framework/maps/${encodeURIComponent(slug)}`;
}

function MapBuilderInner({
  graph,
  moduleOptions,
  slotOptions,
}: {
  graph: MapEditorGraph;
  moduleOptions: readonly string[];
  slotOptions: readonly string[];
}) {
  const router = useRouter();
  const seed = useMemo(() => seedFlow(graph), [graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MapFlowNode>(seed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<MapFlowEdge>(seed.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const {
    failure: saveFailure,
    report: reportSave,
    clear: clearSave,
  } = useSaveFailure({ fallback: 'Failed to save the draft', fields: NO_SERVER_FIELDS });
  const [hasDraft, setHasDraft] = useState<boolean>(
    graph.draftDefinition !== null && graph.draftDefinition !== undefined
  );

  // The live published version + publish/history UI state. `publishedVersion` is local
  // state (not read straight off the prop) so a publish/rollback updates the status pill
  // and the "next version" immediately, without waiting for the server component to
  // re-render — mirroring the workflow builder.
  const [publishedVersion, setPublishedVersion] = useState<number | null>(
    graph.publishedVersion?.version ?? null
  );
  const [publishing, setPublishing] = useState(false);
  const {
    failure: publishFailure,
    report: reportPublish,
    clear: clearPublish,
  } = useSaveFailure({ fallback: 'Failed to publish', fields: NO_SERVER_FIELDS });
  const [published, setPublished] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of nodes) counts[node.data.nodeType] = (counts[node.data.nodeType] ?? 0) + 1;
    return counts;
  }, [nodes]);

  const handleNodeAdd = useCallback(
    (node: MapFlowNode) => {
      setNodes((prev) => [...prev, node]);
      setSaved(false);
    },
    [setNodes]
  );

  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      setNodes((prev) => {
        // Detaching a region: keep its direct members but pop them out to the top
        // level (at their absolute position) so they don't dangle on a removed parent.
        const childIds = prev.filter((n) => n.parentId === nodeId).map((n) => n.id);
        let next: MapFlowNode[] = prev;
        for (const childId of childIds) next = reparentNode(next, childId, null);
        return next.filter((n) => n.id !== nodeId);
      });
      setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
      setSaved(false);
    },
    [setEdges, setNodes]
  );

  // Region grouping: when a node drag ends, (un)group it based on which region it was
  // dropped into. Pick the deepest intersecting region (most specific), never the node
  // itself or a region nested under it (that would create a containment cycle).
  const { getIntersectingNodes } = useReactFlow<MapFlowNode>();
  const handleNodeDragStop = useCallback<OnNodeDrag<MapFlowNode>>(
    (_event, dragged) => {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const candidates = getIntersectingNodes(dragged).filter(
        (n) =>
          n.type === 'region' &&
          n.id !== dragged.id &&
          // A collapsed region is "closed" — don't drop into it (it would hide the
          // node); and never into the dragged node's own subtree (a cycle).
          !n.data?.collapsed &&
          !isDescendant(n.id, dragged.id, byId)
      );
      // Deepest (most-nested) region wins as the drop target.
      const target = candidates.reduce<string | null>(
        (best, n) =>
          best === null || regionDepth(n.id, byId) > regionDepth(best, byId) ? n.id : best,
        null
      );
      setNodes((prev) => reparentNode(prev, dragged.id, target));
      setSaved(false);
    },
    [getIntersectingNodes, nodes, setNodes]
  );

  const handleToggleCollapse = useCallback(
    (regionId: string) => {
      setNodes((prev) => toggleRegionCollapse(prev, regionId));
      setSaved(false);
    },
    [setNodes]
  );

  const editorContext = useMemo(
    () => ({ onToggleCollapse: handleToggleCollapse }),
    [handleToggleCollapse]
  );

  // Node and edge selection are mutually exclusive — a click on one clears the other,
  // so only one inspector shows at a time. A pane click (nodeId === null) clears both.
  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }, []);

  const handleEdgeSelect = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, []);

  // Drawing a connection materialises a default typed edge (decision 6:
  // draw-then-inspect — the author retypes it in the edge inspector). We dedupe on
  // source+target+*type* (not xyflow's `addEdge`, which ignores type) so the schema's
  // allowance of several differently-typed edges between the same pair is drawable —
  // while still blocking an exact-duplicate connection.
  const handleConnect = useCallback(
    (connection: Connection) => {
      const edge = makeMapEdge(connection);
      if (!edge) return;
      setEdges((prev) => {
        const dup = prev.some(
          (e) =>
            e.source === edge.source &&
            e.target === edge.target &&
            e.data?.edgeType === edge.data?.edgeType
        );
        return dup ? prev : [...prev, edge];
      });
      setSaved(false);
    },
    [setEdges]
  );

  const handleEdgeTypeChange = useCallback(
    (edgeId: string, type: EdgeType) => {
      setEdges((prev) =>
        prev.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, edgeType: type } } : e))
      );
      setSaved(false);
    },
    [setEdges]
  );

  const handleEdgeDelete = useCallback(
    (edgeId: string) => {
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      setSelectedEdgeId(null);
      setSaved(false);
    },
    [setEdges]
  );

  // A single merge-patch updater drives every node-inspector field edit (type, module
  // binding, stage, completion mode, first-arrival). The mappers round-trip the data.
  const handleNodeDataChange = useCallback(
    (nodeId: string, patch: Partial<MapNodeData>) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n))
      );
      setSaved(false);
    },
    [setNodes]
  );

  // The condition builder emits a valid `MapCondition` or `undefined` (no gate); write
  // it onto the edge's data so the mappers persist / drop it on save.
  const handleEdgeConditionChange = useCallback(
    (edgeId: string, condition: MapCondition | undefined) => {
      setEdges((prev) =>
        prev.map((e) =>
          e.id === edgeId ? { ...e, data: { ...(e.data as MapEdgeData), condition } } : e
        )
      );
      setSaved(false);
    },
    [setEdges]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    clearSave();
    try {
      const definition = flowToMapDefinition(nodes, edges);
      await apiClient.patch(mapPath(graph.slug), { body: { definition } });
      setHasDraft(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (err) {
      reportSave(headlineOnly(err));
      logger.error('Map draft save failed', err, { slug: graph.slug });
    } finally {
      setSaving(false);
    }
  }, [clearSave, edges, graph.slug, nodes, reportSave, router]);

  const handleDiscard = useCallback(async () => {
    if (!window.confirm('Discard the in-progress draft? The published version is unchanged.')) {
      return;
    }
    clearSave();
    try {
      await apiClient.patch(mapPath(graph.slug), { body: { definition: null } });
      // Reset the canvas to the published snapshot the discard fell back to, read
      // from the props already in hand (no publish happens in the editor, so it is
      // still current). Doing this without a second request keeps discard atomic:
      // the canvas can't be left showing the just-discarded draft if a reload fails.
      const published = publishedFlow(graph);
      setNodes(published.nodes);
      setEdges(published.edges);
      setSelectedNodeId(null);
      setSaved(false);
      setHasDraft(false);
      router.refresh();
    } catch (err) {
      reportSave(headlineOnly(err), 'Failed to discard the draft');
      logger.error('Map draft discard failed', err, { slug: graph.slug });
    }
  }, [clearSave, graph, reportSave, router, setEdges, setNodes]);

  // Publish promotes the SAVED draft to a new immutable version (workflow-builder
  // model). The publish gate (`validatePublishableMap`) 400s on an invalid draft — its
  // message surfaces in the dialog; the live-validation panel already shows which nodes.
  // The parent owns the dialog open state, so it closes it directly on success (rather
  // than coupling close to the transient "Published" flash).
  const handlePublish = useCallback(
    async (changeSummary: string | undefined) => {
      setPublishing(true);
      clearPublish();
      try {
        const result = await apiClient.post<{ version: { version: number } }>(
          `${mapPath(graph.slug)}/publish`,
          { body: changeSummary ? { changeSummary } : {} }
        );
        setPublishedVersion(result.version.version);
        setHasDraft(false);
        setPublishDialogOpen(false);
        setPublished(true);
        setTimeout(() => setPublished(false), 2500);
        router.refresh();
      } catch (err) {
        reportPublish(headlineOnly(err));
        logger.error('Map publish failed', err, { slug: graph.slug });
      } finally {
        setPublishing(false);
      }
    },
    [clearPublish, graph.slug, reportPublish, router]
  );

  // Roll back to a prior version: the service mints a NEW version copying the target and
  // pins it, but — unlike publish — it does NOT clear any in-progress draft. So don't
  // assume the draft is gone: re-read the fresh server state and drive the canvas +
  // draft flag + pill off it (the workflow-builder's revert pattern), keeping the client
  // coherent with what a reload would show. Rethrows so the history dialog shows errors.
  const handleRollback = useCallback(
    async (targetVersion: number) => {
      await apiClient.post(`${mapPath(graph.slug)}/rollback`, { body: { targetVersion } });
      // The rollback has committed from here. A failed reload must not read as a refused rollback,
      // whatever the server said, so it reaches the dialog as an error with no words of its own.
      const fresh = await apiClient.get<MapEditorGraph>(mapPath(graph.slug)).catch(() => {
        throw new Error('Rolled back, but the canvas could not be reloaded');
      });
      const flow = toFlow(pickEditableDefinition(fresh));
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setPublishedVersion(fresh.publishedVersion?.version ?? null);
      setHasDraft(fresh.draftDefinition !== null && fresh.draftDefinition !== undefined);
      setSaved(false);
      router.refresh();
    },
    [graph.slug, router, setEdges, setNodes]
  );

  // Clear the transient "Saved" indicator as soon as the canvas is actually edited
  // (a node moved, resized, or removed) — not on a mere selection — so it never claims
  // an unsaved change is persisted.
  const handleNodesChange = useCallback<typeof onNodesChange>(
    (changes) => {
      if (
        changes.some((c) => c.type === 'position' || c.type === 'remove' || c.type === 'dimensions')
      )
        setSaved(false);
      onNodesChange(changes);
    },
    [onNodesChange]
  );

  // Live preflight: run the pure validators over the current canvas so offending nodes
  // ring and the panel lists every problem before the author publishes (decision 3).
  const issues = useMemo(() => collectMapIssues(flowToMapDefinition(nodes, edges)), [nodes, edges]);
  const errorNodeIds = useMemo(() => issueNodeIds(issues), [issues]);

  // Paint the error ring by deriving `data.hasError` for the canvas rather than mutating
  // canvas state (which would loop): the flag is transient and never persisted.
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const hasError = errorNodeIds.has(n.id);
        return n.data.hasError === hasError ? n : { ...n, data: { ...n.data, hasError } };
      }),
    [nodes, errorNodeIds]
  );

  // Every node key on the canvas — the condition builder's milestone suggestions.
  const nodeKeys = useMemo(() => nodes.map((n) => n.id), [nodes]);

  // Read the live canvas as a definition — the dry-run simulates unsaved edits (F18).
  const getDefinition = useCallback(() => flowToMapDefinition(nodes, edges), [nodes, edges]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  const statusPill =
    publishedVersion === null
      ? { label: 'Unpublished', variant: 'outline' as const }
      : hasDraft
        ? {
            label: `Published v${publishedVersion} · editing draft`,
            variant: 'secondary' as const,
          }
        : { label: `Published v${publishedVersion}`, variant: 'outline' as const };

  return (
    <MapEditorProvider value={editorContext}>
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
          <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-lg font-semibold">{graph.name}</h1>
            <Badge variant="outline" className="font-mono text-xs">
              {graph.slug}
            </Badge>
            <Badge variant={statusPill.variant} className="text-xs">
              {statusPill.label}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              data-testid="map-dryrun-open"
              onClick={() => setSimulatorOpen(true)}
            >
              <FlaskConical className="mr-1.5 h-4 w-4" /> Dry run
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDiscard()}
              disabled={!hasDraft}
            >
              Discard draft
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save draft'}
            </Button>
            <PublishControls
              hasDraft={hasDraft}
              nextVersion={(publishedVersion ?? 0) + 1}
              open={publishDialogOpen}
              onOpenChange={setPublishDialogOpen}
              publishing={publishing}
              failure={publishFailure}
              clearFailure={clearPublish}
              published={published}
              onPublish={handlePublish}
              onOpenHistory={() => setHistoryOpen(true)}
            />
          </div>
        </header>

        {saveFailure && (
          <div className="border-b px-4 py-2">
            <SaveError failure={saveFailure} />
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          <MapPalette typeCounts={typeCounts} />
          <MapCanvas
            nodes={displayNodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={handleNodeSelect}
            onEdgeClick={handleEdgeSelect}
            onNodeAdd={handleNodeAdd}
          />
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              moduleOptions={moduleOptions}
              onDataChange={handleNodeDataChange}
              onDelete={handleNodeDelete}
            />
          ) : selectedEdge ? (
            <EdgeInspector
              edge={selectedEdge}
              nodeKeys={nodeKeys}
              slotOptions={slotOptions}
              onTypeChange={handleEdgeTypeChange}
              onConditionChange={handleEdgeConditionChange}
              onDelete={handleEdgeDelete}
            />
          ) : null}
        </div>

        <ValidationPanel issues={issues} onSelectNode={handleNodeSelect} />

        <VersionHistory
          slug={graph.slug}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          onRollback={handleRollback}
        />

        <SimulatorPanel
          slug={graph.slug}
          open={simulatorOpen}
          onOpenChange={setSimulatorOpen}
          nodeKeys={nodeKeys}
          slotOptions={slotOptions}
          getDefinition={getDefinition}
        />
      </div>
    </MapEditorProvider>
  );
}

export function MapBuilder({
  graph,
  moduleOptions = [],
  slotOptions = [],
}: {
  graph: MapEditorGraph;
  /** Registered module slugs — the node inspector's module-binding suggestions. */
  moduleOptions?: readonly string[];
  /** Registered slot-definition slugs — the condition builder's slot suggestions. */
  slotOptions?: readonly string[];
}) {
  // React Flow requires a provider wrapper for `useReactFlow` (canvas drop positioning).
  return (
    <ReactFlowProvider>
      <MapBuilderInner graph={graph} moduleOptions={moduleOptions} slotOptions={slotOptions} />
    </ReactFlowProvider>
  );
}
