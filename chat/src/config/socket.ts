import { Server, Socket } from "socket.io";
import http from "http";
import express from "express";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const userSocketMap: Record<string, Set<string>> = {};

export const getReceiverSocketId = (receiverId:string):string | undefined =>{
  return userSocketMap[receiverId]?.values().next().value
}

io.on("connection", (socket: Socket) => {
  console.log("User Connected", socket.id);

  const userId = socket.handshake.query.userId?.toString();

  if (userId && userId !== "undefined") {
    if (!userSocketMap[userId]) {
      userSocketMap[userId] = new Set();
    }
    userSocketMap[userId].add(socket.id);
    console.log(`User ${userId} mapped to socket ${socket.id}`);
  }

  io.emit("getOnlineUser", Object.keys(userSocketMap));

  if(userId){
    socket.join(userId);
  }

  socket.on("typing", (data)=>{
    console.log(`User ${data.userId} is typing in chat $${data.chatId}`);
    socket.to(data.chatId).emit("userTyping", {
      chatId:data.chatId,
      userId:data.userId
    });
  })

  socket.on("stopTyping", (data)=>{
    console.log(`User ${data.userId} stopped typing in chat $${data.chatId}`);
    socket.to(data.chatId).emit("userStoppedTyping", {
      chatId:data.chatId,
      userId:data.userId
    });
  })

  socket.on("joinChat", (chatId)=>{
    socket.join(chatId);
    console.log(`User ${userId} joined chat ${chatId}`);
  })

  socket.on("leaveChat", (chatId)=>{
    socket.leave(chatId);
    console.log(`User ${userId} left chat ${chatId}`);
  })

  socket.on("disconnect", () => {
    console.log("User Disconnected", socket.id);
    if (userId) {
      userSocketMap[userId]?.delete(socket.id);
      if (userSocketMap[userId]?.size === 0) {
        delete userSocketMap[userId];
      }
      io.emit("getOnlineUser", Object.keys(userSocketMap));
    }
  });
});

export { app, server, io };
