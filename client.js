// العميل الرئيسي للعبة Invaders
class InvadersClient {
    constructor() {
        this.socket = null;
        this.playerId = null;
        this.roomId = null;
        this.playerName = null;
        this.role = null;
        this.players = [];
        this.gameState = {
            phase: 'lobby',
            round: 1,
            timer: 0
        };
        
        // رابط السيرفر - سيتم تحديثه بعد النشر على Render
        this.SOCKET_URL = 'https://invaders-game-server.onrender.com';
        
        this.initializeApp();
    }
    
    // تهيئة التطبيق
    initializeApp() {
        this.setupEventListeners();
        this.showScreen('start-screen');
    }
    
    // إعداد مستمعي الأحداث
    setupEventListeners() {
        // أزرار الشاشة الرئيسية
        document.getElementById('create-room-btn').addEventListener('click', () => {
            this.showScreen('create-room-screen');
        });
        
        document.getElementById('join-room-btn').addEventListener('click', () => {
            this.showScreen('join-room-screen');
            this.loadAvailableRooms();
        });
        
        // شاشة إنشاء غرفة
        document.getElementById('create-room-confirm').addEventListener('click', () => {
            this.createRoom();
        });
        
        document.getElementById('create-room-back').addEventListener('click', () => {
            this.showScreen('start-screen');
        });
        
        // شاشة الانضمام إلى غرفة
        document.getElementById('join-room-confirm').addEventListener('click', () => {
            this.joinRoom();
        });
        
        document.getElementById('join-room-back').addEventListener('click', () => {
            this.showScreen('start-screen');
        });
        
        // شاشة غرفة الانتظار
        document.getElementById('start-game-btn').addEventListener('click', () => {
            this.startGame();
        });
        
        document.getElementById('leave-waiting-room').addEventListener('click', () => {
            this.leaveRoom();
        });
        
        // شاشة النتائج
        document.getElementById('play-again-btn').addEventListener('click', () => {
            this.playAgain();
        });
        
        document.getElementById('back-to-lobby-btn').addEventListener('click', () => {
            this.backToLobby();
        });
    }
    
    // الاتصال بالسيرفر
    connectToServer() {
        try {
            this.socket = io(this.SOCKET_URL, {
                transports: ['websocket', 'polling'],
                timeout: 10000
            });
            
            this.setupSocketListeners();
            this.showAlert('تم الاتصال بالسيرفر بنجاح', 'success');
        } catch (error) {
            console.error('خطأ في الاتصال:', error);
            this.showAlert('فشل في الاتصال بالسيرفر', 'danger');
        }
    }
    
