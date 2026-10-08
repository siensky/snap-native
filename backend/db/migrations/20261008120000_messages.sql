-- migrate:up

create table messages (
  id           bigserial primary key,
  -- Client-generated per send attempt. A retried POST (same sender, same
  -- client_id) must land as the same message, not a duplicate — see the
  -- unique constraint below and repository.insertMessage.
  client_id    uuid not null,
  sender_id    bigint not null references users(id),
  recipient_id bigint not null references users(id),
  body         text not null,
  created_at   timestamptz not null default now(),
  unique (sender_id, client_id)
);

-- migrate:down

drop table messages;
