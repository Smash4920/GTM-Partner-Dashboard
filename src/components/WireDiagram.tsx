import {
  CONNECTION_EDGES,
  CONNECTION_NODES,
  CONNECTION_STATUS_META,
  CONNECTION_TIER_META,
  type ConnectionNode,
} from '../data/connections';
import type { TeamUser } from '../data/types';

/**
 * The wire diagram: every system that has to be connected, drawn as boxes and
 * wires.
 *
 * The boxes and the wires come from the same catalog (data/connections.ts) so
 * they cannot disagree about where a node sits — each node carries its own
 * rectangle, and each wire's path is derived from the two rectangles it joins.
 * Wires are SVG, boxes are HTML: the nodes need real text, focus, and clicks
 * (a user can be picked inside the notification node), and SVG text would
 * fight all three.
 *
 * Color carries state only, per the brand rules: signal for a required
 * connection, metric for one already flowing, graphite for planned.
 */

interface WireDiagramProps {
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** Roster entries this session would route simulated notifications to. */
  users: TeamUser[];
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
  /** Alerts waiting on each user, shown as a count on their chip. */
  alertCountByUserId: Record<string, number>;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Joins two rectangles with a curve, and points at where the label belongs. */
function wireGeometry(from: Rect, to: Rect): { d: string; labelX: number; labelY: number } {
  // Side by side: leave the right edge, enter the left edge.
  if (to.x >= from.x + from.w) {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const midX = (x1 + x2) / 2;
    return {
      d: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
      labelX: midX,
      labelY: (y1 + y2) / 2,
    };
  }
  // Stacked: leave the bottom, enter the top (or the reverse when the target
  // sits above the source).
  const downward = to.y >= from.y;
  const x1 = from.x + from.w / 2;
  const y1 = downward ? from.y + from.h : from.y;
  const x2 = to.x + to.w / 2;
  const y2 = downward ? to.y : to.y + to.h;
  const midY = (y1 + y2) / 2;
  return {
    d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
    labelX: (x1 + x2) / 2,
    labelY: midY,
  };
}

const CANVAS_PADDING = 8;

function nodeById(id: string): ConnectionNode | undefined {
  return CONNECTION_NODES.find((node) => node.id === id);
}

export default function WireDiagram({
  selectedNodeId,
  onSelectNode,
  users,
  selectedUserId,
  onSelectUser,
  alertCountByUserId,
}: WireDiagramProps) {
  const canvasWidth = Math.max(...CONNECTION_NODES.map((node) => node.x + node.w)) + CANVAS_PADDING;
  const canvasHeight =
    Math.max(...CONNECTION_NODES.map((node) => node.y + node.h)) + CANVAS_PADDING;

  return (
    <div className="space-y-3">
      <Legend />
      <div className="overflow-x-auto">
        <div
          className="relative"
          style={{ width: canvasWidth, height: canvasHeight }}
          role="group"
          aria-label="Data connection map"
        >
          <svg
            className="absolute inset-0"
            width={canvasWidth}
            height={canvasHeight}
            aria-hidden="true"
          >
            <defs>
              {(['live', 'required', 'planned'] as const).map((status) => (
                <marker
                  key={status}
                  id={`arrow-${status}`}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill={CONNECTION_STATUS_META[status].color} />
                </marker>
              ))}
            </defs>
            {CONNECTION_EDGES.map((edge) => {
              const from = nodeById(edge.from);
              const to = nodeById(edge.to);
              if (!from || !to) return null;
              const { d } = wireGeometry(from, to);
              const meta = CONNECTION_STATUS_META[edge.status];
              return (
                <path
                  key={edge.id}
                  d={d}
                  fill="none"
                  stroke={meta.color}
                  strokeWidth={edge.status === 'planned' ? 1 : 1.5}
                  strokeDasharray={edge.status === 'planned' ? '4 4' : undefined}
                  markerEnd={`url(#arrow-${edge.status})`}
                  opacity={edge.status === 'planned' ? 0.7 : 1}
                />
              );
            })}
          </svg>

          {(['source', 'platform', 'destination'] as const).map((tier) => {
            const meta = CONNECTION_TIER_META[tier];
            return (
              <div key={tier} className="absolute" style={{ left: meta.x, width: meta.w, top: 0 }}>
                <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone">
                  {meta.label}
                </p>
                <p className="text-[10px] text-granite">{meta.caption}</p>
              </div>
            );
          })}

          {CONNECTION_EDGES.map((edge) => {
            // Label only the selected node's wires. Every label at once turns
            // the map into a pile of text over the boxes; the detail panel
            // lists all of a box's wires anyway, so this stays legible.
            const touchesSelection =
              selectedNodeId !== null &&
              (edge.from === selectedNodeId || edge.to === selectedNodeId);
            if (!touchesSelection) return null;
            const from = nodeById(edge.from);
            const to = nodeById(edge.to);
            if (!from || !to) return null;
            const { labelX, labelY } = wireGeometry(from, to);
            const meta = CONNECTION_STATUS_META[edge.status];
            return (
              <span
                key={edge.id}
                title={edge.detail}
                className={`pointer-events-auto absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border border-carbon bg-canvas px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.04em] ${meta.textClass}`}
                style={{ left: labelX, top: labelY }}
              >
                {edge.label}
              </span>
            );
          })}

          {CONNECTION_NODES.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              selected={selectedNodeId === node.id}
              onSelect={() => onSelectNode(node.id)}
              users={node.hostsTeam ? users : undefined}
              selectedUserId={selectedUserId}
              onSelectUser={onSelectUser}
              alertCountByUserId={alertCountByUserId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {(['required', 'live', 'planned'] as const).map((status) => {
        const meta = CONNECTION_STATUS_META[status];
        return (
          <span key={status} className="flex items-center gap-2">
            <span className="h-px w-6" style={{ backgroundColor: meta.color }} />
            <span className={`font-mono text-[10px] uppercase tracking-[0.06em] ${meta.textClass}`}>
              {meta.label}
            </span>
            <span className="text-xs text-granite">{meta.description}</span>
          </span>
        );
      })}
    </div>
  );
}

interface NodeCardProps {
  node: ConnectionNode;
  selected: boolean;
  onSelect: () => void;
  /** Present only on the node that hosts the roster. */
  users?: TeamUser[];
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
  alertCountByUserId: Record<string, number>;
}

function NodeCard({
  node,
  selected,
  onSelect,
  users,
  selectedUserId,
  onSelectUser,
  alertCountByUserId,
}: NodeCardProps) {
  const meta = CONNECTION_STATUS_META[node.status];
  return (
    <div className="absolute" style={{ left: node.x, top: node.y, width: node.w, height: node.h }}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`h-full w-full rounded border px-3 py-2 text-left transition-colors duration-150 ${
          selected ? 'border-bone bg-carbon' : 'border-ash/50 bg-carbon/40 hover:border-ash'
        }`}
      >
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotClass}`} />
          <span className="truncate font-mono text-[11px] uppercase tracking-[0.06em] text-bone">
            {node.label}
          </span>
          <span className={`ml-auto shrink-0 font-mono text-[9px] uppercase ${meta.textClass}`}>
            {meta.label}
          </span>
        </span>
        <span className="mt-1 line-clamp-2 block text-[10px] leading-snug text-granite">
          {node.summary}
        </span>
      </button>

      {users && (
        <div className="absolute inset-x-3 bottom-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-granite">
            Partner team · pick one to notify
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {users.length === 0 && <span className="text-[10px] text-granite">No roster yet.</span>}
            {users.map((user) => {
              const alerts = alertCountByUserId[user.id] ?? 0;
              const selectedUser = user.id === selectedUserId;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => onSelectUser(user.id)}
                  title={`${user.name} · ${user.email}${alerts ? ` · ${alerts} SLA alerts` : ''}`}
                  aria-pressed={selectedUser}
                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                    selectedUser
                      ? 'border-bone bg-ash/40 text-bone'
                      : 'border-ash/50 text-stone hover:border-ash'
                  }`}
                >
                  {user.name.split(' ')[0]}
                  {alerts > 0 && <span className="text-signal">{alerts}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
