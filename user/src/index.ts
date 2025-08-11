import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import {createClient} from "redis"
import connectDB from "./config/db.js";
import userRoutes from './routes/User.js';
import { connectRabbitMQ } from "./config/rabbitmq.js";

const app = express();
app.use(express.json())

app.use(cors());

connectDB();

connectRabbitMQ()

export const redisClient = createClient({
    url: process.env.REDIS_URL!
});

redisClient
  .connect()
  .then(() => console.log("connected to redis"))
  .catch(console.error);

  // routes
app.use("/api/v1", userRoutes);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`user service is running on port ${PORT}`);
});