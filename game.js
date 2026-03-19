// ============================================================
// 夜盗 - 完整游戏逻辑
// ============================================================

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// ---- 全局状态 ----
const G = {
    // 场景
    worldWidth: 3200,       // 整个关卡宽度
    cameraX: 0,             // 摄像机偏移
    groundY: 0,             // 地面Y（运行时计算）
    wallY: 0,               // 城墙顶部Y

    // 时间
    totalTime: 180,         // 3分钟
    timeLeft: 180,
    running: false,

    // 声音
    soundLevel: 0,          // 0~dangerThreshold
    soundDecay: 12,         // 每秒衰减
    noticeThreshold: 250,    // 守卫醒来阈值
    dangerThreshold: 500,   // 直接失败阈值

    // 屏息
    breath: 100,            // 0~100
    breathDrain: 25,        // 每秒消耗
    breathRegen: 15,        // 每秒恢复
    isHoldingBreath: false,

    // 游戏阶段
    phase: 'start',         // start, lock, play, success, fail
    doorOpen: false,
    totalValue: 0,

    // 拖拽
    dragging: false,
    dragOffsetX: 0,

    // 键盘控制
    moveLeft: false,
    moveRight: false,
    moveHoldTime: 0,        // 连续按压时长（秒）
};

// ---- 地面区域 ----
const ZONES = [
    { name: '泥地',   startX: 0,    endX: 500,  color: '#4a3828', soundMult: 0.5 },
    { name: '碎石路', startX: 500,  endX: 1000, color: '#5a5a50', soundMult: 0.75 },
    { name: '木地板', startX: 1000, endX: 1800, color: '#6b4e2e', soundMult: 1.0 },
    { name: '石板地', startX: 1800, endX: 2500, color: '#5a6370', soundMult: 1.5 },
    { name: '大理石', startX: 2500, endX: 3200, color: '#8a8a8a', soundMult: 2.0 },
];

// ---- 大门 ----
const door = {
    x: 120, width: 60, height: 140,
    open: false,
};

// ---- 板车 ----
const cart = {
    x: 50, y: 0, width: 100, height: 60,
    vx: 0,
    items: [],
    maxItems: 6,
    visible: false,
    get mass() { return 1 + this.items.length * 0.6; },
    get friction() { return 0.92 - this.items.length * 0.02; },
};

// ---- 物品定义 ----
const ITEM_DEFS = [
    // 仓库前区 (木地板 1000~1800)
    { name: '小钱袋', x: 1150, value: 30,  size: 'S', pickSound: 8,  color: '#c8a84e' },
    { name: '小钱袋', x: 1300, value: 30,  size: 'S', pickSound: 8,  color: '#c8a84e' },
    { name: '粮食袋', x: 1500, value: 60,  size: 'M', pickSound: 15, color: '#8b7355' },
    { name: '粮食袋', x: 1700, value: 60,  size: 'M', pickSound: 15, color: '#8b7355' },
    // 仓库深处 (石板地 1800~2500)
    { name: '铁器箱', x: 1950, value: 100, size: 'L', pickSound: 28, color: '#6a6a6a' },
    { name: '金银箱', x: 2200, value: 160, size: 'M', pickSound: 18, color: '#daa520' },
    { name: '金银箱', x: 2400, value: 160, size: 'M', pickSound: 18, color: '#daa520' },
    // 贵重品区 (大理石 2500~3200)
    { name: '珠宝匣', x: 2700, value: 250, size: 'S', pickSound: 10, color: '#e04040' },
    { name: '珠宝匣', x: 3000, value: 300, size: 'S', pickSound: 10, color: '#ff6090' },
];

let items = [];
function initItems() {
    items = ITEM_DEFS.map((d, i) => ({
        ...d, id: i, pickedUp: false,
        baseY: 0, // 运行时设置
        bobPhase: Math.random() * Math.PI * 2,
    }));
}

// ---- 守卫 ----
const guards = [
    {
        id: 'A',
        homeX: 400, x: 400,
        patrolMin: 200, patrolMax: 1400,
        dir: 1, speed: 40, // px/s
        state: 'sleep', // sleep, patrol
        sleepTimer: 0,
        visionWidth: 180,
        visionAngle: 0,
    },
    {
        id: 'B',
        homeX: 2400, x: 2400,
        patrolMin: 1600, patrolMax: 3000,
        dir: -1, speed: 45,
        state: 'sleep',
        sleepTimer: 0,
        visionWidth: 180,
        visionAngle: 0,
    },
];

const GUARD_PATROL_RETURN_TIME = 6; // 秒无声后回去睡

