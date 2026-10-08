-- migrate:up

create table push_tokens (
  -- The Expo push token itself is the primary key: it identifies one
  -- device+app install, not one user. Re-registering it (a different account
  -- signing in on the same device) reassigns it via ON CONFLICT, rather than
  -- leaving the old owner with a stale token that still gets pushed to.
  token      text primary key,
  user_id    bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index push_tokens_user_id_idx on push_tokens (user_id);

-- migrate:down

drop table push_tokens;
