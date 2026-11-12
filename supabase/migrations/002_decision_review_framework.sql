-- Decision Review framework migration.
-- Prerequisite: public.decisions(id, user_id) and Supabase Auth must exist.
-- Run after 001_initial_schema.sql. Existing review rows are preserved; rows
-- created before review_status existed become drafts so their data is retained.

create table if not exists public.decision_reviews (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  review_status text not null default 'draft',
  scheduled_for date,
  expected_outcome_at_review text,
  actual_outcome text,
  outcome_result text,
  outcome_reflection text,
  information_quality_rating smallint,
  alternative_evaluation_rating smallint,
  risk_assessment_rating smallint,
  reasoning_quality_rating smallint,
  execution_quality_rating smallint,
  decision_quality_score integer generated always as (
    case
      when information_quality_rating is not null
       and alternative_evaluation_rating is not null
       and risk_assessment_rating is not null
       and reasoning_quality_rating is not null
       and execution_quality_rating is not null
      then round((
        (information_quality_rating::numeric
          + alternative_evaluation_rating
          + risk_assessment_rating
          + reasoning_quality_rating
          + execution_quality_rating) / 5 - 1
      ) * 25)::integer
      else null
    end
  ) stored,
  decision_quality_reflection text,
  execution_reflection text,
  bias_assumption_reflection text,
  lessons_learned text,
  next_action text,
  next_action_notes text,
  -- Keep the original review fields for compatibility with the first schema proposal.
  expectation_met boolean,
  went_well text,
  went_wrong text,
  do_differently text,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Add framework columns when the original decision_reviews table already exists.
alter table public.decision_reviews
  add column if not exists review_status text not null default 'draft',
  add column if not exists scheduled_for date,
  add column if not exists expected_outcome_at_review text,
  add column if not exists actual_outcome text,
  add column if not exists outcome_result text,
  add column if not exists outcome_reflection text,
  add column if not exists information_quality_rating smallint,
  add column if not exists alternative_evaluation_rating smallint,
  add column if not exists risk_assessment_rating smallint,
  add column if not exists reasoning_quality_rating smallint,
  add column if not exists execution_quality_rating smallint,
  add column if not exists decision_quality_score integer generated always as (
    case
      when information_quality_rating is not null
       and alternative_evaluation_rating is not null
       and risk_assessment_rating is not null
       and reasoning_quality_rating is not null
       and execution_quality_rating is not null
      then round((
        (information_quality_rating::numeric
          + alternative_evaluation_rating
          + risk_assessment_rating
          + reasoning_quality_rating
          + execution_quality_rating) / 5 - 1
      ) * 25)::integer
      else null
    end
  ) stored,
  add column if not exists decision_quality_reflection text,
  add column if not exists execution_reflection text,
  add column if not exists bias_assumption_reflection text,
  add column if not exists lessons_learned text,
  add column if not exists next_action text,
  add column if not exists next_action_notes text;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_outcome_result_check') then
    alter table public.decision_reviews
      add constraint decision_reviews_outcome_result_check
      check (outcome_result is null or outcome_result in (
        'better_than_expected', 'as_expected', 'worse_than_expected', 'too_early_to_tell'
      ));
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_next_action_check') then
    alter table public.decision_reviews
      add constraint decision_reviews_next_action_check
      check (next_action is null or next_action in (
        'continue', 'adjust', 'reverse', 'abandon', 'gather_more_information'
      ));
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_information_quality_rating_check') then
    alter table public.decision_reviews add constraint decision_reviews_information_quality_rating_check
      check (information_quality_rating is null or information_quality_rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_alternative_evaluation_rating_check') then
    alter table public.decision_reviews add constraint decision_reviews_alternative_evaluation_rating_check
      check (alternative_evaluation_rating is null or alternative_evaluation_rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_risk_assessment_rating_check') then
    alter table public.decision_reviews add constraint decision_reviews_risk_assessment_rating_check
      check (risk_assessment_rating is null or risk_assessment_rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_reasoning_quality_rating_check') then
    alter table public.decision_reviews add constraint decision_reviews_reasoning_quality_rating_check
      check (reasoning_quality_rating is null or reasoning_quality_rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_execution_quality_rating_check') then
    alter table public.decision_reviews add constraint decision_reviews_execution_quality_rating_check
      check (execution_quality_rating is null or execution_quality_rating between 1 and 5);
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_status_check') then
    alter table public.decision_reviews add constraint decision_reviews_status_check
      check (review_status in ('draft', 'completed'));
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.decision_reviews'::regclass and conname = 'decision_reviews_completed_ratings_check') then
    alter table public.decision_reviews add constraint decision_reviews_completed_ratings_check
      check (
        review_status = 'draft'
        or (
          information_quality_rating is not null
          and alternative_evaluation_rating is not null
          and risk_assessment_rating is not null
          and reasoning_quality_rating is not null
          and execution_quality_rating is not null
        )
      );
  end if;
end
$$;

-- Account deletion must remove decisions and their reviews. This cascade also
-- avoids an ON DELETE RESTRICT conflict when auth.users cascades to both tables.
do $$
declare
  review_fk record;
begin
  for review_fk in
    select conname
    from pg_constraint
    where conrelid = 'public.decision_reviews'::regclass
      and confrelid = 'public.decisions'::regclass
      and contype = 'f'
      and conkey @> array[(
        select attnum from pg_attribute
        where attrelid = 'public.decision_reviews'::regclass
          and attname = 'decision_id' and not attisdropped
      )]::smallint[]
  loop
    execute format('alter table public.decision_reviews drop constraint %I', review_fk.conname);
  end loop;
end
$$;

alter table public.decision_reviews
  add constraint decision_reviews_decision_id_fkey
  foreign key (decision_id) references public.decisions(id) on delete cascade;

create index if not exists decision_reviews_decision_reviewed_at_idx
  on public.decision_reviews (decision_id, reviewed_at desc);
create index if not exists decision_reviews_user_reviewed_at_idx
  on public.decision_reviews (user_id, reviewed_at desc);

-- At most one resumable draft may exist for a decision. If this migration is
-- applied to a table with legacy rows, stop safely rather than deleting or
-- silently changing historical records when duplicate drafts are found.
do $$
begin
  if exists (
    select 1
    from public.decision_reviews
    where review_status = 'draft'
    group by decision_id
    having count(*) > 1
  ) then
    raise exception 'Cannot create the one-draft-per-decision index: multiple draft reviews already exist for a decision. Review and resolve these records without deleting data, then rerun this migration.';
  end if;
end
$$;

create unique index if not exists decision_reviews_one_draft_per_decision_idx
  on public.decision_reviews (decision_id)
  where review_status = 'draft';

-- Drafts can be edited, but completion is permanent. Identity fields are fixed
-- at creation so a review cannot be reassigned to another user or decision.
create or replace function public.guard_decision_review_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.review_status <> 'draft' then
      raise exception 'Reviews must be inserted as drafts.';
    end if;
    return new;
  end if;

  if old.review_status = 'completed' then
    raise exception 'Completed reviews are permanent and cannot be changed.';
  end if;

  if new.user_id is distinct from old.user_id
     or new.decision_id is distinct from old.decision_id then
    raise exception 'A review cannot be reassigned to another user or decision.';
  end if;

  if new.review_status not in ('draft', 'completed') then
    raise exception 'Review status must be draft or completed.';
  end if;

  if new.review_status = 'completed'
     and (
       new.information_quality_rating is null
       or new.alternative_evaluation_rating is null
       or new.risk_assessment_rating is null
       or new.reasoning_quality_rating is null
       or new.execution_quality_rating is null
     ) then
    raise exception 'All five quality ratings are required to complete a review.';
  end if;

  return new;
end;
$$;

drop trigger if exists decision_reviews_guard_update on public.decision_reviews;
create trigger decision_reviews_guard_update
  before insert or update on public.decision_reviews
  for each row execute function public.guard_decision_review_update();

alter table public.decision_reviews enable row level security;
revoke all on table public.decision_reviews from public, anon, authenticated;
grant select, insert, update on table public.decision_reviews to authenticated;

-- Remove every existing policy, including SELECT/INSERT policies, before adding
-- the owner-scoped policy set below. PostgreSQL combines permissive policies.
do $$
declare
  review_policy record;
begin
  for review_policy in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'decision_reviews'
  loop
    execute format('drop policy %I on public.decision_reviews', review_policy.policyname);
  end loop;
end
$$;

create policy "Users can read their decision reviews"
  on public.decision_reviews for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.decisions d
      where d.id = decision_reviews.decision_id and d.user_id = (select auth.uid())
    )
  );

create policy "Users can add their decision reviews"
  on public.decision_reviews for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.decisions d
      where d.id = decision_reviews.decision_id and d.user_id = (select auth.uid())
    )
  );

create policy "Users can update their draft reviews"
  on public.decision_reviews for update to authenticated
  using (
    user_id = (select auth.uid())
    and review_status = 'draft'
    and exists (
      select 1 from public.decisions d
      where d.id = decision_reviews.decision_id and d.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and review_status in ('draft', 'completed')
    and exists (
      select 1 from public.decisions d
      where d.id = decision_reviews.decision_id and d.user_id = (select auth.uid())
    )
  );

-- There is deliberately no DELETE privilege or DELETE policy. Completed rows
-- are protected from UPDATE by the trigger; only draft rows may be updated.
