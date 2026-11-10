// @vitest-environment happy-dom

/**
 * MapBuilder (f-map-editor t-1) — the editor shell's behavioural contract. React Flow
 * is mocked (no layout measurement in happy-dom) with a stateful `useNodesState` /
 * `useEdgesState` so the canvas state the shell owns behaves for real; the mocked
 * `ReactFlow` renders one button per node so a click can select it.
 *
 * Proves: the header reflects the map's identity + publish status; Save PATCHes the
 * canvas as `{ definition }` (a schema-valid map with the seeded node); Discard is
 * gated on there being a draft and PATCHes `{ definition: null }` then reloads; and
 * deleting the selected node drops it (and its edges) from the canvas.
 *
 * @see components/admin/framework/map-builder/map-builder.tsx
 */

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { APIClientError } from '@/lib/api/client';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const api = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: api,
}));

// Controls what `getIntersectingNodes` returns for the drag-to-group tests.
const intersect = vi.hoisted(() => ({ nodes: [] as { id: string; type: string }[] }));

vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));

vi.mock('@xyflow/react', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  const { useMapEditor } =
    await import('@/components/admin/framework/map-builder/map-editor-context');
  const stateful = () => (initial: unknown) => {
    const [value, setValue] = react.useState(initial);
    return [value, setValue, vi.fn()];
  };
  const ReactFlow = ({
    nodes,
    edges,
    onNodeClick,
    onEdgeClick,
    onNodesChange,
    onConnect,
    onNodeDragStop,
    children,
  }: {
    nodes: {
      id: string;
      type?: string;
      parentId?: string;
      hidden?: boolean;
      data: { label: string; collapsed?: boolean };
    }[];
    edges: { id: string }[];
    onNodeClick?: (e: unknown, node: unknown) => void;
    onEdgeClick?: (e: unknown, edge: { id: string }) => void;
    onNodesChange?: (changes: { type: string; id: string }[]) => void;
    onConnect?: (connection: { source: string; target: string }) => void;
    onNodeDragStop?: (e: unknown, node: unknown) => void;
    children?: ReactNode;
  }) => {
    // Rendered inside `<MapEditorProvider>`, so the region-collapse callback the real
    // `RegionNode` uses is reachable here for the collapse test.
    const { onToggleCollapse } = useMapEditor();
    return (
      <div data-testid="rf" data-node-count={nodes.length} data-edge-count={edges.length}>
        {nodes.map((n) => (
          <button
            key={n.id}
            data-testid={`rf-node-${n.id}`}
            data-parent={n.parentId ?? ''}
            data-hidden={Boolean(n.hidden)}
            data-collapsed={Boolean(n.data.collapsed)}
            onClick={(e) => onNodeClick?.(e, n)}
          >
            {n.data.label}
          </button>
        ))}
        {nodes.map((n) => (
          <button
            key={`drag-${n.id}`}
            data-testid={`rf-dragstop-${n.id}`}
            onClick={(e) => onNodeDragStop?.(e, n)}
          />
        ))}
        {nodes
          .filter((n) => n.type === 'region')
          .map((n) => (
            <button
              key={`collapse-${n.id}`}
              data-testid={`rf-collapse-${n.id}`}
              onClick={() => onToggleCollapse(n.id)}
            />
          ))}
        <button
          data-testid="rf-move"
          onClick={() => onNodesChange?.([{ type: 'position', id: 'm' }])}
        />
        <button
          data-testid="rf-connect"
          onClick={() => onConnect?.({ source: 'm', target: 'n' })}
        />
        <button
          data-testid="rf-select-edge"
          onClick={(e) => edges[0] && onEdgeClick?.(e, edges[0])}
        />
        {children}
      </div>
    );
  };
  return {
    ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
    ReactFlow,
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    addEdge: (edge: unknown, eds: unknown[]) => [...eds, edge],
    useReactFlow: () => ({
      screenToFlowPosition: (p: unknown) => p,
      getIntersectingNodes: () => intersect.nodes,
    }),
    useNodesState: stateful(),
    useEdgesState: stateful(),
  };
});

import {
  MapBuilder,
  type MapEditorGraph,
} from '@/components/admin/framework/map-builder/map-builder';