    // إعداد مستمعي Socket
    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('متصل بالسيرفر');
            this.showAlert('تم الاتصال بالسيرفر', 'success');
        });
        
        this.socket.on('disconnect', () => {
            this.showAlert('انقطع الاتصال بالسيرفر', 'danger');
        });
        
        this.socket.on('players_update', (data) => {
            this.updatePlayersList(data.players, data.host);
        });
        
        this.socket.on('game_started', () => {
            this.showScreen('game-screen');
        });
        
        this.socket.on('role_assignment', (data) => {
            this.assignRole(data.role, data.description);
        });
        
        this.socket.on('phase_change', (data) => {
            this.updateGamePhase(data.phase, data.round);
        });
        
        this.socket.on('night_results', (data) => {
            this.showNightResults(data.results, data.deadPlayers);
        });
        
        this.socket.on('vote_results', (data) => {
            this.showVoteResults(data.votes, data.executed, data.gameLog);
        });
        
        this.socket.on('game_over', (data) => {
            this.showGameResults(data.winner, data.playerRoles, data.gameLog);
        });
        
        this.socket.on('chat_message', (data) => {
            this.addChatMessage(data.player, data.message, data.timestamp);
        });
        
        this.socket.on('investigation_result', (data) => {
            this.showAlert(`نتيجة الفحص: ${data.target} - ${data.isGood ? 'طيب' : 'شرير'}`, 'info');
        });
    }
    
    // إنشاء غرفة جديدة
    async createRoom() {
        const playerName = document.getElementById('player-name').value.trim();
        const playerCount = document.getElementById('player-count').value;
        const randomizeRoles = document.getElementById('randomize-roles').checked;
        
        if (!playerName) {
            this.showAlert('يرجى إدخال اسم اللاعب', 'warning');
            return;
        }
        
        this.playerName = playerName;
        
        // الاتصال بالسيرفر إذا لم يكن متصلاً
        if (!this.socket || !this.socket.connected) {
            this.connectToServer();
            // انتظر قليلاً قبل إرسال الطلب
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        try {
            const response = await fetch(this.SOCKET_URL + '/create-room', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    playerName,
                    playerCount: parseInt(playerCount),
                    randomizeRoles
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.playerId = data.playerId;
                this.roomId = data.roomId;
                
                this.joinRoomSocket();
                this.showWaitingRoom();
                this.showAlert('تم إنشاء الغرفة بنجاح! شارك الكود مع أصدقائك: ' + data.roomId, 'success');
            } else {
                this.showAlert('فشل في إنشاء الغرفة', 'danger');
            }
        } catch (error) {
            console.error('Error creating room:', error);
            this.showAlert('خطأ في الاتصال بالسيرفر', 'danger');
        }
    }
    
    // الانضمام إلى غرفة
    async joinRoom() {
        const playerName = document.getElementById('join-player-name').value.trim();
        const roomCode = document.getElementById('room-code').value.trim().toUpperCase();
        
        if (!playerName) {
            this.showAlert('يرجى إدخال اسم اللاعب', 'warning');
            return;
        }
        
        if (!roomCode) {
            this.showAlert('يرجى إدخال كود الغرفة', 'warning');
            return;
        }
        
        this.playerName = playerName;
        this.roomId = roomCode;
        
        // الاتصال بالسيرفر إذا لم يكن متصلاً
        if (!this.socket || !this.socket.connected) {
            this.connectToServer();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        try {
            const response = await fetch(this.SOCKET_URL + '/join-room', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    playerName,
                    roomId: roomCode
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.playerId = data.playerId;
                
                this.joinRoomSocket();
                this.showWaitingRoom();
                this.showAlert('تم الانضمام للغرفة بنجاح!', 'success');
            } else {
                this.showAlert(data.error || 'فشل في الانضمام للغرفة', 'danger');
            }
        } catch (error) {
            console.error('Error joining room:', error);
            this.showAlert('خطأ في الاتصال بالسيرفر', 'danger');
        }
    }
    
    // تحميل الغرف المتاحة
    async loadAvailableRooms() {
        try {
            const response = await fetch(this.SOCKET_URL + '/rooms');
            const rooms = await response.json();
            
            const container = document.getElementById('rooms-container');
            container.innerHTML = '';
            
            if (rooms.length === 0) {
                container.innerHTML = '<p class="alert alert-info">لا توجد غرف متاحة حالياً</p>';
                return;
            }
            
            rooms.forEach(room => {
                const roomElement = document.createElement('div');
                roomElement.className = 'room-item';
                roomElement.innerHTML = `
                    <div>
                        <strong>غرفة ${room.id}</strong>
                        <div>${room.playerCount}/${room.maxPlayers} لاعبين</div>
                    </div>
                `;
                
                roomElement.addEventListener('click', () => {
                    document.getElementById('room-code').value = room.id;
                });
                
                container.appendChild(roomElement);
            });
        } catch (error) {
            console.error('Error loading rooms:', error);
        }
    }
    
    // الانضمام للغرفة عبر Socket
    joinRoomSocket() {
        if (this.socket && this.roomId && this.playerId) {
            this.socket.emit('join_room', {
                roomId: this.roomId,
                playerId: this.playerId
            });
        }
    }
    
    // عرض شاشة غرفة الانتظار
    showWaitingRoom() {
        this.showScreen('waiting-room-screen');
        document.getElementById('room-id-display').textContent = this.roomId;
        document.getElementById('settings-player-count').textContent = this.getPlayerCount();
        document.getElementById('settings-randomize').textContent = document.getElementById('randomize-roles')?.checked ? 'نعم' : 'لا';
    }
    
    // تحديث قائمة اللاعبين
    updatePlayersList(players, hostId) {
        this.players = players;
        
        const playersList = document.getElementById('players-list');
        const gamePlayersList = document.getElementById('game-players-list');
        
        playersList.innerHTML = '';
        if (gamePlayersList) {
            gamePlayersList.innerHTML = '';
        }
        
        players.forEach(player => {
            const isHost = player.id === hostId;
            const playerElement = document.createElement('div');
            playerElement.className = `player-item ${isHost ? 'player-host' : ''}`;
            playerElement.innerHTML = `
                <span class="player-name">${player.name}</span>
                ${isHost ? '<span class="host-badge">مالك الغرفة</span>' : ''}
            `;
            
            playersList.appendChild(playerElement);
            
            if (gamePlayersList) {
                const gamePlayerElement = document.createElement('div');
                gamePlayerElement.className = 'player-game-item alive';
                gamePlayerElement.innerHTML = `
                    <span>${player.name}</span>
                    <div class="player-status status-alive"></div>
                `;
                gamePlayersList.appendChild(gamePlayerElement);
            }
        });
        
        document.getElementById('players-count').textContent = players.length;
        document.getElementById('max-players').textContent = this.getPlayerCount();
        
        const startButton = document.getElementById('start-game-btn');
        const isHost = this.playerId === hostId;
        const isFull = players.length === this.getPlayerCount();
        
        startButton.disabled = !isHost || !isFull;
        
        if (isHost) {
            startButton.style.display = 'block';
        } else {
            startButton.style.display = 'none';
        }
    }
    
    // بدء اللعبة
    startGame() {
        if (this.socket && this.roomId && this.playerId) {
            this.socket.emit('start_game', {
                roomId: this.roomId,
                playerId: this.playerId
            });
        }
    }
    
    // تعيين الدور للاعب
    assignRole(role, description) {
        this.role = role;
        
        document.getElementById('role-name').textContent = this.getRoleName(role);
        document.getElementById('role-description').textContent = description;
        
        const roleImage = document.getElementById('role-image');
        roleImage.src = `./img/${role.replace(' ', '_')}.png`;
        roleImage.alt = this.getRoleName(role);
        
        roleImage.onerror = () => {
            roleImage.src = './img/default.png';
        };
    }
    
    // تحديث مرحلة اللعبة
    updateGamePhase(phase, round) {
        this.gameState.phase = phase;
        this.gameState.round = round || 1;
        
        document.getElementById('game-phase').textContent = this.getPhaseName(phase);
        document.getElementById('game-round').textContent = `الجولة ${round || 1}`;
        
        this.updateActionsPanel();
        
        this.startTimer(this.getPhaseDuration(phase));
    }
    
    // تحديث لوحة الإجراءات
    updateActionsPanel() {
        const actionsPanel = document.getElementById('actions-content');
        const actionsTitle = document.getElementById('actions-title');
        
        if (!actionsPanel) return;
        
        actionsPanel.innerHTML = '';
        
        switch (this.gameState.phase) {
            case 'night':
                actionsTitle.textContent = 'إجراءات الليل';
                this.setupNightActions();
                break;
                
            case 'day':
                actionsTitle.textContent = 'مناقشة النهار';
                this.setupDayActions();
                break;
                
            case 'voting':
                actionsTitle.textContent = 'جولة التصويت';
                this.setupVotingActions();
                break;
                
            default:
                actionsTitle.textContent = 'في انتظار اللاعبين...';
                actionsPanel.innerHTML = '<p>جارٍ انتظار اللاعبين الآخرين...</p>';
        }
    }
    
    // إعداد إجراءات الليل
    setupNightActions() {
        const actionsPanel = document.getElementById('actions-content');
        
        if (!this.role) return;
        
        switch (this.role) {
            case 'CONDUCTOR':
                actionsPanel.innerHTML = this.createPlayerSelection('اختر لاعباً لفحصه:', 'conduct_investigation');
                break;
                
            case 'DOCTOR':
                actionsPanel.innerHTML = this.createPlayerSelection('اختر لاعباً لحمايته:', 'protect_player');
                break;
                
            case 'VISITOR':
                actionsPanel.innerHTML = this.createPlayerSelection('اختر لاعباً لقتله:', 'kill_player');
                break;
                
            case 'EATING_HEADS':
                actionsPanel.innerHTML = this.createPlayerSelection('اختر لاعباً لأكل دماغه:', 'eat_brain');
                break;
                
            case 'THE_STRANGER':
                actionsPanel.innerHTML = this.createPlayerSelection('اختر لاعباً ميتاً لإحيائه:', 'revive_player', true);
                break;
                
            default:
                actionsPanel.innerHTML = '<p>لا توجد إجراءات ليلية متاحة لدورك</p>';
        }
    }
    
    // إعداد إجراءات النهار
    setupDayActions() {
        const actionsPanel = document.getElementById('actions-content');
        actionsPanel.innerHTML = `
            <div class="alert alert-info">
                وقت المناقشة: شارك في النقاش مع اللاعبين الآخرين لتحديد المشتبه بهم.
            </div>
            <div class="chat-section">
                <input type="text" id="chat-input" placeholder="اكتب رسالة..." style="width: 100%; padding: 10px; margin: 10px 0;">
                <button id="send-chat" class="action-btn">إرسال</button>
            </div>
        `;
        
        document.getElementById('send-chat').addEventListener('click', () => {
            this.sendChatMessage();
        });
        
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });
    }
    
    // إعداد إجراءات التصويت
    setupVotingActions() {
        const actionsPanel = document.getElementById('actions-content');
        actionsPanel.innerHTML = this.createPlayerSelection('صوت لطرد لاعب:', 'vote_player');
        
        if (this.role === 'ALIEN_KING') {
            const alienKingOption = document.createElement('div');
            alienKingOption.className = 'alert alert-warning';
            alienKingOption.innerHTML = `
                <label>
                    <input type="checkbox" id="use-alien-king">
                    استخدام قدرة Alien King (قتل فوري)
                </label>
            `;
            actionsPanel.appendChild(alienKingOption);
        }
    }
    
    // إنشاء قائمة اختيار اللاعبين
    createPlayerSelection(title, action, includeDead = false) {
        let html = `<h4>${title}</h4>`;
        
        this.players.forEach(player => {
            const isAlive = !includeDead;
            const isSelf = player.id === this.playerId;
            
            if (isAlive || includeDead) {
                html += `
                    <button class="action-btn player-select-btn" 
                            data-player-id="${player.id}"
                            data-action="${action}">
                        ${player.name} ${isSelf ? '(أنت)' : ''}
                    </button>
                `;
            }
        });
        
        setTimeout(() => {
            document.querySelectorAll('.player-select-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const playerId = e.target.getAttribute('data-player-id');
                    const action = e.target.getAttribute('data-action');
                    this.performAction(action, playerId);
                });
            });
        }, 100);
        
        return html;
    }
    
    // تنفيذ إجراء
    performAction(action, targetPlayerId) {
        if (!this.socket || !this.roomId || !this.playerId) return;
        
        let socketAction = '';
        
        switch (action) {
            case 'conduct_investigation':
                socketAction = 'CONDUCTOR';
                break;
            case 'protect_player':
                socketAction = 'DOCTOR';
                break;
            case 'kill_player':
                socketAction = 'VISITOR';
                break;
            case 'eat_brain':
                socketAction = 'EATING_HEADS';
                break;
            case 'revive_player':
                socketAction = 'THE_STRANGER';
                break;
            case 'vote_player':
                socketAction = 'VOTE';
                break;
        }
        
        if (action === 'vote_player') {
            this.socket.emit('vote', {
                roomId: this.roomId,
                playerId: this.playerId,
                target: targetPlayerId
            });
            
            this.showAlert('تم تسجيل صوتك', 'success');
        } else {
            this.socket.emit('night_action', {
                roomId: this.roomId,
                playerId: this.playerId,
                action: socketAction,
                target: targetPlayerId
            });
            
            this.showAlert('تم تنفيذ الإجراء', 'success');
        }
    }
    
    // إرسال رسالة محادثة
    sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (message && this.socket && this.roomId && this.playerId) {
            this.socket.emit('chat_message', {
                roomId: this.roomId,
                playerId: this.playerId,
                message: message
            });
            
            input.value = '';
        }
    }
    
    // إضافة رسالة محادثة
    addChatMessage(player, message, timestamp) {
        const gameLog = document.getElementById('game-log');
        if (!gameLog) return;
        
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<strong>${player}:</strong> ${message} <small>${timestamp}</small>`;
        
        gameLog.appendChild(logEntry);
        gameLog.scrollTop = gameLog.scrollHeight;
    }
    
    // عرض نتائج الليل
    showNightResults(results, deadPlayers) {
        const gameLog = document.getElementById('game-log');
        
        results.forEach(result => {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry system';
            logEntry.textContent = result;
            gameLog.appendChild(logEntry);
        });
        
        this.updateDeadPlayers(deadPlayers);
    }
    
    // عرض نتائج التصويت
    showVoteResults(votes, executed, gameLog) {
        const logPanel = document.getElementById('game-log');
        
        Object.entries(votes).forEach(([playerId, voteCount]) => {
            const player = this.players.find(p => p.id === playerId);
            if (player) {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.textContent = `${player.name}: ${voteCount} صوت`;
                logPanel.appendChild(logEntry);
            }
        });
        
        if (executed) {
            const executedPlayer = this.players.find(p => p.id === executed);
            if (executedPlayer) {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry death';
                logEntry.textContent = `تم إعدام ${executedPlayer.name}`;
                logPanel.appendChild(logEntry);
            }
        }
        
        gameLog.forEach(log => {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry system';
            logEntry.textContent = log;
            logPanel.appendChild(logEntry);
        });
        
        logPanel.scrollTop = logPanel.scrollHeight;
    }
    
    // تحديث اللاعبين الموتى
    updateDeadPlayers(deadPlayers) {
        const gamePlayersList = document.getElementById('game-players-list');
        if (!gamePlayersList) return;
        
        gamePlayersList.innerHTML = '';
        
        this.players.forEach(player => {
            const isAlive = !deadPlayers.includes(player.id);
            const isSelf = player.id === this.playerId;
            
            const gamePlayerElement = document.createElement('div');
            gamePlayerElement.className = `player-game-item ${isAlive ? 'alive' : 'dead'}`;
            gamePlayerElement.innerHTML = `
                <span>${player.name} ${isSelf ? '(أنت)' : ''}</span>
                <div class="player-status status-${isAlive ? 'alive' : 'dead'}"></div>
            `;
            gamePlayersList.appendChild(gamePlayerElement);
        });
    }
    
    // عرض نتائج اللعبة
    showGameResults(winner, playerRoles, gameLog) {
        this.showScreen('results-screen');
        
        const resultsTitle = document.getElementById('results-title');
        const winnerDisplay = document.getElementById('winner-display');
        const playersRoles = document.getElementById('players-roles');
        
        if (winner === 'good') {
            resultsTitle.textContent = 'فوز فريق البشر!';
            winnerDisplay.className = 'winner-section winner-good';
            winnerDisplay.innerHTML = '<h3>🎉 فريق البشر انتصر! 🎉</h3><p>تم القضاء على جميع الفضائيين</p>';
        } else {
            resultsTitle.textContent = 'فوز فريق الفضائيين!';
            winnerDisplay.className = 'winner-section winner-evil';
            winnerDisplay.innerHTML = '<h3>👽 فريق الفضائيين انتصر! 👽</h3><p>سيطروا على السفينة</p>';
        }
        
        playersRoles.innerHTML = '';
        Object.entries(playerRoles).forEach(([playerId, data]) => {
            const roleItem = document.createElement('div');
            roleItem.className = `role-item ${data.team === 'good' ? 'role-good' : 'role-evil'}`;
            roleItem.innerHTML = `
                <div>
                    <strong>${data.name}</strong>
                    <div>${this.getRoleName(data.role)}</div>
                </div>
                <span class="role-team ${data.team === 'good' ? 'team-good' : 'team-evil'}">
                    ${data.team === 'good' ? 'بشري' : 'فضائي'}
                </span>
            `;
            playersRoles.appendChild(roleItem);
        });
        
        const fullLog = document.createElement('div');
        fullLog.className = 'game-log-full';
        fullLog.style.marginTop = '20px';
        fullLog.style.maxHeight = '200px';
        fullLog.style.overflowY = 'auto';
        fullLog.style.background = 'var(--panel-bg)';
        fullLog.style.padding = '15px';
        fullLog.style.borderRadius = '8px';
        
        gameLog.forEach(log => {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry system';
            logEntry.textContent = log;
            fullLog.appendChild(logEntry);
        });
        
        playersRoles.appendChild(fullLog);
    }
    
    // مغادرة الغرفة
    leaveRoom() {
        if (this.socket && this.roomId && this.playerId) {
            this.socket.emit('leave_room', {
                roomId: this.roomId,
                playerId: this.playerId
            });
        }
        
        this.resetGame();
        this.showScreen('start-screen');
    }
    
    // اللعب مرة أخرى
    playAgain() {
        this.resetGame();
        this.showScreen('start-screen');
    }
    
    // العودة للوبي
    backToLobby() {
        this.resetGame();
        this.showScreen('start-screen');
    }
    
    // إعادة تعيين حالة اللعبة
    resetGame() {
        this.roomId = null;
        this.playerId = null;
        this.role = null;
        this.players = [];
        this.gameState = {
            phase: 'lobby',
            round: 1,
            timer: 0
        };
    }
    
    // بدء المؤقت
    startTimer(duration) {
        let timeLeft = duration;
        const timerElement = document.getElementById('game-timer');
        
        if (!timerElement) return;
        
        const timer = setInterval(() => {
            timerElement.textContent = timeLeft;
            timeLeft--;
            
            if (timeLeft < 0) {
                clearInterval(timer);
                timerElement.textContent = '0';
            }
        }, 1000);
    }
    
    // عرض شاشة معينة
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        document.getElementById(screenId).classList.add('active');
    }
    
    // عرض تنبيه
    showAlert(message, type) {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.textContent = message;
        
        const container = document.querySelector('.container') || document.body;
        container.insertBefore(alert, container.firstChild);
        
        setTimeout(() => {
            alert.remove();
        }, 5000);
    }
    
    // الحصول على اسم الدور
    getRoleName(roleKey) {
        const roleNames = {
            'VISITOR': 'الزائر',
            'EATING_HEADS': 'آكل الرؤوس',
            'NEMESIS': 'الند',
            'ALIEN_KING': 'ملك الفضائيين',
            'CONDUCTOR': 'القائد',
            'DOCTOR': 'الطبيب',
            'ALMODAMER': 'المخترع المجنون',
            'MERCHANT': 'التاجر',
            'TRAVELER': 'المسافر',
            'THE_STRANGER': 'الغريب'
        };
        
        return roleNames[roleKey] || roleKey;
    }
    
    // الحصول على اسم المرحلة
    getPhaseName(phase) {
        const phaseNames = {
            'lobby': 'البداية',
            'waiting': 'غرفة الانتظار',
            'night': 'ليل',
            'day': 'نهار',
            'voting': 'تصويت',
            'results': 'نتائج',
            'game_over': 'نهاية اللعبة'
        };
        
        return phaseNames[phase] || phase;
    }
    
    // الحصول على مدة المرحلة
    getPhaseDuration(phase) {
        const durations = {
            'night': 40,
            'day': 90,
            'voting': 60
        };
        
        return durations[phase] || 30;
    }
    
    // الحصول على عدد اللاعبين
    getPlayerCount() {
        return 5; // قيمة افتراضية
    }
}

// بدء التطبيق عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    new InvadersClient();
});