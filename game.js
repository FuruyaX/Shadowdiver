// ==================================================================
// ゲーム全体の管理オブジェクト (シングルトン)
// ==================================================================
const Game = {
    // --- 状態管理 ---
    state: 'loading', // loading, playing, inventory, encounter, gameover
    player: null,
    dungeon: null,
    floor: 1,
    turn: 0,
    
    // --- DOM要素 ---
    dom: {},

    // --- 設定 ---
    MAP_WIDTH: 25,
    MAP_HEIGHT: 25,
    PLAYER_VISION: 5,

    // ==================================================================
    // 初期化
    // ==================================================================
    init() {
        // DOM要素のキャッシュ
        this.dom.mapContainer = document.getElementById('map-container');
        this.dom.messageLog = document.getElementById('message-log');
        this.dom.floorStat = document.getElementById('floor-stat');
        this.dom.hpStat = document.getElementById('hp-stat');
        this.dom.staminaStat = document.getElementById('stamina-stat');
        this.dom.inventoryCount = document.getElementById('inventory-count');
        this.dom.inventoryList = document.getElementById('inventory-list');
        this.dom.inventoryPrompt = document.getElementById('inventory-prompt');
        this.dom.overlay = document.getElementById('overlay');
        this.dom.overlayTitle = document.getElementById('overlay-title');
        this.dom.overlayText = document.getElementById('overlay-text');
        this.dom.overlayActions = document.getElementById('overlay-actions');
        this.dom.restartButton = document.getElementById('restart-button');

        this.dom.restartButton.onclick = () => window.location.reload();
        
        this.startNewGame();
        this.bindInput();
    },

    startNewGame() {
        this.floor = 1;
        this.turn = 0;
        this.player = new Player(100, 50);
        this.dungeon = new Dungeon(this.MAP_WIDTH, this.MAP_HEIGHT);
        
        // 初期アイテム
        this.player.addItem(ItemFactory.create('スタミナドリンク'));
        this.player.addItem(ItemFactory.create('スモーク弾'));

        this.setupNewFloor();
        this.state = 'playing';
        this.dom.overlay.style.display = 'none';
        this.logMessage(`地下 ${this.floor}階`, 'system');
    },
    
    // ==================================================================
    // ゲームループ
    // ==================================================================
    async processTurn(playerAction) {
        if (this.state !== 'playing') return;

        // 1. プレイヤーのアクション実行
        const actionResult = playerAction();
        if (!actionResult.success) {
            this.logMessage(actionResult.message, 'warning');
            return;
        }
        this.player.stamina -= actionResult.cost;
        this.turn++;

        // 2. ゲームワールドの更新
        do {
            this.dungeon.enemy.energy += this.dungeon.enemy.speed;
            while(this.dungeon.enemy.energy >= 10) {
                this.dungeon.enemy.energy -= 10;
                this.dungeon.enemy.update();
                // 敵の移動後にエンカウント判定
                if (this.dungeon.isPlayerCaught()) {
                    this.startEncounter();
                    return; // エンカウント発生でターン処理中断
                }
            }
        } while(this.dungeon.enemy.speed > 10 && this.dungeon.enemy.energy < 10); // 敵が高速なら再度行動

        // 3. ターン終了処理
        this.dungeon.updatePlayerVision(this.player.x, this.player.y, this.PLAYER_VISION);
        this.dungeon.isPlayerCaught(); // 接近警告のため
        this.player.regenerateStamina();
        this.updateUI();
    },
    
    // ==================================================================
    // UI更新
    // ==================================================================
    updateUI() {
        this.dungeon.renderMap();
        this.dom.floorStat.textContent = this.floor;
        this.dom.hpStat.textContent = `${this.player.hp}/${this.player.maxHp}`;
        this.dom.staminaStat.textContent = `${this.player.stamina}/${this.player.maxStamina}`;
        this.updateInventoryUI();
    },

    updateInventoryUI() {
        this.dom.inventoryList.innerHTML = '';
        this.dom.inventoryCount.textContent = this.player.inventory.length;
        this.player.inventory.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'inventory-item';
            li.textContent = item.name;
            li.onclick = () => this.handleItemClick(item, index);
            this.dom.inventoryList.appendChild(li);
        });
    },
    
    // ==================================================================
    // レベル・フロア関連
    // ==================================================================
    setupNewFloor() {
        this.dungeon.generate();
        const startPos = this.dungeon.getEmptyTile();
        this.player.x = startPos.x;
        this.player.y = startPos.y;
        this.dungeon.updatePlayerVision(this.player.x, this.player.y, this.PLAYER_VISION);
        this.updateUI();
    },

    nextFloor() {
        this.floor++;
        this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 20); // フロア移動ボーナス
        this.logMessage(`地下 ${this.floor}階`, 'system');
        this.setupNewFloor();
    },
    
    // ==================================================================
    // イベント処理
    // ==================================================================
    handleInteraction() {
        const tile = this.dungeon.getTile(this.player.x, this.player.y);
        
        switch (tile.entity?.type) {
            case 'stairs': this.nextFloor(); return {success: true, cost: 0};
            case 'item':
                if (this.player.addItem(tile.entity.item)) {
                    this.logMessage(`${tile.entity.item.name}を拾った。`, 'info');
                    tile.entity = null;
                } else {
                    this.logMessage('インベントリが一杯だ。', 'warning');
                }
                return {success: true, cost: 0};
            case 'chest':
                // ここに宝箱を開けるロジック
                this.logMessage('宝箱がある。');
                return {success: true, cost: 1};
            default:
                 // 何もなければ1ターン待機
                 this.logMessage('様子をうかがった。', 'info');
                 return {success: true, cost: 1};
        }
    },

    startEncounter() {
        this.state = 'encounter';
        this.dom.overlayTitle.textContent = '影に捕捉された！';
        this.dom.overlayText.textContent = 'どう切り抜ける？';
        this.dom.overlayActions.innerHTML = '';

        // アクション：回避
        const dodgeButton = this.createActionButton('回避 (ST:20)', () => {
            if (this.player.stamina >= 20) {
                this.player.stamina -= 20;
                if (Math.random() < 0.5) { // 50%で成功
                    this.logMessage('素早く身をかわし、距離を取った！', 'system');
                    this.dungeon.enemy.warp();
                    this.endEncounter();
                } else {
                    this.logMessage('回避に失敗し、攻撃を受けた！', 'danger');
                    this.player.takeDamage(20);
                    this.endEncounter();
                }
            } else {
                this.dom.overlayText.textContent = 'スタミナが足りず回避できない！';
            }
        });
        this.dom.overlayActions.appendChild(dodgeButton);

        // アクション：インベントリの戦闘アイテム
        this.player.inventory.forEach(item => {
            if (item.category === '戦闘') {
                const itemButton = this.createActionButton(`使う: ${item.name}`, () => {
                    item.use(this.player, this);
                    this.player.removeItem(item);
                    this.endEncounter();
                });
                this.dom.overlayActions.appendChild(itemButton);
            }
        });
        
        this.dom.restartButton.style.display = 'none';
        this.dom.overlay.style.display = 'flex';
    },

    endEncounter() {
        this.state = 'playing';
        this.dom.overlay.style.display = 'none';
        this.updateUI();
    },

    gameOver(reason) {
        this.state = 'gameover';
        this.dom.overlayTitle.textContent = '探索失敗';
        this.dom.overlayText.textContent = reason;
        this.dom.overlayActions.innerHTML = '';
        this.dom.restartButton.style.display = 'block';
        this.dom.overlay.style.display = 'flex';
    },
    
    // ==================================================================
    // 入力とユーティリティ
    // ==================================================================
    logMessage(text, type = 'info') {
        const p = document.createElement('p');
        p.textContent = `[T:${this.turn}] ${text}`;
        p.className = type;
        this.dom.messageLog.prepend(p);
    },
    
    bindInput() {
        document.addEventListener('keydown', (e) => {
            if (this.state !== 'playing') return;
            let action = null;
            switch (e.key) {
                case 'ArrowUp': case 'w': action = () => this.player.move(0, -1); break;
                case 'ArrowDown': case 's': action = () => this.player.move(0, 1); break;
                case 'ArrowLeft': case 'a': action = () => this.player.move(-1, 0); break;
                case 'ArrowRight': case 'd': action = () => this.player.move(1, 0); break;
                case ' ': case 'Enter': action = () => this.handleInteraction(); break;
                // 'i'キーでインベントリを開くなどの拡張も可能
                default: return;
            }
            if (action) this.processTurn(action);
        });
    },

    createActionButton(text, onClick) {
        const button = document.createElement('button');
        button.className = 'action-button';
        button.textContent = text;
        button.onclick = onClick;
        return button;
    }
};

