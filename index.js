/**
 * nicoQuickCommands —— 酒馆快捷指令侧滑面板
 * ------------------------------------------------------------
 * 唤醒：从屏幕左边缘向右滑动 / 按住左边缘向右拖拽（鼠标、触屏均可）
 * 面板：iOS 风格极简侧栏（分段控件 / 分组卡片 / 细线分隔 / 实色底），固定于左侧，无水印
 * 点击指令项 → 注入酒馆输入框，支持新增/删除指令，本地持久化
 *
 * v1.2.0 新增：
 * - 双页指令面板：页签「第1页 / 第2页」自由切换，两页指令相互独立；
 * - 第二页与第一页交互完全一致：同样支持新增/删除指令、回车确认、本地持久化；
 * - 页签切换只重渲染当前页列表（DocumentFragment 批量插入），不重建面板、不卡顿。
 *
 * v1.3.0 新增（聊天存档并入）：
 * - 原 nicoDrawPanel 第二页「聊天存档管理器」整体迁入，固定在指令列表下方；
 * - 角色折叠为文件夹，点开角色文件夹后再展开该角色的存档列表；
 * - 备注 / 存档专属头像 / 一键加载 / ＋新聊天 / 刷新 / 筛选 / 当前标记全部保留；
 * - 数量懒加载（首次打开面板才请求）、并发限流 5、超时 20s、列表缓存、渲染串行化；
 * - 存储键沿用 chat-archive-manager，旧备注与专属头像无缝继承。
 *
 * v1.4.0 改版（iOS / iMessage 风格）：
 * - 顶部换成「当前角色头像 ＋ 用户面具头像」交叠双圆 + 下方「用户名 & 角色名」，
 *   面具切换（PERSONA_CHANGED 等）即时刷新；原闪电图标与「快捷指令」标题行移除；
 * - 月亮按钮改为右上角浮动小圆钮；页签改为胶囊分段控件，选中态纯白、无直角；
 * - 存档区改为角色圆形头像横滑条：初始只显示头像 + 名字，点头像在下方展开存档；
 * - 存档行改为 iMessage 会话气泡：头像 / 标题 / 当前标记 / 时间 / 条数 / 预览 / 备注 / 加载，
 *   备注、专属头像、加载、＋新聊天、刷新、筛选、数量懒加载、当前标记全部保留。
 *
 * v1.5.0 更新：
 * - 切换存档不再「先闪一下别的存档」：同角色直接 openCharacterChat；跨角色先补全角色、
 *   把角色指针预置为目标存档再走原生 selectCharacterById，末态校验 chatId 是否真的落到目标；
 * - 切换/删除加串行锁与行级加载反馈；切换期间忽略 CHAT_CHANGED / CHAT_LOADED 的中间态刷新；
 * - 新增删除存档：二次确认弹窗 + 官方删除链路（自动修正角色指针）+ 删除后回读核对，
 *   只清理这一条档案的备注与专属头像；当前存档同样可删，删除后自动切到剩余最新存档/新建聊天。
 *
 * v1.5.1 更新：当前存档也显示删除入口（删除前明确提示会自动切换），夜间模式改为更深的层次黑。
 *
 * 纯前端扩展，不修改 SillyTavern 核心代码；禁用或删除本扩展即可完全移除。
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../../scripts/extensions.js';

const MODULE_NAME = 'nicoQuickCommands';
const MODULE_VERSION = '1.5.1';

// 默认指令（可增删，改动保存在扩展设置中，本地持久化）
const DEFAULT_COMMANDS = [
    '（＄继续剧情，禁止替我做出任何举动或者说出任何话，禁止错乱剧情）',
    '（＄在角色状态栏下方新增可折叠的情感论坛状态栏。char为楼主匿名求助。回复帖子的评论不得少于20条，char回复的评论ID为楼主。）',
    '（＄在角色状态栏下方新增朋友圈html格式的模块。确保ui写实。要有char和NPC的朋友圈内容，同时也要有点赞和评论，跟随剧情更新。禁止单一重复内容。）',
    '（＄在角色状态栏下方添加物品碎碎念的折叠栏。内容为剧情当前的周围NPC或物品的碎碎念，不得少于15条，不得重复，要跟随剧情更新变化。）',
];

// 初始化扩展设置（兼容旧数据：缺字段时补默认值）
// 旧版默认指令（7条，v1.0.0）——完整匹配时迁移为新默认（去掉第2/3/6条）
const OLD_DEFAULT_COMMANDS = [
    '（＄继续剧情，禁止替我做出任何举动或者说出任何话，禁止错乱剧情）',
    '（＄读取char的人物性格设定生成，绝对禁止ooc，禁止输出八股文叙述和塑造八股三次男人物）',
    '（＄角色状态栏的WeChat聊天模块输出的内容禁止错乱，NPC在左侧，char在右侧。绝对禁止重复内容。）',
    '（＄在角色状态栏下方新增可折叠的情感论坛状态栏。char为楼主匿名求助。回复帖子的评论不得少于20条，char回复的评论ID为楼主。）',
    '（＄在角色状态栏下方新增朋友圈html格式的模块。确保ui写实。要有char和NPC的朋友圈内容，同时也要有点赞和评论，跟随剧情更新。禁止单一重复内容。）',
    '（＄小手机格式禁止错乱，确保user在右侧，char在左侧。头像禁止错乱。聊天内容要跟随剧情续写。）',
    '（＄在角色状态栏下方添加物品碎碎念的折叠栏。内容为剧情当前的周围NPC或物品的碎碎念，不得少于15条，不得重复，要跟随剧情更新变化。）',
];

if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = { commands: DEFAULT_COMMANDS.slice(), commands2: [], nightMode: false };
}
const settings = extension_settings[MODULE_NAME];

// 日/夜切换图标：细线 SVG（不依赖酒馆主题的 Font Awesome 版本，渲染更稳定）
const NIGHT_ICON_MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
const NIGHT_ICON_SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
// 兼容旧数据：缺 nightMode 字段时补默认（日间）
if (typeof settings.nightMode !== 'boolean') settings.nightMode = false;
// 旧版默认列表完整匹配时 → 替换为新默认（已自定义过的列表不受影响）
if (Array.isArray(settings.commands) && settings.commands.length === OLD_DEFAULT_COMMANDS.length &&
    OLD_DEFAULT_COMMANDS.every((c, i) => settings.commands[i] === c)) {
    settings.commands = DEFAULT_COMMANDS.slice();
    saveSettingsDebounced();
}
if (!Array.isArray(settings.commands) || settings.commands.length === 0) {
    settings.commands = DEFAULT_COMMANDS.slice();
}
// 第二页指令列表（v1.2.0）：与第一页相互独立，默认空，支持增删，本地持久化
if (!Array.isArray(settings.commands2)) settings.commands2 = [];

// ========== 参数 ==========
const EDGE_WIDTH = 40;      // 左边缘触发宽度（px）
const SWIPE_THRESHOLD = 30; // 向右滑动打开阈值（px）
const PANEL_HIDDEN_OFFSET = 342; // 与 CSS #nqc-panel left:-342px 保持一致

// ========== 状态 ==========
let panel = null;
let mask = null;
let listEl = null;
let idNameEl = null;
let idCharImg = null;
let idUserImg = null;
let addBtn = null;
let addRow = null;
let inputEl = null;
let isOpen = false;
let activePage = 1; // 当前页：1=第一页 2=第二页
let tabBtns = [];

// 手势状态
let startX = 0;
let startY = 0;
let isEdgeTouch = false;
let isMouseDown = false;
let ticking = false; // rAF 节流锁

// ========== Toast（存档加载 / 新聊天等轻反馈） ==========

let nqcToastEl = null;
let nqcToastTimer = null;

function nqcToast(msg) {
    if (!msg) return;
    if (!nqcToastEl) {
        nqcToastEl = document.createElement('div');
        nqcToastEl.className = 'nqc-toast';
        document.body.appendChild(nqcToastEl);
    }
    nqcToastEl.textContent = msg;
    // 强制重排以重播淡入动画（连续提示时不叠加多个 Toast）
    void nqcToastEl.offsetWidth;
    nqcToastEl.classList.add('show');
    clearTimeout(nqcToastTimer);
    nqcToastTimer = setTimeout(() => nqcToastEl.classList.remove('show'), 1600);
}

// ========== 聊天存档区（原 nicoDrawPanel 第二页完整迁入） ==========
/* 功能与迁出前完全一致：按角色归档 / 展开查看存档 / 备注 / 存档专属头像 / 一键加载 /
   ＋新聊天 / 数量懒加载 / 并发限流 5 / 请求超时 20s / 列表缓存 / 渲染串行化 / 当前标记；
   存储仍用 extension_settings['chat-archive-manager']，旧备注与专属头像无缝继承；
   首次打开面板才发起网络请求，启动阶段零请求、零列表渲染；
   扩展重载时解绑旧事件、断开旧 Observer、清理定时器，不叠加、不卡顿。 */
