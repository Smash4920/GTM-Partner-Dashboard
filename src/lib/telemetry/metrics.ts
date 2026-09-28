/**
 * In-process metrics: counters and durations, aggregated per name+attributes.
 *
 * Metrics are recorded unconditionally (they are what the health check and the
 * error-rate alert read), and drained as deltas when the transport flushes, so
 * a collector receives increments rather than ever-growing totals. Names are
 * dotted, lowercase, and namespaced by what emits them (`provider.call`,
 * `telemetry.delivery`); attributes are small string keys that keep totals
 * meaningful — `method`, `status`, `providerId` — never row data.
 */

export interface MetricAttributes {
  [attribute: string]: string | number | boolean;
}

/** Key for one aggregate: the metric name plus sorted attribute pairs. */
function attributeKey(attributes?: MetricAttributes): string {
  if (!attributes) return '';
  return Object.keys(attributes)
    .filter((key) => attributes[key] !== undefined)
    .sort()
    .map((key) => `${key}=${String(attributes[key])}`)
    .join(',');
}

export interface CounterDelta {
  name: string;
  attributes: MetricAttributes;
  delta: number;
}

export interface DurationDelta {
  name: string;
  attributes: MetricAttributes;
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

export interface DurationSnapshot {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

interface CounterCell {
  value: number;
  baseline: number;
}

interface DurationCell {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  // Drained-from values, so deltas survive snapshots taken in between.
  baselineCount: number;
  baselineTotalMs: number;
  // Bounds for the current drain window, reset at each drain: a delta that
  // says "3 calls, 210ms total" should bound those 3 calls, not the session.
  windowMinMs: number;
  windowMaxMs: number;
}

/**
 * A registry is plain state: record from anywhere, snapshot or drain deltas
 * from anywhere. The telemetry facade owns the app-wide instance so shipping
 * is in one place; tests build isolated ones.
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, CounterCell>();
  private readonly durations = new Map<string, DurationCell>();

  /** Counts an occurrence. The name should say what happened, not how many. */
  increment(name: string, attributes?: MetricAttributes): void {
    const cell = this.counterCell(name, attributes);
    cell.value += 1;
  }

  /** Records a duration in milliseconds, keeping count/total/min/max per key. */
  recordDuration(name: string, durationMs: number, attributes?: MetricAttributes): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const key = attributeKey(attributes);
    const mapKey = `${name}|${key}`;
    const cell = this.durations.get(mapKey) ?? {
      count: 0,
      totalMs: 0,
      minMs: Number.POSITIVE_INFINITY,
      maxMs: 0,
      baselineCount: 0,
      baselineTotalMs: 0,
      windowMinMs: Number.POSITIVE_INFINITY,
      windowMaxMs: 0,
    };
    cell.count += 1;
    cell.totalMs += durationMs;
    cell.minMs = Math.min(cell.minMs, durationMs);
    cell.maxMs = Math.max(cell.maxMs, durationMs);
    cell.windowMinMs = Math.min(cell.windowMinMs, durationMs);
    cell.windowMaxMs = Math.max(cell.windowMaxMs, durationMs);
    this.durations.set(mapKey, cell);
  }

  /** Total count for one counter, summed across attribute sets. */
  counterTotal(name: string): number {
    let total = 0;
    for (const [mapKey, cell] of this.counters) {
      if (splitMapKey(mapKey)[0] === name) total += cell.value;
    }
    return total;
  }

  /** Duration stats for one metric name, summed across attribute sets. */
  durationSnapshot(name: string): DurationSnapshot | null {
    let snapshot: DurationSnapshot | null = null;
    for (const [mapKey, cell] of this.durations) {
      if (splitMapKey(mapKey)[0] !== name) continue;
      snapshot = snapshot
        ? {
            count: snapshot.count + cell.count,
            totalMs: snapshot.totalMs + cell.totalMs,
            minMs: Math.min(snapshot.minMs, cell.minMs),
            maxMs: Math.max(snapshot.maxMs, cell.maxMs),
          }
        : { count: cell.count, totalMs: cell.totalMs, minMs: cell.minMs, maxMs: cell.maxMs };
    }
    return snapshot;
  }

  /**
   * Counter increments since the previous drain — what a flush cycle ships.
   * Cells whose delta is zero are omitted so an idle interval sends nothing.
   */
  drainCounterDeltas(): CounterDelta[] {
    const deltas: CounterDelta[] = [];
    for (const [mapKey, cell] of this.counters) {
      const delta = cell.value - cell.baseline;
      if (delta <= 0) continue;
      cell.baseline = cell.value;
      const [name, key] = splitMapKey(mapKey);
      deltas.push({ name, attributes: parseAttributeKey(key), delta });
    }
    return deltas;
  }

  /** Duration deltas since the previous drain, with count/total and bounds. */
  drainDurationDeltas(): DurationDelta[] {
    const deltas: DurationDelta[] = [];
    for (const [mapKey, cell] of this.durations) {
      const count = cell.count - cell.baselineCount;
      if (count <= 0) continue;
      const totalMs = cell.totalMs - cell.baselineTotalMs;
      cell.baselineCount = cell.count;
      cell.baselineTotalMs = cell.totalMs;
      const [name, key] = splitMapKey(mapKey);
      deltas.push({
        name,
        attributes: parseAttributeKey(key),
        count,
        totalMs,
        minMs: cell.windowMinMs,
        maxMs: cell.windowMaxMs,
      });
      cell.windowMinMs = Number.POSITIVE_INFINITY;
      cell.windowMaxMs = 0;
    }
    return deltas;
  }

  private counterCell(name: string, attributes?: MetricAttributes): CounterCell {
    const mapKey = `${name}|${attributeKey(attributes)}`;
    const existing = this.counters.get(mapKey);
    if (existing) return existing;
    const cell: CounterCell = { value: 0, baseline: 0 };
    this.counters.set(mapKey, cell);
    return cell;
  }
}

function splitMapKey(mapKey: string): [name: string, attributeString: string] {
  const separator = mapKey.indexOf('|');
  return [mapKey.slice(0, separator), mapKey.slice(separator + 1)];
}

/**
 * Rebuilds the attribute object from its serialized key. Attribute values are
 * strings/numbers/booleans; `key=value` pairs joined by commas round-trip
 * losslessly because keys are short identifiers without commas or equals.
 */
function parseAttributeKey(attributeString: string): MetricAttributes {
  if (attributeString === '') return {};
  const attributes: MetricAttributes = {};
  for (const pair of attributeString.split(',')) {
    const equals = pair.indexOf('=');
    if (equals === -1) continue;
    attributes[pair.slice(0, equals)] = pair.slice(equals + 1);
  }
  return attributes;
}
