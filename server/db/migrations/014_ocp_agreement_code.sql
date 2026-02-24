-- Add OCP agreement code for Court-OCP dispute linkage.
-- When a case references an OCP agreement, parties are notified via agreement_dispute_filed.
ALTER TABLE cases ADD COLUMN agreement_code TEXT;
