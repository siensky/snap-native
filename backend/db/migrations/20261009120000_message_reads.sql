-- migrate:up

-- When a user last saw the top of a conversation (services.getMessages marks
-- this on every fetch of the newest page). Single-shard, same as push_tokens:
-- only the reader themselves ever needs this, so it's never duplicated onto
-- the other party's shard.
create table message_reads (
  username       text not null,
  other_username text not null,
  last_read_at   timestamptz not null,
  primary key (username, other_username)
);

-- migrate:down

drop table message_reads;
