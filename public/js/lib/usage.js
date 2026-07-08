export function mergeUsage(a, b) {
  if (!b) return a;
  if (!a) return b;
  const input = Math.max(a.input || 0, b.input || 0);
  const output = Math.max(a.output || 0, b.output || 0);
  const cacheRead = Math.max(a.cacheRead || 0, b.cacheRead || 0);
  const cacheWrite = Math.max(a.cacheWrite || 0, b.cacheWrite || 0);
  const denom = input + cacheRead;
  return {
    input, output, cacheRead, cacheWrite,
    totalTokens: Math.max(a.totalTokens || 0, b.totalTokens || 0) || input + output + cacheRead + cacheWrite,
    costTotal: Math.max(a.costTotal || 0, b.costTotal || 0),
    costInput: Math.max(a.costInput || 0, b.costInput || 0),
    costOutput: Math.max(a.costOutput || 0, b.costOutput || 0),
    costCacheRead: Math.max(a.costCacheRead || 0, b.costCacheRead || 0),
    costCacheWrite: Math.max(a.costCacheWrite || 0, b.costCacheWrite || 0),
    cacheHitRate: denom > 0 ? cacheRead / denom : 0,
    source: b.source || a.source,
    provider: b.provider || a.provider,
    model: b.model || a.model,
  };
}

export function sumUsage(list) {
  const z = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0, costInput: 0, costOutput: 0, costCacheRead: 0, costCacheWrite: 0, cacheHitRate: 0 };
  for (const m of list) {
    z.input += m.input || 0; z.output += m.output || 0; z.cacheRead += m.cacheRead || 0; z.cacheWrite += m.cacheWrite || 0;
    z.totalTokens += m.totalTokens || 0; z.costTotal += m.costTotal || 0;
    z.costInput += m.costInput || 0; z.costOutput += m.costOutput || 0;
    z.costCacheRead += m.costCacheRead || 0; z.costCacheWrite += m.costCacheWrite || 0;
  }
  const denom = z.input + z.cacheRead;
  z.cacheHitRate = denom > 0 ? z.cacheRead / denom : 0;
  return z;
}
