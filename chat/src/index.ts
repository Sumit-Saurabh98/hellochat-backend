import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import chatRoutes from "./routes/chat.js";
import { app, server } from "./config/socket.js";
import { smartQueue } from "./config/queue.js";

dotenv.config();

connectDB();

// Export smartQueue for use by chat controller
export { smartQueue };

import("./config/queue.js"); // Initialize queue connection

app.use(cors());

app.use(express.json());

// routes
app.use("/api/v1", chatRoutes);

const PORT = process.env.PORT || 3003;

server.listen(PORT, () => {
    console.log(`chat service is running on port ${PORT}`);
});
