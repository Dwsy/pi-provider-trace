# 追踪指标目录（本地 Web UI / JSONL）

## 观测级
性能: latencyMs, timeToFirstTokenMs, streamingLatencyMs, tokensPerSecond, outputTokensPerSecond
用量: inputTokens, outputTokens, totalTokens
成本: inputCost, outputCost, totalCost
缓存: cacheReadTokens, cacheWriteTokens, cacheHitRate
计数: observation.count

## 追踪级
聚合 latency/tokens/cost; generationCount, observationCount, spanCount, eventCount
日志: errorCount, warningCount, defaultCount, debugCount
评分: scores.countScores, scoresAvg, scoreCategories, scoresNumericCount, scoresCategoricalCount

## 厂商
anthropic, openai, azure, bedrock, google-vertex-ai, google-ai-studio — provider-detect.ts

## API
GET /api/metrics?session= → trace, observation, generations[], scores[]
