// Churn risk per member (HANDOFF "Fitron AI"): 0–100 from days since the last visit,
// visits in the last 30 days against the 30 before, days to expiry and money owed.

export type RiskInput = {
  /** null when the member has never checked in */
  daysSinceVisit: number | null;
  visits30: number;
  visitsPrev30: number;
  /** negative once expired; null with no membership */
  daysToExpiry: number | null;
  /** paise */
  outstanding: number;
};

export function riskScore(r: RiskInput): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const d = r.daysSinceVisit;
  if (d === null) {
    score += 30;
    reasons.push("No visits recorded");
  } else if (d >= 21) {
    score += 40;
    reasons.push(`Last visit ${d} days ago`);
  } else if (d >= 10) {
    score += 25;
    reasons.push(`Last visit ${d} days ago`);
  } else if (d >= 5) score += 10;

  if (r.visitsPrev30 >= 4 && r.visits30 <= r.visitsPrev30 / 2) {
    score += 20;
    reasons.push(`Visits down from ${r.visitsPrev30} to ${r.visits30} a month`);
  } else if (r.visits30 < r.visitsPrev30) score += 5;

  const e = r.daysToExpiry;
  if (e !== null) {
    if (e < 0 && e >= -30) {
      score += 25;
      reasons.push(`Expired ${-e} days ago`);
    } else if (e >= 0 && e <= 7) {
      score += 20;
      reasons.push(e === 0 ? "Expires today" : `Expires in ${e} days`);
    } else if (e > 7 && e <= 15) score += 10;
  }

  if (r.outstanding >= 200_000) {
    score += 15;
    reasons.push("Dues of ₹2,000 or more");
  } else if (r.outstanding > 0) score += 5;

  return { score: Math.min(100, score), reasons };
}

export const riskBand = (score: number) => (score >= 60 ? "High" : score >= 35 ? "Medium" : "Low");
