import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Client } from '@notionhq/client';
import initSqlJs from 'sql.js';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

const app = express();
const port = Number(process.env.server_port || process.env.SERVER_PORT || 6000);
const databaseId = process.env.NOTION_DATABASE_ID || '3be59cf3eff480e28912c0a2d4121b71';
const notionToken = process.env.NOTION_TOKEN;
const dataDir = process.env.DATA_DIR || '/app/data';
const sqliteFile = path.join(dataDir, 'marathon.sqlite');
const legacyCacheFile = path.join(dataDir, 'workouts-cache.json');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:6080,http://127.0.0.1:6080')
  .split(',').map((value) => value.trim()).filter(Boolean);
const notion = notionToken ? new Client({ auth: notionToken }) : null;

const SQL = await initSqlJs({ locateFile: (file) => path.join(process.cwd(), 'node_modules/sql.js/dist', file) });
await mkdir(dataDir, { recursive: true });
let db;
try { db = new SQL.Database(await readFile(sqliteFile)); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  db = new SQL.Database();
}

db.run(`
  CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY, url TEXT, name TEXT NOT NULL, date TEXT NOT NULL,
    week INTEGER, weekday TEXT, type TEXT, planned_km REAL, plan TEXT,
    status TEXT DEFAULT '未开始', completed INTEGER DEFAULT 0,
    actual_km REAL, duration_minutes REAL, pace TEXT, heart_rate REAL,
    rpe REAL, note TEXT, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
  CREATE TABLE IF NOT EXISTS sync_queue (
    workout_id TEXT PRIMARY KEY, payload TEXT NOT NULL, queued_at TEXT NOT NULL,
    attempts INTEGER DEFAULT 0, last_error TEXT,
    FOREIGN KEY(workout_id) REFERENCES workouts(id)
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

const persistDb = async () => {
  const tempFile = `${sqliteFile}.tmp`;
  await writeFile(tempFile, Buffer.from(db.export()));
  await rename(tempFile, sqliteFile);
};
const all = (sql, params = []) => {
  const statement = db.prepare(sql);
  statement.bind(params);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
};
const one = (sql, params = []) => all(sql, params)[0] || null;
const count = (table) => Number(one(`SELECT COUNT(*) AS total FROM ${table}`)?.total || 0);
const normalizeId = (id = '') => id.replaceAll('-', '');
const now = () => new Date().toISOString();

const workoutFromRow = (row) => ({
  id: row.id, url: row.url || '', name: row.name, date: row.date,
  week: row.week, weekday: row.weekday || '', type: row.type || '',
  plannedKm: row.planned_km, plan: row.plan || '', status: row.status || '未开始',
  completed: Boolean(row.completed), actualKm: row.actual_km,
  durationMinutes: row.duration_minutes, pace: row.pace || '',
  heartRate: row.heart_rate, rpe: row.rpe, note: row.note || '',
  syncStatus: row.sync_status || 'synced'
});
const selectWorkouts = () => all(`
  SELECT w.*, CASE WHEN q.workout_id IS NULL THEN 'synced' ELSE 'pending' END AS sync_status
  FROM workouts w LEFT JOIN sync_queue q ON q.workout_id=w.id ORDER BY w.date
`).map(workoutFromRow);
const upsertWorkout = (w) => db.run(`
  INSERT INTO workouts (id,url,name,date,week,weekday,type,planned_km,plan,status,completed,
    actual_km,duration_minutes,pace,heart_rate,rpe,note,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET url=excluded.url,name=excluded.name,date=excluded.date,
    week=excluded.week,weekday=excluded.weekday,type=excluded.type,planned_km=excluded.planned_km,
    plan=excluded.plan,status=excluded.status,completed=excluded.completed,
    actual_km=excluded.actual_km,duration_minutes=excluded.duration_minutes,
    pace=excluded.pace,heart_rate=excluded.heart_rate,rpe=excluded.rpe,
    note=excluded.note,updated_at=excluded.updated_at
`, [normalizeId(w.id), w.url || '', w.name, w.date, w.week, w.weekday, w.type,
  w.plannedKm, w.plan, w.status || '未开始', w.completed ? 1 : 0, w.actualKm,
  w.durationMinutes, w.pace || '', w.heartRate, w.rpe, w.note || '', now()]);

if (count('workouts') === 0) {
  try {
    const legacy = JSON.parse(await readFile(legacyCacheFile, 'utf8'));
    const rows = Array.isArray(legacy) ? legacy : legacy.workouts || [];
    db.run('BEGIN');
    for (const row of rows) upsertWorkout(row);
    db.run('COMMIT');
    await persistDb();
    console.log(`Migrated ${rows.length} workouts from JSON cache to SQLite`);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('SQLite 初始数据迁移失败：', error.message);
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin(origin, cb) { cb(null, !origin || allowedOrigins.includes(origin)); } }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static('public'));

const richText = (property) => property?.rich_text?.map((item) => item.plain_text).join('') || '';
const title = (property) => property?.title?.map((item) => item.plain_text).join('') || '';
const notionWorkout = (page) => {
  const p = page.properties;
  return { id: normalizeId(page.id), url: page.url, name: title(p['名称']),
    date: p['日期']?.date?.start || '', week: p['周次']?.number ?? null,
    weekday: p['星期']?.select?.name || '', type: p['类型']?.select?.name || '',
    plannedKm: p['计划公里']?.number ?? null, plan: richText(p['计划内容']),
    status: p['状态']?.status?.name || '未开始', completed: Boolean(p['已完成']?.checkbox),
    actualKm: p['实际公里']?.number ?? null, durationMinutes: p['实际用时分钟']?.number ?? null,
    pace: richText(p['平均配速']), heartRate: p['平均心率']?.number ?? null,
    rpe: p['体感RPE']?.number ?? null, note: richText(p['备注']) };
};
const sanitize = (body = {}) => {
  const num = (value, min, max) => value === '' || value == null ? null : Math.min(max, Math.max(min, Number(value)));
  return { completed: Boolean(body.completed), actualKm: num(body.actualKm, 0, 100),
    durationMinutes: num(body.durationMinutes, 0, 1440), pace: body.pace ? String(body.pace).slice(0, 30) : '',
    heartRate: num(body.heartRate, 0, 250), rpe: num(body.rpe, 1, 10),
    note: body.note ? String(body.note).slice(0, 1800) : '' };
};
const notionProperties = (u) => ({
  '已完成': { checkbox: u.completed }, '状态': { status: { name: u.completed ? '完成' : '未开始' } },
  '实际公里': { number: u.actualKm }, '实际用时分钟': { number: u.durationMinutes },
  '平均配速': { rich_text: u.pace ? [{ text: { content: u.pace } }] : [] },
  '平均心率': { number: u.heartRate }, '体感RPE': { number: u.rpe },
  '备注': { rich_text: u.note ? [{ text: { content: u.note } }] : [] }
});

let pushRunning = false;
async function pushQueue() {
  if (!notion || pushRunning) return;
  pushRunning = true;
  try {
    for (const item of all('SELECT * FROM sync_queue ORDER BY queued_at')) {
      try {
        const page = await notion.pages.update({ page_id: item.workout_id, properties: notionProperties(JSON.parse(item.payload)) });
        upsertWorkout(notionWorkout(page));
        db.run('DELETE FROM sync_queue WHERE workout_id=?', [item.workout_id]);
        await persistDb();
      } catch (error) {
        db.run('UPDATE sync_queue SET attempts=attempts+1,last_error=? WHERE workout_id=?', [String(error.message).slice(0, 500), item.workout_id]);
        await persistDb();
        console.warn(`Notion 写入等待重试 ${item.workout_id}:`, error.message);
      }
    }
  } finally { pushRunning = false; }
}

let pullRunning = false;
async function pullNotion() {
  if (!notion || pullRunning) return;
  pullRunning = true;
  try {
    const pages = []; let cursor;
    do {
      const result = await notion.databases.query({ database_id: databaseId, start_cursor: cursor, page_size: 100 });
      pages.push(...result.results); cursor = result.has_more ? result.next_cursor : undefined;
    } while (cursor);
    const pending = new Set(all('SELECT workout_id FROM sync_queue').map((row) => row.workout_id));
    db.run('BEGIN');
    for (const page of pages) { const row = notionWorkout(page); if (!pending.has(row.id)) upsertWorkout(row); }
    db.run('COMMIT');
    db.run("INSERT INTO meta(key,value) VALUES('last_notion_pull',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [now()]);
    await persistDb();
  } catch (error) { console.warn('Notion 拉取失败，SQLite 继续服务：', error.message); }
  finally { pullRunning = false; }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: 'sqlite', workouts: count('workouts'),
  pendingUpdates: count('sync_queue'), notionConfigured: Boolean(notion),
  lastNotionPull: one("SELECT value FROM meta WHERE key='last_notion_pull'")?.value || null, date: now() }));
app.get('/api/workouts', (_req, res) => res.json(selectWorkouts()));
app.patch('/api/workouts/:id', async (req, res, next) => {
  try {
    const id = normalizeId(req.params.id);
    if (!one('SELECT id FROM workouts WHERE id=?', [id])) return res.status(404).json({ error: '找不到该训练任务' });
    const u = sanitize(req.body);
    db.run(`UPDATE workouts SET status=?,completed=?,actual_km=?,duration_minutes=?,pace=?,
      heart_rate=?,rpe=?,note=?,updated_at=? WHERE id=?`, [u.completed ? '完成' : '未开始',
      u.completed ? 1 : 0, u.actualKm, u.durationMinutes, u.pace, u.heartRate, u.rpe, u.note, now(), id]);
    db.run(`INSERT INTO sync_queue(workout_id,payload,queued_at,attempts,last_error) VALUES(?,?,?,0,NULL)
      ON CONFLICT(workout_id) DO UPDATE SET payload=excluded.payload,queued_at=excluded.queued_at,attempts=0,last_error=NULL`,
      [id, JSON.stringify(u), now()]);
    await persistDb();
    res.status(202).json(workoutFromRow({ ...one('SELECT * FROM workouts WHERE id=?', [id]), sync_status: 'pending' }));
    pushQueue();
  } catch (error) { next(error); }
});
app.use((error, _req, res, _next) => {
  console.error(error); res.status(error.status || 500).json({ error: error.body?.message || error.message || '服务器错误' });
});

pushQueue(); pullNotion();
setInterval(pushQueue, 60 * 1000).unref();
setInterval(pullNotion, 10 * 60 * 1000).unref();
app.listen(port, '0.0.0.0', () => console.log(`Marathon API :${port}, SQLite ${count('workouts')} workouts`));
