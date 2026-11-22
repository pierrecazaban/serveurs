// The agent's timetable on the VPS (Paris time), replacing the Mac's launchd jobs.
//   Pierre's account only: 10:30 daily (15 invitations, 2 reposts) · every 30 min watch · every 5 min notifier
import { spawn } from 'node:child_process';
const run = (args, port) => new Promise((done) => {
  const p = spawn('node', args, { env: { ...process.env, CDP_PORT: port }, stdio: 'inherit' });
  p.on('exit', done);
});
const jobs = [
  { at: '10:30', args: ['agent.mjs', 'daily'], port: '9333' },
  { every: 30, args: ['agent.mjs', 'watch'], port: '9333' },
  { every: 5, args: ['notifier.mjs'], port: '9333' },
];
const running = new Set();
setInterval(async () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const j of jobs) {
    const due = j.at ? j.at === hm : (minutes - (j.offset ?? 0)) % j.every === 0;
    const key = j.args.join(' ') + j.port;
    if (!due || running.has(key)) continue;
    running.add(key);
    run(j.args, j.port).finally(() => running.delete(key));
  }
}, 60 * 1000);
console.log('scheduler started', new Date().toISOString());