var nqcArchive = (function(){
    var MODULE_NAME = 'chat-archive-manager';
    var MODULE_VERSION = '1.3.0-merged';

    /* ---------- 酒馆上下文桥接（防御式，取不到不拖垮主面板） ---------- */
    function getContext(){
        try{
            if(window.SillyTavern && typeof window.SillyTavern.getContext==='function') return window.SillyTavern.getContext();
        }catch(e){}
        return null;
    }
    // setActiveGroup / saveChatDebounced 未挂在 getContext() 上：动态 import 一次（ESM 缓存，不会重复执行酒馆主模块）
    var arcMod = { setActiveGroup:null, saveChatDebounced:null, doNewChat:null, createOrEditCharacter:null, deleteCharacterChatByName:null, replaceCurrentChat:null };
    var arcModReady = Promise.resolve();
    try{
        arcModReady = import('../../../../script.js').then(function(m){
            if(m && typeof m.setActiveGroup==='function') arcMod.setActiveGroup = m.setActiveGroup;
            if(m && typeof m.saveChatDebounced==='function') arcMod.saveChatDebounced = m.saveChatDebounced;
            if(m && typeof m.doNewChat==='function') arcMod.doNewChat = m.doNewChat;
            if(m && typeof m.createOrEditCharacter==='function') arcMod.createOrEditCharacter = m.createOrEditCharacter;
            if(m && typeof m.deleteCharacterChatByName==='function') arcMod.deleteCharacterChatByName = m.deleteCharacterChatByName;
            if(m && typeof m.replaceCurrentChat==='function') arcMod.replaceCurrentChat = m.replaceCurrentChat;
        }).catch(function(e){ console.warn('['+MODULE_NAME+'] script.js 桥接失败，群聊退出/即时保存将走兜底', e); });
    }catch(e){ console.warn('['+MODULE_NAME+'] 动态 import 不可用', e); }

    /* ---------- 持久化设置（沿用独立版存储键，旧数据自动继承） ---------- */
    function rawSettings(){
        var c = getContext();
        var es = c && (c.extensionSettings || c.extension_settings);
        return es || null;
    }
    function getSettings(){
        var es = rawSettings();
        if(!es) return null;
        if(!es[MODULE_NAME]) es[MODULE_NAME] = { notes:{} };
        if(!es[MODULE_NAME].notes) es[MODULE_NAME].notes = {};
        if(!es[MODULE_NAME].avatars) es[MODULE_NAME].avatars = {};
        return es[MODULE_NAME];
    }
    var settings = getSettings() || { notes:{}, avatars:{} };
    var notes = settings.notes;
    var avatars = settings.avatars;
    // 桥接晚于模块执行就绪时，把就绪前写入的临时数据并回真实设置
    function ensureSettings(){
        var s = getSettings();
        if(!s) return false;
        if(s !== settings){
            Object.keys(notes).forEach(function(k){ if(!s.notes[k]) s.notes[k] = notes[k]; });
            Object.keys(avatars).forEach(function(k){ if(!s.avatars[k]) s.avatars[k] = avatars[k]; });
            settings = s; notes = s.notes; avatars = s.avatars;
        }
        return true;
    }
    function saveSettings(){
        try{ var c = getContext(); if(c && c.saveSettingsDebounced) c.saveSettingsDebounced(); }catch(e){}
    }

    /* ---------- DOM 与状态 ---------- */
    var arcPage = null, listEl = null, railEl = null, panelEl = null, selNameEl = null, selSubEl = null, newChatBtn = null;
    var statsEl = null, refreshBtn = null, filterEl = null;
    var countsStarted = false; // 首次进入存档页才拉取数量（懒加载）
    var countsLoaded = false;
    var counts = {};        // avatar -> 存档数量
    var chatsCache = {};    // avatar -> 完整存档列表
    var activeAvatar = null;   // 当前展开的角色（null = 只显示头像条）
    var COUNT_CONCURRENCY = 5;
    var FETCH_TIMEOUT = 20000;
    var cacheVersion = 0;
    var countsPromise = null;
    var renderChain = Promise.resolve();
    var lastSignature = null;

    // 切换存档串行锁：切换期间忽略重复点击，并压掉中间态的「当前」标记 / 头像刷新
    var switching = false;
    var deleting = false;
    var confirmEl = null;
    var confirmClose = null;

    var boundEvents = [];
    var timers = [];
    var chatObserver = null, chatObserverTarget = null;
    var applyScheduled = false;
    var avatarFileInput = null;
    function arcTimeout(fn, ms){ var id = setTimeout(fn, ms); timers.push(id); return id; }

    /* ---------- 极简 SVG 图标（与主页同一套 24x24 线性填充风格） ---------- */
    var SVG_CHEVRON = '<svg viewBox="0 0 24 24"><path d="M9.29 6.71L14.58 12l-5.29 5.29L10.71 18.7l6.59-6.59a1 1 0 0 0 0-1.41l-6.59-6.59z"/></svg>';
    var SVG_IMAGE = '<svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.9 13.05l2.1 2.53 3.1-3.88L19 17H5l3.9-3.95z"/></svg>';
    var SVG_ERASER = '<svg viewBox="0 0 24 24"><path d="M15.14 3c-.51 0-1.02.2-1.41.59L2.59 14.73a2 2 0 0 0 0 2.83l3.85 3.85c.39.39.9.59 1.41.59H22v-2H7.83l-3-3L13.44 5.7l5.06 5.1 1.42-1.41a2 2 0 0 0 0-2.84l-3.36-3.36A1.98 1.98 0 0 0 15.14 3z"/></svg>';
    var SVG_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5.5h6V7M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7M10 11v5M14 11v5"/></svg>';

    /* ---------- 工具函数 ---------- */
    function noteKey(avatar, fileName){ return avatar + '::' + fileName; }

    function toMs(value){
        if(!value) return 0;
        if(typeof value === 'number') return value;
        var s = String(value).trim();
        if(/^\d+$/.test(s)){
            var n = Number(s);
            return n < 1e11 ? n * 1000 : n;
        }
        var d = new Date(s);
        return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    function formatDateTime(value){
        var ms = toMs(value);
        if(!ms) return '';
        var d = new Date(ms);
        var p = function(n){ return String(n).padStart(2,'0'); };
        return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
    }
    function formatTimestampName(base){
        if(!/^\d+$/.test(base)) return null;
        return formatDateTime(base);
    }
    function formatTimeShort(value){
        var ms = toMs(value);
        if(!ms) return '';
        var d = new Date(ms);
        var p = function(n){ return String(n).padStart(2,'0'); };
        return p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function sortChats(list){
        var msByChat = new Map();
        list.forEach(function(c){ msByChat.set(c, toMs(c && c.last_mes)); });
        return list.slice().sort(function(a,b){ return (msByChat.get(b) || 0) - (msByChat.get(a) || 0); });
    }

    /* ---------- 数据获取（酒馆原生接口，超时 + 并发上限，绝不压垮本地服务） ---------- */
    function fetchWithTimeout(url, options){
        var ctrl = new AbortController();
        var timer = setTimeout(function(){ ctrl.abort(); }, FETCH_TIMEOUT);
        return fetch(url, Object.assign({}, options, { signal: ctrl.signal })).finally(function(){ clearTimeout(timer); });
    }
    async function fetchSimpleCount(avatar){
        try{
            var c = getContext();
            var res = await fetchWithTimeout('/api/characters/chats', {
                method:'POST',
                headers:c.getRequestHeaders(),
                body:JSON.stringify({ avatar_url: avatar, simple: true })
            });
            if(!res.ok) return 0;
            var data = await res.json();
            if(data && data.error === true) return 0;
            return Array.isArray(data) ? data.length : 0;
        }catch(e){
            if(e && e.name==='AbortError') console.warn('['+MODULE_NAME+'] 获取角色存档数量超时('+FETCH_TIMEOUT+'ms):', avatar);
            else console.warn('['+MODULE_NAME+'] 获取角色存档数量失败:', e);
            return 0;
        }
    }
    async function fetchCharacterChats(avatar){
        try{
            var c = getContext();
            var res = await fetchWithTimeout('/api/characters/chats', {
                method:'POST',
                headers:c.getRequestHeaders(),
                body:JSON.stringify({ avatar_url: avatar })
            });
            if(!res.ok) return null;
            var data = await res.json();
            if(data && data.error === true) return [];
            return Array.isArray(data) ? data : [];
        }catch(e){
            if(e && e.name==='AbortError') console.warn('['+MODULE_NAME+'] 获取角色存档超时('+FETCH_TIMEOUT+'ms):', avatar);
            else console.warn('['+MODULE_NAME+'] 获取角色存档失败:', e);
            return null;
        }
    }
    async function mapLimit(items, limit, fn){
        var results = new Array(items.length);
        var next = 0;
        var worker = async function(){
            while(next < items.length){
                var i = next++;
                results[i] = await fn(items[i], i);
            }
        };
        var workers = [];
        for(var w=0; w<Math.min(limit, items.length); w++) workers.push(worker());
        await Promise.all(workers);
        return results;
    }
    function loadCounts(){
        if(countsPromise) return countsPromise;
        countsPromise = (async function(){
            try{
                var list = (getContext() && getContext().characters) || [];
                countsLoaded = true;
                var missing = list.filter(function(c){ return c && c.avatar && counts[c.avatar] === undefined; });
                if(missing.length > 0){
                    await mapLimit(missing, COUNT_CONCURRENCY, async function(c){
                        counts[c.avatar] = await fetchSimpleCount(c.avatar);
                    });
                    await renderCharFolders(true);
                }else{
                    await renderCharFolders();
                }
            }catch(e){
                console.warn('['+MODULE_NAME+'] 加载存档数量失败:', e);
            }
        })().finally(function(){ countsPromise = null; });
        return countsPromise;
    }

    /* ---------- UI：统计 / 筛选 ---------- */
    function updateStats(){
        if(!statsEl) return;
        var c = getContext();
        var total = (c && c.characters) ? c.characters.length : 0;
        var visible = railEl ? railEl.querySelectorAll('.nqc-rail').length : 0;
        statsEl.textContent = countsLoaded ? (visible + ' 个有存档') : ('共 ' + total + ' 个角色');
    }
    function applyFilter(){
        if(!railEl || !filterEl) return;
        var q = (filterEl.value || '').trim().toLowerCase();
        var items = railEl.querySelectorAll('.nqc-rail');
        for(var i=0;i<items.length;i++){
            var it = items[i];
            if(!q){ it.style.display = ''; continue; }
            var nameNode = it.querySelector('.nqc-rail-nm');
            var name = nameNode ? (nameNode.textContent || '').toLowerCase() : '';
            var hit = name.indexOf(q) >= 0;
            if(!hit){
                var chats = chatsCache[it.dataset.avatar];
                if(chats){
                    for(var j=0;j<chats.length;j++){
                        var ch = chats[j];
                        var base = String(ch.file_name || '').replace(/\.jsonl$/i,'');
                        var title = formatTimestampName(base) || base;
                        var note = notes[noteKey(it.dataset.avatar, ch.file_name)] || '';
                        if(title.toLowerCase().indexOf(q) >= 0 || note.toLowerCase().indexOf(q) >= 0){ hit = true; break; }
                    }
                }
            }
            it.style.display = hit ? '' : 'none';
        }
        filterRows(q);
    }
    function filterRows(q){
        if(!listEl) return;
        var rows = listEl.querySelectorAll('.nqc-msg');
        for(var i=0;i<rows.length;i++){
            var row = rows[i];
            if(!q){ row.style.display = ''; continue; }
            var title = row.querySelector('.nqc-msg-title');
            var note = row.querySelector('.nqc-msg-note');
            var pv = row.querySelector('.nqc-msg-pv');
            var hay = ((title ? title.textContent : '') + ' ' + (note ? note.value : '') + ' ' + (pv ? pv.textContent : '')).toLowerCase();
            row.style.display = hay.indexOf(q) >= 0 ? '' : 'none';
        }
    }

    /* ---------- UI：角色头像条（横向滑动，点击展开该角色存档） ---------- */
    function findCharIndex(avatar){
        var c = getContext();
        var cs = (c && c.characters) || [];
        for(var i=0;i<cs.length;i++){ if(cs[i] && cs[i].avatar === avatar) return i; }
        return -1;
    }
    function charNameOf(avatar){
        var c = getContext();
        var cs = (c && c.characters) || [];
        for(var i=0;i<cs.length;i++){ if(cs[i] && cs[i].avatar === avatar) return cs[i].name || String(avatar).replace(/\.png$/i,''); }
        return String(avatar || '').replace(/\.png$/i,'');
    }
    function buildRailItem(c, count){
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'nqc-rail';
        item.dataset.avatar = c.avatar;
        item.title = (c.name || c.avatar) + (count >= 0 ? (' · ' + count + ' 个存档') : '');

        var ring = document.createElement('span');
        ring.className = 'nqc-rail-av';
        var img = document.createElement('img');
        img.className = 'nqc-rail-img';
        img.alt = '';
        img.loading = 'lazy';
        try{ img.src = defaultAvatarUrl(c.avatar); }catch(e){}
        img.addEventListener('error', function(){
            if(img.dataset.fb === '1'){ img.style.visibility = 'hidden'; return; }
            img.dataset.fb = '1';
            img.src = '/img/user-default.png';
        });
        ring.appendChild(img);

        var nm = document.createElement('span');
        nm.className = 'nqc-rail-nm';
        nm.textContent = c.name || String(c.avatar).replace(/\.png$/i,'');

        item.appendChild(ring);
        item.appendChild(nm);
        if(activeAvatar === c.avatar) item.classList.add('active');
        item.addEventListener('click', function(){ selectAvatar(c.avatar); });
        return item;
    }
    function selectAvatar(avatar){
        activeAvatar = (activeAvatar === avatar) ? null : avatar;
        updateRailActive();
        syncPanel();
    }
    function updateRailActive(){
        if(!railEl) return;
        var items = railEl.querySelectorAll('.nqc-rail');
        for(var i=0;i<items.length;i++) items[i].classList.toggle('active', items[i].dataset.avatar === activeAvatar);
    }
    function syncPanel(){
        if(!arcPage) return;
        var on = !!activeAvatar;
        arcPage.classList.toggle('is-open', on);
        if(on){
            if(selNameEl) selNameEl.textContent = charNameOf(activeAvatar);
            if(selSubEl){
                var n = counts[activeAvatar];
                selSubEl.textContent = (countsLoaded && n !== undefined) ? (n + ' 个存档') : '';
            }
            if(listEl){
                listEl.innerHTML = '';
                listEl.dataset.avatar = activeAvatar;
                delete listEl.dataset.cacheVer;
                renderChatList(activeAvatar);
            }
        }else{
            if(listEl){
                listEl.innerHTML = '';
                delete listEl.dataset.avatar;
                delete listEl.dataset.cacheVer;
            }
        }
        filterRows(((filterEl && filterEl.value) || '').trim().toLowerCase());
    }
    // v1.18.1：为指定角色开启全新空白聊天（先切到该角色，再调用酒馆原生 newChat）
    async function startNewChat(idx, charName, btn){
        if(btn && btn.dataset.busy === '1') return;
        var c = getContext();
        if(!c || typeof c.selectCharacterById !== 'function'){ nqcToast('酒馆接口不可用'); return; }
        if(btn){ btn.dataset.busy = '1'; btn.classList.add('nqc-arc-busy'); }
        try{
            nqcToast('正在为「'+charName+'」开启新聊天…');
            if(c.characterId !== idx){ await c.selectCharacterById(idx); }
            var nf = (typeof c.doNewChat === 'function') ? c.doNewChat : arcMod.doNewChat;
            if(typeof nf !== 'function'){ await arcModReady; var c2 = getContext(); nf = (c2 && typeof c2.doNewChat === 'function') ? c2.doNewChat : arcMod.doNewChat; }
            if(typeof nf !== 'function'){ nqcToast('当前酒馆版本不支持一键新聊天'); return; }
            await nf({ deleteCurrentChat:false });
            nqcToast('已为「'+charName+'」开启新聊天');
            setTimeout(function(){ try{ renderCharFolders(true); }catch(e){} }, 1200);
        }catch(e){
            console.error('['+MODULE_NAME+'] 开启新聊天失败:', e);
            nqcToast('开启新聊天失败');
        }finally{
            if(btn){ btn.dataset.busy = '0'; btn.classList.remove('nqc-arc-busy'); }
        }
    }
    async function renderChatList(avatar){
        if(!listEl || listEl.dataset.avatar !== avatar) return;
        var chats = chatsCache[avatar];
        if(chats && listEl.dataset.cacheVer === String(cacheVersion) && listEl.childElementCount > 0) return;
        listEl.innerHTML = '';

        if(!chats){
            var loading = document.createElement('div');
            loading.className = 'nqc-arc-loading';
            loading.textContent = '加载存档中…';
            listEl.appendChild(loading);

            chats = await fetchCharacterChats(avatar);
            if(listEl.dataset.avatar !== avatar) return;
            if(chats === null){
                listEl.innerHTML = '';
                var err = document.createElement('div');
                err.className = 'nqc-arc-empty';
                err.textContent = '加载失败，点右上角刷新重试';
                listEl.appendChild(err);
                return;
            }
            chats = sortChats(chats);
            chatsCache[avatar] = chats;
            if(counts[avatar] !== chats.length){
                counts[avatar] = chats.length;
                if(selSubEl && activeAvatar === avatar) selSubEl.textContent = chats.length + ' 个存档';
            }
            listEl.innerHTML = '';
        }

        if(chats.length === 0){
            var empty = document.createElement('div');
            empty.className = 'nqc-arc-empty';
            empty.textContent = '该角色暂无聊天存档';
            listEl.appendChild(empty);
            listEl.dataset.cacheVer = String(cacheVersion);
            return;
        }

        var currentChat = getContext() ? getContext().chatId : null;
        var frag = document.createDocumentFragment();
        chats.forEach(function(chat){ frag.appendChild(buildChatRow(chat, avatar, currentChat)); });
        listEl.appendChild(frag);
        listEl.dataset.cacheVer = String(cacheVersion);
        filterRows(((filterEl && filterEl.value) || '').trim().toLowerCase());
    }
    function updateCharBadge(avatar, count){
        if(!railEl) return;
        var item = railEl.querySelector('.nqc-rail[data-avatar="'+CSS.escape(avatar)+'"]');
        if(item) item.title = charNameOf(avatar) + ' · ' + count + ' 个存档';
    }

    /* ---------- 存档专属头像 ---------- */
    function getChatAvatar(avatar, fileName){ return avatars[noteKey(avatar, fileName)] || null; }
    function setChatAvatar(avatar, fileName, dataUrl){ avatars[noteKey(avatar, fileName)] = dataUrl; ensureSettings(); saveSettings(); }
    function removeChatAvatar(avatar, fileName){ delete avatars[noteKey(avatar, fileName)]; ensureSettings(); saveSettings(); }

    function defaultAvatarUrl(avatar){
        var c = getContext();
        if(c && typeof c.getThumbnailUrl==='function'){
            try{ return c.getThumbnailUrl('avatar', avatar); }catch(e){}
        }
        return '/characters/' + encodeURIComponent(avatar);
    }
    function isCurrentChat(avatar, fileName){
        var c = getContext();
        if(!c || !c.chatId) return false;
        var cur = c.characters[c.characterId];
        if(!cur || cur.avatar !== avatar) return false;
        return stripJsonl(fileName) === c.chatId;
    }
    function currentCharacter(){
        var c = getContext();
        if(!c) return null;
        var ci = c.characterId;
        if(ci === undefined || ci === null || ci === '') return null;
        var idx = Number(ci);
        var cs = c.characters || [];
        if(!Number.isInteger(idx) || idx < 0 || idx >= cs.length) return null;
        return cs[idx] || null;
    }
    function currentChatAvatarUrl(){
        var c = currentCharacter();
        if(!c || !c.avatar) return null;
        var ctx = getContext();
        if(!ctx || !ctx.chatId) return null;
        return getChatAvatar(c.avatar, ctx.chatId + '.jsonl');
    }
    function isRoleAvatarImg(img, avatar){
        var src = img.getAttribute('src') || '';
        if(!src || !avatar) return false;
        var encoded = encodeURIComponent(avatar);
        return (src.indexOf('type=avatar') >= 0
                && (src.indexOf('file='+encoded) >= 0 || src.indexOf('file='+avatar) >= 0))
            || src.indexOf('/characters/'+encoded) >= 0
            || src.indexOf('/characters/'+avatar) >= 0;
    }
    function replaceMessageAvatar(img, avatar, customUrl){
        if(customUrl){
            if(img.dataset.camCustom === '1'){
                img.src = customUrl;
            }else if(isRoleAvatarImg(img, avatar)){
                img.dataset.camOrig = img.getAttribute('src') || '';
                img.dataset.camCustom = '1';
                img.src = customUrl;
            }
        }else if(img.dataset.camCustom === '1'){
            img.src = img.dataset.camOrig || '';
            delete img.dataset.camCustom;
            delete img.dataset.camOrig;
        }
    }
    function isManagementArea(img){
        return !!img.closest('#rm_print_characters_block, #character_edit_panel, #extension_settings, #avatar_upload_panel, #option_section, .mes_edit_area');
    }
    function collectEmbeddedAvatars(scope){
        var out = [];
        var all = scope.querySelectorAll('img.ls-avatar, img[style*="object-fit:cover"]');
        for(var i=0;i<all.length;i++){
            var img = all[i];
            if(isManagementArea(img)) continue;
            var style = img.getAttribute('style') || '';
            if(img.classList.contains('ls-avatar')){ out.push(img); continue; }
            if(/margin-left:\s*\d+px/.test(style)) continue;
            var h = /height:\s*(\d+)px/.exec(style);
            if(h && Number(h[1]) >= 30 && Number(h[1]) <= 64 && /border-radius/.test(style)) out.push(img);
        }
        return out;
    }
    function replaceEmbeddedAvatar(img, customUrl){
        if(customUrl){
            if(img.dataset.camCustom === '1'){
                img.src = customUrl;
            }else{
                img.dataset.camOrig = img.getAttribute('src') || '';
                img.dataset.camCustom = '1';
                img.src = customUrl;
            }
        }else if(img.dataset.camCustom === '1'){
            img.src = img.dataset.camOrig || '';
            delete img.dataset.camCustom;
            delete img.dataset.camOrig;
        }
    }
    function applyAvatarToChat(avatar, customUrl){
        var chat = document.getElementById('chat') || document;
        var std = chat.querySelectorAll('.mes .avatar img, .mes .mes_avatar, .mes img.avatar');
        var emb = collectEmbeddedAvatars(chat);
        var replaced = 0;
        for(var i=0;i<std.length;i++){
            var img = std[i];
            var before = img.getAttribute('src') || '';
            replaceMessageAvatar(img, avatar, customUrl);
            if(img.getAttribute('src') !== before) replaced++;
        }
        for(var j=0;j<emb.length;j++){
            var em = emb[j];
            var before2 = em.getAttribute('src') || '';
            replaceEmbeddedAvatar(em, customUrl);
            if(em.getAttribute('src') !== before2) replaced++;
        }
        return replaced;
    }
    function syncForceAvatarToChatData(customUrl){
        var c = getContext();
        var chat = (c && c.chat) || [];
        if(!Array.isArray(chat) || !chat.length) return 0;
        var changed = 0;
        for(var i=0;i<chat.length;i++){
            var m = chat[i];
            if(!m || m.is_user) continue;
            if(customUrl){
                if(m.force_avatar !== customUrl){ m.force_avatar = customUrl; changed++; }
            }else{
                if(m.force_avatar){ delete m.force_avatar; changed++; }
            }
        }
        if(changed){
            try{
                if(arcMod.saveChatDebounced) arcMod.saveChatDebounced();
                else if(c.saveChat) c.saveChat();
            }catch(e){ console.warn('['+MODULE_NAME+'] 保存存档头像数据失败:', e); }
        }
        return changed;
    }
    var __avatarGate = { key:null, runs:0, last:0, timer:null };
    function __avatarFullImpl(ch, url){
        applyAvatarToChat(ch.avatar, url);
        syncForceAvatarToChatData(url);
        /* 仅首次补一次150ms晚渲染头像；同档后续不再重复全量 */
        if(__avatarGate.runs <= 1){
            setTimeout(function(){ try{ applyAvatarToChat(ch.avatar, url); }catch(e){} }, 150);
        }
    }
    function applyAvatarForCurrentChat(){
        var c = currentCharacter();
        if(!c || !c.avatar) return;
        var url = currentChatAvatarUrl();
        if(!url) return;
        var gctx = getContext();
        var key = ((gctx && gctx.chatId) || '') + '::' + url;
        var now = Date.now();
        if(__avatarGate.key === key){
            if(__avatarGate.runs >= 2) return;            /* 同档已全量补过，后续靠增量，不再扫全档 */
            if(now - __avatarGate.last < 1200){           /* 合并进档时的高频重复调用 */
                if(!__avatarGate.timer){
                    __avatarGate.timer = setTimeout(function(){
                        __avatarGate.timer = null;
                        applyAvatarForCurrentChat();
                    }, 1200);
                }
                return;
            }
        }else{
            __avatarGate.key = key; __avatarGate.runs = 0;/* 切档/换头像：立即全量 */
            if(__avatarGate.timer){ clearTimeout(__avatarGate.timer); __avatarGate.timer = null; }
        }
        __avatarGate.last = now;
        __avatarGate.runs++;
        __avatarFullImpl(c, url);
    }
    /* 新消息渲染：只对新增的 .mes 节点增量换头像，不再全量扫描整档（大档防卡核心） */
    function applyAvatarToNode(el){
        if(!el || el.nodeType !== 1) return;
        var ch = currentCharacter();
        if(!ch || !ch.avatar) return;
        var url = currentChatAvatarUrl();
        if(!url) return;
        var img = el.querySelector ? el.querySelector('.avatar img, .mes_avatar, img.avatar') : null;
        if(img){ try{ replaceMessageAvatar(img, ch.avatar, url); }catch(e){} }
        var embedded = collectEmbeddedAvatars(el);
        for(var ai=0;ai<embedded.length;ai++){ try{ replaceEmbeddedAvatar(embedded[ai], url); }catch(e){} }
    }
    var __avatarPending = [];
    var __avatarNodeScheduled = false;
    function __avatarFlushNodes(){
        __avatarNodeScheduled = false;
        var nodes = __avatarPending; __avatarPending = [];
        var seen = typeof Set === 'function' ? new Set() : null;
        for(var i=0;i<nodes.length;i++){
            var el = nodes[i];
            if(!el) continue;
            if(seen){ if(seen.has(el)) continue; seen.add(el); }
            try{ applyAvatarToNode(el); }catch(e){}
        }
    }
    function scheduleAvatarNode(el){
        if(__avatarPending.indexOf(el) < 0) __avatarPending.push(el);
        if(!__avatarNodeScheduled){
            __avatarNodeScheduled = true;
            requestAnimationFrame(__avatarFlushNodes);
        }
    }
    function ensureChatObserver(){
        // v1.18.3 防加载大档卡顿：优先只监听 #chat 的直接子节点（.mes），childList+subtree:false。
        // 旧版挂 document.body + subtree:true，大档加载时 body 内每个小节点增删都触发回调，
        // 形成 mutation 洪峰；.mes 本就是 #chat 直接子元素，消息整体插入即可被增量捕获，
        // 其内部头像(img.ls-avatar 等)由 applyAvatarToNode 一并处理，头像替换不遗漏。
        var chatEl = document.getElementById('chat');
        var want = chatEl || document.body;
        if(chatObserver && chatObserverTarget === want && want && want.isConnected !== false) return;
        if(chatObserver){ try{ chatObserver.disconnect(); }catch(e){} chatObserver = null; }
        if(!want) return;
        var useChat = !!chatEl;
        chatObserverTarget = want;
        chatObserver = new MutationObserver(function(mutations){
            for(var i=0;i<mutations.length;i++){
                var m = mutations[i];
                if(m.type !== 'childList') continue;
                for(var j=0;j<m.addedNodes.length;j++){
                    var node = m.addedNodes[j];
                    if(!node || node.nodeType !== 1 || !node.querySelector) continue;
                    if(node.classList && node.classList.contains('mes')){
                        scheduleAvatarNode(node);
                    }else{
                        var mesList = node.querySelectorAll('.mes');
                        if(mesList && mesList.length){
                            for(var k=0;k<mesList.length;k++) scheduleAvatarNode(mesList[k]);
                        }else if(node.querySelector('img.ls-avatar') && node.closest && node.closest('#chat')){
                            scheduleAvatarNode(node);
                        }
                    }
                }
            }
        });
        chatObserver.observe(want, useChat ? { childList:true, subtree:false } : { childList:true, subtree:true });
    }
    function onMessageRendered(arg){
        var id = (typeof arg === 'object' && arg !== null) ? arg.id : arg;
        if(id === undefined || id === null) return;
        var c = getContext();
        var chat = (c && c.chat) || [];
        var m = chat.find(function(x){ return String(x.id) === String(id); });
        if(m && m.is_user) return;
        var ch = currentCharacter();
        if(!ch || !ch.avatar) return;
        var url = currentChatAvatarUrl();
        if(!url) return;
        var el = document.querySelector('#chat .mes[mesid="'+id+'"]') || document.querySelector('.mes[mesid="'+id+'"]');
        if(!el) return;
        var img = el.querySelector('.avatar img, .mes_avatar, img.avatar');
        if(img) replaceMessageAvatar(img, ch.avatar, url);
        var embedded = collectEmbeddedAvatars(el);
        for(var i=0;i<embedded.length;i++) replaceEmbeddedAvatar(embedded[i], url);
    }

    /* ---------- 头像压缩与选择（仅用户主动操作时执行，不占常态开销） ---------- */
    var AVATAR_MAX_SIZE = 512;
    function getAvatarFileInput(){
        if(!avatarFileInput){
            avatarFileInput = document.createElement('input');
            avatarFileInput.type = 'file';
            avatarFileInput.accept = 'image/*';
            avatarFileInput.style.display = 'none';
            document.body.appendChild(avatarFileInput);
        }
        return avatarFileInput;
    }
    async function fileToCompressedDataUrl(file){
        var bmp = null;
        try{ bmp = await createImageBitmap(file); }catch(e){ bmp = null; }
        var w = 0, h = 0, source = null;
        if(bmp){
            w = bmp.width; h = bmp.height; source = bmp;
        }else{
            var url = URL.createObjectURL(file);
            try{
                source = await new Promise(function(resolve, reject){
                    var im = new Image();
                    im.onload = function(){ resolve(im); };
                    im.onerror = function(){ reject(new Error('无法读取图片')); };
                    im.src = url;
                });
                w = source.naturalWidth; h = source.naturalHeight;
            }finally{ URL.revokeObjectURL(url); }
        }
        try{
            if(!w || !h) throw new Error('无效图片');
            var scale = Math.min(1, AVATAR_MAX_SIZE / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale));
            var chh = Math.max(1, Math.round(h * scale));
            var canvas = document.createElement('canvas');
            canvas.width = cw; canvas.height = chh;
            var ctx2d = canvas.getContext('2d');
            if(ctx2d){ ctx2d.imageSmoothingQuality = 'high'; ctx2d.drawImage(source, 0, 0, cw, chh); }
            var dataUrl = canvas.toDataURL('image/webp', 0.88);
            if(dataUrl.indexOf('data:image/webp') !== 0) dataUrl = canvas.toDataURL('image/png');
            return dataUrl;
        }finally{
            if(bmp) bmp.close();
        }
    }
    function openAvatarPicker(onDone){
        var input = getAvatarFileInput();
        input.value = '';
        input.onchange = async function(){
            var file = input.files && input.files[0];
            if(!file) return;
            try{
                var dataUrl = await fileToCompressedDataUrl(file);
                onDone(dataUrl);
            }catch(e){
                console.error('['+MODULE_NAME+'] 头像处理失败:', e);
                nqcToast('头像处理失败，请换一张图片重试');
            }
        };
        input.click();
    }
    function buildChatAvatar(chat, avatar){
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nqc-msg-av';
        btn.title = '为该存档设置专属头像';

        var img = document.createElement('img');
        img.className = 'nqc-msg-avimg';
        img.alt = '';
        var custom = getChatAvatar(avatar, chat.file_name);
        img.src = custom || defaultAvatarUrl(avatar);
        if(!custom) img.classList.add('nqc-av-default');
        img.addEventListener('error', function(){
            if(img.dataset.fb === '1') return;
            img.dataset.fb = '1';
            img.src = '/img/user-default.png';
        });
        btn.appendChild(img);

        var cam = document.createElement('span');
        cam.className = 'nqc-msg-cam';
        cam.innerHTML = SVG_IMAGE;
        btn.appendChild(cam);

        var x = document.createElement('span');
        x.className = 'nqc-msg-avx';
        x.textContent = '×';
        x.title = '恢复角色默认头像';
        x.style.display = custom ? '' : 'none';
        btn.appendChild(x);
        x.addEventListener('click', function(ev){
            ev.stopPropagation();
            removeChatAvatar(avatar, chat.file_name);
            img.src = defaultAvatarUrl(avatar);
            img.classList.add('nqc-av-default');
            x.style.display = 'none';
            btn.title = '为该存档设置专属头像';
            if(isCurrentChat(avatar, chat.file_name)){
                applyAvatarToChat(avatar, null);
                syncForceAvatarToChatData(null);
            }
        });

        btn.addEventListener('click', function(){
            openAvatarPicker(function(dataUrl){
                setChatAvatar(avatar, chat.file_name, dataUrl);
                img.src = dataUrl;
                img.classList.remove('nqc-av-default');
                x.style.display = '';
                btn.title = '该存档已有专属头像，点击更换';
                if(isCurrentChat(avatar, chat.file_name)){
                    applyAvatarToChat(avatar, dataUrl);
                    syncForceAvatarToChatData(dataUrl);
                }
            });
        });
        return btn;
    }

    /* ---------- 存档消息行（iMessage 会话列表风格） ---------- */
    function stripJsonl(name){ return String(name || '').replace(/\.jsonl$/i,''); }
    function buildChatRow(chat, avatar, currentChat){
        var row = document.createElement('div');
        row.className = 'nqc-msg';
        row.dataset.file = chat.file_name;
        row.dataset.avatar = avatar;
        var ctxForCur = getContext();
        var curCharForRow = ctxForCur && ctxForCur.characters ? ctxForCur.characters[ctxForCur.characterId] : null;
        if(currentChat && curCharForRow && curCharForRow.avatar === avatar && stripJsonl(chat.file_name) === currentChat) row.classList.add('nqc-cur');

        row.appendChild(buildChatAvatar(chat, avatar));

        var main = document.createElement('div');
        main.className = 'nqc-msg-main';

        var top = document.createElement('div');
        top.className = 'nqc-msg-top';
        var title = document.createElement('span');
        title.className = 'nqc-msg-title';
        var base = String(chat.file_name || '').replace(/\.jsonl$/i,'');
        var tsTitle = formatTimestampName(base);
        title.textContent = tsTitle || base || chat.file_name;
        title.title = chat.file_name;
        top.appendChild(title);
        if(row.classList.contains('nqc-cur')){
            var badge = document.createElement('span');
            badge.className = 'nqc-msg-badge';
            badge.textContent = '当前';
            top.appendChild(badge);
        }
        // 文件名本身是时间戳时，标题已含日期时间，右侧不再重复显示
        var time = document.createElement('span');
        time.className = 'nqc-msg-time';
        time.textContent = tsTitle ? '' : formatTimeShort(chat.last_mes);
        top.appendChild(time);

        var sub = document.createElement('div');
        sub.className = 'nqc-msg-sub';
        var msgs = Number.isFinite(Number(chat.chat_items)) ? Number(chat.chat_items) : 0;
        sub.textContent = msgs + ' 条 · ' + (chat.file_size || '?');

        var preview = document.createElement('div');
        preview.className = 'nqc-msg-pv';
        var mes = chat.mes && chat.mes !== '[The chat is empty]' ? chat.mes : '';
        preview.textContent = mes;
        preview.title = mes;

        var noteInput = document.createElement('input');
        noteInput.className = 'nqc-msg-note';
        noteInput.type = 'text';
        noteInput.placeholder = '添加备注';
        noteInput.maxLength = 200;
        noteInput.value = notes[noteKey(avatar, chat.file_name)] || '';
        noteInput.addEventListener('input', function(){
            ensureSettings();
            var v = noteInput.value.trim();
            if(v) notes[noteKey(avatar, chat.file_name)] = v;
            else delete notes[noteKey(avatar, chat.file_name)];
            saveSettings();
        });

        main.appendChild(top);
        main.appendChild(sub);
        if(mes) main.appendChild(preview);
        main.appendChild(noteInput);
        row.appendChild(main);

        var loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'nqc-msg-load';
        loadBtn.textContent = '加载';
        loadBtn.title = '切换到该角色并打开这个存档';
        loadBtn.addEventListener('click', function(){ loadChat(avatar, chat.file_name, row, loadBtn); });

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'nqc-msg-del';
        delBtn.title = '删除这个存档（不可恢复）';
        delBtn.setAttribute('aria-label', '删除存档 ' + (chat.file_name || ''));
        delBtn.innerHTML = SVG_TRASH;
        delBtn.addEventListener('click', function(){ deleteChat(avatar, chat, row, delBtn); });

        var actions = document.createElement('div');
        actions.className = 'nqc-msg-actions';
        actions.appendChild(loadBtn);
        actions.appendChild(delBtn);
        row.appendChild(actions);

        return row;
    }

    /* ---------- 加载指定角色的指定存档（与酒馆原生聊天列表点击行为一致） ---------- */
    function syncSelectedChatPole(fileName){
        try{
            var el = document.getElementById('selected_chat_pole');
            if(el) el.value = fileName;
        }catch(e){}
    }
    function markRowLoading(row, loadBtn, on){
        if(row) row.classList.toggle('nqc-loading', !!on);
        if(loadBtn){
            loadBtn.disabled = !!on;
            loadBtn.textContent = on ? '…' : '加载';
        }
    }
    async function loadChat(avatar, fileName, row, loadBtn){
        // 串行切换：上一次没落定前忽略新点击，避免 A/B 两次加载互相打断，最终停在错误存档
        if(switching || deleting){ nqcToast('正在处理，请稍候'); return; }

        var c = getContext();
        var chars = (c && c.characters) || [];
        var idx = -1;
        for(var i=0;i<chars.length;i++){ if(chars[i] && chars[i].avatar === avatar){ idx = i; break; } }
        if(idx === -1){
            console.warn('['+MODULE_NAME+'] 找不到角色:', avatar);
            nqcToast('找不到该角色');
            return;
        }

        var chatBase = stripJsonl(fileName);
        // 已经是当前存档：不再清空重载，避免一次无意义的整屏闪烁
        try{
            if(String(c.characterId) === String(idx) && !c.groupId && stripJsonl(c.chatId || '') === chatBase){
                nqcToast('已经是当前存档');
                return;
            }
        }catch(e){}

        switching = true;
        var prevChatFile = chars[idx] ? chars[idx].chat : undefined;
        markRowLoading(row, loadBtn, true);

        try{
            await arcModReady.catch(function(){});
            var ctxNow = getContext();
            var charsNow = (ctxNow && ctxNow.characters) || [];
            if(!ctxNow || !charsNow[idx]){ throw new Error('角色不可用'); }
            if(arcMod.setActiveGroup){ try{ arcMod.setActiveGroup(null); }catch(e){} } // 退出群聊模式

            var sameChar = String(ctxNow.characterId) === String(idx);
            var inGroup = !!ctxNow.groupId;

            if(sameChar && !inGroup){
                // 同一角色：openCharacterChat 内部先 clearChat 再 load，屏幕上是「旧→目标」，不会出现别人的存档
                await ctxNow.openCharacterChat(chatBase);
            }else{
                // 跨角色：先把角色补全并让指针指向目标存档，再走原生 selectCharacterById，
                // 否则它会先载入该角色上一次的聊天（就是那一闪而过的「别的存档」）
                try{
                    if(typeof ctxNow.unshallowCharacter === 'function') await ctxNow.unshallowCharacter(idx);
                }catch(e){}
                try{
                    var freshChar = (getContext() && getContext().characters[idx]) || charsNow[idx];
                    freshChar.chat = chatBase;
                }catch(e){}
                await ctxNow.selectCharacterById(idx);
                // 保存进行中时 selectCharacterById 会直接返回，这里兜底用官方 openCharacterChat
                if(stripJsonl((getContext() && getContext().chatId) || '') !== chatBase){
                    await ctxNow.openCharacterChat(chatBase);
                }else{
                    syncSelectedChatPole(chatBase);
                    // 与 openCharacterChat 收尾保持一致（角色面板的 newChat 状态）
                    if(typeof arcMod.createOrEditCharacter === 'function'){
                        try{ await arcMod.createOrEditCharacter(new CustomEvent('newChat')); }catch(e){}
                    }
                }
            }

            // 最终校验：必须真的停在目标存档上，否则不报成功、不覆盖「当前」标记
            var finalC = getContext();
            if(stripJsonl((finalC && finalC.chatId) || '') !== chatBase){
                try{ if(prevChatFile !== undefined) charsNow[idx].chat = prevChatFile; }catch(e){}
                throw new Error('存档未真正切换');
            }
            try{ syncSelectedChatPole(chatBase); }catch(e){}
            updateCurrentBadges();
            applyAvatarForCurrentChat();
            nqcToast('已加载存档');
        }catch(e){
            console.error('['+MODULE_NAME+'] 加载存档失败:', e);
            // 失败且没有停在目标档时，把角色指针还原，避免后续保存写到错误文件
            try{
                var cc = getContext();
                if(cc && stripJsonl(cc.chatId || '') !== chatBase && charsNow && charsNow[idx] && prevChatFile !== undefined){
                    charsNow[idx].chat = prevChatFile;
                }
            }catch(e3){}
            nqcToast('加载存档失败');
            // 失败时不留下错误的「当前」标记
            try{ updateCurrentBadges(); }catch(e2){}
        }finally{
            switching = false;
            markRowLoading(row, loadBtn, false);
        }
    }

    /* ---------- 删除存档（二次确认 + 服务端核对，避免删错） ---------- */
    function archiveTitleOf(chat){
        var base = stripJsonl(chat.file_name);
        return formatTimestampName(base) || base || String(chat.file_name || '');
    }
    function askDeleteConfirm(avatar, chat){
        return new Promise(function(resolve){
            if(confirmEl){ resolve(false); return; }
            var host = document.getElementById('nqc-panel') || panelEl || document.body;
            var modal = document.createElement('div');
            modal.className = 'nqc-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');

            var card = document.createElement('div');
            card.className = 'nqc-modal-card';

            var title = document.createElement('div');
            title.className = 'nqc-modal-title';
            title.textContent = '删除这个存档？';

            var target = document.createElement('div');
            target.className = 'nqc-modal-target';
            target.textContent = charNameOf(avatar) + ' · ' + archiveTitleOf(chat);

            var meta = document.createElement('div');
            meta.className = 'nqc-modal-meta';
            var msgs = Number.isFinite(Number(chat.chat_items)) ? Number(chat.chat_items) : 0;
            meta.textContent = msgs + ' 条消息 · ' + (chat.file_size || '大小未知');

            var file = document.createElement('div');
            file.className = 'nqc-modal-file';
            file.textContent = String(chat.file_name || '');

            var warn = document.createElement('div');
            warn.className = 'nqc-modal-warn';
            warn.textContent = isCurrentChat(avatar, chat.file_name)
                ? '这是当前正在使用的存档：删除后会自动切到该角色最新的其他存档；若没有其他存档，将开启一个新聊天。删除后无法恢复，其他存档不会受影响。'
                : '删除后无法恢复，其他存档不会受影响。';

            var actions = document.createElement('div');
            actions.className = 'nqc-modal-actions';
            var cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'nqc-modal-btn cancel';
            cancel.textContent = '取消';
            var ok = document.createElement('button');
            ok.type = 'button';
            ok.className = 'nqc-modal-btn danger';
            ok.textContent = '删除';
            actions.appendChild(cancel);
            actions.appendChild(ok);

            card.appendChild(title);
            card.appendChild(target);
            card.appendChild(meta);
            card.appendChild(file);
            card.appendChild(warn);
            card.appendChild(actions);
            modal.appendChild(card);
            host.appendChild(modal);
            confirmEl = modal;

            var prevFocus = document.activeElement;
            function close(result){
                if(!modal.parentNode) return;
                try{ modal.parentNode.removeChild(modal); }catch(e){}
                document.removeEventListener('keydown', onKey, true);
                confirmEl = null;
                confirmClose = null;
                try{ if(prevFocus && prevFocus.focus) prevFocus.focus(); }catch(e){}
                resolve(!!result);
            }
            confirmClose = close;
            function onKey(e){
                if(e.key === 'Escape'){ e.preventDefault(); close(false); }
            }
            cancel.addEventListener('click', function(){ close(false); });
            ok.addEventListener('click', function(){ close(true); });
            modal.addEventListener('click', function(e){ if(e.target === modal) close(false); });
            document.addEventListener('keydown', onKey, true);
            try{ cancel.focus(); }catch(e){}
        });
    }

    function removeRowAndSync(avatar, chat, row){
        var left = counts[avatar] || 0;
        try{ if(row && row.parentNode) row.parentNode.removeChild(row); }catch(e){}

        if(activeAvatar === avatar){
            if(selSubEl) selSubEl.textContent = left + ' 个存档';
            var leftRows = listEl ? listEl.querySelectorAll('.nqc-msg').length : 0;
            if(left === 0 || leftRows === 0){
                if(listEl){
                    listEl.innerHTML = '';
                    delete listEl.dataset.cacheVer;
                }
                if(left > 0){
                    // 列表比真实数量旧（少见）：按刚核对过的缓存重建，避免留下空白
                    try{ renderChatList(avatar); }catch(e){}
                }
                var railItem = railEl ? railEl.querySelector('.nqc-rail[data-avatar="'+CSS.escape(avatar)+'"]') : null;
                if(left === 0 && railItem) railItem.parentNode && railItem.parentNode.removeChild(railItem);
                if(left === 0){
                    activeAvatar = null;
                    try{ updateRailActive(); }catch(e){}
                    try{ syncPanel(); }catch(e){}
                }
            }
        }
        try{ updateCharBadge(avatar, left); }catch(e){}
        try{ updateStats(); }catch(e){}
        try{ applyFilter(); }catch(e){}
    }

    async function deleteChat(avatar, chat, row, delBtn){
        if(switching || deleting){ nqcToast('正在处理，请稍候'); return; }
        if(delBtn && delBtn.dataset.busy === '1') return;
        var fileName = String(chat.file_name || '');
        var confirmed = await askDeleteConfirm(avatar, chat);
        if(!confirmed) return;

        var wasCurrent = isCurrentChat(avatar, fileName);
        deleting = true;
        if(delBtn){ delBtn.dataset.busy = '1'; delBtn.disabled = true; }
        if(row) row.classList.add('nqc-deleting');
        try{
            var c = getContext();
            if(!c || typeof c.getRequestHeaders !== 'function') throw new Error('酒馆接口不可用');
            var chatfile = /\.jsonl$/i.test(fileName) ? fileName : (fileName + '.jsonl');
            await arcModReady.catch(function(){});
            var ci = findCharIndex(avatar);
            if(ci >= 0 && typeof arcMod.deleteCharacterChatByName === 'function'){
                // 官方删除链路：文件删除后若正是该角色「上次使用」的存档，会自动把角色指针改到剩余的最新存档
                await arcMod.deleteCharacterChatByName(ci, stripJsonl(fileName));
            }else{
                var res = await fetchWithTimeout('/api/chats/delete', {
                    method:'POST',
                    headers:c.getRequestHeaders(),
                    body:JSON.stringify({ chatfile: chatfile, avatar_url: avatar })
                });
                if(!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : '?'));
            }
            // 删除后立刻回读该角色的存档列表，确认目标确实不在了再动 UI
            var fresh = await fetchCharacterChats(avatar);
            if(fresh === null) throw new Error('无法核对删除结果');
            var still = fresh.some(function(x){ return stripJsonl(x && x.file_name) === stripJsonl(fileName); });
            if(still) throw new Error('服务端未删除该存档');

            // 删的是当前正在使用的存档：先让酒馆切到剩余最新存档（没有则新建聊天），避免停留在已删文件上
            var replaced = true;
            if(wasCurrent){
                try{
                    var replaceFn = (typeof c.replaceCurrentChat === 'function') ? c.replaceCurrentChat
                        : ((typeof arcMod.replaceCurrentChat === 'function') ? arcMod.replaceCurrentChat : null);
                    if(replaceFn){
                        await replaceFn();
                    }else if(fresh.length && typeof c.openCharacterChat === 'function'){
                        await c.openCharacterChat(stripJsonl(fresh[0].file_name));
                    }else if(typeof c.doNewChat === 'function'){
                        await c.doNewChat();
                    }else{
                        replaced = false;
                    }
                    try{ if(c.chatId) syncSelectedChatPole(stripJsonl(c.chatId)); }catch(e){}
                    try{ applyAvatarForCurrentChat(); }catch(e){}
                }catch(e){
                    replaced = false;
                    console.warn('['+MODULE_NAME+'] 删除当前存档后自动切换失败:', e);
                }
                // 自动切换后再核对一次（若已经开了新的未保存聊天，列表可能仍为空，这里以服务端返回为准）
                try{
                    var fresh2 = await fetchCharacterChats(avatar);
                    if(fresh2) fresh = fresh2;
                }catch(e){}
            }

            chatsCache[avatar] = sortChats(fresh);
            counts[avatar] = fresh.length;
            countsLoaded = true;
            // 只清理这条存档自己的备注 / 专属头像，绝不按角色整体清空
            delete notes[noteKey(avatar, fileName)];
            delete avatars[noteKey(avatar, fileName)];
            ensureSettings();
            saveSettings();

            removeRowAndSync(avatar, chat, row);
            if(replaced){
                nqcToast('已删除「' + archiveTitleOf(chat) + '」');
            }else{
                nqcToast('已删除，但自动切换失败，请点刷新重试');
            }
        }catch(e){
            console.warn('['+MODULE_NAME+'] 删除存档失败:', e);
            nqcToast('删除失败，请重试');
        }finally{
            deleting = false;
            if(delBtn){ delBtn.dataset.busy = '0'; delBtn.disabled = false; }
            if(row) row.classList.remove('nqc-deleting');
            try{ updateCurrentBadges(); }catch(e){}
        }
    }


    /* ---------- 列表渲染（串行化，签名去重，避免并发重建互相打断） ---------- */
    function renderCharFolders(force){
        var run = renderChain.then(function(){ return renderCharFoldersImpl(force); });
        renderChain = run.catch(function(e){ console.warn('['+MODULE_NAME+'] 渲染失败:', e); });
        return run;
    }
    async function renderCharFoldersImpl(force){
        if(!railEl) return;
        var c = getContext();
        var list = (c && c.characters) || [];

        var sig = list.map(function(ch){ return ch && ch.avatar; }).filter(Boolean).join('');
        if(!force && countsLoaded && sig === lastSignature){
            updateStats();
            return;
        }
        lastSignature = sig;
        railEl.innerHTML = '';

        if(list.length === 0){
            var empty0 = document.createElement('div');
            empty0.className = 'nqc-arc-empty nqc-arc-rail-empty';
            empty0.textContent = '未找到角色卡，请先导入角色';
            railEl.appendChild(empty0);
            updateStats();
            return;
        }

        var frag = document.createDocumentFragment();
        var shown = 0;
        list.forEach(function(ch){
            if(!ch || !ch.avatar) return;
            var n = countsLoaded ? (counts[ch.avatar] !== undefined ? counts[ch.avatar] : 0) : -1;
            if(countsLoaded && n === 0) return; // 无存档的角色不展示
            frag.appendChild(buildRailItem(ch, n));
            shown++;
        });
        if(shown === 0){
            var hint = document.createElement('div');
            hint.className = 'nqc-arc-empty nqc-arc-rail-empty';
            hint.textContent = countsLoaded ? '还没有任何聊天存档' : '正在读取存档…';
            railEl.appendChild(hint);
        }else{
            railEl.appendChild(frag);
        }
        updateStats();

        if(activeAvatar && !railEl.querySelector('.nqc-rail[data-avatar="'+CSS.escape(activeAvatar)+'"]')){
            activeAvatar = null;
        }
        if(activeAvatar){
            updateRailActive();
            syncPanel();
        }else{
            if(arcPage) arcPage.classList.remove('is-open');
            if(listEl){
                listEl.innerHTML = '';
                delete listEl.dataset.avatar;
                delete listEl.dataset.cacheVer;
            }
        }
        applyFilter();
    }
    function updateCurrentBadges(){
        if(!arcPage) return;
        var c = getContext();
        var current = c && c.chatId;
        var curChar = c && c.characters ? c.characters[c.characterId] : null;
        var curAvatar = curChar ? curChar.avatar : null;
        var rows = arcPage.querySelectorAll('.nqc-msg');
        for(var i=0;i<rows.length;i++){
            var row = rows[i];
            var isCur = !!current && row.dataset.avatar === curAvatar && stripJsonl(row.dataset.file) === current;
            row.classList.toggle('nqc-cur', !!isCur);
            var badge = row.querySelector('.nqc-msg-badge');
            if(isCur && !badge){
                badge = document.createElement('span');
                badge.className = 'nqc-msg-badge';
                badge.textContent = '当前';
                var top = row.querySelector('.nqc-msg-top');
                var time = row.querySelector('.nqc-msg-time');
                if(top) top.insertBefore(badge, time || null);
            }else if(!isCur && badge){
                badge.remove();
            }
        }
    }
    async function refreshAll(){
        cacheVersion++;
        Object.keys(chatsCache).forEach(function(k){ delete chatsCache[k]; });
        Object.keys(counts).forEach(function(k){ delete counts[k]; });
        countsLoaded = true;
        await countsPromise;
        await loadCounts();
    }

    /* ---------- 挂载 / 事件 / 初始化 ---------- */
    function mount(){
        arcPage = document.getElementById('nqc-arc');
        if(!arcPage) return false;
        listEl = document.getElementById('nqc-arc-list');
        railEl = document.getElementById('nqc-arc-rail');
        panelEl = document.getElementById('nqc-arc-panel');
        selNameEl = document.getElementById('nqc-arc-sel-nm');
        selSubEl = document.getElementById('nqc-arc-sel-sub');
        newChatBtn = document.getElementById('nqc-arc-newbtn');
        statsEl = document.getElementById('nqc-arc-stats');
        refreshBtn = document.getElementById('nqc-arc-refresh');
        filterEl = document.getElementById('nqc-arc-filter-in');
        if(newChatBtn && !newChatBtn.dataset.arcBound){
            newChatBtn.dataset.arcBound = '1';
            newChatBtn.addEventListener('click', function(){
                if(!activeAvatar) return;
                var idx = findCharIndex(activeAvatar);
                if(idx >= 0) startNewChat(idx, charNameOf(activeAvatar), newChatBtn);
            });
        }
        if(refreshBtn && !refreshBtn.dataset.arcBound){
            refreshBtn.dataset.arcBound = '1';
            refreshBtn.addEventListener('click', async function(){
                if(refreshBtn.classList.contains('spin')) return;
                refreshBtn.classList.add('spin');
                try{ await refreshAll(); }
                finally{ refreshBtn.classList.remove('spin'); }
            });
        }
        if(filterEl && !filterEl.dataset.arcBound){
            filterEl.dataset.arcBound = '1';
            filterEl.addEventListener('input', applyFilter);
        }
        return true;
    }
    function onEvent(type, fn){
        var c = getContext();
        if(!c || !c.eventSource) return;
        var et = c.eventTypes || c.event_types || {};
        var name = et[type];
        if(!name) return;
        try{ c.eventSource.on(name, fn); boundEvents.push({ name:name, fn:fn }); }catch(e){}
    }
    function onPanelOpen(){
        if(!arcPage) return;
        ensureSettings();
        if(!countsStarted){
            countsStarted = true;
            loadCounts();
        }else{
            renderCharFolders();
        }
    }
    function dismissConfirm(){
        try{ if(confirmClose) confirmClose(false); }catch(e){}
    }
    function destroy(){
        var c = getContext();
        if(c && c.eventSource){
            boundEvents.forEach(function(b){
                try{ c.eventSource.removeListener(b.name, b.fn); }
                catch(e){ try{ c.eventSource.off(b.name, b.fn); }catch(_){} }
            });
        }
        boundEvents = [];
        timers.forEach(function(id){ clearTimeout(id); });
        timers = [];
        try{ if(chatObserver) chatObserver.disconnect(); }catch(e){}
        chatObserver = null;
        try{ if(typeof __avatarGate!=='undefined' && __avatarGate && __avatarGate.timer){ clearTimeout(__avatarGate.timer); __avatarGate.timer=null; } }catch(e){}
        try{ __avatarPending = []; __avatarNodeScheduled = false; }catch(e){}
        try{ if(avatarFileInput && avatarFileInput.parentNode) avatarFileInput.parentNode.removeChild(avatarFileInput); }catch(e){}
        avatarFileInput = null;
        dismissConfirm();
    }
    var initRetries = 0;
    function init(){
        var prev = window.__nqcArchiveMod;
        if(prev && prev !== mod && typeof prev.destroy === 'function'){ try{ prev.destroy(); }catch(e){} }
        var ready = false;
        try{ ready = mount() && !!ensureSettings(); }catch(e){ ready = false; }
        if(!ready){
            if(initRetries < 20){ initRetries++; arcTimeout(function(){ init(); }, 500); return; }
            console.warn('['+MODULE_NAME+'] 初始化条件未就绪，已停止重试（不影响面板其他功能）');
            return;
        }

        onEvent('CHARACTER_PAGE_LOADED', function(){
            var c = getContext();
            var avatarSet = new Set(((c && c.characters) || []).map(function(ch){ return ch && ch.avatar; }).filter(Boolean));
            Object.keys(chatsCache).forEach(function(k){ if(!avatarSet.has(k)) delete chatsCache[k]; });
            Object.keys(counts).forEach(function(k){ if(!avatarSet.has(k)) delete counts[k]; });
            if(activeAvatar && !avatarSet.has(activeAvatar)){ activeAvatar = null; try{ syncPanel(); }catch(e){} }
            if(countsStarted){ countsLoaded = true; loadCounts(); }
        });
        // 切换进行中不跟随中间态刷新（否则会先闪一下别的存档的「当前」标记 / 专属头像）
        onEvent('CHAT_CHANGED', function(){ ensureChatObserver(); if(switching || deleting) return; updateCurrentBadges(); applyAvatarForCurrentChat(); });
        onEvent('CHARACTER_MESSAGE_RENDERED', onMessageRendered);
        onEvent('MESSAGE_UPDATED', onMessageRendered);
        onEvent('CHAT_LOADED', function(){ ensureChatObserver(); if(switching || deleting) return; applyAvatarForCurrentChat(); });

        applyAvatarForCurrentChat();
        // 酒馆自动恢复上次聊天可能早于本模块激活，延迟补几次（一次性、非轮询）
        [300, 1000, 2500, 5000].forEach(function(ms){ arcTimeout(function(){ applyAvatarForCurrentChat(); }, ms); });
        ensureChatObserver();
        window.__nqcArchiveMod = mod;
        try{ console.log('[nqc-arc] 聊天存档管理器已并入快捷指令面板 v'+MODULE_VERSION); }catch(e){}
    }

    var mod = { init:init, destroy:destroy, onPanelOpen:onPanelOpen, dismissConfirm:dismissConfirm };
    return mod;
})();

