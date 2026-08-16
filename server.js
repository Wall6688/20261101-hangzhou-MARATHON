import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Client } from '@notionhq/client';

const app = express();
const port = Number(process.env.server_port || process.env.SERVER_PORT || 6000);
const databaseId = process.env.NOTION_DATABASE_ID || '3be59cf3eff480e28912c0a2d4121b71';
const notionToken = process.env.NOTION_TOKEN;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:6000,http://127.0.0.1:6000,https://wall6688.github.io')
  .split(',').map((value) => value.trim()).filter(Boolean);

if (!notionToken) console.warn('NOTION_TOKEN 未配置：健康检查可用，但训练数据接口会返回 503。');
const notion = notionToken ? new Client({ auth: notionToken }) : null;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin(origin, cb) { cb(null, !origin || allowedOrigins.includes(origin)); } }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static('public'));

const text = (property) => property?.rich_text?.map((item) => item.plain_text).join('') || '';
const title = (property) => property?.title?.map((item) => item.plain_text).join('') || '';
const number = (property) => property?.number ?? null;

function toWorkout(page) {
  const p = page.properties;
  return {
    id: page.id,
    url: page.url,
    name: title(p['名称']),
    date: p['日期']?.date?.start || '',
    week: number(p['周次']),
    weekday: p['星期']?.select?.name || '',
    type: p['类型']?.select?.name || '',
    plannedKm: number(p['计划公里']),
    plan: text(p['计划内容']),
    status: p['状态']?.status?.name || '未开始',
    completed: Boolean(p['已完成']?.checkbox),
    actualKm: number(p['实际公里']),
    durationMinutes: number(p['实际用时分钟']),
    pace: text(p['平均配速']),
    heartRate: number(p['平均心率']),
    rpe: number(p['体感RPE']),
    note: text(p['备注'])
  };
}

app.get('/api/health', (_req, res) => res.json({ ok: true, notionConfigured: Boolean(notion), date: new Date().toISOString() }));

app.get('/api/workouts', async (_req, res, next) => {
  try {
    if (!notion) return res.status(503).json({ error: '服务器尚未配置 NOTION_TOKEN' });
    const rows = [];
    let cursor;
    do {
      const response = await notion.databases.query({ database_id: databaseId, start_cursor: cursor, page_size: 100 });
      rows.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);
    res.json(rows.map(toWorkout).sort((a, b) => a.date.localeCompare(b.date)));
  } catch (error) { next(error); }
});

app.patch('/api/workouts/:id', async (req, res, next) => {
  try {
    if (!notion) return res.status(503).json({ error: '服务器尚未配置 NOTION_TOKEN' });
    const body = req.body || {};
    const num = (value, min, max) => value === '' || value == null ? null : Math.min(max, Math.max(min, Number(value)));
    const completed = Boolean(body.completed);
    const properties = {
      '已完成': { checkbox: completed },
      '状态': { status: { name: completed ? '完成' : '未开始' } },
      '实际公里': { number: num(body.actualKm, 0, 100) },
      '实际用时分钟': { number: num(body.durationMinutes, 0, 1440) },
      '平均配速': { rich_text: body.pace ? [{ text: { content: String(body.pace).slice(0, 30) } }] : [] },
      '平均心率': { number: num(body.heartRate, 0, 250) },
      '体感RPE': { number: num(body.rpe, 1, 10) },
      '备注': { rich_text: body.note ? [{ text: { content: String(body.note).slice(0, 1800) } }] : [] }
    };
    const page = await notion.pages.update({ page_id: req.params.id, properties });
    res.json(toWorkout(page));
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.body?.message || error.message || '服务器错误' });
});

app.listen(port, '0.0.0.0', () => console.log(`Marathon API listening on :${port}`));

