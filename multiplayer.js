var server = require('http').createServer();
var options = {
  cors: true
}

var io = require('socket.io')(server, options);


// -----------------------------------------------------------

// Player unidos a este server.
// Cada entrada es un key value pair, con la key = a la room, y el value una lista de los players.
var players = {};

// Objeto donde vamos almacenando info de la sesion.
var data = {};


// -----------------------------------------------------------

// Mensaje que lanza Sockets.io cuando se conecta un nuevo cliente.
io.sockets.on('connection', function(socket)
{  
  var id = socket.id;
  var room = "/";
  
  
  // -----------------------------
  
  // Mensaje que mandan los usuarios para unirse a una room.
  socket.on ('initialize', function (newRoom = "/", playerData)
  {
    // Nuevo Objeto del player.
    var newPlayer = playerData || {};
    newPlayer.id = id;

    // Unimos al player a la room que ha pedido.
    room = newRoom;
    socket.join(room);    
    if (!players[room]) players[room] = {};
    players[room][id] = newPlayer;

    // Le pasamos al player su id y una lista de los players que hay unidos en su room
    socket.emit("initialized", {id:id, players:players[room]});
    io.to(room).emit("playerJoined", newPlayer);
    
    console.log("Client [" + socket.id + "] has joined room [" + room + "]");  
  });
  
  // -----------------------------  
  
  // Mensaje que envia en bucle cada cliente actualizando su informacion.
  socket.on("update", function(playerData)
  {
      players[room][playerData.id] = playerData;
  });
  
  // Chat de voz
  socket.on("voice", function(voice)
  {
    
    // Se lo mandamos a todos los usuarios de su sala.
    for  (var playerId in players[room]){
      if (playerId == id)
        continue;
      
      io.to(playerId).emit("voice", voice);
    }   
  });
  
  // -----------------------------
  
  // Mensaje que laza alguien cuando queire extraer informacion guardada.
  socket.on("getdata", function(dataId, callback)
  {    
    callback(data[dataId]);
  });
  
  // Mensaje que lanza alguien cuando quiere guardar informacion.
  socket.on("setdata", function(dataId, value)
  {
    data[dataId] = value;
  })
  
  // -----------------------------
  
  // Mensaje que lanza alguien para que propagemos informacion a todos los demas.
  socket.on("event", function(eventId, eventData)
  {
    io.to(room).emit("event", eventId, eventData);
  });
  
  // -----------------------------
  
  // Mensajes de Sockets.io cuando se desconecta un cliente.
  socket.on('disconnect',function()
  {    
    console.log("Client [" + id + "] has leaved.")
    delete players[room][socket.id];    
    socket.broadcast.emit ('playerLeaved', socket.id);
  });
  
});

// 60 veces por segundo, enviamos la informacion a los clientes de los players en su room.
var update = function()
{ 
  var rooms = Object.keys(players);
  rooms.forEach(function(room) {
    io.to(room).emit("update", players[room]);
  });  
  setTimeout(update, (1/120) * 1000);
}
update();


// -----------------------------------------------------------

console.log("Server started.");
server.listen(3000);