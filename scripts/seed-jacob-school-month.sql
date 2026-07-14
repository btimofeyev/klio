-- Repeatable local-development seed for the existing Jacob family workspace.
-- Run with: supabase db query --local --file scripts/seed-jacob-school-month.sql

do $$
declare
  target_family uuid;
  target_student uuid;
  target_parent uuid;
  next_week_start date;
begin
  select s.family_id, s.id, f.created_by
  into target_family, target_student, target_parent
  from public.students s
  join public.families f on f.id = s.family_id
  join auth.users u on u.id = f.created_by
  where lower(s.display_name) = 'jacob'
    and lower(u.email) = 'btimofeyev@gmail.com'
  limit 1;

  if target_student is null then
    raise exception 'Jacob seed target was not found';
  end if;

  next_week_start := current_date + ((8 - extract(isodow from current_date)::int) % 7);

  update public.students
  set grade_band = '9-12',
      learning_preferences = 'Works best with a clear checklist, short focused blocks, discussion before writing, and visible examples. Prefers project-based connections across subjects.'
  where id = target_student;

  update public.families
  set available_days = '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb,
      weekly_minutes = 1200
  where id = target_family;

  insert into public.categories (family_id, name, slug, description, created_by_type, created_by)
  values
    (target_family, 'Math', 'math', 'Algebra I coursework, practice, assessments, and corrections.', 'parent', target_parent),
    (target_family, 'Language Arts', 'language-arts', 'English 9 reading, writing, vocabulary, and literature.', 'parent', target_parent),
    (target_family, 'Science', 'science', 'Biology investigations, labs, notes, and assessments.', 'parent', target_parent),
    (target_family, 'World History', 'world-history', 'Ninth-grade world history readings, sources, maps, and projects.', 'parent', target_parent),
    (target_family, 'Spanish', 'spanish', 'Spanish I vocabulary, listening, speaking, and writing.', 'parent', target_parent)
  on conflict (family_id, slug) do update
  set name = excluded.name, description = excluded.description, updated_at = now();

  insert into public.evidence_items
    (id, family_id, created_by, kind, title, raw_text, source_at, processing_status, provenance, capture_route, capture_submission_id, created_at)
  values
    ('91000000-0000-4000-8000-000000000001', target_family, target_parent, 'grade', 'Algebra I readiness check', 'Diagnostic: integer operations 9/10, fractions 7/10, one-step equations 8/10. Jacob corrected two fraction errors after reviewing a worked example.', current_date - interval '28 days' + time '10:00', 'ready', '{"seed":"jacob-month-v1","week":1}', 'learning', '92000000-0000-4000-8000-000000000001', current_date - interval '28 days' + time '10:00'),
    ('91000000-0000-4000-8000-000000000002', target_family, target_parent, 'book', 'English 9 reading response: The Odyssey', 'Read the Cyclops episode. Wrote a response identifying pride as a motivation and quoted one passage, but the explanation of how the quote supports the claim was brief.', current_date - interval '27 days' + time '13:30', 'ready', '{"seed":"jacob-month-v1","week":1}', 'learning', '92000000-0000-4000-8000-000000000002', current_date - interval '27 days' + time '13:30'),
    ('91000000-0000-4000-8000-000000000003', target_family, target_parent, 'activity', 'Biology cell diagram', 'Labeled nucleus, mitochondria, ribosomes, cell membrane, cytoplasm, and vacuole. Mixed up rough and smooth endoplasmic reticulum, then corrected the labels using notes.', current_date - interval '26 days' + time '11:00', 'ready', '{"seed":"jacob-month-v1","week":1}', 'learning', '92000000-0000-4000-8000-000000000003', current_date - interval '26 days' + time '11:00'),
    ('91000000-0000-4000-8000-000000000004', target_family, target_parent, 'document', 'Early civilizations comparison timeline', 'Created a timeline comparing Mesopotamia and ancient Egypt: rivers, writing systems, political structure, and religious beliefs. Included dates and four cited course-text references.', current_date - interval '25 days' + time '14:00', 'ready', '{"seed":"jacob-month-v1","week":1}', 'learning', '92000000-0000-4000-8000-000000000004', current_date - interval '25 days' + time '14:00'),
    ('91000000-0000-4000-8000-000000000005', target_family, target_parent, 'document', 'Algebra multi-step equations practice', 'Completed 18 multi-step equations: 15 correct independently. The three errors came from distributing a negative sign. Corrections were completed with color-coded steps.', current_date - interval '21 days' + time '10:15', 'ready', '{"seed":"jacob-month-v1","week":2}', 'learning', '92000000-0000-4000-8000-000000000005', current_date - interval '21 days' + time '10:15'),
    ('91000000-0000-4000-8000-000000000006', target_family, target_parent, 'document', 'Odyssey claim-evidence paragraph', 'Draft claim: Odysseus’s pride puts his crew at risk. Used two quotations. Topic sentence and evidence were clear; commentary repeated the quotation instead of explaining the consequence.', current_date - interval '20 days' + time '13:00', 'ready', '{"seed":"jacob-month-v1","week":2}', 'learning', '92000000-0000-4000-8000-000000000006', current_date - interval '20 days' + time '13:00'),
    ('91000000-0000-4000-8000-000000000007', target_family, target_parent, 'activity', 'Microscope lab: onion and cheek cells', 'Prepared slides, focused at three magnifications, and sketched plant and animal cells. Correctly noted the cell wall in onion cells and its absence in cheek cells.', current_date - interval '19 days' + time '11:30', 'ready', '{"seed":"jacob-month-v1","week":2}', 'learning', '92000000-0000-4000-8000-000000000007', current_date - interval '19 days' + time '11:30'),
    ('91000000-0000-4000-8000-000000000008', target_family, target_parent, 'voice', 'Spanish introduction recording', 'Transcript: Hola, me llamo Jacob. Tengo catorce años. Me gusta la historia y jugar videojuegos. Jacob used complete memorized sentences and understandable pronunciation, with pauses before age and interests.', current_date - interval '18 days' + time '15:00', 'ready', '{"seed":"jacob-month-v1","week":2}', 'learning', '92000000-0000-4000-8000-000000000008', current_date - interval '18 days' + time '15:00'),
    ('91000000-0000-4000-8000-000000000009', target_family, target_parent, 'grade', 'Algebra graphing linear equations quiz', 'Score: 84%. Correctly identified slope and y-intercept in 5 of 6 items. Missed one negative slope and one graph created from standard form. Corrections not yet reviewed.', current_date - interval '14 days' + time '10:00', 'ready', '{"seed":"jacob-month-v1","week":3}', 'learning', '92000000-0000-4000-8000-000000000009', current_date - interval '14 days' + time '10:00'),
    ('91000000-0000-4000-8000-000000000010', target_family, target_parent, 'document', 'Revised literary analysis paragraph', 'Revision added explanation after each quotation and a concluding sentence connecting pride to leadership. Parent conference focused on replacing “this shows” with precise analytical language.', current_date - interval '13 days' + time '13:15', 'ready', '{"seed":"jacob-month-v1","week":3}', 'learning', '92000000-0000-4000-8000-000000000010', current_date - interval '13 days' + time '13:15'),
    ('91000000-0000-4000-8000-000000000011', target_family, target_parent, 'activity', 'Diffusion and osmosis investigation notes', 'Recorded potato-mass changes in salt solutions, calculated percent change for four concentrations, and graphed results. Hypothesis was supported; notes identify concentration as the independent variable.', current_date - interval '12 days' + time '11:15', 'ready', '{"seed":"jacob-month-v1","week":3}', 'learning', '92000000-0000-4000-8000-000000000011', current_date - interval '12 days' + time '11:15'),
    ('91000000-0000-4000-8000-000000000012', target_family, target_parent, 'document', 'Hammurabi primary-source comparison', 'Compared three laws and argued that social class affected consequences. Cited all three excerpts and identified one limitation: the laws describe ideals and penalties, not how often they were enforced.', current_date - interval '11 days' + time '14:10', 'ready', '{"seed":"jacob-month-v1","week":3}', 'learning', '92000000-0000-4000-8000-000000000012', current_date - interval '11 days' + time '14:10'),
    ('91000000-0000-4000-8000-000000000013', target_family, target_parent, 'document', 'Introduction to systems of equations', 'Solved four systems by graphing. Three were correct; the fourth graph used the wrong y-intercept. Jacob explained that the intersection represents a solution satisfying both equations.', current_date - interval '7 days' + time '10:30', 'ready', '{"seed":"jacob-month-v1","week":4}', 'learning', '92000000-0000-4000-8000-000000000013', current_date - interval '7 days' + time '10:30'),
    ('91000000-0000-4000-8000-000000000014', target_family, target_parent, 'note', 'Biology lab conclusion still in progress', 'Jacob finished the data table and graph for the osmosis investigation. The written conclusion still needs a claim, two specific data points, and an explanation using water movement across a membrane.', current_date - interval '5 days' + time '11:45', 'ready', '{"seed":"jacob-month-v1","week":4,"completion":"incomplete"}', 'learning', '92000000-0000-4000-8000-000000000014', current_date - interval '5 days' + time '11:45'),
    ('91000000-0000-4000-8000-000000000015', target_family, target_parent, 'note', 'Oral practice notes from Friday', 'Practiced a short spoken exchange using greetings, age, likes, and dislikes. The note does not clearly identify whether this belongs with Spanish or a communication activity.', current_date - interval '2 days' + time '15:10', 'needs_review', '{"seed":"jacob-month-v1","week":4,"needs_parent_confirmation":true}', 'learning', '92000000-0000-4000-8000-000000000015', current_date - interval '2 days' + time '15:10')
  on conflict (id) do update set
    title = excluded.title, raw_text = excluded.raw_text, source_at = excluded.source_at,
    processing_status = excluded.processing_status, provenance = excluded.provenance,
    capture_route = excluded.capture_route, capture_submission_id = excluded.capture_submission_id,
    created_at = excluded.created_at, updated_at = now();

  insert into public.evidence_students (evidence_id, student_id, family_id)
  select id, target_student, target_family
  from public.evidence_items
  where id between '91000000-0000-4000-8000-000000000001'::uuid and '91000000-0000-4000-8000-000000000015'::uuid
  on conflict do nothing;

  insert into public.evidence_categories (family_id, evidence_id, category_id, assigned_by, confidence, document_type, tags)
  select target_family, mapping.evidence_id, c.id, 'parent', 1.0, mapping.document_type, mapping.tags
  from (values
    ('91000000-0000-4000-8000-000000000001'::uuid, 'math', 'Diagnostic', array['algebra-i','diagnostic']),
    ('91000000-0000-4000-8000-000000000002'::uuid, 'language-arts', 'Reading response', array['english-9','odyssey']),
    ('91000000-0000-4000-8000-000000000003'::uuid, 'science', 'Diagram', array['biology','cells']),
    ('91000000-0000-4000-8000-000000000004'::uuid, 'world-history', 'Timeline', array['civilizations','comparison']),
    ('91000000-0000-4000-8000-000000000005'::uuid, 'math', 'Practice set', array['algebra-i','equations']),
    ('91000000-0000-4000-8000-000000000006'::uuid, 'language-arts', 'Analytical paragraph', array['english-9','claim-evidence']),
    ('91000000-0000-4000-8000-000000000007'::uuid, 'science', 'Lab', array['biology','microscope']),
    ('91000000-0000-4000-8000-000000000008'::uuid, 'spanish', 'Oral recording', array['spanish-i','speaking']),
    ('91000000-0000-4000-8000-000000000009'::uuid, 'math', 'Quiz', array['algebra-i','linear-equations']),
    ('91000000-0000-4000-8000-000000000010'::uuid, 'language-arts', 'Revision', array['english-9','literary-analysis']),
    ('91000000-0000-4000-8000-000000000011'::uuid, 'science', 'Lab notes', array['biology','osmosis']),
    ('91000000-0000-4000-8000-000000000012'::uuid, 'world-history', 'Primary-source analysis', array['hammurabi','primary-sources']),
    ('91000000-0000-4000-8000-000000000013'::uuid, 'math', 'Practice set', array['algebra-i','systems']),
    ('91000000-0000-4000-8000-000000000014'::uuid, 'science', 'Lab conclusion', array['biology','osmosis','incomplete'])
  ) as mapping(evidence_id, slug, document_type, tags)
  join public.categories c on c.family_id = target_family and c.slug = mapping.slug
  on conflict (evidence_id, category_id) do update set
    confidence = excluded.confidence, document_type = excluded.document_type, tags = excluded.tags;

  insert into public.skill_observations
    (id, family_id, student_id, authored_by, author_type, subject, skill_key, skill_label, status, confidence, rationale, approval_status, reviewed_by, reviewed_at, created_at)
  values
    ('94000000-0000-4000-8000-000000000001', target_family, target_student, target_parent, 'parent', 'Algebra I', 'algebra.multi-step-equations', 'Solve multi-step linear equations', 'developing', .86, 'Solved 15 of 18 independently and corrected distribution errors with a worked example.', 'approved', target_parent, now(), current_date - interval '21 days'),
    ('94000000-0000-4000-8000-000000000002', target_family, target_student, target_parent, 'parent', 'Algebra I', 'algebra.graph-linear-equations', 'Graph linear equations and interpret slope', 'developing', .82, 'Quiz score was 84%; negative slope and standard-form conversion still need review.', 'approved', target_parent, now(), current_date - interval '14 days'),
    ('94000000-0000-4000-8000-000000000003', target_family, target_student, target_parent, 'parent', 'English 9', 'english.claim-evidence-reasoning', 'Explain how evidence supports a literary claim', 'developing', .84, 'Revision added specific commentary after both quotations; continued practice with precise analytical language is appropriate.', 'approved', target_parent, now(), current_date - interval '13 days'),
    ('94000000-0000-4000-8000-000000000004', target_family, target_student, target_parent, 'parent', 'English 9', 'english.revision', 'Revise writing using feedback', 'secure', .91, 'Used conference feedback to improve commentary and add a conclusion without changing the central claim.', 'approved', target_parent, now(), current_date - interval '13 days'),
    ('94000000-0000-4000-8000-000000000005', target_family, target_student, target_parent, 'parent', 'Biology', 'biology.cell-structure', 'Compare plant and animal cell structures', 'secure', .92, 'Accurately connected observed cell-wall differences to plant and animal cell diagrams.', 'approved', target_parent, now(), current_date - interval '19 days'),
    ('94000000-0000-4000-8000-000000000006', target_family, target_student, target_parent, 'parent', 'Biology', 'biology.experimental-reasoning', 'Use data to support a scientific conclusion', 'developing', .78, 'Data collection and graphing are complete; the written claim-evidence-reasoning conclusion remains unfinished.', 'approved', target_parent, now(), current_date - interval '5 days'),
    ('94000000-0000-4000-8000-000000000007', target_family, target_student, target_parent, 'parent', 'World History', 'history.primary-source-analysis', 'Evaluate a primary source and its limitations', 'developing', .88, 'Compared laws accurately and identified that written law does not prove consistent enforcement.', 'approved', target_parent, now(), current_date - interval '11 days'),
    ('94000000-0000-4000-8000-000000000008', target_family, target_student, target_parent, 'parent', 'Spanish I', 'spanish.personal-introduction', 'Give a short personal introduction', 'emerging', .76, 'Produced complete rehearsed sentences with understandable pronunciation; fluency pauses remain.', 'approved', target_parent, now(), current_date - interval '18 days')
  on conflict (id) do update set
    status = excluded.status, confidence = excluded.confidence, rationale = excluded.rationale,
    approval_status = excluded.approval_status, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;

  insert into public.observation_evidence (observation_id, evidence_id, family_id)
  values
    ('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005',target_family),
    ('94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000009',target_family),
    ('94000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000010',target_family),
    ('94000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000010',target_family),
    ('94000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000007',target_family),
    ('94000000-0000-4000-8000-000000000006','91000000-0000-4000-8000-000000000014',target_family),
    ('94000000-0000-4000-8000-000000000007','91000000-0000-4000-8000-000000000012',target_family),
    ('94000000-0000-4000-8000-000000000008','91000000-0000-4000-8000-000000000008',target_family)
  on conflict do nothing;

  insert into public.artifacts
    (id, family_id, student_id, created_by, type, title, summary, content, rationale, status, reviewed_by, reviewed_at, created_at, updated_at)
  values
    ('93000000-0000-4000-8000-000000000001', target_family, target_student, target_parent, 'dashboard', 'Jacob’s first-month learning dashboard', 'A grounded overview of the first four weeks of ninth grade.', jsonb_build_object(
      'student','Jacob','timeframe','First four weeks of ninth grade',
      'workedOn',jsonb_build_array(
        jsonb_build_object('area','Algebra I','status','Multi-step equations are developing; graphing linear equations needs targeted correction.'),
        jsonb_build_object('area','English 9','status','Literary claim and evidence are clear; analytical commentary improved after revision.'),
        jsonb_build_object('area','Biology','status','Cell structure is secure; the osmosis conclusion is unfinished.'),
        jsonb_build_object('area','World History','status','Primary-source comparison is developing with appropriate attention to limitations.'),
        jsonb_build_object('area','Spanish I','status','Personal introductions are emerging with understandable rehearsed speech.')
      ),
      'unfinished',jsonb_build_array('Finish the osmosis lab conclusion using two data points.','Review the two missed linear-equation quiz items.'),
      'parentAttention',jsonb_build_array('Confirm where Friday’s oral-practice note belongs.','Choose a short next text for English literary analysis.')
    ), 'Seeded from linked first-month evidence and approved observations.', 'approved', target_parent, now(), current_date - interval '8 days', current_date - interval '8 days'),
    ('93000000-0000-4000-8000-000000000002', target_family, target_student, target_parent, 'weekly_plan', 'Jacob’s week-five plan', 'A practical plan continuing current work without inventing new requirements.', jsonb_build_object(
      'student','Jacob','weekOf',to_char(current_date - extract(dow from current_date)::int + 1, 'YYYY-MM-DD'),
      'plan',jsonb_build_array(
        jsonb_build_object('order',1,'focus','Biology','activity','Write the osmosis conclusion using the existing graph and two specific data points.','suggestedDuration','35 minutes'),
        jsonb_build_object('order',2,'focus','Algebra I','activity','Correct the negative-slope and standard-form quiz items, then solve four similar problems.','suggestedDuration','30 minutes'),
        jsonb_build_object('order',3,'focus','English 9','activity','Read a short new passage and write one claim-evidence-commentary paragraph.','suggestedDuration','40 minutes'),
        jsonb_build_object('order',4,'focus','Spanish I','activity','Repeat the personal introduction without notes and add two follow-up questions.','suggestedDuration','20 minutes')
      ),
      'parentDecisionsNeeded',jsonb_build_array('Choose the English passage.','Confirm whether Friday oral practice belongs in Spanish.')
    ), 'Based on current approved skills, incomplete work, and recent evidence.', 'approved', target_parent, now(), current_date - interval '6 days', current_date - interval '6 days'),
    ('93000000-0000-4000-8000-000000000003', target_family, target_student, target_parent, 'portfolio', 'Jacob’s first-month portfolio selections', 'A draft set of representative work from the first month of ninth grade.', jsonb_build_object(
      'student','Jacob','period','First month of ninth grade',
      'selections',jsonb_build_array(
        jsonb_build_object('title','Revised literary analysis paragraph','why','Shows revision from evidence summary to analytical commentary.'),
        jsonb_build_object('title','Microscope lab','why','Shows careful observation and accurate comparison of cell structures.'),
        jsonb_build_object('title','Hammurabi primary-source comparison','why','Shows source comparison and recognition of a source limitation.')
      ),
      'parentDecision','Confirm these three selections and optionally add one Algebra example after quiz corrections.'
    ), 'Draft only; parent confirmation is required before this becomes an approved portfolio.', 'draft', null, null, current_date - interval '1 day', current_date - interval '1 day')
  on conflict (id) do update set
    title = excluded.title, summary = excluded.summary, content = excluded.content,
    rationale = excluded.rationale, status = excluded.status, reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at, created_at = excluded.created_at, updated_at = excluded.updated_at;

  insert into public.weekly_plan_items
    (id, family_id, artifact_id, student_id, scheduled_date, scheduled_time, position, title, description, estimated_minutes, subject, source_kind)
  values
    ('97000000-0000-4000-8000-000000000001', target_family, null, target_student, next_week_start, time '09:00', 1, 'Algebra I · Lesson 6', 'Continue the family curriculum: graph linear equations from slope-intercept form.', 45, 'Algebra I', 'parent'),
    ('97000000-0000-4000-8000-000000000002', target_family, null, target_student, next_week_start, time '10:15', 2, 'English 9 · The Odyssey', 'Read the assigned section and annotate one example of leadership.', 40, 'English 9', 'parent'),
    ('97000000-0000-4000-8000-000000000003', target_family, null, target_student, next_week_start, time '11:15', 3, 'Finish the osmosis conclusion', 'Use the existing graph and cite two specific data points.', 30, 'Biology', 'parent'),
    ('97000000-0000-4000-8000-000000000004', target_family, null, target_student, next_week_start + 1, time '09:00', 1, 'Algebra I · Lesson 7', 'Continue the scheduled curriculum lesson.', 45, 'Algebra I', 'parent'),
    ('97000000-0000-4000-8000-000000000005', target_family, null, target_student, next_week_start + 1, time '10:15', 2, 'World History · Chapter 3', 'Read the assigned section and complete the source questions.', 45, 'World History', 'parent'),
    ('97000000-0000-4000-8000-000000000006', target_family, null, target_student, next_week_start + 1, time '13:30', 3, 'Spanish I · Lesson 9', 'Complete the curriculum dialogue and vocabulary review.', 25, 'Spanish I', 'parent'),
    ('97000000-0000-4000-8000-000000000007', target_family, null, target_student, next_week_start + 2, time '09:00', 1, 'Algebra I · Lesson 8', 'Begin systems of equations in the family curriculum.', 45, 'Algebra I', 'parent'),
    ('97000000-0000-4000-8000-000000000008', target_family, null, target_student, next_week_start + 2, time '10:15', 2, 'Biology · Cell transport review', 'Review curriculum notes before the next lab.', 35, 'Biology', 'parent'),
    ('97000000-0000-4000-8000-000000000009', target_family, null, target_student, next_week_start + 3, time '09:30', 1, 'English 9 · Analytical paragraph', 'Use the curriculum prompt to write one claim-evidence-commentary paragraph.', 45, 'English 9', 'parent'),
    ('97000000-0000-4000-8000-000000000010', target_family, null, target_student, next_week_start + 3, time '11:00', 2, 'World History · Primary source', 'Complete the assigned document analysis.', 40, 'World History', 'parent'),
    ('97000000-0000-4000-8000-000000000011', target_family, null, target_student, next_week_start + 4, time '09:00', 1, 'Algebra I · Weekly review', 'Finish the curriculum review set and record the score.', 35, 'Algebra I', 'parent'),
    ('97000000-0000-4000-8000-000000000012', target_family, null, target_student, next_week_start + 4, time '10:00', 2, 'Spanish I · Oral check', 'Give the assigned personal introduction without notes.', 20, 'Spanish I', 'parent')
  on conflict (id) do update set
    scheduled_date = excluded.scheduled_date, scheduled_time = excluded.scheduled_time,
    position = excluded.position, title = excluded.title, description = excluded.description,
    estimated_minutes = excluded.estimated_minutes, subject = excluded.subject, updated_at = now();

  insert into public.artifact_sources (artifact_id, evidence_id, family_id, note)
  values
    ('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000009',target_family,'Algebra quiz'),
    ('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000010',target_family,'English revision'),
    ('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000014',target_family,'Incomplete Biology conclusion'),
    ('93000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000009',target_family,'Algebra follow-up'),
    ('93000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000014',target_family,'Biology follow-up'),
    ('93000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000010',target_family,'Portfolio selection'),
    ('93000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000007',target_family,'Portfolio selection'),
    ('93000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000012',target_family,'Portfolio selection')
  on conflict do nothing;

  insert into public.reminders
    (id, family_id, student_id, source_evidence_id, title, notes, due_at, status, created_by_type, created_by, confidence, rationale, created_at)
  values
    ('95000000-0000-4000-8000-000000000001', target_family, target_student, '91000000-0000-4000-8000-000000000014', 'Finish the Biology osmosis conclusion', 'Use the completed graph, state whether the hypothesis was supported, and cite two percent-change values.', current_date + interval '1 day' + time '16:00', 'pending', 'parent', target_parent, 1, 'Seeded follow-up for explicitly incomplete work.', current_date - interval '5 days'),
    ('95000000-0000-4000-8000-000000000002', target_family, target_student, '91000000-0000-4000-8000-000000000009', 'Review Algebra quiz corrections', 'Redo the negative-slope item and convert one equation from standard form before graphing.', current_date + interval '3 days' + time '10:00', 'pending', 'parent', target_parent, 1, 'Seeded follow-up from recorded quiz errors.', current_date - interval '2 days'),
    ('95000000-0000-4000-8000-000000000003', target_family, target_student, '91000000-0000-4000-8000-000000000008', 'Listen to Spanish introduction recording', 'Completed during week two review.', current_date - interval '15 days' + time '15:00', 'completed', 'parent', target_parent, 1, 'Seeded completed reminder.', current_date - interval '18 days')
  on conflict (id) do update set
    title = excluded.title, notes = excluded.notes, due_at = excluded.due_at,
    status = excluded.status, confidence = excluded.confidence, rationale = excluded.rationale;

  insert into public.approval_requests (id, family_id, entity_type, entity_id, status, created_at)
  values ('96000000-0000-4000-8000-000000000001', target_family, 'artifact', '93000000-0000-4000-8000-000000000003', 'pending', current_date - interval '1 day')
  on conflict (id) do update set status = excluded.status, entity_id = excluded.entity_id;

  insert into public.audit_events (family_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  select target_family, target_parent, 'system', 'development.seed_applied', 'student', target_student, '{"seed":"jacob-month-v1"}'::jsonb
  where not exists (
    select 1 from public.audit_events
    where family_id = target_family and action = 'development.seed_applied' and metadata->>'seed' = 'jacob-month-v1'
  );
end
$$;