// ---- 开锁小游戏 ----
const lockGame = {
    angle: 0,
    targetAngle: 0,
    tolerance: 12, // 度
    solved: false,
    lastAngle: 0,
    dragging: false,
};

// ---- 结果演出 ----
let resultAnim = { phase: 0, timer: 0, type: '', reason: '' };

// ============================================================
// 初始化
// ============================================================
function resize() {
    const container = document.getElementById('game-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight * 0.8; // 下方4/5
    G.groundY = canvas.height * 0.75;
    G.wallY = canvas.height * 0.18;

    cart.y = G.groundY - cart.height;
    items.forEach(it => { it.baseY = G.groundY - 30; });
    door.y = G.groundY - door.height;
}

function init() {
    initItems();
    lockGame.targetAngle = 30 + Math.random() * 300; // 随机目标角度
    resize();

    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('restart-btn').addEventListener('click', () => location.reload());

    // 鼠标/触摸事件
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', resetMoveInput);

    // 右键屏息
    canvas.addEventListener('mousedown', e => { if (e.button === 2) G.isHoldingBreath = true; });
    document.addEventListener('mouseup', e => { if (e.button === 2) G.isHoldingBreath = false; });

    // 开锁canvas事件
    const lc = document.getElementById('lock-canvas');
    lc.addEventListener('mousedown', onLockDown);
    lc.addEventListener('mousemove', onLockMove);
    lc.addEventListener('mouseup', onLockUp);

    window.addEventListener('resize', resize);

    requestAnimationFrame(gameLoop);
}

function startGame() {
    document.getElementById('start-overlay').classList.add('hidden');
    G.phase = 'play';
    G.running = true;
    G.timeLeft = G.totalTime;
    lastTime = performance.now();
}

// ============================================================
// 游戏主循环
// ============================================================
let lastTime = 0;

function gameLoop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (G.running) {
        updateTime(dt);
        updateSound(dt);
        updateBreath(dt);
        updateCart(dt);
        updateGuards(dt);
        checkFailConditions();
    }

    render();
    updateUI();
    requestAnimationFrame(gameLoop);
}

// ============================================================
// 更新逻辑
// ============================================================
function updateTime(dt) {
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) {
        G.timeLeft = 0;
        triggerFail('dawn');
    }
}

function updateSound(dt) {
    // 自然衰减
    G.soundLevel = Math.max(0, G.soundLevel - G.soundDecay * dt);
}

function addSound(amount) {
    // 获取板车所在区域的声音倍率
    const zone = getZoneAt(cart.x + cart.width / 2);
    const zoneMult = zone ? zone.soundMult : 1;
    const breathMult = G.isHoldingBreath ? 0.5 : 1;
    // 和失败阈值使用同一坐标系，避免UI与判定不一致
    G.soundLevel = Math.min(G.dangerThreshold, G.soundLevel + amount * zoneMult * breathMult);
}

function updateBreath(dt) {
    if (G.isHoldingBreath) {
        G.breath = Math.max(0, G.breath - G.breathDrain * dt);
        if (G.breath <= 0) G.isHoldingBreath = false;
    } else {
        G.breath = Math.min(100, G.breath + G.breathRegen * dt);
    }
}

function updateCart(dt) {
    if (!cart.visible) return;

    // 键盘推车：A/D 连续按压会逐渐提速，且噪音更大
    const moveDir = (G.moveRight ? 1 : 0) - (G.moveLeft ? 1 : 0);
    if (moveDir !== 0) {
        G.moveHoldTime = Math.min(3, G.moveHoldTime + dt);
        const holdBoost = 1 + G.moveHoldTime * 0.9;
        const pushForce = (220 / cart.mass) * holdBoost;
        cart.vx += moveDir * pushForce * dt;
        const maxSpeed = (260 / cart.mass) * holdBoost;
        cart.vx = Math.max(-maxSpeed, Math.min(maxSpeed, cart.vx));
    } else {
        G.moveHoldTime = Math.max(0, G.moveHoldTime - dt * 2);
    }

    // 惯性
    cart.x += cart.vx * dt;
    cart.vx *= Math.pow(cart.friction, dt * 10);

    // 边界
    if (cart.x < -cart.width) cart.x = -cart.width;
    if (cart.x > G.worldWidth - 20) cart.x = G.worldWidth - 20;

    // 移动时产生声音
    const speed = Math.abs(cart.vx);
    if (speed > 5) {
        const holdNoiseMult = 1 + G.moveHoldTime * 0.8;
        const baseSound = 0.8 + cart.mass * 0.6;
        const speedFactor = speed / 100;
        addSound(baseSound * speedFactor * holdNoiseMult * dt * 60);
    }

    // 检查是否逃出大门
    if (G.doorOpen && cart.x + cart.width < door.x && cart.items.length > 0) {
        triggerSuccess();
    }
}

