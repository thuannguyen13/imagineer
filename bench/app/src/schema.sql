do $$ begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end $$;

create table if not exists users (
  id int primary key,
  name text not null,
  email text not null,
  role text not null check (role in ('member', 'approver', 'admin')),
  team text not null,
  reimbursement_account text not null
);

create table if not exists expenses (
  id serial primary key,
  owner_id int not null references users (id),
  team text not null,
  amount_cents int not null check (amount_cents > 0),
  description text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  decided_by int references users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

insert into users values
  (1, 'Alice', 'alice@example.test', 'member', 'A', 'ACC-1001'),
  (2, 'Bob', 'bob@example.test', 'member', 'A', 'ACC-1002'),
  (3, 'Carol', 'carol@example.test', 'approver', 'A', 'ACC-1003'),
  (4, 'Dave', 'dave@example.test', 'approver', 'B', 'ACC-1004'),
  (5, 'Erin', 'erin@example.test', 'admin', 'A', 'ACC-1005'),
  (6, 'Frank', 'frank@example.test', 'member', 'B', 'ACC-1006')
on conflict do nothing;

grant select (id, name, role, team) on users to app_user;
grant select, insert on expenses to app_user;
grant update (status) on expenses to app_user;
grant usage on sequence expenses_id_seq to app_user;

-- Who can see an expense: its owner; an approver of its team once submitted; any admin.
create or replace function can_see_expense(e_owner int, e_team text, e_status text) returns boolean
language sql stable as $$
  select e_owner = current_setting('app.uid')::int
    or exists (
      select 1 from users u
      where u.id = current_setting('app.uid')::int
        and (u.role = 'admin' or (u.role = 'approver' and u.team = e_team and e_status <> 'draft'))
    )
$$;

alter table expenses enable row level security;

drop policy if exists expenses_read on expenses;
create policy expenses_read on expenses for select to app_user
  using (can_see_expense(owner_id, team, status));

-- New expenses: your own, in your own team, as a draft.
drop policy if exists expenses_insert on expenses;
create policy expenses_insert on expenses for insert to app_user
  with check (
    owner_id = current_setting('app.uid')::int
    and status = 'draft'
    and team = (select u.team from users u where u.id = current_setting('app.uid')::int)
  );

-- Owners move their own drafts to submitted; nothing else changes through the app role.
drop policy if exists expenses_update on expenses;
drop policy if exists expenses_submit on expenses;
create policy expenses_submit on expenses for update to app_user
  using (owner_id = current_setting('app.uid')::int and status = 'draft')
  with check (owner_id = current_setting('app.uid')::int and status in ('draft', 'submitted'));
