import { describe, expect, it } from 'vitest';
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