function updateGuards(dt) {
    guards.forEach(g => {
        if (g.state === 'sleep') {
            // 声音超过阈值则醒来
            if (G.soundLevel >= G.noticeThreshold) {
                g.state = 'patrol';
                g.sleepTimer = 0;
            }
        } else if (g.state === 'patrol') {
            // 巡逻移动
            g.x += g.dir * g.speed * dt;
            if (g.x >= g.patrolMax) { g.x = g.patrolMax; g.dir = -1; }
            if (g.x <= g.patrolMin) { g.x = g.patrolMin; g.dir = 1; }

            // 声音高时加速
            if (G.soundLevel > G.noticeThreshold) {
                g.sleepTimer = 0;
                g.speed = 45 + (G.soundLevel - G.noticeThreshold);
            } else {
                g.sleepTimer += dt;
                g.speed = 40;
                if (g.sleepTimer >= GUARD_PATROL_RETURN_TIME) {
                    g.state = 'sleep';
                    g.x = g.homeX;
                    g.sleepTimer = 0;
                }
            }
        }
    });
}

function checkFailConditions() {
    if (G.phase !== 'play') return;

    // 声音超限
    if (G.soundLevel >= G.dangerThreshold) {
        triggerFail('noise');
        return;
    }

    // 守卫视线检测
    if (cart.visible) {
        for (const g of guards) {
            if (g.state !== 'patrol') continue;
            const visionLeft = g.x - g.visionWidth / 2;
            const visionRight = g.x + g.visionWidth / 2;
            const cartCenter = cart.x + cart.width / 2 - G.cameraX;
            // 守卫X是世界坐标
            const cartWorldCenter = cart.x + cart.width / 2;
            if (cartWorldCenter > visionLeft && cartWorldCenter < visionRight) {
                triggerFail('spotted');
                return;
            }
        }
    }
}

// ============================================================
// 胜负触发
// ============================================================
function triggerSuccess() {
    if (G.phase !== 'play') return;
    G.phase = 'success';
    G.running = false;
    resultAnim = { phase: 0, timer: 0, type: 'success' };
    setTimeout(showSuccessResult, 1500);
}

function triggerFail(reason) {
    if (G.phase !== 'play') return;
    G.phase = 'fail';
    G.running = false;
    resultAnim = { phase: 0, timer: 0, type: 'fail', reason };
    setTimeout(() => showFailResult(reason), 2000);
}

