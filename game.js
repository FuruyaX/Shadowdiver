'use strict';
// ==================================================================
// ゲーム設定 (仕様書のスプレッドシートに基づく)
// ==================================================================
const GameConfig = {
    PLAYER: {
        INITIAL_HP: 100,
        INITIAL_STAMINA: 50,
        VISION_RADIUS: 5,
        INVENTORY_SIZE: 10,
    },
    ENEMY_AI: {
        // モードごとの設定
        search:   { name: "索敵",   duration: 40, speed: 8,  detectionRange: 6, message: "影はこちらの様子を探っている..." },
        active:   { name: "アクティブ", duration: 15, speed: 12, detectionRange: 10, message: "影が殺意を放ち、猛追を開始した！" },
        wander_a: { name: "徘徊A",  duration: 10, speed: 5,  detectionRange: 0,  message: "影の気配が完全に消えた..." },
        wander_b: { name: "徘徊B",  duration: 30, speed: 5,  detectionRange: 6,  message: "影は何かを探して徘徊しているようだ。" }
    },
    ENCOUNTER: {
        DODGE_ACTION: {
            costST: 20,
            successRate: 0.5,
            success: { message: "素早く身をかわし、距離を取った！" },
            failure: { message: "回避に失敗し、攻撃を受けた！", damage: 20 }
        }
    },
    DUNGEON: {
        WIDTH: 25,
        HEIGHT: 25,
        // 床面積の割合をランダム化
        getFloorRatio: () => 0.35 + Math.random() * 0.2 // 35% ~ 55%
    }
};

