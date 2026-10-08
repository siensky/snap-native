-- migrate:up
create table users (
    id            bigserial primary key,
    username      text not null unique,
    password_hash text not null,
    created_at    timestamptz not null default now()
);

--- Skapa en rad
create table snaps (
  id          bigserial primary key,
  sender_id   bigint not null references users(id),
  type        text not null check (type in ('text','photo')),
  body        text,        -- required for text, optional caption for photo
  media_key   text,        -- photo only (S3 key)
  media_mime  text,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
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

--- För varje mottagare har vi en rad här
create table snap_recipients (
  snap_id      bigint not null references snaps(id) on delete cascade,
  recipient_id bigint not null references users(id),
  screenshot   boolean not null default FALSE,
  viewed_at    timestamptz,
  primary key (snap_id, recipient_id)
);

create table friendships (
  user_id    bigint not null references users(id) on delete cascade,
  friend_id  bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index on friendships (friend_id);


-- migrate:down

drop table friendships;
drop table snap_recipients;
drop table snaps;
drop table users;
