import { useState, type ReactNode } from 'react';
import Card from '../components/Card';
import KpiTile from '../components/KpiTile';
import WireDiagram from '../components/WireDiagram';
import {
  CONNECTION_EDGES,
  CONNECTION_METHOD_COVERAGE,
  CONNECTION_NODES,
  CONNECTION_STATUS_META,
  type ConnectionEdge,
  type ConnectionNode,
} from '../data/connections';

/**
 * Data Connections: the systems the dashboard has to be wired to, what each
 * one supplies, and what is still missing.
 *
 * The route is static: the map, the coverage counts, and the detail panel
 * all come from the connection catalog and render without loading business
 * facts, so they survive total provider failure. The partner team's roster
 * and the notification rule that used to hang off the map live on Settings.
 */
export default function DataConnectionsView() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('notifications');

  const selectedNode = CONNECTION_NODES.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdges = selectedNode
    ? CONNECTION_EDGES.filter(
        (edge) => edge.from === selectedNode.id || edge.to === selectedNode.id,
      )
    : [];

  const methodsCovered = new Set(
    CONNECTION_NODES.flatMap((node) => node.methods).filter((method) =>
      CONNECTION_METHOD_COVERAGE.includes(method),
    ),
  );
  const required = CONNECTION_NODES.filter((node) => node.status === 'required').length;
  const live = CONNECTION_NODES.filter((node) => node.status === 'live').length;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
          Integration map
        </p>
        <h1 className="mt-2 text-3xl tracking-tight text-bone">Data Connections</h1>
        <p className="mt-1 max-w-3xl text-sm text-granite">
          Every system the dashboard has to be wired to, what each one supplies, and what is still
          missing — the plumbing behind the read-only DataProvider seam. Only in-process
          mock/provider behavior runs in this demo; identity, server row enforcement, source
          freshness, the warehouse, durable writes, and external delivery are unconnected. The
          partner team&apos;s roster and notification routing live on Settings.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          label="Connections required"
          value={`${required}`}
          sub={`of ${CONNECTION_NODES.length} systems mapped · ${live} live on mock data`}
        />
        <KpiTile
          label="Provider methods wired"
          value={`${methodsCovered.size}/${CONNECTION_METHOD_COVERAGE.length}`}
          sub="every DataProvider method has a wire"
        />
        <KpiTile
          label="Flows planned"
          value={`${CONNECTION_EDGES.length}`}
          sub={`${
            CONNECTION_EDGES.filter((edge) => edge.status === 'required').length
          } required to go live`}
        />
      </div>

      <Card
        title="Data connection map"
        subtitle="Boxes are systems, wires are data. Solid wires are live or required, dashed are planned. Click a box for what it supplies."
      >
        <div className="space-y-5">
          <WireDiagram selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />
          <div className="border-t border-carbon pt-5">
            <ConnectionDetail node={selectedNode} edges={selectedEdges} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function ConnectionDetail({
  node,
  edges,
}: {
  node: ConnectionNode | null;
  edges: ConnectionEdge[];
}) {
  if (!node) {
    return (
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone">
          Selected connection
        </p>
        <p className="mt-2 text-sm text-granite">
          Pick a box in the map to see what it supplies, how it authenticates, how fresh it is, and
          what is still missing before it can be connected.
        </p>
      </div>
    );
  }

  const meta = CONNECTION_STATUS_META[node.status];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone">
          Selected connection
        </p>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
          <span className={`font-mono text-[10px] uppercase tracking-[0.06em] ${meta.textClass}`}>
            {meta.label}
          </span>
        </span>
        {node.owner && (
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            {node.owner === 'architecture' ? 'Architecture roadmap' : 'Product roadmap'}
          </span>
        )}
      </div>
      <h3 className="mt-2 text-lg tracking-tight text-bone">{node.label}</h3>
      <p className="mt-1 max-w-xl text-sm text-stone">{node.summary}</p>

      <dl className="mt-4 space-y-3 text-sm">
        <DetailRow label="Supplies">
          <ul className="space-y-1">
            {node.supplies.map((item) => (
              <li key={item} className="flex gap-2 text-stone">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-graphite"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </DetailRow>
        {node.methods.length > 0 && (
          <DetailRow label="Provider methods">
            <span className="flex flex-wrap gap-1.5">
              {node.methods.map((method) => (
                <span
                  key={method}
                  className="rounded border border-ash/50 px-1.5 py-0.5 font-mono text-[10px] text-stone"
                >
                  {method}
                </span>
              ))}
            </span>
          </DetailRow>
        )}
        {node.source && <DetailRow label="Source">{node.source}</DetailRow>}
        {node.auth && <DetailRow label="Auth">{node.auth}</DetailRow>}
        {node.cadence && <DetailRow label="Cadence">{node.cadence}</DetailRow>}
      </dl>

      {node.blocker && (
        <div className="mt-4 rounded border border-signal/40 p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
            {node.status === 'live' ? 'Limit of the demo' : 'What is missing'}
          </p>
          <p className="mt-1 text-sm text-stone">{node.blocker}</p>
        </div>
      )}

      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
          Wires on this box
        </p>
        <ul className="mt-2 space-y-1.5">
          {edges.map((edge) => {
            const edgeMeta = CONNECTION_STATUS_META[edge.status];
            return (
              <li key={edge.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={`h-1.5 w-1.5 rounded-full ${edgeMeta.dotClass}`} />
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-stone">
                  {edge.label}
                </span>
                <span className="text-xs text-granite">{edge.detail}</span>
              </li>
            );
          })}
          {edges.length === 0 && <li className="text-xs text-granite">No wires mapped yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">{label}</dt>
      <dd className="mt-0.5 text-stone">{children}</dd>
    </div>
  );
}
