/**
 * Minimal OTLP/HTTP JSON parsing helpers — just enough of the spec to read what Claude
 * Code's exporter sends (attributes, scalar values, nanosecond timestamps). Not a general
 * OTLP client: no protobuf, no traces, no array/kvlist attribute values (Claude Code's own
 * metrics/events don't use those). Field names and exact shapes are unverified against a
 * real Claude Code export (built from the published OTel semantic conventions) — the
 * `attributes` JSON blob captured alongside every row is the fallback if a mapping below
 * turns out wrong once we test against real traffic.
 */

export interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

export interface OtlpAttribute {
  key: string;
  value?: OtlpAttributeValue;
}

export type AttributeRecord = Record<string, string | number | boolean | null>;

function attrValue(v: OtlpAttributeValue | undefined): string | number | boolean | null {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return typeof v.intValue === 'string' ? Number(v.intValue) : v.intValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return null;
}

export function attrsToRecord(attrs: OtlpAttribute[] | undefined): AttributeRecord {
  const out: AttributeRecord = {};
  for (const a of attrs ?? []) out[a.key] = attrValue(a.value);
  return out;
}

/** OTLP timestamps are nanoseconds since epoch, sent as a string (too large for a JS number). */
export function nanoToDate(nanos: string | number | undefined): Date {
  if (nanos === undefined || nanos === null || nanos === '') return new Date();
  const n = typeof nanos === 'string' ? BigInt(nanos) : BigInt(Math.round(nanos));
  return new Date(Number(n / 1_000_000n));
}

export function stringAttr(attrs: AttributeRecord, key: string): string | null {
  const v = attrs[key];
  return typeof v === 'string' ? v : null;
}