function showSuccessResult() {
    const panel = document.getElementById('result-panel');
    panel.className = 'result-success';
    document.getElementById('result-title').textContent = '满载而归！';
    document.getElementById('result-reason').textContent = '你在黎明前成功逃离了仓库';
    document.getElementById('result-score').textContent = `偷到 ${G.totalValue} 金`;

    const maxValue = ITEM_DEFS.reduce((s, d) => s + d.value, 0);
    const ratio = G.totalValue / maxValue;
    let stars = ratio >= 0.8 ? 3 : ratio >= 0.4 ? 2 : 1;
    document.getElementById('result-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);

    document.getElementById('result-overlay').classList.remove('hidden');
}

function showFailResult(reason) {
    const panel = document.getElementById('result-panel');
    panel.className = 'result-fail';

    const reasons = {
        spotted: { title: '你被捕了', desc: '"嘿！谁在那！"' },
        noise: { title: '你被捕了', desc: '"什么声音！？" 守卫同时惊醒' },
        dawn: { title: '你被捕了', desc: '天亮了...板车暴露在阳光下' },
    };

    const r = reasons[reason];
    document.getElementById('result-title').textContent = r.title;
    document.getElementById('result-reason').textContent = r.desc;

    if (G.totalValue > 0) {
        document.getElementById('result-score').textContent = `${G.totalValue} 金 — 全部没收`;
    } else {
        document.getElementById('result-score').textContent = '一无所获';
    }
    document.getElementById('result-stars').textContent = '';

    document.getElementById('result-overlay').classList.remove('hidden');
}

// ============================================================
// 输入处理 - 游戏场景
// ============================================================
function screenToWorld(sx) {
    return sx + G.cameraX;
}

function onPointerDown(e) {
    if (e.button !== 0) return; // 只处理左键
    if (G.phase !== 'play') return;

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = screenToWorld(sx);

    // 点击大门开锁
    if (!G.doorOpen && wx >= door.x && wx <= door.x + door.width &&
        sy >= door.y && sy <= door.y + door.height) {
        openLockGame();
        return;
    }
}

function onPointerMove(e) {
    // 推车移动改为键盘控制，此处保留用于未来扩展
}

function onPointerUp(e) {
    // 推车移动改为键盘控制，此处保留用于未来扩展
}

function onKeyDown(e) {
    if (e.code === 'KeyA') {
        G.moveLeft = true;
        e.preventDefault();
        return;
    }
    if (e.code === 'KeyD') {
        G.moveRight = true;
        e.preventDefault();
        return;
    }
    if (e.code === 'KeyF') {
        if (!e.repeat) tryPickupNearestItem();
        e.preventDefault();
    }
}

function onKeyUp(e) {
    if (e.code === 'KeyA') {
        G.moveLeft = false;
        return;
    }
    if (e.code === 'KeyD') {
        G.moveRight = false;
    }
}

function resetMoveInput() {
    G.moveLeft = false;
    G.moveRight = false;
    G.moveHoldTime = 0;
}

function tryPickupNearestItem() {
    if (G.phase !== 'play' || !cart.visible) return;
    if (cart.items.length >= cart.maxItems) return;

    const cartCenter = cart.x + cart.width / 2;
    let nearest = null;
    let nearestDist = Infinity;

    for (const it of items) {
        if (it.pickedUp) continue;
        const dist = Math.abs(it.x - cartCenter);
        if (dist < nearestDist) {
            nearest = it;
            nearestDist = dist;
        }
    }

    if (!nearest) return;
    if (nearestDist < 200) {
        pickupItem(nearest);
    } else {
        // 最近物品也太远，给出闪烁反馈
        nearest._flash = 30;
    }
}

// ============================================================
// 物品装载
// ============================================================
function pickupItem(item) {
    if (cart.items.length >= cart.maxItems) return; // 满了
    item.pickedUp = true;
    cart.items.push(item);
    G.totalValue += item.value;

    // 声音
    addSound(item.pickSound);

    // 得手动画数据
    item._pickAnim = { timer: 1.5, value: item.value };
}

// ============================================================
// 开锁小游戏
// ============================================================
function openLockGame() {
    G.phase = 'lock';
    document.getElementById('lock-overlay').classList.remove('hidden');
    drawLock();
}

function onLockDown(e) {
    lockGame.dragging = true;
    lockGame.lastAngle = getLockAngle(e);
}

function onLockMove(e) {
    if (!lockGame.dragging) return;
    const angle = getLockAngle(e);
    let delta = angle - lockGame.lastAngle;
    // 旋转速度过快产生声音
    if (Math.abs(delta) > 10) {
        addSound(Math.abs(delta) * 0.3);
    }
    lockGame.angle = (lockGame.angle + delta + 360) % 360;
    lockGame.lastAngle = angle;
    drawLock();

    // 检查是否到达目标角度
    let diff = Math.abs(lockGame.angle - lockGame.targetAngle);
    if (diff > 180) diff = 360 - diff;
    if (diff < lockGame.tolerance) {
        lockGame.solved = true;
        lockGame.dragging = false;
        document.getElementById('lock-hint').textContent = '解锁成功！';
        document.getElementById('lock-hint').style.color = '#5a5';
        setTimeout(closeLockGame, 600);
    }
}

function onLockUp() {
    lockGame.dragging = false;
}

function getLockAngle(e) {
    const lc = document.getElementById('lock-canvas');
    const rect = lc.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const mx = e.clientX - rect.left - cx;
    const my = e.clientY - rect.top - cy;
    return ((Math.atan2(my, mx) * 180 / Math.PI) + 360) % 360;
}

function drawLock() {
    const lc = document.getElementById('lock-canvas');
    const lctx = lc.getContext('2d');
    const cx = lc.width / 2, cy = lc.height / 2, r = 80;
    lctx.clearRect(0, 0, lc.width, lc.height);

    // 外圈
    lctx.beginPath();
    lctx.arc(cx, cy, r, 0, Math.PI * 2);
    lctx.strokeStyle = '#666';
    lctx.lineWidth = 6;
    lctx.stroke();

    // 目标区域（隐形提示：靠近时颜色变化）
    let diff = Math.abs(lockGame.angle - lockGame.targetAngle);
    if (diff > 180) diff = 360 - diff;
    const proximity = Math.max(0, 1 - diff / 90);

    // 锁芯中心
    lctx.beginPath();
    lctx.arc(cx, cy, 20, 0, Math.PI * 2);
    const g = Math.floor(proximity * 200);
    lctx.fillStyle = `rgb(${100 - g / 2}, ${80 + g}, ${60})`;
    lctx.fill();

    // 指针
    const rad = lockGame.angle * Math.PI / 180;
    lctx.beginPath();
    lctx.moveTo(cx, cy);
    lctx.lineTo(cx + Math.cos(rad) * (r - 10), cy + Math.sin(rad) * (r - 10));
    lctx.strokeStyle = '#e8d5a3';
    lctx.lineWidth = 3;
    lctx.stroke();

    // 提示 - 靠近时"阻力"文字
    if (proximity > 0.5) {
        document.getElementById('lock-hint').textContent = '感觉到阻力了...';
        document.getElementById('lock-hint').style.color = '#5a5';
    } else {
        document.getElementById('lock-hint').textContent = '缓慢转动，感受阻力';
        document.getElementById('lock-hint').style.color = '#999';
    }
}

function closeLockGame() {
    document.getElementById('lock-overlay').classList.add('hidden');
    G.doorOpen = true;
    door.open = true;
    cart.visible = true;
    cart.x = door.x + door.width + 10;
    G.phase = 'play';
}

// ============================================================
// 渲染
// ============================================================
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 摄像机跟随板车
    if (cart.visible) {
        const targetCam = cart.x - canvas.width * 0.35;
        G.cameraX += (targetCam - G.cameraX) * 0.08;
    }
    G.cameraX = Math.max(0, Math.min(G.worldWidth - canvas.width, G.cameraX));

    // 天色
    const timeRatio = 1 - G.timeLeft / G.totalTime; // 0=夜 1=天亮
    drawSky(timeRatio);
    drawWall();
    drawGuards();
    drawGround();
    drawDoor();
    drawItems();
    drawCart();
    drawGuardVision();
    drawPickupAnimations();

    // 失败/成功演出
    if (G.phase === 'fail') drawFailEffect();
    if (G.phase === 'success') drawSuccessEffect();
}

