const ratingFields = [
  ['information_quality_rating', 'Information Quality'],
  ['alternative_evaluation_rating', 'Alternative Evaluation'],
  ['risk_assessment_rating', 'Risk Assessment'],
  ['reasoning_quality_rating', 'Reasoning Quality'],
  ['execution_quality_rating', 'Execution Quality'],
];

const categoryOrder = ['Career', 'Finance', 'Personal', 'Education', 'Health', 'Business', 'Other'];
const outcomeLabels = {
  better_than_expected: 'Better than expected',
  as_expected: 'As expected',
  worse_than_expected: 'Worse than expected',
  too_early_to_tell: 'Too early to tell',
};

export const periodOptions = [
  ['all', 'All Time'],
  ['30d', 'Last 30 Days'],
  ['90d', 'Last 90 Days'],
  ['year', 'This Year'],
];

function periodStart(period, now = new Date()) {
  const start = new Date(now);
  if (period === '30d') start.setDate(start.getDate() - 30);
  else if (period === '90d') start.setDate(start.getDate() - 90);
  else if (period === 'year') start.setMonth(0, 1);
  else return null;
  if (period === 'year') start.setHours(0, 0, 0, 0);
  return start;
}

function isInPeriod(value, start) {
  if (!start) return true;
  if (!value) return false;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const localDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    return value >= localDate;
  }
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date >= start;
}

function finiteNumbers(values) {
  return values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function average(values) {
  const numbers = finiteNumbers(values);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function countBy(items, keyFn, order = []) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item) || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const keys = [...new Set([...order, ...counts.keys()])];
  return keys.map((key) => ({ key, count: counts.get(key) || 0 })).filter((item) => item.count > 0);
}

function monthKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.valueOf())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' }).format(new Date(year, month - 1, 1));
}

function groupedMonthly(items, dateFn) {
  const groups = new Map();
  for (const item of items) {
    const key = monthKey(dateFn(item));
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({ key, label: monthLabel(key), rows }));
}

function decisionTrend(decisions) {
  return groupedMonthly(decisions, (decision) => decision.created_at).map(({ key, label, rows }) => ({
    key,
    label,
    count: rows.length,
  }));
}

function qualityTrend(reviews) {
  return groupedMonthly(reviews, (review) => review.scheduled_for || review.reviewed_at).map(({ key, label, rows }) => ({
    key,
    label,
    values: ratingFields.map(([field]) => average(rows.map((review) => review[field]))),
  }));
}

function outcomeConfidence(decisions, reviews) {
  const decisionsById = new Map(decisions.map((decision) => [decision.id, decision]));
  const completed = reviews.filter((review) => review.review_status === 'completed' && review.outcome_result && review.outcome_result !== 'too_early_to_tell');
  return countBy(completed, (review) => review.outcome_result, Object.keys(outcomeLabels)).map(({ key, count }) => {
    const matching = completed.filter((review) => review.outcome_result === key);
    return {
      key,
      label: outcomeLabels[key] || key,
      count,
      averageConfidence: average(matching.map((review) => decisionsById.get(review.decision_id)?.confidence)),
    };
  });
}

function confidenceOutcomeTrend(decisions, reviews) {
  const decisionsById = new Map(decisions.map((decision) => [decision.id, decision]));
  const reviewed = reviews.filter((review) => review.review_status === 'completed' && review.outcome_result && review.outcome_result !== 'too_early_to_tell');
  return groupedMonthly(reviewed, (review) => review.scheduled_for || review.reviewed_at).map(({ key, label, rows }) => {
    const reported = rows.filter((review) => ['better_than_expected', 'as_expected', 'worse_than_expected'].includes(review.outcome_result));
    const favorable = reported.filter((review) => ['better_than_expected', 'as_expected'].includes(review.outcome_result)).length;
    return {
      key,
      label,
      averageConfidence: average(rows.map((review) => decisionsById.get(review.decision_id)?.confidence)),
      reportedFavorableShare: reported.length ? favorable / reported.length * 100 : null,
    };
  });
}

