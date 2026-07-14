-- Early versions treated every lesson note as grading material. Reclassify only
-- unambiguous completion-only notes that have no uploaded work or assessment signal.
create temporary table completion_only_submission_repairs on commit drop as
select distinct submission.id, submission.family_id, submission.assignment_id, submission.submitted_at
from public.assignment_submissions submission
join public.assignment_reviews review
  on review.submission_id = submission.id
 and review.family_id = submission.family_id
where review.status = 'draft'
  and review.draft_score is null
  and coalesce(submission.note, '') ~* '(^|[^[:alnum:]_])(done|finished|completed|complete|wrapped up)([^[:alnum:]_]|$)'
  and coalesce(submission.note, '') !~* '(score|grade|graded|points?|percent|percentage|quiz|test|rubric|feedback|review|check my|correct my|passed|failed|[0-9]+([.][0-9]+)?[[:space:]]*%|[0-9]+[[:space:]]*/[[:space:]]*[0-9]+)'
  and coalesce(submission.note, '') !~ '(^|[[:space:]])[A-F][+-]?([[:space:].,;!?]|$)'
  and not exists (
    select 1
    from public.assignment_submission_evidence link
    join public.evidence_items evidence on evidence.id = link.evidence_id
    where link.submission_id = submission.id
      and (evidence.storage_path is not null or evidence.kind <> 'note')
  );

update public.assignment_reviews review
set status = 'superseded', updated_at = timezone('utc', now())
from completion_only_submission_repairs repair
where review.submission_id = repair.id
  and review.family_id = repair.family_id
  and review.status = 'draft';

update public.assignment_submissions submission
set status = 'reviewed', updated_at = timezone('utc', now())
from completion_only_submission_repairs repair
where submission.id = repair.id
  and submission.family_id = repair.family_id;

update public.assignments assignment
set status = 'completed',
    completed_at = coalesce(assignment.completed_at, repair.submitted_at),
    submitted_at = coalesce(assignment.submitted_at, repair.submitted_at),
    updated_at = timezone('utc', now())
from completion_only_submission_repairs repair
where assignment.id = repair.assignment_id
  and assignment.family_id = repair.family_id;

update public.weekly_plan_items item
set completed_at = coalesce(item.completed_at, repair.submitted_at),
    updated_at = timezone('utc', now())
from completion_only_submission_repairs repair
where item.assignment_id = repair.assignment_id
  and item.family_id = repair.family_id;
