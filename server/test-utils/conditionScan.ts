/**
 * Test utilities for inspecting drizzle-orm SQL condition trees produced by
 * eq()/and()/inArray() etc., so tests can assert that tenant-isolation
 * filters are actually composed into the generated queries.
 */

export interface ColumnEqPair {
  column: string;
  value: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** drizzle Param chunks carry `value` + `encoder`; StringChunks only `value` (string[]). */
function isParamChunk(v: Record<string, unknown>): boolean {
  return "value" in v && "encoder" in v;
}

/** drizzle Column chunks carry a string `name` and a `table` reference. */
function isColumnChunk(v: Record<string, unknown>): boolean {
  return typeof v["name"] === "string" && "table" in v;
}

/**
 * Recursively collect (column, value) equality pairs from a drizzle SQL tree.
 * Pairs are reconstructed positionally: within each SQL chunk list a Param
 * is associated with the most recently seen Column (eq() emits
 * [Column, StringChunk, Param]).
 */
export function collectEqPairs(
  node: unknown,
  pairs: ColumnEqPair[] = [],
  visited: Set<object> = new Set(),
): ColumnEqPair[] {
  if (!isRecord(node)) return pairs;
  if (visited.has(node)) return pairs;
  visited.add(node);

  const chunks = node["queryChunks"];
  if (Array.isArray(chunks)) {
    let lastColumn: string | null = null;
    for (const chunk of chunks) {
      // inArray()/notInArray() emit an Array chunk of Params
      if (Array.isArray(chunk)) {
        if (lastColumn) {
          for (const el of chunk) {
            if (isRecord(el) && isParamChunk(el)) {
              pairs.push({ column: lastColumn, value: el["value"] });
            }
          }
        }
        lastColumn = null;
        continue;
      }
      if (isRecord(chunk)) {
        if (isColumnChunk(chunk)) {
          lastColumn = chunk["name"] as string;
        } else if (isParamChunk(chunk)) {
          if (lastColumn) pairs.push({ column: lastColumn, value: chunk["value"] });
          lastColumn = null;
        } else if (Array.isArray(chunk["queryChunks"])) {
          collectEqPairs(chunk, pairs, visited);
          lastColumn = null;
        }
      }
    }
    return pairs;
  }

  for (const [key, value] of Object.entries(node)) {
    // Never walk back into table/column definitions — cycles and noise.
    if (key === "table" || key === "encoder" || key === "decoder") continue;
    if (Array.isArray(value)) {
      for (const el of value) collectEqPairs(el, pairs, visited);
    } else if (isRecord(value) && Array.isArray(value["queryChunks"])) {
      collectEqPairs(value, pairs, visited);
    }
  }
  return pairs;
}

/** True when the condition tree contains `eq(<column>, <value>)`. */
export function hasEqCondition(cond: unknown, column: string, value: unknown): boolean {
  return collectEqPairs(cond).some(p => p.column === column && p.value === value);
}

/** True when the condition tree references the given column at all. */
export function hasColumnCondition(cond: unknown, column: string): boolean {
  return collectEqPairs(cond).some(p => p.column === column);
}