// ==================================================================
// アイテム定義とファクトリ
// ==================================================================
const ItemFactory = {
    definitions: {
        'スタミナドリンク': { category: '移動', use: (p, g) => { p.stamina = Math.min(p.maxStamina, p.stamina + 30); g.logMessage('スタミナが回復した。', 'system'); }},
        '救急キット': { category: '特殊', use: (p, g) => { p.hp = Math.min(p.maxHp, p.hp + 50); g.logMessage('HPが回復した。', 'system'); }},
        'スモーク弾': { category: '戦闘', use: (p, g) => { g.logMessage('スモーク弾を使い、影の視界から逃れた！', 'system'); g.dungeon.enemy.warp(); }},
        '閃光弾': { category: '戦闘', use: (p, g) => { g.logMessage('閃光弾で影の動きを止めた！', 'system'); g.dungeon.enemy.setMode('wander_a', 20); }},
        'コンパス': { category: '探索', use: (p, g) => { g.logMessage('コンパスが階段の方向を示した。', 'system'); /* ここで方角を示す */ }},
    },
    create(name) {
        const def = this.definitions[name];
        return { name, category: def.category, use: def.use };
    }
};


// ==================================================================
// プレイヤークラス
// ==================================================================
class Player {
    constructor(maxHp, maxStamina) {
        this.x = 0; this.y = 0;
        this.hp = maxHp; this.maxHp = maxHp;
        this.stamina = maxStamina; this.maxStamina = maxStamina;
        this.inventory = [];
    }
    move(dx, dy) {
        const newX = this.x + dx;
        const newY = this.y + dy;
        if (!Game.dungeon.isWalkable(newX, newY)) {
            return { success: false, message: '壁に阻まれた。' };
        }
        if (this.stamina <= 0) {
            return { success: false, message: 'スタミナ不足で動けない。' };
        }
        this.x = newX;
        this.y = newY;
        
        const tile = Game.dungeon.getTile(this.x, this.y);
        if (tile.entity?.type === 'trap') {
            Game.logMessage('罠を踏んでしまった！', 'danger');
            this.takeDamage(tile.entity.damage);
            tile.entity = null; // 罠は一度きり
        }
        return { success: true, cost: 1 };
    }
    takeDamage(amount) {
        this.hp -= amount;
        Game.dom.hpStat.textContent = `${this.hp}/${this.maxHp}`;
        if (this.hp <= 0) {
            Game.gameOver(`HPが0になった...`);
        }
    }
    regenerateStamina() {
        if (Game.turn % 2 === 0 && this.stamina < this.maxStamina) {
            this.stamina++;
        }
    }
    addItem(item) {
        if (this.inventory.length < 10) {
            this.inventory.push(item);
            return true;
        }
        return false;
    }
    removeItem(item) {
        this.inventory = this.inventory.filter(i => i !== item);
    }
}

