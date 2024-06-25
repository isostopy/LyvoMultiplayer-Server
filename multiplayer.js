// ===========================================================
// Inicializar el servidor

var https = require("https");
var server = require("http").createServer();
var options = {
  cors: true,
};

var io = require("socket.io")(server, options);


// ===========================================================
// VARIABLES GLOBALES

// Objeto donde vamos almacenando info generica de la sesion.
// Cualquier miembro de la sesion puede guardar aqui la info que quiera asignada a un id.
var data = {};

// Player unidos a este server.
// Cada entrada es un keyValuePair, con la key = a la room, y el value una lista de objetos player asignada al id de cada uno.
var players = {};

// Players baneados.
// Cada entrada tiene una key que es la room y el value es un array con las id estaticas de los jugadores baneados.
var bannedPlayers = {};

// Lista que indica quien esta compartiendo pantalla en cada room.
// La key = la room, el value = el id del cliente que esta presentando.
var presenters = {};

// Lista con los portales a las salas privadas que hay abiertos.
var portals = {};


// ===========================================================

// Mensaje que lanza Sockets.io cuando se conecta un nuevo cliente.
io.sockets.on("connection", function (socket)
{  
  var id = socket.id;    // Id del usuario para sesion, cambia cada vez que te conectas.
  var staticId = "";     // Id estatico del usuario, es el mismo entre sesiones.
  var room = "/";        // Room en la que esta conectado el usuario.

  // -----------------------------
  // JOIN
  {
    // Mensaje que lanza un usuario para unirse a una room.
    // El cliente solo tiene que llamar a este evento una vez, al principio.
    socket.on("join", function (newRoom, playerData, callback) {
      /* Si quisieramos poder cambiar de room y llamar a este evento varias veces:
          habria que sacar al player de la lista en players[room], informar a todos los de esa room que se ha ido
          y decirle al player que se va que todos los que hay en su room se han ido
          habria que meterle en players[newRoom] e informar a todos en esa room de que se ha unido un nuevo player.
          y decirle al player que han llegado todos los de la nueva room.                 */

      var newPlayer = playerData || {};
      newPlayer.id = id;
      
      staticId = playerData ? playerData.staticId : "";
      
      // Comprobar que no este baneado.
      if (bannedPlayers[newRoom] && bannedPlayers[newRoom].includes(newPlayer.staticId))
      {
        var bannedInfo = 
        {
          banned : true,
          id : id
        }

        callback(bannedInfo);
        return;
      }

      // Unimos al player a la room que ha pedido.
      room = newRoom;
      socket.join(room);
      // Guardamos su informacion en el objeto Players.
      if (!players[room]) players[room] = {};
      players[room][id] = newPlayer;

      // Le devolvemos al player su id.
      if (callback)
      {
        callback(id);
      }
      // Le decimos a toda la room que se ha unido un nuevo player.
      socket.to(room).emit("playerJoined", newPlayer);

      // console.log("Client [" + socket.id + "] has joined room [" + room + "]");
    });
    
    // Evento que lanza un jugador para obtener la lista de jugadores en tu room.
    socket.on("getplayers", function (callback)
    {
      if (!players[room]) 
      {
        callback({});
        return;
      }
      callback(players[room]);
    });
  }

  // -----------------------------
  // GENERIC DATA
  {
    // Mensaje que laza alguien cuando queire extraer informacion guardada.
    socket.on("getdata", function (dataId, callback)
    {
      callback(data[dataId]);
    });

    // Mensaje que lanza alguien cuando quiere guardar informacion.
    socket.on("setdata", function (dataId, value)
    {
      data[dataId] = value;
    });
  }

  // -----------------------------
  // GENERIC EVENT
  {
    // Mensaje que lanza un cliente para que propagemos un evento a todos los demas.
    socket.on("event", function (eventId, eventData)
    {
      io.to(room).emit("event", eventId, eventData);
    });
  }

  // -----------------------------
  // HOST
  {
    // Funcion que nos dice si un jugador es host.
    var isHost = function(playerId)
    {
        if (!players[room][playerId])
            return false;      
        if (players[room][playerId].hosting === false)
            return false;
        if (players[room][playerId].hosting === true)
            return true;
        return false;
    };
    
    // Funcion que nos dice si hay algun host en una room.
    var areHostInRoom = function(roomId)
    {
        if (!players[roomId])
            return false;
      
        for(var i in players[roomId])
        {
          var player = players[room][i];
          if (player.hosting == true)
            return true;
        }
        return false;
    };
    
    // ----------
    
    // Un jugador nos indica que quiere hacerse hots.
    socket.on("hosting:setashost", ()=>
    {
        if (!players[room] || !players[room][id])
            return;
      
        var requestOptions = {
          headers : {
            "user-id": staticId,
            "room": room
          }
        };
        
        let url = "https://universolyvo.com/3d-info/checkHost.php";
        
        // Hay que preguntar al servidor si esta persona puede ser host.
        https.get(url, requestOptions, (res)=>
        {
            console.log(res.statusCode);
            if (res.statusCode >= 400)
            {
                return;
            }
          
            // La marcamos como host.
            players[room][id].hosting = true;

            // Enviamos a todos los host una actualización del estado de los usuarios.
            for(let i in players[room])
            {
                let player = players[room][i];

                if (player.hosting)
                    io.to(player.id).emit("hosting:playersupdate", players[room]);
            }
        });
    });
    
    // Un jugador indica que quiere hacer o quitar de presentador a alguien.
    socket.on("hosting:setpresenter", (playerId)=>
    {
        // Solo puedes hacer presentador si eres host.
        if (!isHost(id))
            return;
      
        // Indicamos que la persona esta presentando.
        if (!players[room][playerId])
          return;
        players[room][playerId].presenting = !players[room][playerId].presenting;
      
        // Enviamos a esa persona una actualización de su estado.
        io.to(playerId).emit("hosting:setpresenter", players[room][playerId].presenting);
        // Enviamos a todos los host una actualización del estado de los usuarios.
        for(let i in players[room])
        {
            let player = players[room][i];
          
            if (player.hosting)
                io.to(player.id).emit("hosting:playersupdate", players[room]);
        }
    });
    
    // Silenciar a un jugador.
    socket.on("hosting:muteplayer", (targetPlayer)=>
    {
        if (!isHost(id))
            return;
      
        // Decirle a ese jugador que se tiene que silenciar.
        io.to(targetPlayer).emit("hosting:mute");
    });
    
    // Explusar a un jugador.
    socket.on("hosting:banplayer", (targetPlayer)=>
    {
      if (!isHost(id))
        return;
      if (isHost(targetPlayer))
          return;
      
      var bannedPlayer = players[room][targetPlayer];
      
      if (!bannedPlayers[room])
        bannedPlayers[room] = [];
      
      if (bannedPlayers[room].includes(bannedPlayer.staticId) == false)
        bannedPlayers[room].push(bannedPlayer.staticId);
      
      io.to(targetPlayer).emit("hosting:ban");
    })
  }
  
  // -----------------------------
  // MULTIPLAYER
  {    
    // Mensaje que envia en bucle cada cliente actualizando su informacion.
    socket.on("multiplayer:update", function (playerData)
    {
      if (!players[room]) return;

      players[room][id].multiplayerData = playerData;
    });
  }

  // -----------------------------
  // CHAT DE VOZ
  {
    socket.on("voice", function (voice)
    {
      // Se lo mandamos a todos los usuarios de su sala.
      for (var playerId in players[room])
      {
        if (playerId == id) continue;

        io.to(playerId).emit("voice", voice);
      }
    });
  }

  // -----------------------------
  // SCREEN SHARING
  {
    // Funcion que llama un nuevo cliente para que le pasemos la informacion de lo que ya esta pasando en la sesion.
    socket.on("screensharing:getdata", function(callback)
    {
      if (!presenters[room])
        callback(false);
      else
        callback(true);
    });
    
    // -----
    
    // Un cliente quiere empezar a compartir pantalla.
    socket.on("screensharing:start", function (callback)
    {      
      // Si ya hay alguien presentando no damos permiso.
      if (presenters[room])
      {
        callback(false);
        return;
      }

      presenters[room] = id;
      callback(true);
      
      io.in(room).emit("screensharing:start");
    });

    // -----
    
    // El cliente nos pasa una imagen compartiendo su pantalla.
    socket.on("screensharing:image", (image) =>
    {            
      // Solo puede pasar su pantalla quien esta presentando.
      if (!presenters[room] || socket.id != presenters[room])
        return;

        io.in(room).emit("screensharing:image", image);
    });
    
    // Audio de la pantalla.
    socket.on("screensharing:audio", (audio) =>
    {
      // Solo puede pasar su pantalla quien esta presentando.
      if (!presenters[room] || socket.id != presenters[room])
        return;
      
      io.in(room).emit("screensharing:audio", audio);
    });

    // -----
    
    // Funcion que termina de compartir pantalla.
    var stopScreenShare = function()
    {
      if (id != presenters[room]) return;
      
      delete presenters[room];
      
      io.in(room).emit("screensharing:end");
    };
        
    // Evento que lanza un cliente para terminar de compartir pantalla.
    socket.on("screensharing:end", () => stopScreenShare());
  }
  
  // -----------------------------
  // PRIVATE ROOMS
  {
      // Evento que llama un usuario cuando quiere abrir un portal de sala privada.
      socket.on("privateroom:open", (portalId, roomId)=>
      {        
          // Comprobar que no este abierto ya el portal.
          if (portals[portalId]) { return; }        
          portals[portalId] = id;
        
          // Le decimos a todos que se ha abierto un portal.
          socket.broadcast.emit("privateroom:open", portalId, roomId);
      });
    
      // Funcion que cierra el portal de la sala privada.
      var closeRoom = function(portalId)
      {        
          // Solo puede cerrar quien lo ha abierto.
          if (portals[portalId] != id) { return; }  
          delete portals[portalId];
        
          // Le decimos a todos que se ha cerrado un portal.
          socket.broadcast.emit("privateroom:close", portalId);
      };
    
      // Evento que lanza un usuario cuando quiere cerrar un portal.
      socket.on("privateroom:close", closeRoom);      
  }

  // -----------------------------
  // DISCONNECT
  {
    // Mensajes de Sockets.io cuando se desconecta un cliente.
    socket.on("disconnect", function ()
    {
      // console.log("Client [" + id + "] has leaved.");
      
      if (!players[room])
        return;

      // Si el player que se va es el que estaba presentando en su room, paramos de presentar.
      if (presenters[room] == id)
        stopScreenShare();
      
      var wasHosting = players[room][id].hosting;
      
      // Lo eliminamos de la lista de players.
      if (players[room][socket.id]) delete players[room][socket.id];   
      // Si la room en la que estaba se queda vacia, la eliminamos tambien.
      if (Object.keys(players[room]).length <= 0) delete players[room];
      
      // Si el player que se va es host,
      // y no queda ningun otro host en la sala, se desbanea a todo el mundo.
      if (wasHosting == true && areHostInRoom(room) == false)
          delete bannedPlayers[room];
      
      // Si el usuario que se va tenia abierta una sala privada, la cerramos.
      var portalKeys = Object.keys(portals);
      portalKeys.forEach(( portalId )=> {
            if (id == portals[portalId])
                closeRoom(portalId);
      });
      
      // Infornanos a todos los de su room de que se ha ido.
      socket.to(room).emit("playerLeaved", socket.id); 
    });
  }
});


// ===========================================================

// 60 veces por segundo, enviamos la informacion a los clientes de los players en su room.
var multiplayerUpdate = function () {
    var rooms = Object.keys(players);
    rooms.forEach((room) => {
      io.to(room).emit("multiplayer:update", players[room]);
    });

    setTimeout(multiplayerUpdate, (1 / 120) * 1000);
};
multiplayerUpdate();


// ===========================================================

server.listen(3000);
console.log("Server started.");