// ==================================================================
// ゲーム全体の管理オブジェクト (シングルトン)
// ==================================================================
const Game = {
    state: 'loading', // loading, playing, encounter, gameover
    player: null,
    dungeon: null,
    floor: 1,
    turn: 0,
    dom: {},

    init() {
        this.cacheDomElements();
        this.bindGlobalEvents();
        this.startNewGame();
        this.bindInput();
    },

    cacheDomElements() {
        this.dom = {
            gameContainer: document.getElementById('game-container'),
            mapContainer: document.getElementById('map-container'),
            mainViewText: document.getElementById('main-view-text'),
            messageLog: document.getElementById('message-log'),
            floorStat: document.getElementById('floor-stat'),
            hpStat: document.getElementById('hp-stat'),
            staminaStat: document.getElementById('stamina-stat'),
            inventoryCount: document.getElementById('inventory-count'),
            inventoryList: document.getElementById('inventory-list'),
            overlay: document.getElementById('overlay'),
            overlayTitle: document.getElementById('overlay-title'),
            overlayText: document.getElementById('overlay-text'),
            overlayActions: document.getElementById('overlay-actions'),
            restartButton: document.getElementById('restart-button')
        };
    },
    
    bindGlobalEvents() {
        this.dom.restartButton.onclick = () => window.location.reload();
    },

    startNewGame() {
        this.floor = 1;
        this.turn = 0;
        this.player = new Player(GameConfig.PLAYER.INITIAL_HP, GameConfig.PLAYER.INITIAL_STAMINA);
        this.dungeon = new Dungeon(GameConfig.DUNGEON.WIDTH, GameConfig.DUNGEON.HEIGHT);
        
        this.player.addItem(ItemFactory.create('スタミナドリンク'));
        this.player.addItem(ItemFactory.create('スモーク弾'));

        this.setupNewFloor();
        this.state = 'playing';
        this.dom.overlay.style.display = 'none';
        this.logMessage(`地下 ${this.floor}階`, 'system');
    },

    processTurn(playerAction) {
        if (this.state !== 'playing') return;

        const actionResult = playerAction();
        if (!actionResult || !actionResult.success) {
            if(actionResult.message) this.logMessage(actionResult.message, 'warning');
            return;
        }
        if(actionResult.cost > 0) this.player.useStamina(actionResult.cost);

        this.turn++;

        // 敵の行動とエンカウント判定
        this.dungeon.enemy.update();
        if (this.dungeon.isPlayerOnSameTileAsEnemy()) {
            this.startEncounter();
            return;
        }
        
        this.player.regenerateStamina();
        this.dungeon.updatePlayerVision(this.player.x, this.player.y, GameConfig.PLAYER.VISION_RADIUS);
        this.dungeon.updateShadowProximity(); // 敵の接近警告
        this.updateUI();
    },

    updateUI() {
        this.dungeon.renderMap();
        this.renderMainView();
        this.dom.floorStat.textContent = this.floor;
        this.dom.hpStat.textContent = `${this.player.hp}/${this.player.maxHp}`;
        this.dom.staminaStat.textContent = `${Math.floor(this.player.stamina)}/${this.player.maxStamina}`;
        this.updateInventoryUI();
    },
    
    renderMainView() {
        const { x, y, direction } = this.player;
        const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
        
        let viewText = "";
        const frontTile = this.dungeon.getTile(x + dx, y + dy);

        if (!frontTile || frontTile.type === 'wall') {
            viewText = "目の前は硬い壁だ。";
        } else {
            viewText = "通路が続いている。";
            if (frontTile.entity) {
                const entityName = {
                    stairs: "階下へ続く階段",
                    item: "何かアイテム",
                    chest: "古い宝箱",
                    trap: "危険な罠"
                }[frontTile.entity.type];
                viewText += `<br>足元に${entityName}がある。`;
            }
        }
        this.dom.mainViewText.innerHTML = viewText;
    },

    updateInventoryUI() {
        this.dom.inventoryList.innerHTML = '';
        this.dom.inventoryCount.textContent = this.player.inventory.length;
        this.player.inventory.forEach(item => {
            const li = document.createElement('li');
            li.className = 'inventory-item';
            li.textContent = item.name;
            li.onclick = () => {
                if (item.category !== '戦闘') { // 戦闘用アイテムはここでは使えない
                     item.use(this.player, this);
                     this.player.removeItem(item);
                     this.updateUI();
                } else {
                    this.logMessage('戦闘用アイテムはここでは使えない。', 'warning');
                }
            };
            this.dom.inventoryList.appendChild(li);
        });
    },

    setupNewFloor() {
        this.dungeon.generate();
        const startPos = this.dungeon.getEmptyTile();
        this.player.setPosition(startPos.x, startPos.y);
        this.dungeon.updatePlayerVision(this.player.x, this.player.y, GameConfig.PLAYER.VISION_RADIUS);
        this.updateUI();
    },

    nextFloor() {
        this.floor++;
        this.player.stamina = Math.min(this.player.maxStamina, this.player.stamina + 20);
        this.logMessage(`地下 ${this.floor}階へ到達した。スタミナが少し回復した。`, 'system');
        this.setupNewFloor();
    },

    handleInteraction() {
        const tile = this.dungeon.getTile(this.player.x, this.player.y);
        
        if (tile.entity) {
            switch (tile.entity.type) {
                case 'stairs': this.nextFloor(); return { success: true, cost: 0 };
                case 'item':
                    if (this.player.addItem(tile.entity.item)) {
                        this.logMessage(`${tile.entity.item.name}を拾った。`, 'info');
                        tile.entity = null;
                    } else {
                        this.logMessage('インベントリが一杯だ。', 'warning');
                    }
                    return { success: true, cost: 1 };
                default:
                    this.logMessage('様子をうかがった。', 'info');
                    return { success: true, cost: 1 };
            }
        } else {
            this.logMessage('様子をうかがった。', 'info');
            return { success: true, cost: 1 };
        }
    },

    startEncounter() {
        this.state = 'encounter';
        this.dom.overlayTitle.textContent = '影に捕捉された！';
        this.dom.overlayText.textContent = 'どう切り抜ける？';
        this.dom.overlayActions.innerHTML = '';

        const dodgeSpec = GameConfig.ENCOUNTER.DODGE_ACTION;
        const dodgeButton = this.createActionButton(`回避 (ST:${dodgeSpec.costST})`, () => {
            if (this.player.stamina >= dodgeSpec.costST) {
                this.player.useStamina(dodgeSpec.costST);
                if (Math.random() < dodgeSpec.successRate) {
                    this.logMessage(dodgeSpec.success.message, 'system');
                    this.dungeon.enemy.warp();
                } else {
                    this.logMessage(dodgeSpec.failure.message, 'danger');
                    this.player.takeDamage(dodgeSpec.failure.damage);
                }
                this.endEncounter();
            } else {
                this.dom.overlayText.textContent = 'スタミナが足りず回避できない！';
            }
        });
        this.dom.overlayActions.appendChild(dodgeButton);

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
        if (this.state === 'gameover') return;
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
                default: return;
            }
            if (action) {
                e.preventDefault();
                this.processTurn(action);
            }
        });

        // フローティングコントローラ
        document.getElementById('btn-up').onclick = () => this.processTurn(() => this.player.move(0, -1));
        document.getElementById('btn-down').onclick = () => this.processTurn(() => this.player.move(0, 1));
        document.getElementById('btn-left').onclick = () => this.processTurn(() => this.player.move(-1, 0));
        document.getElementById('btn-right').onclick = () => this.processTurn(() => this.player.move(1, 0));
        document.getElementById('btn-interact').onclick = () => this.processTurn(() => this.handleInteraction());
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
        'コンパス': { category: '探索', use: (p, g) => { g.logMessage('コンパスが階段の方向を示した。', 'system'); /* TODO: 方角表示ロジック */ }},
    },
    create(name) {
        const def = this.definitions[name];
        if (!def) throw new Error(`Item "${name}" not found.`);
        return { name, category: def.category, use: def.use };
    }
};

