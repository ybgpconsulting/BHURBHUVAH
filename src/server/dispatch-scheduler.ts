import { addDays, format, parseISO } from 'date-fns';
import { getNextDeliveryDate, generateDispatch, publishDispatch, validateDispatch } from './dispatch-engine';

type TriggerType = 'cron' | 'manual_retry';

export async function runDispatchGeneration(
  db: D1Database,
  scheduledAt: Date,
  triggerType: TriggerType,
  requestedDate?: string,
  autoPublish = false,
) {
  const deliveryDate = requestedDate || getNextDeliveryDate(scheduledAt);
  let lastRun = await db.prepare(`
    SELECT id, attempt_number, status, result_json
    FROM dispatch_generation_runs WHERE delivery_date = ?
    ORDER BY attempt_number DESC LIMIT 1
  `).bind(deliveryDate).first<{ id: string; attempt_number: number; status: string; result_json: string | null }>();

  if (lastRun?.status === 'running') {
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const recovered = await db.prepare(`
      UPDATE dispatch_generation_runs
      SET status = 'failed', error_message = 'Generation attempt timed out and can be retried safely', completed_at = ?
      WHERE id = ? AND status = 'running' AND started_at < ?
    `).bind(new Date().toISOString(), lastRun.id, staleBefore).run();
    if (!recovered.meta.changes) throw new Error('A generation attempt for this delivery date is already running');
    lastRun = { ...lastRun, status: 'failed' };
  }

  if (lastRun?.status === 'succeeded' || lastRun?.status === 'needs_review') {
    return { skipped: true, delivery_date: deliveryDate, status: lastRun.status, result: lastRun.result_json ? JSON.parse(lastRun.result_json) : null };
  }
  if (lastRun?.status === 'running') throw new Error('A generation attempt for this delivery date is already running');
  if (triggerType === 'manual_retry' && lastRun?.status !== 'failed') {
    throw new Error('Only a failed scheduled generation can be retried');
  }

  const attemptNumber = (lastRun?.attempt_number || 0) + 1;
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO dispatch_generation_runs
      (id, delivery_date, attempt_number, trigger_type, status, started_at)
    VALUES (?, ?, ?, ?, 'running', ?)
  `).bind(id, deliveryDate, attemptNumber, triggerType, startedAt).run();

  try {
    const operator = await db.prepare(`
      SELECT id FROM users WHERE is_active = 1 AND role IN ('owner', 'manager')
      ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at LIMIT 1
    `).first<{ id: string }>();
    if (!operator) throw new Error('No active owner or manager is available to generate dispatch');

    const today = format(addDays(parseISO(deliveryDate), -1), 'yyyy-MM-dd');
    const expiryWindowEnd = format(addDays(parseISO(today), 7), 'yyyy-MM-dd');
    await db.prepare("UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE status = 'active' AND end_date < ?")
      .bind(new Date().toISOString(), today).run();
    await db.prepare(`
      INSERT INTO follow_up_tasks
        (id, customer_id, subscription_id, task_type, status, next_follow_up_date, created_by)
      SELECT lower(hex(randomblob(16))), s.customer_id, s.id, 'expiry_reminder', 'pending', s.end_date, ?
      FROM subscriptions s
      WHERE s.status = 'active' AND s.end_date >= ? AND s.end_date <= ?
        AND NOT EXISTS (
          SELECT 1 FROM follow_up_tasks f
          WHERE f.subscription_id = s.id AND f.task_type = 'expiry_reminder'
        )
    `).bind(operator.id, today, expiryWindowEnd).run();

    const generated = await generateDispatch(db, deliveryDate, operator.id);
    const validationErrors = await validateDispatch(db, generated.dispatchRunId);
    const published = autoPublish && validationErrors.length === 0;
    if (published) await publishDispatch(db, generated.dispatchRunId, operator.id);

    const status = validationErrors.length ? 'needs_review' : 'succeeded';
    const result = {
      dispatch_run_id: generated.dispatchRunId,
      generated_count: generated.generatedCount,
      total_orders: generated.totals.total_orders,
      total_quantity: generated.totals.total_quantity,
      validation_errors: validationErrors,
      published,
    };
    await db.prepare(`
      UPDATE dispatch_generation_runs
      SET status = ?, result_json = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `).bind(status, JSON.stringify(result), new Date().toISOString(), id).run();
    return { skipped: false, delivery_date: deliveryDate, status, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown generation failure';
    await db.prepare(`
      UPDATE dispatch_generation_runs
      SET status = 'failed', error_message = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `).bind(message, new Date().toISOString(), id).run();
    throw error;
  }
}

export async function scheduled(
  controller: ScheduledController,
  env: { DB: D1Database; DISPATCH_AUTO_PUBLISH?: string },
  executionContext: ExecutionContext,
) {
  executionContext.waitUntil(
    runDispatchGeneration(env.DB, new Date(controller.scheduledTime), 'cron', undefined, env.DISPATCH_AUTO_PUBLISH === 'true')
      .catch((error) => {
        console.error('Scheduled dispatch generation failed', error instanceof Error ? error.message : 'Unknown failure');
      }),
  );
}
