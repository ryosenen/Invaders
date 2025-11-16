const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// إعدادات CORS محسنة للعمل مع Netlify
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));

// خدمة الملفات الثابتة
app.use(express.static(__dirname));
app.use(express.json());

// تخزين الحالة في الذاكرة
const rooms = new Map();
const players = new Map();

// تعريف الأدوار
const ROLES = {
  // فريق الشر (Evil)
  VISITOR: { name: 'Visitor', team: 'evil', basic: true, description: 'كائن فضائي يظهر كطيب عند الفحص' },
  EATING_HEADS: { name: 'Eating heads', team: 'evil', basic: false, description: 'يأكل دماغ لاعب فيمنعه من التصويت' },
  NEMESIS: { name: 'Nemesis', team: 'evil', basic: false, description: 'ينسخ قدرة شخصية طيبة' },
  ALIEN_KING: { name: 'Alien king', team: 'evil', basic: false, description: 'يقتل لاعباً مباشرة عند التصويت عليه' },
  
  // فريق الخير (Good)
  CONDUCTOR: { name: 'Conductor', team: 'good', basic: true, description: 'يفحص لاعباً لمعرفة فريقه' },
  DOCTOR: { name: 'Doctor', team: 'good', basic: true, description: 'يحمي لاعباً من القتل الليلي' },
  ALMODAMER: { name: 'Almodamer', team: 'good', basic: false, description: 'يحول الشرير المقتول إلى طيب والعكس' },
  MERCHANT: { name: 'Merchant', team: 'good', basic: false, description: 'يكشف دور طيب عند موته' },
  TRAVELER: { name: 'Traveler', team: 'good', basic: false, description: 'لا يملك قدرات خاصة' },
  THE_STRANGER: { name: 'The Stranger', team: 'good', basic: false, description: 'يعيد إحياء لاعب طيب' }
};

// قواعد توزيع الأدوار حسب عدد اللاعبين
const ROLE_DISTRIBUTION = {
  5: {
    evil: { basic: 1, variable: 0 },
    good: { basic: 2, variable: 2 }
  },
  7: {
    evil: { basic: 1, variable: 1 },
    good: { basic: 3, variable: 2 }
  },
  9: {
    evil: { basic: 1, variable: 2 },
    good: { basic: 2, variable: 4 }
  }
};

// المسارات (Phases) للعبة
const GAME_PHASES = {
  LOBBY: 'lobby',
  WAITING: 'waiting',
  NIGHT: 'night',
  DAY: 'day',
  VOTING: 'voting',
  RESULTS: 'results',
  GAME_OVER: 'game_over'
};

// إنشاء غرفة جديدة
function createRoom(roomId, hostId, playerCount, randomizeRoles) {
  const room = {
    id: roomId,
    host: hostId,
    players: new Map(),
    playerCount,
    randomizeRoles,
    phase: GAME_PHASES.LOBBY,
    roles: [],
    alivePlayers: new Set(),
    deadPlayers: new Set(),
    nightActions: new Map(),
    votes: new Map(),
    gameLog: [],
    timer: null,
    round: 0
  };
  
  rooms.set(roomId, room);
  return room;
}