const PUBLISHED_DEF = {
  nodes: [
    {
      key: 'm',
      type: 'module',
      moduleSlug: 'm',
      completionMode: 'once',
      meta: { _layout: { x: 0, y: 0 } },
    },
  ],
  edges: [],
};

function graph(over: Partial<MapEditorGraph> = {}): MapEditorGraph {
  return {
    slug: 'demo',
    name: 'Demo map',
    description: null,
    draftDefinition: null,
    publishedVersion: { version: 2, definition: PUBLISHED_DEF },
    ...over,
  };
}

const REGION_DEF = {
  nodes: [
    {
      key: 'zone',
      type: 'region',
      completionMode: 'once',
      meta: { _layout: { x: 0, y: 0 }, _size: { width: 300, height: 200 } },
    },
    {
      key: 'm',
      type: 'module',
      moduleSlug: 'm',
      completionMode: 'once',
      meta: { _layout: { x: 400, y: 50 } },
    },
  ],
  edges: [],
};

// `m` already inside `zone` — for the region-delete-detach test.
const REGION_MEMBER_DEF = {
  nodes: [
    REGION_DEF.nodes[0],
    { ...REGION_DEF.nodes[1], region: 'zone', meta: { _layout: { x: 40, y: 40 } } },
  ],
  edges: [],
};

beforeEach(() => {
  api.patch.mockReset().mockResolvedValue({});
  api.get.mockReset().mockResolvedValue(graph());
  api.post.mockReset().mockResolvedValue({ version: { version: 3 } });
  router.refresh.mockReset();
  intersect.nodes = [];
});

describe('MapBuilder header', () => {
  it('shows the map name, slug and published status', () => {
    render(<MapBuilder graph={graph()} />);
    expect(screen.getByText('Demo map')).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(screen.getByText('Published v2')).toBeInTheDocument();
  });

  it('disables Discard when there is no draft', () => {
    render(<MapBuilder graph={graph()} />);
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeDisabled();
  });

  it('enables Discard when a draft is present', () => {
    render(<MapBuilder graph={graph({ draftDefinition: PUBLISHED_DEF })} />);
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeEnabled();
  });

  it('shows the Unpublished status when the map has no published version', () => {
    render(<MapBuilder graph={graph({ publishedVersion: null })} />);
    expect(screen.getByText('Unpublished')).toBeInTheDocument();
  });

  it('reflects a draft on a published map in the status pill', () => {
    render(<MapBuilder graph={graph({ draftDefinition: PUBLISHED_DEF })} />);
    expect(screen.getByText(/Published v2 · editing draft/)).toBeInTheDocument();
  });
});

describe('MapBuilder selection', () => {
  it('shows the selected node’s identity and module binding in the panel', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);
    await user.click(screen.getByTestId('rf-node-m'));
    const panel = screen.getByTestId('map-node-panel');
    expect(panel).toHaveTextContent('Module');
    expect(panel).toHaveTextContent('m');
  });
});

describe('MapBuilder save', () => {
  it('PATCHes the canvas as a schema-valid { definition }', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [path, opts] = api.patch.mock.calls[0];
    expect(path).toBe('/api/v1/admin/framework/maps/demo');
    const def = (opts as { body: { definition: { nodes: { key: string }[] } } }).body.definition;
    expect(def.nodes.map((n) => n.key)).toEqual(['m']);
    // Position round-tripped back into meta._layout.
    expect((def.nodes[0] as unknown as { meta: { _layout: unknown } }).meta._layout).toEqual({
      x: 0,
      y: 0,
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('clears the Saved indicator when a node is moved', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    await user.click(screen.getByTestId('rf-move'));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('surfaces a save failure as an inline alert', async () => {
    api.patch.mockRejectedValueOnce(new APIClientError('boom', 'X', 500));
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('MapBuilder discard', () => {
  it('PATCHes { definition: null } after confirm and resets to the published snapshot', async () => {
    window.confirm = vi.fn(() => true);
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: PUBLISHED_DEF })} />);

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/v1/admin/framework/maps/demo', {
        body: { definition: null },
      })
    );
    // Atomic: reset comes from the in-props published snapshot, not a second fetch.
    expect(api.get).not.toHaveBeenCalled();
    // Draft is gone → Discard disables, canvas still shows the published node.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Discard draft' })).toBeDisabled()
    );
    expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '1');
  });

  it('does nothing when the confirm is dismissed', async () => {
    window.confirm = vi.fn(() => false);
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: PUBLISHED_DEF })} />);

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('surfaces a discard failure as an inline alert', async () => {
    window.confirm = vi.fn(() => true);
    api.patch.mockRejectedValueOnce(new Error('network down'));
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: PUBLISHED_DEF })} />);

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    // A non-APIClientError has no words of its own, so the context says it all.
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to discard the draft');
  });
});

