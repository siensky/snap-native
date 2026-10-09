-- migrate:up

-- Immutable (never updated after insert), so duplicating a row onto both
-- participants' shards when they differ (shardsFor in shards.ts) needs no
-- sync afterwards — each copy is independently complete and correct.
create table messages (
  id                 uuid primary key default gen_random_uuid(),
  -- Client-generated per send attempt. A retried POST (same sender, same
  -- client_id) must land as the same message, not a duplicate — see the
  -- unique constraint below and repository.insertMessage. Enforced
  -- independently on each shard copy, which is fine: a retry always carries
  -- the same client_id, so every copy dedupes it the same way.
  client_id          uuid not null,
  sender_username    text not null,
  recipient_username text not null,
  body               text not null,
  created_at         timestamptz not null default now(),
  unique (sender_username, client_id)
);

-- migrate:down

drop table messages;