// ========== 面板构建 ==========

function buildPanel() {
    // 防御：清理可能残留的重复面板
    const stale = document.getElementById('nqc-panel');
    if (stale) stale.remove();
    const staleMask = document.getElementById('nqc-mask');
    if (staleMask) staleMask.remove();

    mask = document.createElement('div');
    mask.id = 'nqc-mask';
    document.body.appendChild(mask);

    panel = document.createElement('div');
    panel.id = 'nqc-panel';
    panel.innerHTML =
        '<div id="nqc-handle"></div>' +
        '<div class="nqc-id" id="nqc-id">' +
        '<div class="nqc-id-avs">' +
        '<img class="nqc-id-av char" id="nqc-id-char" alt="">' +
        '<img class="nqc-id-av user" id="nqc-id-user" alt="">' +
        '</div>' +
        '<div class="nqc-id-nm" id="nqc-id-nm"></div>' +
        '</div>' +
        '<button type="button" class="nqc-night-btn" id="nqc-night-btn" title="切换到夜间模式">' +
        NIGHT_ICON_MOON +
        '</button>' +
        '<div class="nqc-tabs" id="nqc-tabs">' +
        '<button type="button" class="nqc-tab active" data-pg="1">第1页</button>' +
        '<button type="button" class="nqc-tab" data-pg="2">第2页</button>' +
        '</div>' +
        '<div class="nqc-list" id="nqc-list"></div>' +
        '<div class="nqc-add-row" id="nqc-add-row">' +
        '<input type="text" class="nqc-input" id="nqc-input" placeholder="输入新指令…" maxlength="500">' +
        '<button type="button" class="nqc-row-btn confirm" id="nqc-confirm" title="确认添加"><i class="fa-solid fa-check"></i></button>' +
        '<button type="button" class="nqc-row-btn" id="nqc-cancel" title="取消"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<button type="button" class="nqc-add-btn" id="nqc-add-btn">' +
        '<i class="fa-solid fa-plus nqc-add-icon"></i><span>新增指令</span>' +
        '</button>' +
        '<div class="nqc-arc" id="nqc-arc">' +
        '<div class="nqc-arc-bar">' +
        '<span class="nqc-arc-title" id="nqc-arc-title">聊天存档</span>' +
        '<span class="nqc-arc-sel-nm" id="nqc-arc-sel-nm"></span>' +
        '<span class="nqc-arc-sel-sub" id="nqc-arc-sel-sub"></span>' +
        '<span class="nqc-arc-stats" id="nqc-arc-stats"></span>' +
        '<button type="button" class="nqc-arc-newbtn" id="nqc-arc-newbtn">＋ 新聊天</button>' +
        '<button type="button" class="nqc-arc-rf" id="nqc-arc-refresh" title="刷新存档列表"><svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></button>' +
        '</div>' +
        '<div class="nqc-arc-search">' +
        '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>' +
        '<input type="text" id="nqc-arc-filter-in" placeholder="搜索角色或备注" autocomplete="off">' +
        '</div>' +
        '<div class="nqc-arc-rail" id="nqc-arc-rail"></div>' +
        '<div class="nqc-arc-panel" id="nqc-arc-panel">' +
        '<div class="nqc-arc-list" id="nqc-arc-list"></div>' +
        '</div>' +
        '</div>';
    document.body.appendChild(panel);

    listEl = panel.querySelector('#nqc-list');
    idNameEl = panel.querySelector('#nqc-id-nm');
    idCharImg = panel.querySelector('#nqc-id-char');
    idUserImg = panel.querySelector('#nqc-id-user');
    bindImgFallback(idCharImg);
    bindImgFallback(idUserImg);
    addBtn = panel.querySelector('#nqc-add-btn');
    addRow = panel.querySelector('#nqc-add-row');
    inputEl = panel.querySelector('#nqc-input');

    // 页签：切换第一页/第二页（两页指令相互独立，切换只重渲染列表）
    tabBtns = Array.prototype.slice.call(panel.querySelectorAll('.nqc-tab'));
    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => switchPage(Number(btn.dataset.pg) || 1));
        // 主题常把 button 圆角清零：用内联 important 兜底，保证胶囊页签不被拉直
        try { btn.style.setProperty('border-radius', '999px', 'important'); } catch (e) { /* 忽略 */ }
    });
    try {
        const tabsEl = panel.querySelector('.nqc-tabs');
        if (tabsEl) tabsEl.style.setProperty('border-radius', '999px', 'important');
        panel.style.setProperty('border-radius', '0 16px 16px 0', 'important');
    } catch (e) { /* 忽略 */ }

    // 夜间模式：灰色大背景 + 黑色子模块 + 白色文本（状态本地持久化）
    const nightBtn = panel.querySelector('#nqc-night-btn');
    // 主题常给 button 加底块/描边：清成纯图标，并固定在右上角
    try {
        nightBtn.style.setProperty('background', 'transparent', 'important');
        nightBtn.style.setProperty('border', '0', 'important');
        nightBtn.style.setProperty('box-shadow', 'none', 'important');
        nightBtn.style.setProperty('padding', '0', 'important');
        nightBtn.style.setProperty('top', '10px', 'important');
        nightBtn.style.setProperty('right', '12px', 'important');
    } catch (e) { /* 忽略 */ }
    const applyNight = (on) => {
        panel.classList.toggle('night', on);
        mask.classList.toggle('night', on);
        nightBtn.innerHTML = on ? NIGHT_ICON_SUN : NIGHT_ICON_MOON;
        nightBtn.title = on ? '切换到日间模式' : '切换到夜间模式';
    };
    applyNight(!!settings.nightMode);
    nightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.nightMode = !panel.classList.contains('night');
        saveSettingsDebounced();
        applyNight(settings.nightMode);
    });

    // 遮罩点击关闭（桌面端兜底）
    mask.addEventListener('click', closePanel);

    // 手机端修复：触摸点击遮罩/别处时，浏览器合成的 click 可能被全局 touch 处理吞掉，
    // 改用 pointerdown（按下即触发，鼠标/触屏统一，无 300ms 延迟）——面板外一律关闭
    document.addEventListener('pointerdown', (e) => {
        if (!isOpen) return; // 未打开时零开销
        if (e.target instanceof Element && e.target.closest('#nqc-panel')) return;
        closePanel();
    }, true);

    // 新增指令：展开输入行
    addBtn.addEventListener('click', () => {
        addRow.classList.add('show');
        addBtn.style.display = 'none';
        inputEl.focus();
    });

    // 确认新增
    panel.querySelector('#nqc-confirm').addEventListener('click', addCommand);
    // 取消新增
    panel.querySelector('#nqc-cancel').addEventListener('click', cancelAdd);
    // 回车确认
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCommand();
        } else if (e.key === 'Escape') {
            cancelAdd();
        }
    });

    // Esc 关闭面板
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePanel();
    });
}

