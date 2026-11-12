-- Initial Decision Journal schema for a new Supabase project.
-- Apply this before 002_decision_review_framework.sql.

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  category text not null check (category in (
    'Career', 'Finance', 'Personal', 'Education', 'Health', 'Business', 'Other'
  )),
  context text not null default '',
  problem text not null default '',
  options text not null default '',
  chosen_decision text not null check (length(btrim(chosen_decision)) > 0),
  reasoning text not null check (length(btrim(reasoning)) > 0),
  expected_outcome text not null check (length(btrim(expected_outcome)) > 0),
  confidence smallint not null default 50 check (confidence between 0 and 100),
  review_date date not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'decided', 'review_due', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists decisions_user_created_at_idx
  on public.decisions (user_id, created_at desc);
create index if not exists decisions_user_review_date_idx
  on public.decisions (user_id, review_date);

create or replace function public.handle_decisions_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists decisions_updated_at on public.decisions;
create trigger decisions_updated_at
  before update on public.decisions
  for each row execute function public.handle_decisions_updated_at();

-- Status values returned by the database map to the interface labels:
-- in_progress = In progress; decided = Decided; review_due = Review due;
-- completed = Review complete; archived = Archived.
alter table public.decisions enable row level security;
revoke all on table public.decisions from public, anon, authenticated;
grant select, insert, update, delete on table public.decisions to authenticated;

-- Remove any prior policies so permissive legacy policies cannot broaden access.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'decisions'
  loop
    execute format('drop policy %I on public.decisions', existing_policy.policyname);
  end loop;
end
$$;

create policy "Users can read their decisions"
  on public.decisions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can add their decisions"
  on public.decisions for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their decisions"
  on public.decisions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their decisions"
  on public.decisions for delete to authenticated
  using ((select auth.uid()) = user_id);
