import { supabase } from './supabase.js';

const PAGE_SIZE = 500;

const DECISION_COLUMNS = 'id,category,status,confidence,review_date,created_at';
const REVIEW_COLUMNS = [
  'id',
  'decision_id',
  'review_status',
  'scheduled_for',
  'reviewed_at',
  'created_at',
  'outcome_result',
  'information_quality_rating',
  'alternative_evaluation_rating',
  'risk_assessment_rating',
  'reasoning_quality_rating',
  'execution_quality_rating',
  'decision_quality_score',
  'next_action',
].join(',');

function periodCutoff(period) {
  const now = new Date();
  if (period === '30d') now.setDate(now.getDate() - 30);
  else if (period === '90d') now.setDate(now.getDate() - 90);
  else if (period === 'year') now.setMonth(0, 1), now.setHours(0, 0, 0, 0);
  else return null;
  return now;
}

async function fetchAllPages(queryFactory) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await queryFactory().range(start, start + PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function uniqueRows(rows) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

async function fetchRowsForDecisionIds(userId, ids) {
  const groups = [];
  for (let index = 0; index < ids.length; index += 100) groups.push(ids.slice(index, index + 100));
  const results = await Promise.all(groups.map((group) => fetchAllPages(() => supabase
    .from('decision_reviews')
    .select(REVIEW_COLUMNS)
    .eq('user_id', userId)
    .in('decision_id', group)
    .order('created_at', { ascending: true }))));
  return results.flat();
}

async function fetchRelatedDecisions(userId, ids, existingRows) {
  const existingIds = new Set(existingRows.map((row) => row.id));
  const missingIds = ids.filter((id) => !existingIds.has(id));
  const groups = [];
  for (let index = 0; index < missingIds.length; index += 100) groups.push(missingIds.slice(index, index + 100));
  const results = await Promise.all(groups.map((group) => fetchAllPages(() => supabase
    .from('decisions')
    .select(DECISION_COLUMNS)
    .eq('user_id', userId)
    .in('id', group)
    .order('created_at', { ascending: true }))));
  return uniqueRows([...existingRows, ...results.flat()]);
}

export async function fetchInsightsData(period = 'all') {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('Please sign in to view your personal insights.');

  const userId = userData.user.id;
  const cutoff = periodCutoff(period);
  const decisionQuery = () => {
    let query = supabase.from('decisions').select(DECISION_COLUMNS).eq('user_id', userId).order('created_at', { ascending: true });
    if (cutoff) query = query.gte('created_at', cutoff.toISOString());
    return query;
  };
  const periodReviewQuery = () => {
    let query = supabase.from('decision_reviews').select(REVIEW_COLUMNS).eq('user_id', userId).order('reviewed_at', { ascending: true });
    if (cutoff) {
      const date = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
      query = query.or(`scheduled_for.gte.${date},and(scheduled_for.is.null,reviewed_at.gte.${cutoff.toISOString()})`);
    }
    return query;
  };

  const [selectedDecisions, periodReviews] = await Promise.all([
    fetchAllPages(decisionQuery),
    fetchAllPages(periodReviewQuery),
  ]);
  // For due decisions in the selected range, also fetch their review history so
  // an older completed review or an active draft is not miscounted as pending.
  const decisionHistory = selectedDecisions.length
    ? await fetchRowsForDecisionIds(userId, selectedDecisions.map((decision) => decision.id))
    : [];
  const reviews = uniqueRows([...periodReviews, ...decisionHistory]);
  const relatedIds = [...new Set(periodReviews.map((review) => review.decision_id))];
  const decisions = await fetchRelatedDecisions(userId, relatedIds, selectedDecisions);

  return { decisions, reviews };
}
