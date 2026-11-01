-- Contact and support. Anyone can write to the support team from /contact. Every message is kept here
-- (so none is lost if email is down), and also emailed to the support address when SMTP is set up.
create table if not exists support_messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  email       text not null,
  topic       text not null,
  message     text not null,
  user_id     text,
  -- A salted hash of the sender's address, only for spotting abuse. The address itself is never stored.
  ip_hash     text not null default '',
  page        text not null default '',
  status      text not null default 'new' check (status in ('new', 'handled')),
  emailed     boolean not null default false,
  email_error text not null default ''
);
create index if not exists support_messages_created_idx on support_messages (created_at desc);
create index if not exists support_messages_status_idx on support_messages (status, created_at desc);

-- Small site-wide settings an admin can change without redeploying (today: the support email address).
create table if not exists site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
