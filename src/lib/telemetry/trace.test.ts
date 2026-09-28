import { afterEach, describe, expect, it } from 'vitest';
import {
  formatTraceparent,
  newTraceIds,
  parseTraceparent,
  readIncomingTraceContext,
  startSpan,
} from './trace';

const SAMPLE_TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SAMPLE_SPAN_ID = 'b7ad6b7169203331';

describe('parseTraceparent', () => {
  it('parses a well-formed traceparent header', () => {
    expect(parseTraceparent(`00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-01`)).toEqual({
      version: '00',
      traceId: SAMPLE_TRACE_ID,
      parentSpanId: SAMPLE_SPAN_ID,
      traceFlags: '01',
    });
  });

  it('rejects the reserved version, malformed hex, and wrong widths', () => {
    for (const bad of [
      `ff-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-01`, // reserved version
      `zz-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-01`, // version not hex
      `00-${SAMPLE_TRACE_ID}-01`, // missing field
      `00-0af7651916cd43dd8448eb211c80319-${SAMPLE_SPAN_ID}-01`, // short trace id
      `00-${SAMPLE_TRACE_ID}-b7ad6b71692033-01`, // short span id
      `00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-0x`, // flags not hex
      `00-00000000000000000000000000000000-${SAMPLE_SPAN_ID}-01`, // all-zero trace id
      `00-${SAMPLE_TRACE_ID}-0000000000000000-01`, // all-zero span id
      `  `,
      null,
      undefined,
    ]) {
      expect(parseTraceparent(bad)).toBeNull();
    }
  });

  it('round-trips through formatTraceparent', () => {
    const context = parseTraceparent(`00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-00`);
    expect(context && formatTraceparent(context)).toBe(
      `00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-00`,
    );
  });
});

describe('startSpan', () => {
  it('starts a root span with a fresh trace and its own span id', () => {
    const span = startSpan('session');

    expect(span.name).toBe('session');
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parseTraceparent(span.traceparent)?.traceId).toBe(span.traceId);
    expect(parseTraceparent(span.traceparent)?.parentSpanId).not.toBe('');
  });

  it('nests a child span under the parent traceparent it is given', () => {
    const parent = startSpan('provider.getForecastSummary');
    const child = startSpan('provider.listQuarterOpportunities', {
      parentTraceparent: parent.traceparent,
    });

    const parsed = parseTraceparent(child.traceparent);
    expect(parsed?.traceId).toBe(parent.traceId);
    const data = child.end();
    expect(data.parentSpanId).toBe(parseTraceparent(parent.traceparent)?.parentSpanId);
  });

  it('ends once: duration, status, and attributes freeze at the first end', () => {
    let clock = 1_000;
    const span = startSpan('provider.listPartners', {
      now: () => clock,
      attributes: { providerId: 'local' },
    });
    span.setAttribute('attempt', 2);

    clock = 1_250;
    const ended = span.end('ok');
    clock = 9_999;
    const endedAgain = span.end('error');

    expect(ended).toBe(endedAgain);
    expect(ended.status).toBe('ok');
    expect(ended.durationMs).toBe(250);
    expect(ended.attributes).toEqual({ providerId: 'local', attempt: 2 });
    expect(ended.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('never reports a negative duration when the clock goes backwards', () => {
    let clock = 5_000;
    const span = startSpan('clock.skew', { now: () => clock });
    clock = 4_990;

    expect(span.end().durationMs).toBe(0);
  });
});

describe('readIncomingTraceContext', () => {
  afterEach(() => {
    document.querySelector('meta[name="traceparent"]')?.remove();
    window.history.pushState({}, '', '/');
  });

  it('continues the trace carried in the page URL', () => {
    window.history.pushState({}, '', `/?traceparent=00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-01`);

    expect(readIncomingTraceContext()).toEqual({
      version: '00',
      traceId: SAMPLE_TRACE_ID,
      parentSpanId: SAMPLE_SPAN_ID,
      traceFlags: '01',
    });
  });

  it('continues the trace a deployment writes into a meta tag', () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'traceparent');
    meta.setAttribute('content', `00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-01`);
    document.head.appendChild(meta);

    expect(readIncomingTraceContext()?.traceId).toBe(SAMPLE_TRACE_ID);
  });

  it('returns null when no trace was served with the page', () => {
    expect(readIncomingTraceContext()).toBeNull();
  });
});

describe('newTraceIds', () => {
  it('mints distinct, correctly sized ids', () => {
    const first = newTraceIds();
    const second = newTraceIds();

    expect(first.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(first.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(first.traceId).not.toBe(second.traceId);
  });
});
