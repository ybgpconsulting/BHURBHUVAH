import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const environment = process.argv[2] || 'production';
if (!['staging', 'production'].includes(environment)) {
  console.error('Deployment validation supports only the staging or production environment.');
  process.exit(1);
}
const environmentDatabase = config.match(new RegExp(
  `\\[env\\.${environment}\\.d1_databases\\][\\s\\S]*?database_id\\s*=\\s*"([^"]+)"`,
));

if (!environmentDatabase || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(environmentDatabase[1])) {
  console.error(`Deployment blocked: set a valid ${environment} D1 database_id in wrangler.toml first.`);
  process.exit(1);
}
const variablesSection = config.match(new RegExp(
  `\\[env\\.${environment}\\.vars\\]([\\s\\S]*?)(?=\\n\\[|$)`,
))?.[1] || '';
if (/SESSION_SECRET\s*=/.test(config)) {
  console.error('Deployment blocked: SESSION_SECRET must not be stored in wrangler.toml.');
  process.exit(1);
}

function validateSchedule(time, cron) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time || '');
  if (!match) throw new Error('Dispatch generation time must use 24-hour HH:mm format.');
  const utcMinutes = (Number(match[1]) * 60 + Number(match[2]) - 330 + 1440) % 1440;
  const expected = `${utcMinutes % 60} ${Math.floor(utcMinutes / 60)} * * *`;
  if (cron !== expected) throw new Error(`Cron ${cron} does not match ${time} Asia/Kolkata (expected ${expected}).`);
}

const configuredVars = variablesSection;
const configuredTriggers = config.match(new RegExp(
  `\\[env\\.${environment}\\.triggers\\]([\\s\\S]*?)(?=\\n\\[|$)`,
))?.[1] || '';
const getValue = (section, key) => section.match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`))?.[1];
const getCron = (section) => section.match(/crons\s*=\s*\[\s*"([^"]+)"\s*\]/)?.[1];

try {
  validateSchedule(getValue(configuredVars, 'DISPATCH_GENERATION_TIME'), getCron(configuredTriggers));
} catch (error) {
  console.error(`Deployment blocked: ${error.message}`);
  process.exit(1);
}

console.log(`${environment} D1 binding and scheduled dispatch time validated. Confirm migrations, backup, and SESSION_SECRET before deployment.`);
