import { describe, expect, it } from 'vitest';
import { ORIGINAL_CONNECTION_EDGES, ORIGINAL_CONNECTION_NODES } from './__fixtures__/connections';
import {
  CONNECTION_EDGES,
  CONNECTION_METHOD_COVERAGE,
  CONNECTION_NODES,
  CONNECTION_STATUS_META,
  CONNECTION_TIER_META,
} from './connections';

/**
 * The map is documentation, so these checks guard the claims it makes: every
 * wire joins two real boxes, every DataProvider method appears somewhere on the
 * map, and no two boxes are drawn on top of each other.
 */
describe('connection catalog', () => {
  it('preserves every original node and edge record in catalog order', () => {
    expect(CONNECTION_NODES).toStrictEqual(ORIGINAL_CONNECTION_NODES);
    expect(CONNECTION_EDGES).toStrictEqual(ORIGINAL_CONNECTION_EDGES);
    expect(CONNECTION_NODES.map((node) => node.id)).toEqual(
      ORIGINAL_CONNECTION_NODES.map((node) => node.id),
    );
    expect(CONNECTION_EDGES.map((edge) => edge.id)).toEqual(
      ORIGINAL_CONNECTION_EDGES.map((edge) => edge.id),
    );
  });

  it('preserves optional-property presence without materializing absent fields', () => {
    const optionalProperties = ['source', 'auth', 'cadence', 'blocker', 'owner', 'hostsTeam'];
    for (const [index, original] of ORIGINAL_CONNECTION_NODES.entries()) {
      const node = CONNECTION_NODES[index];
      expect(Object.keys(node).sort()).toEqual(Object.keys(original).sort());
      for (const property of optionalProperties) {
        expect(Object.hasOwn(node, property)).toBe(Object.hasOwn(original, property));
      }
    }
    for (const [index, original] of ORIGINAL_CONNECTION_EDGES.entries()) {
      expect(Object.keys(CONNECTION_EDGES[index]).sort()).toEqual(Object.keys(original).sort());
    }
  });

  it('preserves the original column geometry and tier ordering', () => {
    expect(CONNECTION_NODES.map(({ tier, x, y, w, h }) => ({ tier, x, y, w, h }))).toStrictEqual(
      ORIGINAL_CONNECTION_NODES.map(({ tier, x, y, w, h }) => ({ tier, x, y, w, h })),
    );
    for (const node of CONNECTION_NODES) {
      expect({ x: node.x, w: node.w }).toStrictEqual({
        x: CONNECTION_TIER_META[node.tier].x,
        w: CONNECTION_TIER_META[node.tier].w,
      });
    }
  });

  it('draws each node once, inside the diagram', () => {
    expect(new Set(CONNECTION_NODES.map((node) => node.id)).size).toBe(CONNECTION_NODES.length);
    for (const node of CONNECTION_NODES) {
      expect(CONNECTION_STATUS_META[node.status]).toBeDefined();
      expect(node.label.length).toBeGreaterThan(0);
      expect(node.supplies.length).toBeGreaterThan(0);
      expect(node.w).toBeGreaterThan(0);
      expect(node.h).toBeGreaterThan(0);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('joins two existing nodes on every wire, each wire once', () => {
    const ids = new Set(CONNECTION_NODES.map((node) => node.id));
    expect(new Set(CONNECTION_EDGES.map((edge) => edge.id)).size).toBe(CONNECTION_EDGES.length);
    for (const edge of CONNECTION_EDGES) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
      expect(edge.from).not.toBe(edge.to);
      expect(edge.label.length).toBeGreaterThan(0);
      expect(CONNECTION_STATUS_META[edge.status]).toBeDefined();
    }
  });

  it('marks only in-process mock/provider behavior active (VAL-GOV-004)', () => {
    // Live means "flowing in this demo", which only the in-process canonical
    // model and the dashboard platform can truthfully claim.
    expect(
      CONNECTION_NODES.filter((node) => node.status === 'live').map((node) => node.id),
    ).toEqual(['canonical', 'api']);

    // Identity, server row enforcement, source freshness/ingestion, the
    // warehouse, durable writes, and external delivery are never live.
    const neverLive = ['idp', 'notifications', 'writeback', 'ingest', 'warehouse', 'salesforce'];
    for (const id of neverLive) {
      const node = CONNECTION_NODES.find((candidate) => candidate.id === id);
      expect(node?.status).not.toBe('live');
    }

    // Blocked nodes name the missing production dependency instead of
    // overstating authorization, freshness, or delivery.
    for (const id of ['idp', 'notifications']) {
      const node = CONNECTION_NODES.find((candidate) => candidate.id === id);
      expect(node?.blocker).toMatch(/^Not connected:/);
    }
    const notifications = CONNECTION_NODES.find((node) => node.id === 'notifications');
    expect(notifications?.blocker).toMatch(/simulated, local-only session records/);
    expect(notifications?.blocker).toMatch(/never delivered/);
    const idp = CONNECTION_NODES.find((node) => node.id === 'idp');
    expect(idp?.blocker).toMatch(/current-session notification-routing simulation/);
    expect(idp?.blocker).toMatch(/never provision, authorize, revoke, or restore/);

    // The live legend cannot read as production connectivity.
    expect(CONNECTION_STATUS_META.live.description).toMatch(/in-process mock\/provider behavior/);
    expect(CONNECTION_STATUS_META.live.description).toMatch(/no external system is connected/i);

    // No node or wire copy claims row-level authorization happens client-side.
    for (const node of CONNECTION_NODES) {
      expect(node.summary).not.toMatch(/row-authorized/i);
    }
  });

  it('covers every DataProvider method with a wire or a box', () => {
    // The contract in DataProvider.ts is the seam; if a method is added there
    // and not here, the map is quietly incomplete.
    const mapped = new Set(
      CONNECTION_NODES.flatMap((node) => node.methods).filter((method) =>
        CONNECTION_METHOD_COVERAGE.includes(method),
      ),
    );
    for (const method of CONNECTION_METHOD_COVERAGE) {
      expect(mapped.has(method)).toBe(true);
    }
    expect(mapped.size).toBe(CONNECTION_METHOD_COVERAGE.length);
  });

  it('serves bounded scoped Action Center results with truthful method coverage (VAL-ACT-011)', () => {
    const api = CONNECTION_NODES.find((node) => node.id === 'api');
    for (const method of ['getActionCenterSummary', 'listActionItems']) {
      expect(CONNECTION_METHOD_COVERAGE).toContain(`${method}()`);
      expect(api?.methods).toContain(`${method}()`);
    }
    expect(api?.status).toBe('live');
    expect(api?.summary).toContain('computed in-process');
    expect(api?.supplies.join(' ')).toContain('session-only demo policy');
  });

  it('places each tier in its own column, with no overlapping boxes', () => {
    const columns = new Set(CONNECTION_NODES.map((node) => CONNECTION_TIER_META[node.tier].x));
    expect(columns.size).toBe(3);
    for (const node of CONNECTION_NODES) {
      expect(node.x).toBe(CONNECTION_TIER_META[node.tier].x);
      expect(node.w).toBe(CONNECTION_TIER_META[node.tier].w);
    }
    for (let a = 0; a < CONNECTION_NODES.length; a += 1) {
      for (let b = a + 1; b < CONNECTION_NODES.length; b += 1) {
        const first = CONNECTION_NODES[a];
        const second = CONNECTION_NODES[b];
        const overlaps =
          first.x < second.x + second.w &&
          second.x < first.x + first.w &&
          first.y < second.y + second.h &&
          second.y < first.y + first.h;
        expect(overlaps).toBe(false);
      }
    }
  });
});