// ==================================================================
// ダンジョンクラス
// ==================================================================
class Dungeon {
    // ... (generate, getEmptyTile, isWalkable, updatePlayerVision, renderMapは前回とほぼ同じ)
    constructor(width, height) { this.width = width; this.height = height; this.map = []; this.enemy = null; }
    generate() {
        // マップ生成ロジック (Drunkard's Walk)
        this.map = Array.from({ length: this.height }, () => Array.from({ length: this.width }, () => ({ type: 'wall', visible: false, discovered: false, entity: null })));
        let x = Math.floor(this.width / 2), y = Math.floor(this.height / 2);
        this.getTile(x, y).type = 'floor';
        let floorTiles = Math.floor(this.width * this.height * 0.45);
        for(let i=0; i<floorTiles; i++) {
             let nx = x + Math.floor(Math.random() * 3) - 1;
             let ny = y + Math.floor(Math.random() * 3) - 1;
             if(nx > 0 && nx < this.width -1 && ny > 0 && ny < this.height -1) {
                 x = nx; y = ny;
                 if(this.getTile(x,y).type === 'wall') { this.getTile(x,y).type = 'floor'; }
             }
        }
        // エンティティ配置
        this.placeEntity({ type: 'stairs' }, 1);
        this.placeEntity({ type: 'item', item: ItemFactory.create('救急キット') }, 2);
        this.placeEntity({ type: 'trap', damage: 10 }, 5);
        
        this.enemy = new Enemy(this);
    }
    placeEntity(entity, count) {
        for(let i=0; i<count; i++) {
            const pos = this.getEmptyTile();
            this.getTile(pos.x, pos.y).entity = JSON.parse(JSON.stringify(entity));
        }
    }
    getTile(x, y) { return this.map[y][x]; }
    getEmptyTile() { let x, y; do { x = Math.floor(Math.random() * this.width); y = Math.floor(Math.random() * this.height); } while (this.getTile(x, y).type !== 'floor' || this.getTile(x,y).entity); return { x, y }; }
    isWalkable(x, y) { return x >= 0 && x < this.width && y >= 0 && y < this.height && this.getTile(x, y).type !== 'wall'; }
    updatePlayerVision(px, py, radius) { /* ... */ }
    renderMap() { /* ... */ }
    isPlayerCaught() {
        const dist = Math.abs(Game.player.x - this.enemy.x) + Math.abs(Game.player.y - this.enemy.y);
        if (dist === 0) return true;

        if (this.enemy.mode === 'active' && dist <= this.enemy.detectionRange.active) {
            Game.logMessage(`【警告】影が猛追してくる！[距離:${dist}]`, 'danger');
        } else if ((this.enemy.mode === 'search' || this.enemy.mode === 'wander_b') && dist <= this.enemy.detectionRange.search) {
            Game.logMessage(`影の気配を感じる... [距離:${dist}]`, 'warning');
        }
        return false;
    }
}
// Dungeonクラスのメソッド実装（前回から流用し、entity描画を追加）
Dungeon.prototype.updatePlayerVision = function(px, py, radius) { for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) { const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2); if (dist <= radius) { this.map[y][x].visible = true; this.map[y][x].discovered = true; } else { this.map[y][x].visible = false; } } };
Dungeon.prototype.renderMap = function() { Game.dom.mapContainer.innerHTML = ''; Game.dom.mapContainer.style.gridTemplateColumns = `repeat(${this.width}, 1fr)`; for (let y = 0; y < this.height; y++) { for (let x = 0; x < this.width; x++) { const tile = this.getTile(x, y); const cell = document.createElement('div'); cell.className = `map-cell ${tile.type}`; if (tile.entity?.type==='trap') cell.classList.add('trap'); if (tile.visible) cell.classList.add('visible'); else if (tile.discovered) cell.classList.add('discovered'); let content = ''; if (tile.visible) { if (Game.player.x === x && Game.player.y === y) content = '🙂'; else if (tile.entity) { switch(tile.entity.type){ case 'stairs': content = '🔽'; break; case 'item': content = '💊'; break; case 'chest': content = '📦'; break; } } } cell.innerHTML = `<span>${content}</span>`; Game.dom.mapContainer.appendChild(cell); } } };


