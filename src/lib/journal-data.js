import { supabase } from './supabase.js';

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

export async function getSignedInUser() {
  const client = requireClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Your session has ended. Sign in again to continue.');
  return data.user;
}

export async function fetchDecisions() {
  const client = requireClient();
  const user = await getSignedInUser();
  const { data, error } = await client.from('decisions').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveDecisionRecord(payload, id = null) {
  const client = requireClient();
  const user = await getSignedInUser();
  const record = { ...payload, user_id: user.id };
  const query = id
    ? client.from('decisions').update(record).eq('id', id).eq('user_id', user.id)
    : client.from('decisions').insert(record);
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteDecisionRecord(id) {
  const client = requireClient();
  const user = await getSignedInUser();
  const { error, count } = await client.from('decisions').delete({ count: 'exact' }).eq('id', id).eq('user_id', user.id);
  if (error) throw error;
  if (count === 0) throw new Error('The decision was not found or is no longer available.');
}

export async function fetchDecisionReviews(decisionId) {
  const client = requireClient();
  const user = await getSignedInUser();
  const { data, error } = await client.from('decision_reviews').select('*')
    .eq('decision_id', decisionId).eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchReviews() {
  const client = requireClient();
  const user = await getSignedInUser();
  const { data, error } = await client.from('decision_reviews').select('*')
    .eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveReviewDraft(decisionId, payload, draftId = null) {
  const client = requireClient();
  const user = await getSignedInUser();
  const record = { ...payload, decision_id: decisionId, user_id: user.id, review_status: 'draft' };
  const query = draftId
    ? client.from('decision_reviews').update(record).eq('id', draftId).eq('review_status', 'draft').eq('user_id', user.id)
    : client.from('decision_reviews').insert(record);
  const { data, error } = await query.select('*').single();
  if (error) throw error;
  return data;
}

export async function completeReviewDraft(draftId) {
  const client = requireClient();
  const user = await getSignedInUser();
  const { data, error } = await client.from('decision_reviews')
    .update({ review_status: 'completed' })
    .eq('id', draftId).eq('user_id', user.id).eq('review_status', 'draft')
    .select('*').single();
  if (error) throw error;
  return data;
}
