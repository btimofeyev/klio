alter table public.curriculum_units
  add column attention_mode text not null default 'unspecified'
    constraint curriculum_units_attention_mode_check
    check (attention_mode in ('unspecified', 'parent_led', 'independent', 'flexible')),
  add column parent_attention_minutes integer
    constraint curriculum_units_parent_attention_minutes_check
    check (parent_attention_minutes is null or parent_attention_minutes between 1 and 480),
  add constraint curriculum_units_attention_shape_check check (
    (attention_mode = 'flexible' and parent_attention_minutes is not null)
    or
    (attention_mode <> 'flexible' and parent_attention_minutes is null)
  );

alter table public.assignments
  add column attention_mode text
    constraint assignments_attention_mode_check
    check (attention_mode is null or attention_mode in ('unspecified', 'parent_led', 'independent', 'flexible')),
  add column parent_attention_minutes integer
    constraint assignments_parent_attention_minutes_check
    check (parent_attention_minutes is null or parent_attention_minutes between 1 and 480),
  add constraint assignments_attention_shape_check check (
    (attention_mode = 'flexible' and parent_attention_minutes is not null)
    or
    (attention_mode is distinct from 'flexible' and parent_attention_minutes is null)
  );

comment on column public.curriculum_units.attention_mode is
  'Parent-attention default: unspecified, parent_led, independent, or flexible.';
comment on column public.curriculum_units.parent_attention_minutes is
  'Required parent-led introduction minutes when the curriculum default is flexible.';
comment on column public.assignments.attention_mode is
  'Nullable assignment override; null inherits the curriculum-unit default.';
comment on column public.assignments.parent_attention_minutes is
  'Required parent-led introduction minutes when the assignment override is flexible.';
