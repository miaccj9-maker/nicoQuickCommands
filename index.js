/**
 * nicoQuickCommands —— 酒馆快捷指令侧滑面板
 * ------------------------------------------------------------
 * 唤醒：从屏幕左边缘向右滑动 / 按住左边缘向右拖拽（鼠标、触屏均可）
 * 面板：黑白灰 ins 极简直角风格，固定于左侧，无水印
 * 点击指令项 → 注入酒馆输入框（#chat_input），支持新增/删除指令，本地持久化
 *
 * 纯前端扩展，不修改 SillyTavern 核心代码；禁用或删除本扩展即可完全移除。
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../../scripts/extensions.js';

const MODULE_NAME = 'nicoQuickCommands';
const MODULE_VERSION = '1.1.0';

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
    extension_settings[MODULE_NAME] = { commands: DEFAULT_COMMANDS.slice(), nightMode: false };
}
const settings = extension_settings[MODULE_NAME];
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

// ========== 参数 ==========
const EDGE_WIDTH = 40;      // 左边缘触发宽度（px）
const SWIPE_THRESHOLD = 30; // 向右滑动打开阈值（px）
const PANEL_HIDDEN_OFFSET = 300; // 与 CSS #nqc-panel left:-300px 保持一致

// ========== 状态 ==========
let panel = null;
let mask = null;
let listEl = null;
let headerCountEl = null;
let addBtn = null;
let addRow = null;
let inputEl = null;
let isOpen = false;

// 手势状态
let startX = 0;
let startY = 0;
let isEdgeTouch = false;
let isMouseDown = false;
let ticking = false; // rAF 节流锁

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
        '<div class="nqc-header">' +
        '<i class="fa-solid fa-bolt nqc-header-icon"></i>' +
        '<span class="nqc-header-title">快捷指令</span>' +
        '<span class="nqc-header-count"></span>' +
        '<button type="button" class="nqc-night-btn" id="nqc-night-btn" title="切换到夜间模式">' +
        '<i class="fa-solid fa-moon"></i>' +
        '</button>' +
        '</div>' +
        '<div class="nqc-list" id="nqc-list"></div>' +
        '<div class="nqc-add-row" id="nqc-add-row">' +
        '<input type="text" class="nqc-input" id="nqc-input" placeholder="输入新指令…" maxlength="500">' +
        '<button type="button" class="nqc-row-btn confirm" id="nqc-confirm" title="确认添加"><i class="fa-solid fa-check"></i></button>' +
        '<button type="button" class="nqc-row-btn" id="nqc-cancel" title="取消"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<button type="button" class="nqc-add-btn" id="nqc-add-btn">' +
        '<i class="fa-solid fa-plus nqc-add-icon"></i><span>新增指令</span>' +
        '</button>';
    document.body.appendChild(panel);

    listEl = panel.querySelector('#nqc-list');
    headerCountEl = panel.querySelector('.nqc-header-count');
    addBtn = panel.querySelector('#nqc-add-btn');
    addRow = panel.querySelector('#nqc-add-row');
    inputEl = panel.querySelector('#nqc-input');

    // 夜间模式：灰色大背景 + 黑色子模块 + 白色文本（状态本地持久化）
    const nightBtn = panel.querySelector('#nqc-night-btn');
    const applyNight = (on) => {
        panel.classList.toggle('night', on);
        mask.classList.toggle('night', on);
        nightBtn.innerHTML = on ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
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

function addCommand() {
    const text = inputEl.value.trim();
    if (!text) return;
    if (settings.commands.includes(text)) {
        inputEl.select();
        return; // 已存在，不重复添加
    }
    settings.commands.push(text);
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

    const fragment = document.createDocumentFragment();
    for (const cmd of settings.commands) {
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
            const idx = settings.commands.indexOf(cmd);
            if (idx !== -1) {
                settings.commands.splice(idx, 1);
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

    if (settings.commands.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'nqc-item';
        empty.style.cssText = 'cursor:default; color:#b0b0b0; border-style:dashed;';
        const emptySpan = document.createElement('span');
        emptySpan.className = 'nqc-item-text';
        emptySpan.textContent = '暂无指令，点击下方「新增指令」添加';
        empty.appendChild(emptySpan);
        fragment.appendChild(empty);
    }

    listEl.appendChild(fragment);
    headerCountEl.textContent = `${settings.commands.length} 条`;
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
}

function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('is-open');
    mask.classList.remove('is-open');
    cancelAdd();
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

    // 页面卸载时清理面板（防止扩展热重载残留）
    window.addEventListener('beforeunload', () => {
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

    console.log(`[${MODULE_NAME}] 初始化完成：从屏幕左边缘右滑/右拖唤出快捷指令面板`);
}

export async function loop() {
    // 无需循环逻辑
}