// توزيع الأدوار عشوائياً
function assignRoles(room) {
  const distribution = ROLE_DISTRIBUTION[room.playerCount];
  const roles = [];
  
  // الأدوار الأساسية للشر
  const evilBasicRoles = ['VISITOR'];
  for (let i = 0; i < distribution.evil.basic; i++) {
    roles.push(evilBasicRoles[i % evilBasicRoles.length]);
  }
  
  // الأدوار المتغيرة للشر
  const evilVariableRoles = ['EATING_HEADS', 'NEMESIS', 'ALIEN_KING'];
  for (let i = 0; i < distribution.evil.variable; i++) {
    const role = evilVariableRoles[Math.floor(Math.random() * evilVariableRoles.length)];
    roles.push(role);
  }
  
  // الأدوار الأساسية للخير
  const goodBasicRoles = ['CONDUCTOR', 'DOCTOR'];
  for (let i = 0; i < distribution.good.basic; i++) {
    const role = goodBasicRoles[Math.floor(Math.random() * goodBasicRoles.length)];
    roles.push(role);
  }
  
  // الأدوار المتغيرة للخير
  const goodVariableRoles = ['ALMODAMER', 'MERCHANT', 'TRAVELER', 'THE_STRANGER'];
  const neededGoodRoles = distribution.good.variable;
  for (let i = 0; i < neededGoodRoles; i++) {
    const role = goodVariableRoles[Math.floor(Math.random() * goodVariableRoles.length)];
    roles.push(role);
  }
  
  // التأكد من أن عدد الأدوار يساوي عدد اللاعبين
  if (roles.length !== room.playerCount) {
    console.warn(`عدد الأدوار (${roles.length}) لا يساوي عدد اللاعبين (${room.playerCount})`);
    while (roles.length < room.playerCount) {
      roles.push('TRAVELER');
    }
    while (roles.length > room.playerCount) {
      roles.pop();
    }
  }
  
  // خلط الأدوار
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  
  return roles;
}

// التحقق من حالة الفوز
function checkWinCondition(room) {
  const alivePlayers = Array.from(room.players.values()).filter(player => room.alivePlayers.has(player.id));
  const evilCount = alivePlayers.filter(player => {
    const role = ROLES[player.role];
    return role && role.team === 'evil';
  }).length;
  
  const goodCount = alivePlayers.filter(player => {
    const role = ROLES[player.role];
    return role && role.team === 'good';
  }).length;
  
  if (evilCount === 0) {
    return 'good';
  } else if (evilCount >= goodCount) {
    return 'evil';
  }
  
  return null;
}

// بدء جولة الليل
function startNightPhase(room) {
  room.phase = GAME_PHASES.NIGHT;
  room.nightActions.clear();
  room.round++;
  
  io.to(room.id).emit('phase_change', { phase: GAME_PHASES.NIGHT, round: room.round });
  
  room.timer = setTimeout(() => {
    processNightActions(room);
  }, 40000);
  
  room.gameLog.push(`بدأت ليلة الجولة ${room.round}`);
}

// معالجة أفعال الليل
function processNightActions(room) {
  const actions = room.nightActions;
  const results = [];
  
  // تطبيق أفعال الحماية أولاً (الدكتور)
  const doctorAction = Array.from(actions.values()).find(action => 
    action.role === 'DOCTOR' && action.target
  );
  
  const protectedPlayer = doctorAction ? doctorAction.target : null;
  
  // تطبيق أفعال القتل
  const killActions = Array.from(actions.values()).filter(action => 
    action.role === 'VISITOR' && action.target
  );
  
  for (const action of killActions) {
    if (action.target !== protectedPlayer && room.alivePlayers.has(action.target)) {
      room.alivePlayers.delete(action.target);
      room.deadPlayers.add(action.target);
      results.push(`تم قتل ${getPlayerName(room, action.target)} في الليل`);
    }
  }
  
  // تطبيق أفعال أخرى
  actions.forEach((action, playerId) => {
    const player = room.players.get(playerId);
    if (!player) return;
    
    switch (action.role) {
      case 'CONDUCTOR':
        if (action.target) {
          const targetPlayer = room.players.get(action.target);
          if (targetPlayer) {
            let isGood = ROLES[targetPlayer.role].team === 'good';
            if (targetPlayer.role === 'VISITOR') {
              isGood = true;
            }
            io.to(playerId).emit('investigation_result', {
              target: getPlayerName(room, action.target),
              isGood: isGood
            });
          }
        }
        break;
        
      case 'EATING_HEADS':
        if (action.target && room.alivePlayers.has(action.target)) {
          player.cantVoteNextDay = action.target;
          results.push(`${getPlayerName(room, action.target)} لن يستطيع التصويت غدًا`);
        }
        break;
        
      case 'THE_STRANGER':
        if (action.target && room.deadPlayers.has(action.target)) {
          const targetPlayer = room.players.get(action.target);
          if (targetPlayer && ROLES[targetPlayer.role].team === 'good') {
            room.deadPlayers.delete(action.target);
            room.alivePlayers.add(action.target);
            results.push(`تم إحياء ${getPlayerName(room, action.target)}`);
          }
        }
        break;
    }
  });
  
  room.phase = GAME_PHASES.DAY;
  io.to(room.id).emit('night_results', { results, deadPlayers: Array.from(room.deadPlayers) });
  io.to(room.id).emit('phase_change', { phase: GAME_PHASES.DAY });
  
  room.timer = setTimeout(() => {
    startVotingPhase(room);
  }, 90000);
}

