import dotenv from "dotenv";
dotenv.config();

import connectDB from "./config/db.js";
import { io } from "./config/socket.js";
import Chat from "./models/Chat.js";
import Messages from "./models/Messages.js";
import { redisClient, smartDequeue } from "./config/queue.js";

// Quick Redis test function
async function testRedisConnection(redisClient: any) {
  try {
    console.log('Testing Redis connection in consumer...');
    await redisClient.set('consumer:test', 'connected');
    const value = await redisClient.get('consumer:test');
    console.log('Consumer Redis test:', value);
    return true;
  } catch (error) {
    console.error('Consumer Redis test failed:', error);
    return false;
  }
}

async function processMessage(messagePayload: any) {
  try {
    console.log('Processing message:', messagePayload);

    const { chatId, clientMessageId, tempMessageId, sender, text, mediaType, mediaInfo } = messagePayload;

    // Verify chat exists
    const chat = await Chat.findById(chatId);
    if (!chat) {
      console.error('Chat not found');
      return;
    }

    // Check if user is participant
    const isUserInChat = chat.users.some((userId: any) => userId.toString() === sender.toString());
    if (!isUserInChat) {
      console.error('User not in chat');
      return;
    }

    // Find the other user for socket notifications
    const otherUserId = chat.users.find((userId: any) => userId.toString() !== sender.toString());
    if (!otherUserId) {
      console.error('No other user in chat');
      return;
    }

    let savedMessage;

    // If tempMessageId is provided, the message was already created by queue endpoint
    if (tempMessageId) {
      // Find the existing message and update it if needed
      savedMessage = await Messages.findById(tempMessageId);
      if (!savedMessage) {
        console.error('Temp message not found:', tempMessageId);
        return;
      }

      // Message already exists, just proceed to emit
    } else {
      // Legacy support: create message if no tempMessageId (old queue messages)
      let dbMessageData: any = {
        chatId: chatId,
        sender: sender,
        seen: false,
        text: text || "",
      };

      if (mediaType && mediaInfo) {
        if (mediaType === 'image') {
          dbMessageData.messageType = "image";
        } else {
          dbMessageData.messageType = mediaType;
          dbMessageData.file = {
            filename: mediaInfo.filename,
            fileType: mediaInfo.fileType,
            fileSize: mediaInfo.fileSize,
          };
        }
      } else {
        dbMessageData.messageType = "text";
      }

      savedMessage = await Messages.create(dbMessageData);

      // Update chat's latest message
      const latestMessageText = mediaType ?
        (mediaType === 'image' ? "📷 Image" :
         mediaType === 'video' ? "🎥 Video" :
         mediaType === 'file' ? "📄 File" : text)
        : text;

      await Chat.findByIdAndUpdate(chatId, {
        latestMessage: { text: latestMessageText, sender: sender },
        updatedAt: new Date(),
      });
    }

    // Cache in Redis
    await cacheMessage(chatId, savedMessage);

    // Emit to chat room and specific users
    const messageWithClientId = { ...savedMessage.toObject(), clientMessageId };
    io.to(chatId).emit("newMessage", messageWithClientId);
    io.to(savedMessage.sender.toString()).emit("newMessage", messageWithClientId);

    console.log('Message processed successfully:', savedMessage._id);

  } catch (error) {
    console.error('Error processing message:', error);
  }
}

async function cacheMessage(chatId: string, message: any) {
  const key = `chat:${chatId}:messages`;
  try {
    await redisClient.sAdd(key, JSON.stringify(message));
    await redisClient.expire(key, 3600); // Expire after 1 hour
  } catch (error) {
    console.error('Error caching message:', error);
  }
}

async function dequeueMessage(): Promise<any | null> {
  // Use global in-memory queue as fallback
  if (typeof global !== 'undefined' && (global as any).messageQueue) {
    const queue = (global as any).messageQueue;
    if (queue.length > 0) {
      const message = queue.shift();
      console.log('Dequeued from memory:', message?.clientMessageId);
      return message;
    }
  }

  // Try Redis if available
  const key = 'message_queue';
  try {
    const messageJson = await redisClient.lPop(key);
    if (messageJson) {
      console.log('Dequeued from Redis');
      return JSON.parse(messageJson);
    }
    return null;
  } catch (error) {
    console.error('Redis dequeue failed, no messages in memory');
    return null;
  }
}

async function startConsumer() {
  try {
    // Connect to services
    await connectDB();
    // Redis and RabbitMQ already connected in index.ts

    console.log('Consumer services connected');

    // Message processing loop
    setInterval(async () => {
      const message = await smartDequeue();
      if (message) {
        await processMessage(message);
      }
    }, 100); // Check every 100ms

    console.log('Message consumer started');

  } catch (error) {
    console.error('Failed to start consumer:', error);
    process.exit(1);
  }
}

startConsumer();

export default startConsumer;
