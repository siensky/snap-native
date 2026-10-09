-- migrate:up

-- The inbox query filters by recipient_username alone ("what is waiting for
-- me?"), but the table's primary key is (snap_id, recipient_username) —
-- recipient_username is the trailing column there, so that index can't serve
-- the lookup and Postgres falls back to scanning. Mirrors the friendships
-- (friend_username) index, which exists for the same reason.
create index snap_recipients_recipient_username_idx on snap_recipients (recipient_username);

-- migrate:down

drop index snap_recipients_recipient_username_idx;