// بدء مرحلة التصويت
function startVotingPhase(room) {
  room.phase = GAME_PHASES.VOTING;
  room.votes.clear();
  
  io.to(room.id).emit('phase_change', { phase: GAME_PHASES.VOTING });
  
  room.timer = setTimeout(() => {
    processVotes(room);
  }, 60000);
}

// معالجة الأصوات
function processVotes(room) {
  const votes = room.votes;
  const voteCount = {};
  
  votes.forEach((targetId, voterId) => {
    if (room.alivePlayers.has(voterId) && room.alivePlayers.has(targetId)) {
      voteCount[targetId] = (voteCount[targetId] || 0) + 1;
      
      const voter = room.players.get(voterId);
      if (voter && voter.role === 'ALIEN_KING' && voter.canUseAlienKing) {
        room.alivePlayers.delete(targetId);
        room.deadPlayers.add(targetId);
        voter.canUseAlienKing = false;
        room.gameLog.push(`استخدم ${getPlayerName(room, voterId)} قدرة Alien King لقتل ${getPlayerName(room, targetId)}`);
      }
    }
  });
  
  let maxVotes = 0;
  let executedPlayer = null;
  
  Object.entries(voteCount).forEach(([playerId, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      executedPlayer = playerId;
    }
  });
  
  if (executedPlayer && room.alivePlayers.has(executedPlayer)) {
    room.alivePlayers.delete(executedPlayer);
    room.deadPlayers.add(executedPlayer);
    room.gameLog.push(`تم إعدام ${getPlayerName(room, executedPlayer)} بالتصويت`);
  }
  
  room.phase = GAME_PHASES.RESULTS;
  io.to(room.id).emit('vote_results', { 
    votes: voteCount, 
    executed: executedPlayer,
    gameLog: room.gameLog.slice(-10)
  });
  
  io.to(room.id).emit('phase_change', { phase: GAME_PHASES.RESULTS });
  
  const winner = checkWinCondition(room);
  if (winner) {
    endGame(room, winner);
  } else {
    room.timer = setTimeout(() => {
      if (room.randomizeRoles) {
        const newRoles = assignRoles(room);
        let index = 0;
        room.players.forEach(player => {
          player.role = newRoles[index++];
        });
        
        room.players.forEach((player, playerId) => {
          io.to(playerId).emit('role_assignment', { 
            role: player.role, 
            description: ROLES[player.role].description 
          });
        });
      }
      
      startNightPhase(room);
    }, 10000);
  }
}

// إنهاء اللعبة
function endGame(room, winner) {
  room.phase = GAME_PHASES.GAME_OVER;
  
  const playerRoles = {};
  room.players.forEach((player, playerId) => {
    playerRoles[playerId] = {
      name: player.name,
      role: player.role,
      team: ROLES[player.role].team
    };
  });
  
  io.to(room.id).emit('game_over', { 
    winner, 
    playerRoles,
    gameLog: room.gameLog
  });
  
  io.to(room.id).emit('phase_change', { phase: GAME_PHASES.GAME_OVER });
}

// الحصول على اسم اللاعب
function getPlayerName(room, playerId) {
  const player = room.players.get(playerId);
  return player ? player.name : 'لاعب مجهول';
}

// تعريف مسار API الأساسي
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'السيرفر يعمل بشكل صحيح', rooms: rooms.size });
});

