-- Batch threshold approvals are useful calibration evidence, but they are not
-- equivalent to a reviewer inspecting one plan. Keeping a distinct signal
-- prevents confidence-threshold automation from recursively validating itself.

ALTER TABLE public.autopilot_learning_events
  DROP CONSTRAINT IF EXISTS autopilot_learning_events_signal_type_check;

ALTER TABLE public.autopilot_learning_events
  ADD CONSTRAINT autopilot_learning_events_signal_type_check
  CHECK (signal_type IN (
    'human_revision',
    'human_edit',
    'partial_approval',
    'clean_approval',
    'batch_approval',
    'dismissal',
    'execution_failure',
    'delayed_outcome'
  ));

ALTER TABLE public.autopilot_learning_events
  DROP CONSTRAINT IF EXISTS autopilot_learning_events_batch_trust_check;

ALTER TABLE public.autopilot_learning_events
  ADD CONSTRAINT autopilot_learning_events_batch_trust_check
  CHECK (signal_type <> 'batch_approval' OR trust_score <= 0.58);

COMMENT ON CONSTRAINT autopilot_learning_events_signal_type_check
  ON public.autopilot_learning_events IS
  'Batch approvals are lower-trust threshold decisions; objective execution outcomes remain separate evidence.';

COMMENT ON CONSTRAINT autopilot_learning_events_batch_trust_check
  ON public.autopilot_learning_events IS
  'Threshold-selected approvals cannot be stored with human-review trust.';