function drawSky(timeRatio) {
    const r = Math.floor(10 + timeRatio * 60);
    const g = Math.floor(10 + timeRatio * 40);
    const b = Math.floor(30 + timeRatio * 50);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, canvas.width, G.wallY);

    // 星星（夜晚可见）
    if (timeRatio < 0.7) {
        const alpha = (1 - timeRatio / 0.7) * 0.8;
        ctx.fillStyle = `rgba(255,255,220,${alpha})`;
        const seed = 42;
        for (let i = 0; i < 30; i++) {
            const sx = ((seed * (i + 1) * 7) % canvas.width);
            const sy = ((seed * (i + 1) * 13) % (G.wallY - 10));
            ctx.fillRect(sx, sy, 2, 2);
        }
    }
}

function drawWall() {
    const wallH = G.groundY - G.wallY - 200;
    // 城墙顶部平台
    ctx.fillStyle = '#3a3530';
    ctx.fillRect(-G.cameraX, G.wallY, G.worldWidth + 200, 30);
    // 城垛
    for (let x = -G.cameraX; x < canvas.width + 50; x += 40) {
        ctx.fillStyle = '#3a3530';
        ctx.fillRect(x, G.wallY - 15, 25, 15);
    }
    // 城墙体
    ctx.fillStyle = '#2e2a25';
    ctx.fillRect(-G.cameraX, G.wallY + 30, G.worldWidth + 200, 100);

    // 砖纹
    ctx.strokeStyle = '#1e1a15';
    ctx.lineWidth = 1;
    for (let row = 0; row < 4; row++) {
        const y = G.wallY + 30 + row * 25;
        const offset = row % 2 === 0 ? 0 : 30;
        for (let x = -G.cameraX + offset; x < canvas.width + 60; x += 60) {
            ctx.strokeRect(x, y, 60, 25);
        }
    }
}

function drawGround() {
    ZONES.forEach(zone => {
        const sx = zone.startX - G.cameraX;
        const ex = zone.endX - G.cameraX;
        const w = ex - sx;

        ctx.fillStyle = zone.color;
        ctx.fillRect(sx, G.groundY, w, canvas.height - G.groundY);

        // 地面纹理
        if (zone.name === '大理石') {
            // 光泽感
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            for (let x = sx; x < ex; x += 80) {
                ctx.fillRect(x, G.groundY, 40, canvas.height - G.groundY);
            }
        } else if (zone.name === '碎石路') {
            ctx.fillStyle = 'rgba(200,200,200,0.15)';
            for (let i = 0; i < 20; i++) {
                const px = sx + ((i * 73 + 11) % Math.max(1, Math.floor(w)));
                ctx.fillRect(px, G.groundY + 5, 4, 3);
            }
        } else if (zone.name === '木地板') {
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 1;
            for (let x = sx; x < ex; x += 50) {
                ctx.beginPath();
                ctx.moveTo(x, G.groundY);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
        }

        // 区域名称标签
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '11px sans-serif';
        ctx.fillText(zone.name, sx + 10, G.groundY + 16);
    });

    // 地面线
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, G.groundY);
    ctx.lineTo(canvas.width, G.groundY);
    ctx.stroke();
}

