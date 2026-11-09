import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, ArrowRight, RotateCcw, X } from 'lucide-react';
import { IconButton } from '../../components/ui';
import type { NoteGraph } from '@larvis/shared';
import { getNoteGraphState, updateNote } from '../../lib/api';
import { useTheme } from '../../theme/ThemeProvider';
import { Markdown } from '../../components/Markdown';
import { Button } from '../../components/ui';
import {
  NO_GROUP_COLOR,
  clearPositions,
  directionFor,
  groupColors,
  groupOrder,
  hasAnyPosition,
  layoutGraph,
  neighbours,
  nodeSize,
  validEdges,
  withPositions,
  type LayoutDirection,
} from './graphLayout';

// Themen-Graph einer Notiz: React Flow zeichnet, Dagre legt aus (graphLayout.ts).
// Auf der aktuellen Version lassen sich Knoten verschieben; die Position landet
// verzögert in `graph` der Notiz. Eingefrorene Versionen sind nur zum Ansehen.
//
// Lesbarkeit vor Übersicht: Der Graph öffnet als Vollbild-Ebene über der App (im
// schmalen Notiz-Panel wären die Kacheln nach fitView nur Striche), fitView
// verkleinert höchstens bis FIT_MIN_ZOOM (kleinste Kachel ≈ 28 px hoch) und lässt
// den Rest per Verschieben erreichen. Die Minimap erscheint erst ab MINIMAP_MIN_WIDTH.

const SAVE_DELAY = 600;
const FIT_MIN_ZOOM = 0.7; // kleinste Kachel 40 px × 0.7 = 28 px
const MINIMAP_MIN_WIDTH = 900;

type TopicData = { label: string; color: string; fontSize: number; width: number; height: number; active: boolean; direction: LayoutDirection };
type TopicNode = FlowNode<TopicData, 'topic'>;

const TopicTile = memo(function TopicTile({ data }: NodeProps<TopicNode>) {
  return (
    <div
      className={`graph-node${data.active ? ' graph-node--active' : ''}`}
      lang="de"
      style={{
        width: data.width,
        minHeight: data.height,
        fontSize: data.fontSize,
        ['--node-color' as string]: data.color,
      }}
    >
      <Handle type="target" position={data.direction === 'LR' ? Position.Left : Position.Top} className="graph-node__handle" isConnectable={false} />
      <span className="graph-node__label">{data.label}</span>
      <Handle type="source" position={data.direction === 'LR' ? Position.Right : Position.Bottom} className="graph-node__handle" isConnectable={false} />
    </div>
  );
});

const NODE_TYPES = { topic: TopicTile };

export interface NoteGraphViewProps {
  noteId: string;
  graph: NoteGraph;
  /** Eingefrorene Version: kein Verschieben, kein Zurücksetzen. */
  readOnly: boolean;
  /** Meldet jeden neuen Stand nach oben (z. B. damit „Neue Version" die Positionen mitnimmt). */
  onGraphChange: (graph: NoteGraph) => void;
  /** Überschrift der Vollbild-Ebene (Titel der Notiz). */
  title: string;
  /** Schließt die Vollbild-Ebene (zurück ins Notiz-Panel). */
  onClose: () => void;
}

export default function NoteGraphView({ title, onClose, ...props }: NoteGraphViewProps) {
  // Escape schließt nur die Graph-Ebene, nicht das Notiz-Panel darunter: Capture
  // auf window läuft vor dessen Listener und hält das Ereignis an.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="graph-overlay" data-noswipe role="dialog" aria-modal="true" aria-label={`Graph: ${title}`}>
      <div className="graph-overlay__head">
        <h2 className="graph-overlay__title">{title}</h2>
        <IconButton size="sm" label="Graph schließen" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <ReactFlowProvider>
        <GraphCanvas {...props} title={title} onClose={onClose} />
      </ReactFlowProvider>
    </div>,
    document.body,
  );
}

