import { createClient } from 'redis';
import dotenv from "dotenv";
dotenv.config();

// Redis client using connection URL (same as user service)
export const redisClient = createClient({
    url: process.env.REDIS_URL!,
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));
redisClient.on('ready', () => console.log('Redis Client Ready'));
redisClient.on('end', () => console.log('Redis Client Ended'));

export const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log('Redis connected successfully');
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
  }
};

// Cache message for chat
export const cacheMessage = async (chatId: string, message: any, ttl = 3600) => {
  const key = `chat:${chatId}:messages`;
  try {
    // Add message to set for this chat
    await redisClient.sAdd(key, JSON.stringify(message));
    await redisClient.expire(key, ttl); // Expire after 1 hour
  } catch (error) {
    console.error('Error caching message:', error);
  }
};

// Get cached messages for chat
export const getCachedMessages = async (chatId: string): Promise<any[]> => {
  const key = `chat:${chatId}:messages`;
  try {
    const messages = await redisClient.sMembers(key);
    return messages.map(msg => JSON.parse(msg)).sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateA - dateB;
    });
  } catch (error) {
    console.error('Error getting cached messages:', error);
    return [];
  }
};

// Add message to queue for processing (RabbitMQ will pick up)
export const queueMessage = async (message: any) => {
  const key = 'message_queue';
  try {
    await redisClient.rPush(key, JSON.stringify(message));
    console.log('Message queued for processing');
  } catch (error) {
    console.error('Error queuing message:', error);
  }
};

// Get message from queue
export const dequeueMessage = async (): Promise<any | null> => {
  const key = 'message_queue';
  try {
    const messageJson = await redisClient.lPop(key);
    if (messageJson) {
      return JSON.parse(messageJson);
    }
    return null;
  } catch (error) {
    console.error('Error dequeuing message:', error);
    return null;
  }
};

// Cache user online status
export const setUserOnline = async (userId: string, socketId: string) => {
  const key = `user:${userId}:online`;
  try {
    await redisClient.set(key, socketId);
    await redisClient.expire(key, 60); // 1 minute TTL
  } catch (error) {
    console.error('Error setting user online:', error);
  }
};

// Get user's socket ID
export const getUserSocket = async (userId: string): Promise<string | null> => {
  const key = `user:${userId}:online`;
  try {
    return await redisClient.get(key);
  } catch (error) {
    console.error('Error getting user socket:', error);
    return null;
  }
};

// Set user offline
export const setUserOffline = async (userId: string) => {
  const key = `user:${userId}:online`;
  try {
    await redisClient.del(key);
  } catch (error) {
    console.error('Error setting user offline:', error);
  }
};

export default redisClient;
