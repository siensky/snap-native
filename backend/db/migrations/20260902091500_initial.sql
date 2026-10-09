-- migrate:up

-- The same schema is applied to both shard databases (DATABASE_URL_A and
-- DATABASE_URL_B) — see backend/src/db/shards.ts. A row that mentions two
-- users (a friendship, a snap, a message) can't carry a real foreign key to
-- users(id) across a database boundary, so these tables key the OTHER party
-- by username instead, and the app duplicates such a row onto every shard it
-- mentions (shardsFor in shards.ts). users itself is never duplicated: a
-- user has exactly one home shard, chosen by hashing their username.
create extension if not exists pgcrypto;

create table users (
    id            uuid primary key default gen_random_uuid(),
    username      text not null unique,
    password_hash text not null,
    created_at    timestamptz not null default now()
);

--- Skapa en rad
create table snaps (
  id              uuid primary key default gen_random_uuid(),
  -- No FK, no numeric id: the sender may live on a different shard than
  -- this copy. Denormalized rather than looked up, same as sender_username
  -- already was on every *read* path before sharding.
  sender_username text not null,
  type            text not null check (type in ('text','photo')),
  body            text,        -- required for text, optional caption for photo
  media_key       text,        -- photo only (S3 key)
  media_mime      text,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  -- The row is written before the upload, so a photo snap starts without media
  -- and setSnapMedia fills it in. That way a failed upload leaves a findable
  -- row rather than an orphaned S3 object. media_key and media_mime move together.
  -- A photo snap may carry an optional caption in body; a text snap must have
  -- one and can never have media.
  check (
    (type = 'text'  and body is not null and media_key is null and media_mime is null) or
    (type = 'photo' and (media_key is null) = (media_mime is null))
  )
);

--- För varje mottagare har vi en rad här — alltid på mottagarens egen shard,
--- aldrig duplicerad: ingen annan part läser en recipient-rad.
create table snap_recipients (
  snap_id            uuid not null,
  recipient_username text not null,
  screenshot         boolean not null default FALSE,
  viewed_at          timestamptz,
  primary key (snap_id, recipient_username)
);

create table friendships (
  user_username      text not null,
  friend_username    text not null,
  -- The friend's OWN account creation date, snapshotted when the edge is
  -- written (repository.addFriend) — getFriends reports this, not when the
  -- edge was made, and a join to the friend's users row isn't available when
  -- they live on the other shard.
  friend_created_at  timestamptz not null,
  created_at         timestamptz not null default now(),
  primary key (user_username, friend_username),
  check (user_username <> friend_username)
);
create index on friendships (friend_username);


-- migrate:down

drop table friendships;
drop table snap_recipients;
drop table snaps;
drop table users;
