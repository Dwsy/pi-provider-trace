import type { ScoreEvent, ScoreAggregates } from "./types.js";

export function aggregateScores(scores: ScoreEvent[]): ScoreAggregates {
	const out: ScoreAggregates = {
		countScores: scores.length,
		scoresNumericCount: 0,
		scoresCategoricalCount: 0,
	};
	let sum = 0;
	let n = 0;
	const cats: Record<string, number> = {};
	for (const s of scores) {
		if (s.dataType === "NUMERIC" && typeof s.value === "number") {
			out.scoresNumericCount += 1;
			sum += s.value;
			n += 1;
		} else if (s.dataType === "CATEGORICAL" || typeof s.value === "string") {
			out.scoresCategoricalCount += 1;
			const k = String(s.value);
			cats[k] = (cats[k] ?? 0) + 1;
		}
	}
	if (n > 0) out.scoresAvg = sum / n;
	if (Object.keys(cats).length) out.scoreCategories = cats;
	return out;
}