// ========== 分页 ==========

function getCommands() {
    return activePage === 2 ? settings.commands2 : settings.commands;
}

function switchPage(pg) {
    if (pg === activePage) return; // 同页不重复渲染，零开销
    activePage = pg;
    cancelAdd();
    renderList(); // 只重渲染列表（DocumentFragment），不重建面板
}

function updateTabs() {
    tabBtns.forEach((btn) => {
        btn.classList.toggle('active', (Number(btn.dataset.pg) || 1) === activePage);
    });
}

// ========== 顶部身份区：用户面具 ⇄ 当前角色 ==========

const identityListeners = [];
let identityBound = false;

// 主面板作用域的上下文桥接（存档 IIFE 内有同名局部函数，这里需独立一份）
function nqcGetContext() {
    try {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
            return window.SillyTavern.getContext() || null;
        }
    } catch (e) { /* 忽略 */ }
    return null;
}

function removeIdentityListeners() {
    const c = nqcGetContext();
    if (c && c.eventSource) {
        identityListeners.forEach(({ name, fn }) => {
            try { c.eventSource.removeListener(name, fn); } catch (e) { try { c.eventSource.off(name, fn); } catch (_) { /* 忽略 */ } }
        });
    }
    identityListeners.length = 0;
    identityBound = false;
}

