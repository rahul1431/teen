-- Add selfie_path to kyc_documents (using local storage instead of S3)
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS selfie_path TEXT;

-- Widen kyc_documents to support resubmission (status can go back to under_review)
-- The s3_front_key and s3_back_key columns serve as local file paths

-- Add submitted_at for tracking when the user last submitted docs
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NOW();

-- Index for admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_documents (status);
CREATE INDEX IF NOT EXISTS idx_kyc_submitted_at ON kyc_documents (submitted_at DESC);