function drawDoor() {
    const dx = door.x - G.cameraX;

    // 门框
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(dx - 8, G.groundY - door.height - 10, door.width + 16, door.height + 10);

    if (door.open) {
        // 打开的门（向内倾斜效果）
        ctx.fillStyle = '#2a1a0a';
        ctx.fillRect(dx, G.groundY - door.height, 15, door.height);
        // 门洞
        ctx.fillStyle = '#111';
        ctx.fillRect(dx + 15, G.groundY - door.height, door.width - 15, door.height);
    } else {
        // 关着的门
        ctx.fillStyle = '#5a4020';
        ctx.fillRect(dx, G.groundY - door.height, door.width, door.height);
        // 门环
        ctx.beginPath();
        ctx.arc(dx + door.width - 15, G.groundY - door.height / 2, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#b8960c';
        ctx.lineWidth = 3;
        ctx.stroke();
        // 锁
        ctx.fillStyle = '#888';
        ctx.fillRect(dx + door.width / 2 - 8, G.groundY - door.height / 2 + 15, 16, 12);
        ctx.fillStyle = '#555';
        ctx.beginPath();
        ctx.arc(dx + door.width / 2, G.groundY - door.height / 2 + 10, 10, Math.PI, 0);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#888';
        ctx.stroke();

        // 点击提示
        if (G.phase === 'play' && !G.doorOpen) {
            ctx.fillStyle = 'rgba(232,213,163,0.7)';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('点击开锁', dx + door.width / 2, G.groundY - door.height - 18);
            ctx.textAlign = 'left';
        }
    }
}

function drawCart() {
    if (!cart.visible) return;
    const cx = cart.x - G.cameraX;
    const cy = cart.y;

    // 车身
    ctx.fillStyle = '#5a4535';
    ctx.fillRect(cx, cy + 10, cart.width, cart.height - 20);

    // 车边框
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy + 10, cart.width, cart.height - 20);

    // 轮子
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx + 20, cy + cart.height, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + cart.width - 20, cy + cart.height, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx + 20, cy + cart.height, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + cart.width - 20, cy + cart.height, 10, 0, Math.PI * 2);
    ctx.stroke();

    // 把手
    ctx.strokeStyle = '#5a4535';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + 25);
    ctx.lineTo(cx - 25, cy + 15);
    ctx.stroke();

    // 车上物品（简化显示）
    cart.items.forEach((item, i) => {
        const ix = cx + 10 + (i % 3) * 30;
        const iy = cy + 5 - Math.floor(i / 3) * 20;
        const sz = item.size === 'L' ? 14 : item.size === 'M' ? 11 : 8;
        ctx.fillStyle = item.color;
        ctx.fillRect(ix, iy, sz * 2, sz);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ix, iy, sz * 2, sz);
    });

    // 容量提示
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${cart.items.length}/${cart.maxItems}`, cx + cart.width / 2, cy + cart.height + 24);
    ctx.textAlign = 'left';
}

function drawItems() {
    items.forEach(it => {
        if (it.pickedUp) return;
        const sx = it.x - G.cameraX;
        const sy = it.baseY;
        const sz = it.size === 'L' ? 20 : it.size === 'M' ? 15 : 10;

        // 浮动效果
        it.bobPhase += 0.02;
        const bob = Math.sin(it.bobPhase) * 3;

        // 闪烁（太远提示）
        if (it._flash && it._flash > 0) {
            it._flash--;
            if (it._flash % 6 < 3) return; // 闪烁跳过帧
        }

        // 物品本体
        ctx.fillStyle = it.color;
        ctx.fillRect(sx - sz, sy - sz * 2 + bob, sz * 2, sz * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx - sz, sy - sz * 2 + bob, sz * 2, sz * 2);

        // 价值标签
        ctx.fillStyle = 'rgba(240,192,64,0.9)';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${it.value}金`, sx, sy - sz * 2 - 8 + bob);

        // 拿取图标（板车靠近时显示）
        if (cart.visible) {
            const dist = Math.abs(it.x - (cart.x + cart.width / 2));
            if (dist < 200) {
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.font = '18px sans-serif';
                ctx.fillText('✋', sx, sy - sz * 2 - 24 + bob);
            }
        }
        ctx.textAlign = 'left';
    });
}

