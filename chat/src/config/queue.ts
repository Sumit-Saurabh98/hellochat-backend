import { createClient } from "redis";

// In-memory fallback queue when Redis fails
const memoryQueue: any[] = [];
export let redisConnected = false;
export let redisClient: any = null;

// Initialize memory queue immediately (no Redis wait)
console.log("🔄 Initializing in-memory queue system");
redisConnected = false;

// Try Redis in background (don't block startup)
const tryRedisConnection = async () => {
  try {
    redisClient = createClient({
        url: process.env.REDIS_URL!,
        socket: {
            connectTimeout: 5000, // 5 seconds max
        },
    });

    console.log("Attempting Redis connection...");

    await redisClient.connect();
    console.log("✅ Redis connected! Switching to Redis queue");
    redisConnected = true;
  } catch (error: any) {
    console.error("❌ Redis failed, staying with memory queue:", error.message);
    redisConnected = false;
  }
};

// Start async Redis attempt (but don't block startup)
tryRedisConnection();

// Fallback queue methods
export const queueToMemory = async (message: any) => {
  console.log('Queued to memory:', message.clientMessageId);
  memoryQueue.push(message);
};

export const dequeueFromMemory = (): any | null => {
  if (memoryQueue.length > 0) {
    console.log('Dequeued from memory');
    return memoryQueue.shift() || null;
  }
  return null;
};

// Queue method that uses Redis if available, otherwise memory
export const smartQueue = async (message: any) => {
  if (redisConnected && redisClient) {
    try {
      await redisClient.rPush('message_queue', JSON.stringify(message));
      console.log('Queued to Redis');
    } catch (error) {
      console.error('Redis queue failed, falling back to memory');
      queueToMemory(message);
    }
  } else {
    queueToMemory(message);
  }
};

// Dequeue method that uses Redis if available, otherwise memory
export const smartDequeue = async (): Promise<any | null> => {
  if (redisConnected) {
    try {
      const message = await redisClient.lPop('message_queue');
      if (message) {
        console.log('Dequeued from Redis');
        return JSON.parse(message);
      }
    } catch (error) {
      console.error('Redis dequeue failed, falling back to memory');
    }
  }

  // Fall back to memory
  return dequeueFromMemory();
};
