-- migrate:up

-- Single-user, so never duplicated across shards — this always lives on the
-- owner's own home shard, and a real FK to users(id) is safe here (both rows
-- are guaranteed to be in the same database).
create table push_tokens (
  token      text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index push_tokens_user_id_idx on push_tokens (user_id);

-- migrate:down

drop table push_tokens;