function bindImgFallback(img) {
    if (!img || img.dataset.fbBound === '1') return;
    img.dataset.fbBound = '1';
    img.addEventListener('error', function () {
        if (this.dataset.fbUsed === '1') { this.style.visibility = 'hidden'; return; }
        this.dataset.fbUsed = '1';
        this.src = '/img/user-default.png';
    });
}

function setImgSrc(img, src) {
    if (!img || !src) return;
    if (img.dataset.src === src) return;
    img.dataset.src = src;
    img.style.visibility = '';
    img.dataset.fbUsed = '0';
    img.src = src;
}

function updateIdentity() {
    if (!panel || !idNameEl) return;
    const c = nqcGetContext();
    if (!c) return;

    const pu = c.powerUserSettings || {};
    const personas = pu.personas || {};
    let personaAvatar = (c.chatMetadata && c.chatMetadata.persona) || pu.default_persona || '';
    if (!personaAvatar && c.name1) {
        for (const k in personas) {
            if (personas[k] === c.name1) { personaAvatar = k; break; }
        }
    }
    const userName = c.name1 || personas[personaAvatar] || '';
    const chars = c.characters || [];
    const rawId = c.characterId;
    const idx = (rawId === null || rawId === undefined || rawId === '') ? -1 : Number(rawId);
    let ch = Number.isInteger(idx) && idx >= 0 ? chars[idx] : null;
    let isGroup = false;
    // 群聊：characterId 为空，退化为群组名与群头像
    if (!ch && c.groupId && Array.isArray(c.groups)) {
        const g = c.groups.find((x) => String(x.id) === String(c.groupId));
        if (g) { ch = { name: g.name, avatar: g.avatar_url || '' }; isGroup = true; }
    }
    const charName = ch && ch.name ? ch.name : '';

    const thumb = (type, file) => {
        try { return (c.getThumbnailUrl ? c.getThumbnailUrl(type, file) : '') || ''; } catch (e) { return ''; }
    };

    if (idUserImg) {
        const uSrc = personaAvatar ? thumb('persona', personaAvatar) : '/img/user-default.png';
        setImgSrc(idUserImg, uSrc || '/img/user-default.png');
        idUserImg.style.display = '';
    }
    if (idCharImg) {
        if (ch && ch.avatar) {
            const charSrc = isGroup
                ? ('/characters/' + encodeURIComponent(ch.avatar))
                : (thumb('avatar', ch.avatar) || ('/characters/' + encodeURIComponent(ch.avatar)));
            setImgSrc(idCharImg, charSrc);
            idCharImg.style.display = '';
        } else {
            idCharImg.style.display = 'none';
        }
    }
    idNameEl.textContent = [userName, charName].filter(Boolean).join(' & ');
    idNameEl.title = idNameEl.textContent;
}