// إنشاء غرفة جديدة
app.post('/create-room', (req, res) => {
  const { playerName, playerCount, randomizeRoles } = req.body;
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const playerId = Math.random().toString(36).substring(2, 10);
  
  const room = createRoom(roomId, playerId, parseInt(playerCount), randomizeRoles);
  const player = { id: playerId, name: playerName, room: roomId };
  
  room.players.set(playerId, player);
  players.set(playerId, player);
  
  res.json({ roomId, playerId, success: true });
});

// الانضمام إلى غرفة
app.post('/join-room', (req, res) => {
  const { roomId, playerName } = req.body;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'الغرفة غير موجودة' });
  }
  
  if (room.players.size >= room.playerCount) {
    return res.status(400).json({ error: 'الغرفة ممتلئة' });
  }
  
  const playerId = Math.random().toString(36).substring(2, 10);
  const player = { id: playerId, name: playerName, room: roomId };
  
  room.players.set(playerId, player);
  players.set(playerId, player);
  
  res.json({ roomId, playerId, success: true });
});

// الحصول على قائمة الغرف
app.get('/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    playerCount: room.players.size,
    maxPlayers: room.playerCount,
    host: room.host
  }));
  
  res.json(roomList);
});

// تهيئة Socket.io بعد تعريف الـ routes
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// اتصالات Socket.io
io.on('connection', (socket) => {
  console.log('مستخدم متصل:', socket.id);
  
  socket.on('join_room', (data) => {
    const { roomId, playerId } = data;
    const room = rooms.get(roomId);
    const player = players.get(playerId);
    
    if (room && player) {
      socket.join(roomId);
      player.socketId = socket.id;
      
      io.to(roomId).emit('players_update', {
        players: Array.from(room.players.values()),
        host: room.host
      });
    }
  });
  
  socket.on('start_game', (data) => {
    const { roomId, playerId } = data;
    const room = rooms.get(roomId);
    
    if (room && room.host === playerId && room.players.size === room.playerCount) {
      const roles = assignRoles(room);
      let index = 0;
      
      room.players.forEach(player => {
        player.role = roles[index++];
        room.alivePlayers.add(player.id);
      });
      
      room.players.forEach((player, playerId) => {
        io.to(playerId).emit('role_assignment', { 
          role: player.role, 
          description: ROLES[player.role].description 
        });
      });
      
      room.phase = GAME_PHASES.WAITING;
      io.to(roomId).emit('game_started');
      io.to(roomId).emit('phase_change', { phase: GAME_PHASES.WAITING });
      
      setTimeout(() => {
        startNightPhase(room);
      }, 5000);
    }
  });
  
  socket.on('night_action', (data) => {
    const { roomId, playerId, action, target } = data;
    const room = rooms.get(roomId);
    
    if (room && room.phase === GAME_PHASES.NIGHT && room.alivePlayers.has(playerId)) {
      room.nightActions.set(playerId, { role: action, target });
    }
  });
  
  socket.on('vote', (data) => {
    const { roomId, playerId, target } = data;
    const room = rooms.get(roomId);
    
    if (room && room.phase === GAME_PHASES.VOTING && room.alivePlayers.has(playerId)) {
      room.votes.set(playerId, target);
    }
  });
  
  socket.on('chat_message', (data) => {
    const { roomId, playerId, message } = data;
    const room = rooms.get(roomId);
    const player = players.get(playerId);
    
    if (room && player) {
      io.to(roomId).emit('chat_message', {
        player: player.name,
        message,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  });
  
  socket.on('leave_room', (data) => {
    const { roomId, playerId } = data;
    const room = rooms.get(roomId);
    
    if (room) {
      room.players.delete(playerId);
      players.delete(playerId);
      socket.leave(roomId);
      
      if (room.host === playerId && room.players.size > 0) {
        room.host = Array.from(room.players.keys())[0];
      }
      
      io.to(roomId).emit('players_update', {
        players: Array.from(room.players.values()),
        host: room.host
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('مستخدم منقطع:', socket.id);
  });
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 سيرفر Invaders يعمل على المنفذ ${PORT}`);
  console.log(`🌐 يمكن الوصول عبر: http://localhost:${PORT}`);
});