function confidenceBuckets(decisions) {
  const buckets = [
    { label: '0–39%', min: 0, max: 39, count: 0 },
    { label: '40–59%', min: 40, max: 59, count: 0 },
    { label: '60–79%', min: 60, max: 79, count: 0 },
    { label: '80–100%', min: 80, max: 100, count: 0 },
  ];
  for (const decision of decisions) {
    const value = Number(decision.confidence);
    const bucket = buckets.find((item) => value >= item.min && value <= item.max);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function buildLearningPatterns(reviews) {
  const patterns = [];
  const completed = reviews.filter((review) => review.review_status === 'completed');
  const lowScorePatterns = [
    ['information_quality_rating', 'Information quality is often self-rated low', 'Several reviews rated information quality 1 or 2 out of 5. Consider identifying what information is missing before choosing.'],
    ['alternative_evaluation_rating', 'Alternative evaluation is often self-rated low', 'Several reviews rated alternative evaluation 1 or 2 out of 5. Try writing down at least two viable options before deciding.'],
    ['risk_assessment_rating', 'Risk assessment is often self-rated low', 'Several reviews rated risk assessment 1 or 2 out of 5. Add a short “what could go wrong?” check to your decision process.'],
  ];

  for (const [field, title, description] of lowScorePatterns) {
    const supported = completed.filter((review) => review[field] !== null && review[field] !== undefined && Number(review[field]) <= 2);
    if (supported.length >= 3) patterns.push({ title, description, count: supported.length, total: completed.length });
  }

  if (completed.length >= 6) {
    const sorted = completed.slice().sort((a, b) => new Date(a.scheduled_for || a.reviewed_at) - new Date(b.scheduled_for || b.reviewed_at));
    const split = Math.floor(sorted.length / 2);
    const earlier = average(sorted.slice(0, split).map((review) => review.risk_assessment_rating));
    const recent = average(sorted.slice(split).map((review) => review.risk_assessment_rating));
    if (earlier !== null && recent !== null && recent - earlier >= 0.5) {
      patterns.push({
        title: 'Risk-assessment ratings have risen over time',
        description: `The average moved from ${earlier.toFixed(1)} to ${recent.toFixed(1)} out of 5 between the earlier and more recent review groups. This describes your ratings, not proof of cause.`,
        count: sorted.length,
        total: sorted.length,
      });
    }
  }

  const actionCounts = countBy(completed, (review) => review.next_action);
  const changeActions = actionCounts.filter(({ key }) => ['adjust', 'reverse', 'gather_more_information'].includes(key));
  const changeCount = changeActions.reduce((sum, item) => sum + item.count, 0);
  if (changeCount >= 3) {
    patterns.push({
      title: 'You often select a change-oriented next action',
      description: 'Adjust, reverse, or gather-more-information actions appear repeatedly. The journal records your selected next step; it cannot confirm whether it was carried out.',
      count: changeCount,
      total: completed.length,
    });
  }

  const worse = completed.filter((review) => review.outcome_result === 'worse_than_expected');
  if (worse.length >= 3) {
    patterns.push({
      title: 'Several reviewed outcomes were worse than expected',
      description: 'This is your own comparison of actual and expected outcomes, not an objective score. Consider recording the assumptions that could change the forecast.',
      count: worse.length,
      total: completed.length,
    });
  }

  return patterns;
}

export function calculateInsights({ decisions, reviews }, period = 'all', now = new Date()) {
  const start = periodStart(period, now);
  const selectedDecisions = decisions.filter((decision) => isInPeriod(decision.created_at, start));
  const selectedReviews = reviews.filter((review) => isInPeriod(review.scheduled_for || review.reviewed_at, start));
  const completedReviews = selectedReviews.filter((review) => review.review_status === 'completed');
  const reviewByDecision = new Map();
  for (const review of reviews) {
    if (!reviewByDecision.has(review.decision_id)) reviewByDecision.set(review.decision_id, []);
    reviewByDecision.get(review.decision_id).push(review);
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDecisions = selectedDecisions.filter((decision) => {
    const due = decision.review_date && new Date(`${decision.review_date}T00:00:00`) <= today;
    return due && decision.status !== 'archived';
  });
  const completedDue = dueDecisions.filter((decision) =>
    decision.status === 'completed' || (reviewByDecision.get(decision.id) || []).some((review) => review.review_status === 'completed'),
  );
  const draftIds = new Set(reviews.filter((review) => review.review_status === 'draft').map((review) => review.decision_id));
  const pendingIds = new Set(dueDecisions.filter((decision) => !completedDue.includes(decision)).map((decision) => decision.id));
  for (const id of draftIds) if (selectedDecisions.some((decision) => decision.id === id)) pendingIds.add(id);

  const aspectAverages = ratingFields.map(([field, label]) => ({
    field,
    label,
    average: average(completedReviews.map((review) => review[field])),
    count: completedReviews.filter((review) => review[field] !== null && review[field] !== undefined && Number.isFinite(Number(review[field]))).length,
  }));
  const availableAspects = aspectAverages.filter((aspect) => aspect.average !== null);
  const strongest = availableAspects.slice().sort((a, b) => b.average - a.average)[0] || null;
  const growthArea = availableAspects.slice().sort((a, b) => a.average - b.average)[0] || null;

  const outcomeMix = countBy(
    completedReviews.filter((review) => review.outcome_result),
    (review) => review.outcome_result,
    Object.keys(outcomeLabels),
  ).map(({ key, count }) => ({ key, label: outcomeLabels[key] || key, count }));

  return {
    decisions: selectedDecisions,
    reviews: selectedReviews,
    completedReviews,
    metrics: {
      total: selectedDecisions.length,
      completed: selectedDecisions.filter((decision) => decision.status === 'completed').length,
      pending: pendingIds.size,
      reviewCompletionRate: dueDecisions.length ? completedDue.length / dueDecisions.length : null,
      averageConfidence: average(selectedDecisions.map((decision) => decision.confidence)),
      completedReviewCount: completedReviews.length,
      averageDecisionQualityScore: average(completedReviews.map((review) => review.decision_quality_score)),
    },
    categoryDistribution: categoryOrder.map((category) => ({
      key: category,
      count: selectedDecisions.filter((decision) => decision.category === category).length,
    })),
    statusDistribution: countBy(selectedDecisions, (decision) => decision.status),
    decisionTrend: decisionTrend(selectedDecisions),
    aspectAverages,
    strongest,
    growthArea,
    qualityTrend: qualityTrend(completedReviews),
    outcomeConfidence: outcomeConfidence(decisions, completedReviews),
    confidenceOutcomeTrend: confidenceOutcomeTrend(decisions, completedReviews),
    outcomeMix,
    confidenceBuckets: confidenceBuckets(selectedDecisions),
    learningPatterns: buildLearningPatterns(selectedReviews),
  };
}

export function formatRating(value) {
  return value === null ? '—' : `${value.toFixed(1)} / 5`;
}

export function formatPercent(value) {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export const qualityRatingLabels = ratingFields;
