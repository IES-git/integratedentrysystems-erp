-- ============================================================================
-- Phase 4: QA issue dashboard summary view.
-- ============================================================================
--
-- Aggregates qa_issue rows by price book, check, severity, and status so the
-- QA dashboard can show ingestion/data-quality health at a glance and catch
-- problems before a book is published. Detail rows are read directly from
-- qa_issue by the dashboard API; this view powers the summary tiles.
-- ----------------------------------------------------------------------------

create or replace view public.qa_issue_summary as
select coalesce(d.title, 'unassigned') as price_book_title,
       q.price_book_id,
       q.check_name,
       q.severity,
       q.status,
       count(*)              as issue_count,
       max(q.updated_at)     as last_seen
from public.qa_issue q
left join public.price_book_document d on d.id = q.price_book_id
group by d.title, q.price_book_id, q.check_name, q.severity, q.status;

comment on view public.qa_issue_summary is
  'Phase 4 QA dashboard: qa_issue counts grouped by price book, check, severity, and status.';
