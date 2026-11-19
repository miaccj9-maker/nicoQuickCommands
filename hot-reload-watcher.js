/**
 * nicoQuickCommands 热更新哨兵
 *
 * 用法：双击 start-hot-reload.cmd，或 `node hot-reload-watcher.js`
 *
 * - 本扩展目录有文件变化 -> 写 mode=self，扩展只热替换自身，不刷新整页
 * - 其他扩展目录有变化（安装/卸载/更新） -> 写 mode=reload，扩展自动刷新页面
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const selfDir = __dirname;
const tokenFile = path.join(selfDir, 'hot-reload.json');

// 安装目录：.../SillyTavern/data/default-user/extensions/nicoQuickCommands-v1.6.0
// 向上四级即 SillyTavern 根目录；也可用环境变量 ST_ROOT 覆盖
const stRoot = process.env.ST_ROOT || path.resolve(selfDir, '..', '..', '..', '..');

const watchRoots = [
    path.join(stRoot, 'data', 'default-user', 'extensions'),
    path.join(stRoot, 'public', 'scripts', 'extensions', 'third-party'),
];

let pendingMode = null;
let pendingFile = '';
let timer = null;

function writeToken(mode, file) {
    const payload = {
        token: Date.now(),
        mode: mode || 'none',
        file: file || '',
        time: new Date().toISOString(),
    };
    try {
        fs.writeFileSync(tokenFile, JSON.stringify(payload), 'utf8');
    } catch (e) {
        console.error('[nqc-hot-watcher] 写入 token 失败:', e.message);
    }
}

function schedule(mode, file) {
    if (mode === 'reload') pendingMode = 'reload';
    else if (pendingMode !== 'reload') pendingMode = 'self';
    pendingFile = file || pendingFile;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        writeToken(pendingMode || 'self', pendingFile);
        pendingMode = null;
        pendingFile = '';
        timer = null;
    }, 1200);
}

// 初始 token，避免页面刚加载就被触发
writeToken('none', '');
console.log('[nqc-hot-watcher] 监听中：' + stRoot);

for (const root of watchRoots) {
    if (!fs.existsSync(root)) {
        console.warn('[nqc-hot-watcher] 目录不存在，跳过:', root);
        continue;
    }
    try {
        fs.watch(root, { recursive: true }, (eventType, filename) => {
            if (!filename) return;
            const full = path.join(root, filename);
            if (full === tokenFile || path.basename(full) === 'hot-reload.json') return;
            const isSelf = full === selfDir || full.startsWith(selfDir + path.sep);
            schedule(isSelf ? 'self' : 'reload', full);
        });
        console.log('[nqc-hot-watcher] 监听:', root);
    } catch (e) {
        console.error('[nqc-hot-watcher] 监听失败:', root, e.message);
    }
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