function bindIdentityEvents() {
    if (identityBound) removeIdentityListeners();
    const c = nqcGetContext();
    if (!c || !c.eventSource) return;
    const et = c.eventTypes || {};
    ['PERSONA_CHANGED', 'PERSONA_UPDATED', 'PERSONA_RENAMED', 'CHAT_CHANGED', 'CHAT_LOADED', 'CHARACTER_PAGE_LOADED'].forEach((key) => {
        const name = et[key];
        if (!name) return;
        try {
            c.eventSource.on(name, updateIdentity);
            identityListeners.push({ name, fn: updateIdentity });
        } catch (e) { /* 忽略 */ }
    });
    identityBound = identityListeners.length > 0;
}

function addCommand() {
    const text = inputEl.value.trim();
    if (!text) return;
    const list = getCommands();
    if (list.includes(text)) {
        inputEl.select();
        return; // 已存在，不重复添加
    }
    list.push(text);
    saveSettingsDebounced();
    renderList();
    cancelAdd();
}

function cancelAdd() {
    addRow.classList.remove('show');
    addBtn.style.display = '';
    inputEl.value = '';
}

// ========== 列表渲染 ==========

function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';

    const list = getCommands();
    const fragment = document.createDocumentFragment();
    for (const cmd of list) {
        const item = document.createElement('div');
        item.className = 'nqc-item';

        const textSpan = document.createElement('span');
        textSpan.className = 'nqc-item-text';
        textSpan.textContent = cmd; // textContent 防注入
        textSpan.title = cmd;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'nqc-item-del';
        delBtn.title = '删除该指令';
        delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 不触发注入
            const list = getCommands();
            const idx = list.indexOf(cmd);
            if (idx !== -1) {
                list.splice(idx, 1);
                saveSettingsDebounced();
                renderList();
            }
        });

        item.appendChild(textSpan);
        item.appendChild(delBtn);

        // 点击：注入酒馆输入框
        item.addEventListener('click', () => {
            injectToChatInput(cmd);
        });

        fragment.appendChild(item);
    }

    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nqc-item';
        empty.style.cssText = 'cursor:default; color:#b0b0b0; border-style:dashed;';
        const emptySpan = document.createElement('span');
        emptySpan.className = 'nqc-item-text';
        emptySpan.textContent = activePage === 2 ? '第2页暂无指令，点击下方「新增指令」添加' : '暂无指令，点击下方「新增指令」添加';
        empty.appendChild(emptySpan);
        fragment.appendChild(empty);
    }

    listEl.appendChild(fragment);
    updateTabs();
}