describe('MapBuilder node add', () => {
  it('adds a node dropped from the palette', () => {
    render(<MapBuilder graph={graph()} />);
    expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '1');

    fireEvent.drop(screen.getByTestId('map-canvas'), {
      dataTransfer: { getData: () => 'stage' },
      clientX: 10,
      clientY: 10,
    });
    expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '2');
  });
});

describe('MapBuilder delete', () => {
  it('removes the selected node from the canvas', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);
    expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '1');

    await user.click(screen.getByTestId('rf-node-m'));
    await user.click(screen.getByRole('button', { name: /Delete node/ }));

    expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '0');
  });
});

describe('MapBuilder edges', () => {
  it('draws a default edge on connect', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);
    expect(screen.getByTestId('rf')).toHaveAttribute('data-edge-count', '0');

    await user.click(screen.getByTestId('rf-connect'));
    expect(screen.getByTestId('rf')).toHaveAttribute('data-edge-count', '1');
  });

  it('does not add an exact-duplicate connection (same pair + type)', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    await user.click(screen.getByTestId('rf-connect'));
    await user.click(screen.getByTestId('rf-connect'));
    // Both draws default to prerequisite m→n → the second is deduped.
    expect(screen.getByTestId('rf')).toHaveAttribute('data-edge-count', '1');
  });

  it('allows a second, differently-typed edge between the same pair', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    // Draw m→n (prerequisite), retype it to unlocks, then draw m→n again.
    await user.click(screen.getByTestId('rf-connect'));
    await user.click(screen.getByTestId('rf-select-edge'));
    await user.click(screen.getByTestId('edge-type-unlocks'));
    await user.click(screen.getByTestId('rf-connect'));
    // The new prerequisite m→n is distinct from the existing unlocks m→n.
    expect(screen.getByTestId('rf')).toHaveAttribute('data-edge-count', '2');
  });

  it('selects a drawn edge, retypes it, then deletes it', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);
    await user.click(screen.getByTestId('rf-connect'));
    await user.click(screen.getByTestId('rf-select-edge'));

    expect(screen.getByTestId('map-edge-panel')).toBeInTheDocument();
    // A freshly-drawn edge defaults to prerequisite.
    expect(screen.getByTestId('edge-type-prerequisite')).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByTestId('edge-type-unlocks'));
    expect(screen.getByTestId('edge-type-unlocks')).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('button', { name: /Delete edge/ }));
    expect(screen.getByTestId('rf')).toHaveAttribute('data-edge-count', '0');
    expect(screen.queryByTestId('map-edge-panel')).not.toBeInTheDocument();
  });

  it('shows the edge inspector in place of the node panel (mutually exclusive)', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    await user.click(screen.getByTestId('rf-node-m'));
    expect(screen.getByTestId('map-node-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('rf-connect'));
    await user.click(screen.getByTestId('rf-select-edge'));

    expect(screen.queryByTestId('map-node-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('map-edge-panel')).toBeInTheDocument();
  });
});

describe('MapBuilder regions', () => {
  it('groups a node into a region it is dropped onto, and ungroups it when dropped out', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: REGION_DEF })} />);
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-parent', '');

    // Drop `m` while it intersects `zone` → grouped.
    intersect.nodes = [{ id: 'zone', type: 'region' }];
    await user.click(screen.getByTestId('rf-dragstop-m'));
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-parent', 'zone');

    // Drop `m` where it intersects nothing → ungrouped.
    intersect.nodes = [];
    await user.click(screen.getByTestId('rf-dragstop-m'));
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-parent', '');
  });

  it('never groups a region into itself', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: REGION_DEF })} />);
    // `zone` reports itself as intersecting — the self-group must be rejected.
    intersect.nodes = [{ id: 'zone', type: 'region' }];
    await user.click(screen.getByTestId('rf-dragstop-zone'));
    expect(screen.getByTestId('rf-node-zone')).toHaveAttribute('data-parent', '');
  });

  it('groups into the deepest (most-nested) intersecting region', async () => {
    const user = userEvent.setup();
    // `inner` is a region nested inside `zone`; a node dropped where both intersect
    // should land in `inner`.
    const nestedDef = {
      nodes: [
        REGION_DEF.nodes[0],
        {
          key: 'inner',
          type: 'region',
          region: 'zone',
          completionMode: 'once',
          meta: { _layout: { x: 20, y: 20 }, _size: { width: 120, height: 90 } },
        },
        REGION_DEF.nodes[1],
      ],
      edges: [],
    };
    render(<MapBuilder graph={graph({ draftDefinition: nestedDef })} />);

    intersect.nodes = [
      { id: 'zone', type: 'region' },
      { id: 'inner', type: 'region' },
    ];
    await user.click(screen.getByTestId('rf-dragstop-m'));
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-parent', 'inner');
  });

  it('collapses a region, hiding its members, and expands it back', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: REGION_MEMBER_DEF })} />);
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-hidden', 'false');

    await user.click(screen.getByTestId('rf-collapse-zone'));
    expect(screen.getByTestId('rf-node-zone')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-hidden', 'true');

    await user.click(screen.getByTestId('rf-collapse-zone'));
    expect(screen.getByTestId('rf-node-zone')).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-hidden', 'false');
  });

  it('does not group a node into a collapsed (closed) region', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: REGION_DEF })} />);
    await user.click(screen.getByTestId('rf-collapse-zone'));

    // `zone` is collapsed; dropping `m` onto it must be rejected.
    intersect.nodes = [{ id: 'zone', type: 'region', data: { collapsed: true } } as never];
    await user.click(screen.getByTestId('rf-dragstop-m'));
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-parent', '');
  });

  it('reveals a collapsed region’s members when the region is deleted', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: REGION_MEMBER_DEF })} />);
    await user.click(screen.getByTestId('rf-collapse-zone'));
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-hidden', 'true');

    await user.click(screen.getByTestId('rf-node-zone'));
    await user.click(screen.getByRole('button', { name: /Delete region/ }));

    // `m` survives and is visible again (no collapsed ancestor).
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-hidden', 'false');
  });

  it('detaches a region’s members when the region is deleted (they survive, unparented)', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: REGION_MEMBER_DEF })} />);
    expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '2');
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-parent', 'zone');

    await user.click(screen.getByTestId('rf-node-zone'));
    await user.click(screen.getByRole('button', { name: /Delete region/ }));

    expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '1');
    expect(screen.getByTestId('rf-node-m')).toHaveAttribute('data-parent', '');
  });
});