// ==================================================================
// 敵クラス (AIロジック)
// ==================================================================
class Enemy {
    constructor(dungeon) {
        this.dungeon = dungeon;
        this.energy = 0;
        this.detectionRange = { search: 6, active: 10 };
        this.setMode('search');
        this.warp();
    }

    setMode(newMode, durationOverride = null) {
        if (this.mode === newMode) return;
        this.mode = newMode;
        
        switch(newMode) {
            case 'search':
                Game.logMessage("影はこちらの様子を探っている...", "warning");
                this.speed = 8; // プレイヤー(10)より少し遅い
                this.modeTimer = durationOverride || 40;
                break;
            case 'active':
                Game.logMessage("影が殺意を放ち、猛追を開始した！", "danger");
                this.speed = 12; // プレイヤー(10)より速い
                this.modeTimer = durationOverride || 15;
                break;
            case 'wander_a':
                Game.logMessage("影の気配が完全に消えた...", "system");
                this.speed = 5; // 遅い
                this.modeTimer = durationOverride || 10;
                this.wanderAnchor = {x: this.x, y: this.y};
                break;
            case 'wander_b':
                 Game.logMessage("影は何かを探して徘徊しているようだ。", "info");
                this.speed = 5;
                this.modeTimer = durationOverride || 30;
                this.wanderAnchor = {x: this.x, y: this.y};
                break;
        }
    }