// ========== 注入输入框 ==========

function injectToChatInput(text) {
    if (!text) return;
    try {
        // 新版酒馆主输入框 id=send_textarea（酒馆自身即用 $val()+input事件 写入）；
        // 兼容旧版 id=chat_input
        const tArea = document.getElementById('send_textarea') || document.getElementById('chat_input');
        if (tArea) {
            // 基于实时值追加：连续点击多条指令时逐条累加，不会互相覆盖
            const curr = tArea.value || '';
            const br = curr.length > 0 && !curr.endsWith('\n') ? '\n' : '';
            tArea.value = curr + br + text;
            // 触发 input 事件：酒馆据此更新发送按钮/字符计数/自动高度（与酒馆原生写法一致）
            tArea.dispatchEvent(new Event('input', { bubbles: true }));
            tArea.focus();
            return;
        }
    } catch (_) { /* 走降级 */ }
    try {
        navigator.clipboard.writeText(text); // 找不到输入框时降级为复制
    } catch (_) { /* 忽略 */ }
}

// ========== 开关 ==========

function openPanel() {
    if (isOpen) return;
    isOpen = true;
    panel.classList.add('is-open');
    mask.classList.add('is-open');
    renderList(); // 每次打开刷新计数与列表（设置可能被其它扩展/标签页改动）
    updateIdentity();
    // 存档区：首次打开才拉取角色存档数量（懒加载，启动零请求）
    try { nqcArchive.onPanelOpen(); } catch (e) { console.warn('[nqc-arc] 存档区加载失败', e); }
}