function drawGuards() {
    guards.forEach(g => {
        const gx = g.x - G.cameraX;
        const gy = G.wallY - 5;

        // 身体
        ctx.fillStyle = '#8b0000';
        ctx.fillRect(gx - 12, gy - 35, 24, 30);

        // 头
        ctx.fillStyle = '#d4a574';
        ctx.beginPath();
        ctx.arc(gx, gy - 42, 10, 0, Math.PI * 2);
        ctx.fill();

        // 帽子
        ctx.fillStyle = '#4a4a4a';
        ctx.fillRect(gx - 12, gy - 55, 24, 8);
        ctx.fillRect(gx - 8, gy - 62, 16, 8);

        if (g.state === 'sleep') {
            // Zzz动画
            const t = performance.now() / 1000;
            const zAlpha = 0.5 + Math.sin(t * 2) * 0.3;
            ctx.fillStyle = `rgba(255,255,255,${zAlpha})`;
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText('Z', gx + 15, gy - 55 + Math.sin(t * 1.5) * 5);
            ctx.font = '12px sans-serif';
            ctx.fillText('z', gx + 28, gy - 62 + Math.sin(t * 2) * 4);
            ctx.font = '10px sans-serif';
            ctx.fillText('z', gx + 36, gy - 68 + Math.sin(t * 2.5) * 3);
        } else {
            // 巡逻中 - 眼睛发光
            ctx.fillStyle = '#ff4444';
            ctx.fillRect(gx - 5, gy - 45, 3, 3);
            ctx.fillRect(gx + 2, gy - 45, 3, 3);

            // 巡逻方向箭头
            ctx.fillStyle = 'rgba(255,100,100,0.5)';
            ctx.font = '14px sans-serif';
            ctx.fillText(g.dir > 0 ? '→' : '←', gx - 5, gy - 65);
        }
    });
}

function drawGuardVision() {
    guards.forEach(g => {
        if (g.state !== 'patrol') return;

        const gx = g.x - G.cameraX;
        const gy = G.wallY + 30;
        const halfW = g.visionWidth / 2;
        const bottomY = G.groundY;

        // 视线锥形光柱
        const gradient = ctx.createLinearGradient(0, gy, 0, bottomY);
        gradient.addColorStop(0, 'rgba(255,255,200,0.15)');
        gradient.addColorStop(1, 'rgba(255,255,200,0.05)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(gx - 10, gy);
        ctx.lineTo(gx - halfW, bottomY);
        ctx.lineTo(gx + halfW, bottomY);
        ctx.lineTo(gx + 10, gy);
        ctx.closePath();
        ctx.fill();

        // 预警区域（视线即将到达的范围）
        const previewX = gx + g.dir * (halfW + 60);
        ctx.fillStyle = 'rgba(255,255,100,0.03)';
        ctx.beginPath();
        ctx.moveTo(previewX - 10, gy);
        ctx.lineTo(previewX - halfW, bottomY);
        ctx.lineTo(previewX + halfW, bottomY);
        ctx.lineTo(previewX + 10, gy);
        ctx.closePath();
        ctx.fill();
    });
}

function drawPickupAnimations() {
    items.forEach(it => {
        if (!it._pickAnim) return;
        const anim = it._pickAnim;
        anim.timer -= 0.016;
        if (anim.timer <= 0) {
            delete it._pickAnim;
            return;
        }

        const progress = 1 - anim.timer / 1.5;
        const sx = it.x - G.cameraX;
        const sy = it.baseY - 60 - progress * 40;
        const alpha = 1 - progress;

        ctx.fillStyle = `rgba(240,192,64,${alpha})`;
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`+${anim.value}金`, sx, sy);

        // 叮！文字
        if (progress < 0.3) {
            ctx.font = 'bold 16px sans-serif';
            ctx.fillStyle = `rgba(255,255,255,${1 - progress / 0.3})`;
            ctx.fillText('叮！', sx + 40, sy + 10);
        }
        ctx.textAlign = 'left';
    });
}

function drawFailEffect() {
    resultAnim.timer += 0.016;
    const t = resultAnim.timer;

    if (resultAnim.reason === 'spotted') {
        // 画面红闪
        const flash = Math.sin(t * 15) * 0.3 + 0.3;
        ctx.fillStyle = `rgba(200,0,0,${flash * Math.min(1, t)})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 文字
        if (t > 0.5) {
            ctx.fillStyle = `rgba(255,255,255,${Math.min(1, (t - 0.5) * 2)})`;
            ctx.font = 'bold 36px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('"嘿！谁在那！"', canvas.width / 2, canvas.height / 2);
            ctx.textAlign = 'left';
        }

        // 渐黑
        if (t > 1.2) {
            ctx.fillStyle = `rgba(0,0,0,${Math.min(1, (t - 1.2) * 2)})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    } else if (resultAnim.reason === 'noise') {
        // 屏幕边缘红闪
        const flash = Math.min(1, t * 3);
        ctx.strokeStyle = `rgba(255,0,0,${flash})`;
        ctx.lineWidth = 20;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);

        if (t > 0.3) {
            ctx.fillStyle = `rgba(255,255,255,${Math.min(1, (t - 0.3) * 2)})`;
            ctx.font = 'bold 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('"什么声音！？"', canvas.width / 2, canvas.height / 2);
            ctx.textAlign = 'left';
        }

        if (t > 1.2) {
            ctx.fillStyle = `rgba(0,0,0,${Math.min(1, (t - 1.2) * 2)})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    } else if (resultAnim.reason === 'dawn') {
        // 天亮效果
        const bright = Math.min(0.8, t * 0.5);
        ctx.fillStyle = `rgba(255,230,180,${bright})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (t > 1) {
            ctx.fillStyle = `rgba(80,40,0,${Math.min(1, (t - 1) * 2)})`;
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('天亮了......', canvas.width / 2, canvas.height / 2);
            ctx.textAlign = 'left';
        }
    }
}