// ==================================================================
// プレイヤークラス
// ==================================================================
class Player {
    constructor(maxHp, maxStamina) {
        this.x = 0; this.y = 0;
        this.direction = 'down';
        this.hp = maxHp; this.maxHp = maxHp;
        this.stamina = maxStamina; this.maxStamina = maxStamina;
        this.inventory = [];
    }
    
    setPosition(x, y) { this.x = x; this.y = y; }

    move(dx, dy) {
        if (dx === 1) this.direction = 'right';
        else if (dx === -1) this.direction = 'left';
        else if (dy === 1) this.direction = 'down';
        else if (dy === -1) this.direction = 'up';

        const newX = this.x + dx;
        const newY = this.y + dy;
        if (!Game.dungeon.isWalkable(newX, newY)) {
            return { success: false, message: '壁に阻まれた。' };
        }
        if (this.stamina < 1) {
            return { success: false, message: 'スタミナ不足で動けない。' };
        }
        this.x = newX;
        this.y = newY;
        
        const tile = Game.dungeon.getTile(this.x, this.y);
        if (tile.entity?.type === 'trap') {
            Game.logMessage('罠を踏んでしまった！', 'danger');
            this.takeDamage(tile.entity.damage);
            tile.entity = null;
        }
        return { success: true, cost: 1 };
    }

    takeDamage(amount) {
        this.hp -= amount;
        if (this.hp <= 0) {
            this.hp = 0;
            Game.gameOver(`HPが0になった...`);
        }
        Game.updateUI(); // ダメージ後すぐにUIに反映
    }
    
    useStamina(amount) {
        this.stamina -= amount;
        if (this.stamina < 0) this.stamina = 0;
    }

    regenerateStamina() {
        if (this.stamina < this.maxStamina) {
            this.stamina += 0.5; // 1ターンで0.5回復
        }
    }
    addItem(item) {
        if (this.inventory.length < GameConfig.PLAYER.INVENTORY_SIZE) {
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
    constructor(width, height) {
        this.width = width; this.height = height; this.map = []; this.enemy = null;
    }

    generate() {
        this.map = Array.from({ length: this.height }, () => 
            Array.from({ length: this.width }, () => ({ type: 'wall', visible: false, discovered: false, entity: null }))
        );
        // Drunkard's Walk
        let x = Math.floor(this.width / 2), y = Math.floor(this.height / 2);
        this.getTile(x, y).type = 'floor';
        let floorTiles = Math.floor(this.width * this.height * GameConfig.DUNGEON.getFloorRatio());
        for(let i=0; i<floorTiles; i++) {
             let nx = x + Math.floor(Math.random() * 3) - 1;
             let ny = y + Math.floor(Math.random() * 3) - 1;
             if(nx > 0 && nx < this.width -1 && ny > 0 && ny < this.height -1) {
                 x = nx; y = ny;
                 if(this.getTile(x,y).type === 'wall') this.getTile(x,y).type = 'floor';
             }
        }
        this.placeEntity({ type: 'stairs' }, 1);
        this.placeEntity({ type: 'item', item: ItemFactory.create('救急キット') }, 2);
        this.placeEntity({ type: 'trap', damage: 10 }, 5);
        
        this.enemy = new Enemy(this);
    }

    placeEntity(entity, count) {
        for(let i=0; i<count; i++) {
            const pos = this.getEmptyTile();
            if (pos) this.getTile(pos.x, pos.y).entity = JSON.parse(JSON.stringify(entity));
        }
    }

    getTile(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
        return this.map[y][x];
    }
    
    getEmptyTile() {
        let x, y, attempts = 0;
        do {
            x = Math.floor(Math.random() * this.width);
            y = Math.floor(Math.random() * this.height);
            if (attempts++ > 1000) return null; // 無限ループ防止
        } while (this.getTile(x, y).type !== 'floor' || this.getTile(x,y).entity);
        return { x, y };
    }
    isWalkable(x, y) { return this.getTile(x, y)?.type !== 'wall'; }
    
    updatePlayerVision(px, py, radius) {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
                const tile = this.getTile(x,y);
                if (dist <= radius) {
                    tile.visible = true;
                    tile.discovered = true;
                } else {
                    tile.visible = false;
                }
            }
        }
    }
    
