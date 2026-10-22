import { Hono } from 'hono';
import { authMiddleware } from './middleware/auth';
import { Env } from './types';
import { scheduled } from './dispatch-scheduler';
import auth from './api/auth';
import customers from './api/customers';
import products from './api/products';
import routesAPI from './api/routes';
import plans from './api/plans';
import subscriptions from './api/subscriptions';
import changes from './api/changes';
import dispatch from './api/dispatch';
import deliveries from './api/deliveries';
import followups from './api/followups';
import dashboard from './api/dashboard';
import reports from './api/reports';
import exportsAPI from './api/exports';
import users from './api/users';
import marketResearch from './api/market-research';

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && new URL(origin).origin !== new URL(c.req.url).origin) {
      return c.json({ error: 'Cross-origin request rejected' }, 403);
    }
  }
  await next();
});

app.use('*', authMiddleware);

app.route('/api/auth', auth);
app.route('/api/customers', customers);
app.route('/api/products', products);
app.route('/api/routes', routesAPI);
app.route('/api/plans', plans);
app.route('/api/subscriptions', subscriptions);
app.route('/api/changes', changes);
app.route('/api/dispatch', dispatch);
app.route('/api/deliveries', deliveries);
app.route('/api/followups', followups);
app.route('/api/dashboard', dashboard);
app.route('/api/reports', reports);
app.route('/api/exports', exportsAPI);
app.route('/api/users', users);
app.route('/api/market-research', marketResearch);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

app.notFound((c) => {
  if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not Found' }, 404);
  }
  return c.text('Not Found', 404);
});

export default {
  fetch: (request: Request, env: Env['Bindings'], executionContext: ExecutionContext) =>
    app.fetch(request, env, executionContext),
  scheduled,
};
export { app, scheduled };