function drawSuccessEffect() {
    resultAnim.timer += 0.016;
    const t = resultAnim.timer;

    // 黎明金光
    const bright = Math.min(0.6, t * 0.4);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, `rgba(255,200,80,${bright})`);
    gradient.addColorStop(1, `rgba(255,230,150,${bright * 0.5})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 金币飞散
    if (t > 0.3) {
        ctx.fillStyle = '#f0c040';
        ctx.font = '20px sans-serif';
        for (let i = 0; i < 15; i++) {
            const phase = t * 2 + i * 0.7;
            const px = canvas.width * 0.3 + Math.sin(phase * 3 + i) * 200;
            const py = canvas.height * 0.5 - phase * 50 + Math.sin(phase * 5) * 30;
            const alpha = Math.max(0, 1 - (t - 0.3) / 1.2);
            ctx.globalAlpha = alpha;
            ctx.fillText('●', px, py);
        }
        ctx.globalAlpha = 1;
    }

    // 价值文字
    if (t > 0.5) {
        ctx.fillStyle = `rgba(180,130,0,${Math.min(1, (t - 0.5) * 2)})`;
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${G.totalValue} 金！`, canvas.width / 2, canvas.height / 2);
        ctx.font = '20px sans-serif';
        ctx.fillText('满载而归！', canvas.width / 2, canvas.height / 2 + 45);
        ctx.textAlign = 'left';
    }
}

// ============================================================
// UI更新
// ============================================================
function updateUI() {
    // 倒计时
    const min = Math.floor(G.timeLeft / 60);
    const sec = Math.floor(G.timeLeft % 60);
    document.getElementById('timer').textContent =
        `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

    // 天色变化 - timer颜色
    const timeRatio = G.timeLeft / G.totalTime;
    const timerEl = document.getElementById('timer');
    if (timeRatio < 0.2) {
        timerEl.style.color = '#ff4444';
        timerEl.style.textShadow = '0 0 10px rgba(255,0,0,0.8)';
    } else if (timeRatio < 0.4) {
        timerEl.style.color = '#ff8844';
    } else {
        timerEl.style.color = '#e8d5a3';
        timerEl.style.textShadow = '0 0 10px rgba(232,213,163,0.5)';
    }

    // 声音条（按 dangerThreshold 映射到 0~100%）
    const soundMax = Math.max(G.dangerThreshold, 1);
    const soundBar = document.getElementById('sound-bar');
    const soundPercent = (G.soundLevel / soundMax) * 100;
    soundBar.style.width = `${Math.min(100, soundPercent)}%`;

    // 阈值线位置（与逻辑阈值保持一致）
    const noticeEl = document.getElementById('threshold-notice');
    const dangerEl = document.getElementById('threshold-danger');
    noticeEl.style.left = `${Math.min(100, (G.noticeThreshold / soundMax) * 100)}%`;
    dangerEl.style.left = `${Math.min(100, (G.dangerThreshold / soundMax) * 100)}%`;

    // 屏息条
    document.getElementById('breath-bar').style.width = `${G.breath}%`;

    // 价值
    document.getElementById('total-value').textContent = `${G.totalValue} 金`;

    // 守卫状态
    const guardEl = document.getElementById('guard-status');
    const anyPatrol = guards.some(g => g.state === 'patrol');
    if (anyPatrol) {
        guardEl.textContent = '巡逻中！';
        guardEl.style.color = '#ff4444';
    } else {
        guardEl.textContent = '睡眠中';
        guardEl.style.color = '#5a5';
    }
}

// ============================================================
// 工具函数
// ============================================================
function getZoneAt(worldX) {
    return ZONES.find(z => worldX >= z.startX && worldX < z.endX) || ZONES[0];
}

// ============================================================
// 启动
// ============================================================
window.addEventListener('load', init);
