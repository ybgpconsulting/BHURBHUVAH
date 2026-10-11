CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_renewed_from
  ON subscriptions(renewed_from_id)
  WHERE renewed_from_id IS NOT NULL;
