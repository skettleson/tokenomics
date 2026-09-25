import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const root = '/Users/samuelkettleson/code/tokenomics/.design/candidate-b/sketch/src/';
const { CHARTS, SESSION_TABLE_SQL } = await import(root + 'analytics/charts.ts');
const { RULES } = await import(root + 'analytics/rules.ts');
const { SESSION_ROLLUP_SQL } = await import(root + 'analytics/analytics.ts');
await import(root + 'http.ts');
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(root + 'warehouse/migrations/001-init.sql', 'utf8'));
db.exec(`INSERT INTO source_file VALUES (1,'/x','claude_code',1,'{}','present',NULL,0);
INSERT INTO price VALUES ('std','anthropic','standard',NULL,3,15,3.75,6,0.3);
INSERT INTO price VALUES ('flag','anthropic','flagship','std',15,75,18.75,30,1.5);
INSERT INTO model VALUES (1,'claude-opus-5','flag');
INSERT INTO project VALUES (1,'/p','p');
INSERT INTO session VALUES ('claude_code:s1','s1',1,NULL,'t',2);
INSERT INTO request VALUES ('claude_code:msg_1',1,'claude_code','claude_code:s1',1,0,'2026-09-01','2026-W36','measured',100,9000000,500000,0,1000,0,9501100,NULL,0,2);`);

const ins = db.prepare(`INSERT INTO request VALUES (?,1,'claude_code',?,?,?,?,?,'measured',?,?,?,0,?,0,?,NULL,0,0)`);
db.exec(`INSERT INTO model VALUES (2,'claude-sonnet-5','std'); INSERT INTO model VALUES (3,'mystery-model',NULL);`);
for (let i = 0; i < 6; i++) {
  db.exec(`INSERT INTO session VALUES ('claude_code:q${i}','q${i}',1,NULL,'quick ${i}',2)`);
  ins.run(`m_q${i}`, `claude_code:q${i}`, 1, 0, '2026-09-15', '2026-W38', 800000, 200000, 100000, 5000, 1105000);
}
for (let i = 0; i < 3; i++) ins.run(`m_s${i}`, 'claude_code:s1', 2, 0, '2026-09-08', '2026-W37', 1000, 10000, 0, 100000, 111000);
ins.run('m_big', 'claude_code:s1', 1, 0, '2026-09-08', '2026-W37', 1000, 3000000, 0, 300000, 3301000);
ins.run('m_x', 'claude_code:s1', 3, 0, '2026-09-08', '2026-W37', 1000, 30000, 0, 0, 31000);
const scope = (extra) => `WITH f AS (SELECT *, day AS bucket FROM fact WHERE 1=1 ${extra}), ${SESSION_ROLLUP_SQL.trim()} `;
for (const c of CHARTS) console.log(c.id, db.prepare(scope('') + c.sql).all().length);
console.log('sessions', db.prepare(scope('') + SESSION_TABLE_SQL).all({ session_limit: 50 }).length);
for (const r of RULES) {
  const params = { ...r.params };
  if (r.sql.includes(':current_week')) params.current_week = '2026-W39';
  const rows = db.prepare(scope(r.requires === 'measured' ? "AND fidelity='measured'" : '').replace(/ $/, r.ctes ? ', ' + r.ctes + ' ' : ' ') + r.sql).all(params);
  console.log(r.id, JSON.stringify(rows));
}
try { db.exec(`INSERT INTO request VALUES ('bad',1,'claude_code',NULL,1,0,'2026-09-01','2026-W36','measured',1,1,1,1,1,0,999,NULL,0,0)`); console.log('CHECK MISSED'); } catch (e) { console.log('check ok:', e.message); }
