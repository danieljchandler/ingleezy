-- Create trending video candidates table
CREATE TABLE trending_video_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  video_id text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  creator_name text NOT NULL,
  creator_handle text,
  thumbnail_url text,
  view_count bigint,
  trending_score integer,
  detected_topic text,
  discovered_at timestamp with time zone DEFAULT now(),
  processed boolean DEFAULT false,
  rejected boolean DEFAULT false,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(platform, video_id)
);

-- Enable RLS
ALTER TABLE trending_video_candidates ENABLE ROW LEVEL SECURITY;

-- Admin policies
CREATE POLICY "Admins can view all candidates"
ON trending_video_candidates
FOR SELECT
USING (is_admin());

CREATE POLICY "Admins can insert candidates"
ON trending_video_candidates
FOR INSERT
WITH CHECK (is_admin());

CREATE POLICY "Admins can update candidates"
ON trending_video_candidates
FOR UPDATE
USING (is_admin());

CREATE POLICY "Admins can delete candidates"
ON trending_video_candidates
FOR DELETE
USING (is_admin());

-- Add trigger for updated_at
CREATE TRIGGER update_trending_video_candidates_updated_at
BEFORE UPDATE ON trending_video_candidates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();