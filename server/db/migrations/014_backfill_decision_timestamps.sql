UPDATE cases
SET decided_at = COALESCE(closed_at, voided_at, created_at)
WHERE status IN ('closed', 'sealed', 'void')
  AND (decided_at IS NULL OR TRIM(decided_at) = '');