describe('MapBuilder node config', () => {
  it('edits a node field in the inspector and round-trips it through Save', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    await user.click(screen.getByTestId('rf-node-m'));
    await user.selectOptions(screen.getByTestId('node-completion'), 'repeatable');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const [, opts] = api.patch.mock.calls[0];
    const def = (opts as { body: { definition: { nodes: { completionMode: string }[] } } }).body
      .definition;
    expect(def.nodes[0].completionMode).toBe('repeatable');
  });
});

// A prerequisite cycle a→b→a: unsatisfiable (and both nodes unreachable) — the pure
// validators flag it, so the live-preflight panel must surface it on load.
const CYCLE_DEF = {
  nodes: [
    { key: 'a', type: 'milestone', completionMode: 'once', meta: { _layout: { x: 0, y: 0 } } },
    { key: 'b', type: 'milestone', completionMode: 'once', meta: { _layout: { x: 100, y: 0 } } },
  ],
  edges: [
    { from: 'a', to: 'b', type: 'prerequisite' },
    { from: 'b', to: 'a', type: 'prerequisite' },
  ],
};

describe('MapBuilder live validation', () => {
  it('shows no validation panel for a clean map', () => {
    render(<MapBuilder graph={graph()} />);
    expect(screen.queryByTestId('map-validation-panel')).not.toBeInTheDocument();
  });

  it('surfaces a prerequisite cycle and selects the node when an issue is clicked', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: CYCLE_DEF })} />);

    const panel = screen.getByTestId('map-validation-panel');
    expect(panel).toHaveTextContent('PREREQUISITE_CYCLE');

    await user.click(screen.getByTestId('map-issue-0'));
    // The issue points at a cycle node → its inspector opens.
    expect(screen.getByTestId('map-node-panel')).toBeInTheDocument();
  });
});

