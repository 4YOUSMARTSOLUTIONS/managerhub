ALTER TABLE area_goal_entries
  ADD COLUMN IF NOT EXISTS numerator_value numeric,
  ADD COLUMN IF NOT EXISTS denominator_value numeric;