    renderMap() {
        Game.dom.mapContainer.innerHTML = '';
        Game.dom.mapContainer.style.gridTemplateColumns = `repeat(${this.width}, 1fr)`;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const tile = this.getTile(x, y);
                const cell = document.createElement('div');
                cell.className = `map-cell ${tile.type}`;
                if (tile.entity?.type==='trap') cell.classList.add('trap');
                if (tile.visible) cell.classList.add('visible');
                else if (tile.discovered) cell.classList.add('discovered');
                
                let content = '';
                if (tile.visible) {
                    if (Game.player.x === x && Game.player.y === y) content = '🙂';
                    else if (tile.entity) {
                        content = { stairs: '🔽', item: '💊', chest: '📦' }[tile.entity.type] || '';
                    }
                }
                cell.innerHTML = `<span>${content}</span>`;
                Game.dom.mapContainer.appendChild(cell);
            }
        }
    }

    isPlayerOnSameTileAsEnemy() {
        return Game.player.x === this.enemy.x && Game.player.y === this.enemy.y;
    }
    
    updateShadowProximity() {
        const dist = Math.abs(Game.player.x - this.enemy.x) + Math.abs(Game.player.y - this.enemy.y);
        const dom = Game.dom.gameContainer.classList;

        dom.remove('shadow-close', 'shadow-danger');
        if (this.enemy.mode === 'active' && dist <= this.enemy.spec.detectionRange) {
            dom.add('shadow-danger');
        } else if (dist <= this.enemy.spec.detectionRange) {
            dom.add('shadow-close');
        }
    }
}

// ==================================================================
// 敵クラス (AIロジック)
// ==================================================================
class Enemy {
    constructor(dungeon) {
        this.dungeon = dungeon;
        this.x = 0; this.y = 0;
        this.mode = null;
        this.spec = null;
        this.modeTimer = 0;
        this.wanderAnchor = {x: 0, y: 0};
        this.setMode('search');
        this.warp();
    }

    setMode(newMode, durationOverride = null) {
        if (this.mode === newMode) return;
        this.mode = newMode;
        this.spec = GameConfig.ENEMY_AI[newMode];
        this.modeTimer = durationOverride || this.spec.duration;
        Game.logMessage(this.spec.message, this.mode === 'active' ? 'danger' : 'warning');

        if (newMode.startsWith('wander')) {
            this.wanderAnchor = {x: this.x, y: this.y};
        }
    }

    update() {
        this.modeTimer--;
        const player = Game.player;
        const dist = Math.abs(player.x - this.x) + Math.abs(player.y - this.y);

        // モード遷移
        switch(this.mode) {
            case 'search':
                if (dist <= this.spec.detectionRange) this.setMode('active');
                else if (this.modeTimer <= 0) this.setMode('wander_b');
                break;
            case 'active':
                if (dist > this.spec.detectionRange + 2 || this.modeTimer <= 0) this.setMode('wander_a');
                break;
            case 'wander_a':
                if (this.modeTimer <= 0) this.setMode('wander_b');
                break;
            case 'wander_b':
                if (dist <= this.spec.detectionRange) this.setMode('active');
                else if (this.modeTimer <= 0 && Math.random() < 0.3) this.setMode('search');
                else if (this.modeTimer <= 0) this.modeTimer = this.spec.duration; // タイマーリセット
                break;
        }

        // 行動実行
        for(let i=0; i < (this.spec.speed / 10); i++) { // 速度に応じて複数回移動
             switch(this.mode) {
                case 'active': this.moveTowards(player.x, player.y); break;
                case 'search': this.moveLooselyTowards(player.x, player.y); break;
                case 'wander_a':
                case 'wander_b': this.moveWandering(); break;
            }
        }
    }

    moveTowards(targetX, targetY) {
        let dx = Math.sign(targetX - this.x);
        let dy = Math.sign(targetY - this.y);
        
        let moved = false;
        if (dx !== 0 && dy !== 0 && this.dungeon.isWalkable(this.x + dx, this.y + dy)) {
            if (Math.random() < 0.5) this.x += dx; else this.y += dy;
            moved = true;
        }
        if (!moved && dx !== 0 && this.dungeon.isWalkable(this.x + dx, this.y)) {
            this.x += dx;
            moved = true;
        }
        if (!moved && dy !== 0 && this.dungeon.isWalkable(this.x, this.y + dy)) {
            this.y += dy;
        }
    }
    
    moveLooselyTowards(targetX, targetY) {
        if(Math.random() < 0.3) this.moveWandering();
        else this.moveTowards(targetX, targetY);
    }

    moveWandering() {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        const newX = this.x + dx, newY = this.y + dy;
        const distFromAnchor = Math.abs(newX - this.wanderAnchor.x) + Math.abs(newY - this.wanderAnchor.y);
        if (this.dungeon.isWalkable(newX, newY) && distFromAnchor < 8) {
            this.x = newX; this.y = newY;
        }
    }

    warp() {
        const pos = this.dungeon.getEmptyTile();
        if (pos) { this.x = pos.x; this.y = pos.y; }
    }
}

// ==================================================================
// ゲーム開始
// ==================================================================
window.onload = () => {
    Game.init();
};