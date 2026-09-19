-- Content-library bridge: attribution and the library's id on discover_videos.
-- See docs/content-library-bridge.md. Apply to the live project — a migration
-- merged through GitHub alone is not applied there (README, "Lovable").

alter table public.discover_videos
  add column if not exists library_item_id uuid,
  add column if not exists creator_name    text,
  add column if not exists creator_handle  text;

create index if not exists discover_videos_library_item_idx
  on public.discover_videos (library_item_id)
  where library_item_id is not null;
