const { pool } = require('../pool');

function mapTask(row){ if (!row) return null; const type = row.type || row.task_type; return { id: Number(row.id), name: row.name, type, reward_type: row.reward_type, reward_amount: Number(row.reward_amount||0), link: row.link || null, required_count: row.required_count!==null && row.required_count!==undefined ? Number(row.required_count) : null, active: Boolean(row.active), created_by: row.created_by ? Number(row.created_by) : null, created_at: row.created_at ? new Date(row.created_at) : null }; }

async function createTask(payload){ const client = await pool.connect(); try { const { name, type, reward_type, reward_amount, link=null, required_count=null, created_by=null } = payload || {}; const amount = Math.max(0, parseInt(reward_amount||0,10)||0); let hasLegacyTaskType = false; try { const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='custom_tasks'`); hasLegacyTaskType = cols.rows.some(r=> String(r.column_name) === 'task_type'); } catch (e) { hasLegacyTaskType = false; }
  let res;
  if (hasLegacyTaskType) {
    res = await client.query(`INSERT INTO custom_tasks (name, type, task_type, reward_type, reward_amount, link, required_count, created_by, active) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,true) RETURNING *`, [name, type, reward_type, amount, link, (required_count!==null && required_count!==undefined) ? Number(required_count) : null, created_by]);
  } else {
    res = await client.query(`INSERT INTO custom_tasks (name, type, reward_type, reward_amount, link, required_count, created_by, active) VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`, [name, type, reward_type, amount, link, (required_count!==null && required_count!==undefined) ? Number(required_count) : null, created_by]);
  }
  return mapTask(res.rows[0]); } finally { client.release(); } }

async function listTasks(includeInactive=false){ const client = await pool.connect(); try { const res = await client.query(`SELECT * FROM custom_tasks ${includeInactive?'':'WHERE active = true'} ORDER BY id DESC`); return res.rows.map(mapTask); } finally { client.release(); } }

async function isTaskCompleted(taskId, tgid){ const client = await pool.connect(); try { const res = await client.query('SELECT 1 FROM task_completions WHERE task_id=$1 AND tgid=$2', [taskId, tgid]); return res.rows.length>0; } finally { client.release(); } }

async function markTaskCompleted(taskId, tgid){ const client = await pool.connect(); try { await client.query('INSERT INTO task_completions (task_id, tgid, completed_at) VALUES ($1,$2, now()) ON CONFLICT DO NOTHING', [taskId, tgid]); return true; } finally { client.release(); } }

module.exports = { mapTask, createTask, listTasks, isTaskCompleted, markTaskCompleted };