// Two-node snapshot a rollback returns — proves the canvas reloads from the new version.
const ROLLBACK_DEF = {
  nodes: [
    { key: 'a', type: 'milestone', completionMode: 'once', meta: { _layout: { x: 0, y: 0 } } },
    { key: 'b', type: 'milestone', completionMode: 'once', meta: { _layout: { x: 100, y: 0 } } },
  ],
  edges: [],
};

const VERSION_LIST = {
  versions: [
    {
      id: 'v2id',
      version: 2,
      changeSummary: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      createdBy: 'u',
    },
    {
      id: 'v1id',
      version: 1,
      changeSummary: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      createdBy: 'u',
    },
  ],
  publishedVersionId: 'v2id',
  nextCursor: null,
};

describe('MapBuilder version controls', () => {
  it('gates Publish on a saved draft', () => {
    render(<MapBuilder graph={graph()} />);
    expect(screen.getByTestId('map-publish-open')).toBeDisabled();
  });

  it('enables Publish when a draft is present', () => {
    render(<MapBuilder graph={graph({ draftDefinition: PUBLISHED_DEF })} />);
    expect(screen.getByTestId('map-publish-open')).toBeEnabled();
  });

  it('publishes the draft and updates the version pill', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph({ draftDefinition: PUBLISHED_DEF })} />);

    await user.click(screen.getByTestId('map-publish-open'));
    await user.click(screen.getByTestId('map-publish-confirm'));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/admin/framework/maps/demo/publish', {
        body: {},
      })
    );
    // Mock publish returns v3 → the pill reflects it, draft cleared.
    expect(await screen.findByText('Published v3')).toBeInTheDocument();
  });

  it('opens version history and loads the versions', async () => {
    api.get.mockResolvedValueOnce(VERSION_LIST);
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    await user.click(screen.getByTestId('map-history-open'));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/api/v1/admin/framework/maps/demo/versions')
    );
    expect(await screen.findByTestId('map-version-2')).toHaveTextContent('live');
  });

  it('rolls back a prior version and reloads the canvas from fresh server state', async () => {
    // get calls in order: history list (open), fresh map (after rollback), history reload.
    api.get
      .mockResolvedValueOnce(VERSION_LIST)
      .mockResolvedValueOnce(
        graph({
          publishedVersion: { version: 3, definition: ROLLBACK_DEF },
          draftDefinition: null,
        })
      )
      .mockResolvedValueOnce({ ...VERSION_LIST, publishedVersionId: 'v3id' });
    api.post.mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);
    expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '1');

    await user.click(screen.getByTestId('map-history-open'));
    await screen.findByTestId('map-version-1');
    await user.click(screen.getByTestId('map-rollback-1'));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/admin/framework/maps/demo/rollback', {
        body: { targetVersion: 1 },
      })
    );
    // The fresh map (published v3 = the rolled-back 2-node snapshot, no draft) drives the
    // canvas — so it shows 2 nodes and the pill reflects v3.
    await waitFor(() => expect(screen.getByTestId('rf')).toHaveAttribute('data-node-count', '2'));
  });

  it('does not report a committed rollback as refused when the reload fails', async () => {
    api.get
      .mockResolvedValueOnce(VERSION_LIST)
      .mockRejectedValueOnce(new APIClientError('Internal server error', 'INTERNAL_ERROR', 500))
      .mockResolvedValueOnce(VERSION_LIST);
    api.post.mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);

    await user.click(screen.getByTestId('map-history-open'));
    await screen.findByTestId('map-version-1');
    await user.click(screen.getByTestId('map-rollback-1'));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t confirm the rollback/i);
    expect(alert).not.toHaveTextContent(/internal server error/i);
  });
});

describe('MapBuilder dry run', () => {
  it('opens the dry-run simulator from the header', async () => {
    const user = userEvent.setup();
    render(<MapBuilder graph={graph()} />);
    await user.click(screen.getByTestId('map-dryrun-open'));
    expect(screen.getByTestId('sim-run')).toBeInTheDocument();
  });
});