function GraphCanvas({ noteId, graph, readOnly, onGraphChange }: NoteGraphViewProps) {
  const { theme } = useTheme();
  const flow = useReactFlow();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const colors = useMemo(() => groupColors(graph), [graph]);
  const colorOf = useCallback((group?: string) => (group ? colors.get(group) : undefined) ?? NO_GROUP_COLOR, [colors]);

  // Richtung einmal beim Öffnen aus dem Seitenverhältnis der Ebene (≈ Viewport);
  // ein späteres Umlegen bei Größenänderung wäre unruhig.
  const [direction] = useState<LayoutDirection>(() =>
    typeof window === 'undefined' ? 'LR' : directionFor(window.innerWidth, window.innerHeight - 120),
  );

  const buildNodes = useCallback((): TopicNode[] => {
    const pos = layoutGraph(graph, direction);
    return graph.nodes.map((n) => {
      const size = nodeSize(n);
      return {
        id: n.id,
        type: 'topic',
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        data: { label: n.label, color: colorOf(n.group), active: false, direction, ...size },
      };
    });
  }, [graph, colorOf, direction]);

  // Dagre nur einmal für den Startstand rechnen, nicht bei jedem Render.
  const [initialNodes] = useState(buildNodes);
  const [nodes, setNodes, onNodesChange] = useNodesState<TopicNode>(initialNodes);

  // Neuer Graph von außen (Claude, Zurücksetzen, Versionswechsel) → Kacheln neu aufbauen.
  const firstBuild = useRef(true);
  useEffect(() => {
    if (firstBuild.current) {
      firstBuild.current = false;
      return;
    }
    setNodes(buildNodes());
  }, [buildNodes, setNodes]);

  const shownNodes = useMemo(
    () => nodes.map((n) => (n.data.active === (n.id === selectedId) ? n : { ...n, data: { ...n.data, active: n.id === selectedId } })),
    [nodes, selectedId],
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      validEdges(graph).map((e, i) => ({
        id: `${e.from}->${e.to}#${i}`,
        source: e.from,
        target: e.to,
        label: e.label,
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: selectedId && (e.from === selectedId || e.to === selectedId) ? 'graph-edge--active' : undefined,
      })),
    [graph, selectedId],
  );

  // ---- Speichern der Positionen (verzögert, beim Schließen sofort) --------
  // Gespeichert wird auf den frisch gelesenen Graphen (Claude kann ihn inzwischen
  // erweitert haben), und nie in eine inzwischen eingefrorene Version.
  // Speichern läuft als Kette, damit ein späteres Zurücksetzen nie von einem früher
  // gestarteten Positions-Speichern überholt wird (jedes Speichern liest erst, schreibt dann).
  const chain = useRef<Promise<void>>(Promise.resolve());
  const saveGraph = useCallback(
    (apply: (g: NoteGraph) => NoteGraph) => {
      const run = async () => {
        const fresh = await getNoteGraphState(noteId);
        if (fresh.superseded_at || !fresh.graph) return;
        await updateNote(noteId, { graph: apply(fresh.graph) });
      };
      chain.current = chain.current.catch(() => {}).then(run);
      return chain.current;
    },
    [noteId],
  );
  const pending = useRef<Map<string, { x: number; y: number }> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const pos = pending.current;
    pending.current = null;
    if (pos) void saveGraph((g) => withPositions(g, pos)).catch(() => {});
  }, [saveGraph]);
  useEffect(() => flush, [flush]);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: TopicNode, dragged: TopicNode[]) => {
      if (readOnly) return;
      // Alle Kacheln speichern, nicht nur die gezogene: sonst würde das Auto-Layout
      // die übrigen beim nächsten Öffnen anders legen, als sie gerade stehen.
      const current = flow.getNodes() as TopicNode[];
      const pos = new Map(current.map((n) => [n.id, n.position]));
      for (const d of dragged) pos.set(d.id, d.position);
      onGraphChange(withPositions(graph, pos));
      pending.current = pos;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    [readOnly, flow, graph, onGraphChange, flush],
  );

  const resetLayout = () => {
    clearTimeout(timer.current);
    pending.current = null;
    onGraphChange(clearPositions(graph));
    void saveGraph(clearPositions).catch(() => {});
    requestAnimationFrame(() => void flow.fitView({ padding: 0.08, minZoom: FIT_MIN_ZOOM, maxZoom: 1.2, duration: 250 }));
  };

  const selected = selectedId ? graph.nodes.find((n) => n.id === selectedId) : undefined;
  const links = useMemo(() => (selectedId ? neighbours(graph, selectedId) : []), [graph, selectedId]);

  const focusNode = (id: string) => {
    setSelectedId(id);
    const n = flow.getNode(id);
    if (n) {
      const w = n.measured?.width ?? 140;
      const h = n.measured?.height ?? 48;
      void flow.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(flow.getZoom(), 1), duration: 300 });
    }
  };

  const legend = groupOrder(graph);

  // Die Breite der Zeichenfläche entscheidet über die Minimap. Vom Tab-Wischen der
  // AppShell hält `data-noswipe` an der Ebene die Gesten fern: React-Touch-Ereignisse
  // blubbern trotz Portal bis dorthin.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setCanvasWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="graph-view">
      <div className="graph-view__main">
        <div className="graph-view__canvas" ref={canvasRef}>
          <ReactFlow<TopicNode, FlowEdge>
            nodes={shownNodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={!readOnly}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable
            colorMode={theme === 'dark' ? 'dark' : 'light'}
            fitView
            fitViewOptions={{ padding: 0.08, minZoom: FIT_MIN_ZOOM, maxZoom: 1.2 }}
            minZoom={0.25}
            maxZoom={2.5}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            {canvasWidth >= MINIMAP_MIN_WIDTH && (
              <MiniMap
                pannable
                zoomable
                position="top-right"
                nodeColor={(n) => (n.data as TopicData).color}
                nodeBorderRadius={6}
                style={{ width: 160, height: 104 }}
                className="graph-view__minimap"
              />
            )}
          </ReactFlow>
        </div>
        {selected && (
          <aside className="graph-panel" aria-label={`Knoten ${selected.label}`}>
            <div className="graph-panel__head">
              <span className="graph-panel__swatch" style={{ background: colorOf(selected.group) }} />
              <h3 className="graph-panel__title">{selected.label}</h3>
              <button type="button" className="icon-btn icon-btn--sm" title="Schließen" onClick={() => setSelectedId(null)}>
                <X size={16} />
              </button>
            </div>
            {selected.group && (
              <div className="graph-panel__group text-muted">{graph.groups?.[selected.group] ?? selected.group}</div>
            )}
            {selected.note ? (
              <Markdown className="graph-panel__note">{selected.note}</Markdown>
            ) : (
              <p className="text-muted graph-panel__note">Keine Notiz zu diesem Knoten.</p>
            )}
            {links.length > 0 && (
              <div className="stack gap-xs">
                <div className="section-title" style={{ margin: 0 }}>Verbunden</div>
                <ul className="graph-panel__links">
                  {links.map((l, i) => (
                    <li key={`${l.node.id}-${i}`}>
                      <button type="button" className="graph-panel__link" onClick={() => focusNode(l.node.id)}>
                        {l.direction === 'out' ? <ArrowRight size={14} /> : <ArrowLeft size={14} />}
                        <span className="graph-panel__swatch graph-panel__swatch--sm" style={{ background: colorOf(l.node.group) }} />
                        <span className="graph-panel__link-label">{l.node.label}</span>
                        {l.label && <span className="graph-panel__rel text-muted">{l.label}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>
      <div className="graph-view__foot">
        {legend.length > 0 && (
          <ul className="graph-legend" aria-label="Legende">
            {legend.map((g) => (
              <li key={g} className="graph-legend__item">
                <span className="graph-panel__swatch graph-panel__swatch--sm" style={{ background: colorOf(g) }} />
                {graph.groups?.[g] ?? g}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && hasAnyPosition(graph) && (
          <Button variant="ghost" size="sm" onClick={resetLayout} style={{ marginLeft: 'auto' }}>
            <RotateCcw size={14} /> Layout zurücksetzen
          </Button>
        )}
      </div>
    </div>
  );
}