function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('is-open');
    mask.classList.remove('is-open');
    cancelAdd();
    try { if (nqcArchive && typeof nqcArchive.dismissConfirm === 'function') nqcArchive.dismissConfirm(); } catch (e) {}
}

// ========== 手势唤醒（passive + rAF 节流，不阻塞滚动） ==========

const handlers = {
    ts(e) {
        if (isOpen) return;
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;
        isEdgeTouch = startX <= EDGE_WIDTH; // 左边缘触发
    },
    tm(e) {
        if (!isEdgeTouch || isOpen) return;
        if (ticking) return;
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        window.requestAnimationFrame(() => {
            const diffX = touch.clientX - startX; // 向右滑为正
            const diffY = Math.abs(startY - touch.clientY);
            if (diffX > SWIPE_THRESHOLD && diffX > diffY) {
                openPanel();
                isEdgeTouch = false;
            }
            ticking = false;
        });
        ticking = true;
    },
    md(e) {
        if (isOpen) return;
        startX = e.clientX;
        startY = e.clientY;
        isEdgeTouch = startX <= EDGE_WIDTH; // 左边缘触发
        isMouseDown = true;
    },
    mm(e) {
        if (!isMouseDown || !isEdgeTouch || isOpen) return;
        if (ticking) return;
        window.requestAnimationFrame(() => {
            if (e.clientX - startX > SWIPE_THRESHOLD) { // 向右拖为正
                openPanel();
                isEdgeTouch = false;
            }
            ticking = false;
        });
        ticking = true;
    },
    mu() {
        isMouseDown = false;
        isEdgeTouch = false;
    },
};

function bindGesture() {
    // 防御：先移除旧句柄，确保多轮 init / 热重载不叠加监听
    const doc = document;
    if (doc._nqcHandlers) {
        const h = doc._nqcHandlers;
        doc.removeEventListener('touchstart', h.ts);
        doc.removeEventListener('touchmove', h.tm);
        doc.removeEventListener('mousedown', h.md);
        doc.removeEventListener('mousemove', h.mm);
        doc.removeEventListener('mouseup', h.mu);
    }
    doc._nqcHandlers = handlers;
    // 全部 passive: true，杜绝阻塞主渲染线程
    doc.addEventListener('touchstart', handlers.ts, { passive: true });
    doc.addEventListener('touchmove', handlers.tm, { passive: true });
    doc.addEventListener('mousedown', handlers.md, { passive: true });
    doc.addEventListener('mousemove', handlers.mm, { passive: true });
    doc.addEventListener('mouseup', handlers.mu, { passive: true });
}

// ========== 扩展入口 ==========

export async function init() {
    console.log(`[${MODULE_NAME}] v${MODULE_VERSION} 初始化中...`);

    buildPanel();
    renderList();
    bindGesture();
    updateIdentity();
    bindIdentityEvents();
    // 存档区：DOM 已就绪，绑定刷新 / 筛选并挂载酒馆事件（数据在首次打开面板时才拉取）
    try { nqcArchive.init(); } catch (e) { console.warn('[nqc-arc] 存档区初始化失败（不影响快捷指令）', e); }

    // 页面卸载时清理面板（防止扩展热重载残留）
    window.addEventListener('beforeunload', () => {
        try { if (window.__nqcArchiveMod && window.__nqcArchiveMod.destroy) window.__nqcArchiveMod.destroy(); } catch (e) { /* 忽略 */ }
        try { removeIdentityListeners(); } catch (e) { /* 忽略 */ }
        if (nqcToastEl) { nqcToastEl.remove(); nqcToastEl = null; }
        if (panel) panel.remove();
        if (mask) mask.remove();
        const doc = document;
        if (doc._nqcHandlers) {
            const h = doc._nqcHandlers;
            doc.removeEventListener('touchstart', h.ts);
            doc.removeEventListener('touchmove', h.tm);
            doc.removeEventListener('mousedown', h.md);
            doc.removeEventListener('mousemove', h.mm);
            doc.removeEventListener('mouseup', h.mu);
            delete doc._nqcHandlers;
        }
    });

    console.log(`[${MODULE_NAME}] 初始化完成：左边缘右滑唤出面板（快捷指令 + 聊天存档，iOS 极简风）`);
}

export async function loop() {
    // 无需循环逻辑
}