    update() {
        this.modeTimer--;
        const player = Game.player;
        const dist = Math.abs(player.x - this.x) + Math.abs(player.y - this.y);

        // --- モード遷移判定 ---
        switch(this.mode) {
            case 'search':
                if (dist <= this.detectionRange.search) this.setMode('active');
                else if (this.modeTimer <= 0) this.setMode('wander_b');
                break;
            case 'active':
                if (this.modeTimer <= 0) this.setMode('wander_a');
                break;
            case 'wander_a':
                if (this.modeTimer <= 0) this.setMode('wander_b');
                break;
            case 'wander_b':
                if (dist <= this.detectionRange.search) this.setMode('active');
                else if (this.modeTimer <= 0 && Math.random() < 0.3) this.setMode('search');
                else if (this.modeTimer <= 0) this.modeTimer = 30; // タイマーリセット
                break;
        }

        // --- 行動実行 ---
        switch(this.mode) {
            case 'active': this.moveTowards(player.x, player.y); break;
            case 'search': this.moveLooselyTowards(player.x, player.y); break;
            case 'wander_a':
            case 'wander_b': this.moveWandering(); break;
        }
    }

    moveTowards(targetX, targetY, precision = 1.0) {
        // シンプルな貪欲法による追跡
        let dx = Math.sign(targetX - this.x);
        let dy = Math.sign(targetY - this.y);

        if (Math.random() > precision) { // 精度が低い場合、たまにランダムに動く
            dx = Math.floor(Math.random() * 3) - 1;
            dy = Math.floor(Math.random() * 3) - 1;
        }

        if (dx !== 0 && dy !== 0 && this.dungeon.isWalkable(this.x + dx, this.y + dy)) {
            this.x += dx; this.y += dy;
        } else if (dx !== 0 && this.dungeon.isWalkable(this.x + dx, this.y)) {
            this.x += dx;
        } else if (dy !== 0 && this.dungeon.isWalkable(this.x, this.y + dy)) {
            this.y += dy;
        }
    }
    
    moveLooselyTowards(targetX, targetY) { this.moveTowards(targetX, targetY, 0.7); }

    moveWandering() {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        // アンカーから離れすぎないようにする
        const distFromAnchor = Math.abs((this.x+dx) - this.wanderAnchor.x) + Math.abs((this.y+dy) - this.wanderAnchor.y);
        if (this.dungeon.isWalkable(this.x + dx, this.y + dy) && distFromAnchor < 6) {
            this.x += dx; this.y += dy;
        }
    }

    warp() {
        const pos = this.dungeon.getEmptyTile();
        this.x = pos.x; this.y = pos.y;
    }
}

// ==================================================================
// ゲーム開始
// ==================================================================
window.onload = () => {
    Game.init();
};