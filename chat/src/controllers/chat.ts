import TryCatch from "../config/trycatch.js";
import type { AuthenticatedRequest } from "../middlewares/isAuth.js";
import axios from "axios";
import { type Response } from "express";
import Chat from "../models/Chat.js";
import Messages from "../models/Messages.js";
import type { IMessage } from "../models/Messages.js";
import type { IMessageWithUrl } from "../models/Messages.js";
import { getReceiverSocketId, io } from "../config/socket.js";
import { generateSingleUploadPresignedUrl, initiateMultipartUpload, generatePartPresignedUrl, completeMultipartUpload, generateViewPresignedUrl } from "../config/aws-s3.js";


export const createNewChat = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?._id;
    const { otherUserId } = req.body;

    if (!userId || !otherUserId) {
      res.status(400).json({
        message: "Please provide both user ids",
      });

      return;
    }

    const existingChat = await Chat.findOne({
      users: { $all: [userId, otherUserId], $size: 2 },
    });

    if (existingChat) {
      res.status(200).json({
        message: "Chat already exists",
        chatId: existingChat._id,
      });
      return;
    }

    const newChat = await Chat.create({
      users: [userId, otherUserId],
    });

    res.status(201).json({
      message: "Chat created",
      chatId: newChat._id,
    });
  }
);

// Get presigned view URL for image
export const getImageViewUrl = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const { key } = req.query;

    if (!key || typeof key !== "string") {
      res.status(400).json({
        message: "key is required",
      });
      return;
    }

    const url = await generateViewPresignedUrl(key);

    res.status(200).json({
      url,
    });
  }
);

// AWS S3 Upload Controllers
export const getSingleUploadPresignedUrl = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      res.status(400).json({
        message: "fileName and contentType are required",
      });
      return;
    }

    // Validate contentType
    const allowedStarts = ["image/", "video/", "application/", "text/", "audio/"];
    if (!allowedStarts.some(start => contentType.startsWith(start))) {
      res.status(400).json({
        message: "Invalid file type",
      });
      return;
    }

    const { uploadUrl, key } = await generateSingleUploadPresignedUrl(fileName, contentType);

    res.status(200).json({
      uploadUrl,
      key,
    });
  }
);

export const initiateMultipartUploadUrl = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const { fileName, contentType, totalParts } = req.body;

    if (!fileName || !contentType || !totalParts) {
      res.status(400).json({
        message: "fileName, contentType, and totalParts are required",
      });
      return;
    }

    // Validate contentType
    const allowedStarts = ["image/", "video/", "application/", "text/", "audio/"];
    if (!allowedStarts.some(start => contentType.startsWith(start))) {
      res.status(400).json({
        message: "Invalid file type",
      });
      return;
    }

    if (totalParts < 1 || totalParts > 10000) { // AWS limit
      res.status(400).json({
        message: "totalParts must be between 1 and 10000",
      });
      return;
    }

    const { uploadId, key } = await initiateMultipartUpload(fileName, contentType);

    // Generate presigned URLs for all parts
    const partUrls = [];
    for (let i = 1; i <= totalParts; i++) {
      const { uploadUrl, partNumber } = await generatePartPresignedUrl(key, uploadId, i);
      partUrls.push({ uploadUrl, partNumber });
    }

    res.status(200).json({
      uploadId,
      key,
      parts: partUrls,
    });
  }
);

export const completeMultipartUploadHandler = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const { key, uploadId, parts } = req.body;

    if (!key || !uploadId || !parts) {
      res.status(400).json({
        message: "key, uploadId, and parts are required",
      });
      return;
    }

    await completeMultipartUpload(key, uploadId, parts);

    res.status(200).json({
      message: "Upload completed successfully",
      key,
    });
  }
);

export const getAllChats = TryCatch(async (req: AuthenticatedRequest, res) => {
  const userId = req.user?._id;
  if (!userId) {
    res.status(400).json({
      message: " UserId missing",
    });
    return;
  }

  const chats = await Chat.find({ users: userId }).sort({ updatedAt: -1 });

  const chatWithUserData = await Promise.all(
    chats.map(async (chat) => {
      const otherUserId = chat.users.find((id) => id !== userId);

      const unseenCount = await Messages.countDocuments({
        chatId: chat._id,
        sender: { $ne: userId },
        seen: false,
      });

      try {
        const { data } = await axios.get(
          `${process.env.USER_SERVICE}/api/v1/user/${otherUserId}`
        );

        return {
          user: data,
          chat: {
            ...chat.toObject(),
            latestMessage: chat.latestMessage || null,
            unseenCount,
          },
        };
      } catch (error) {
        console.log(error);
        return {
          user: { _id: otherUserId, name: "Unknown User" },
          chat: {
            ...chat.toObject(),
            latestMessage: chat.latestMessage || null,
            unseenCount,
          },
        };
      }
    })
  );

  res.json({
    chats: chatWithUserData,
  });
});

export const sendMessage = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const senderId = req.user?._id;
    const { chatId, text, mediaType, mediaKey, mediaInfo } = req.body;

    if (!senderId || !chatId) {
      res.status(400).json({
        message: "Please provide senderId",
      });
      return;
    }

    if (!text && !mediaKey && !mediaType) {
      res.status(400).json({
        message: "Please provide text or media",
      });
      return;
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      res.status(404).json({
        message: "Chat not found",
      });
      return;
    }

    const isUserInChat = chat.users.some(
      (userId) => userId.toString() === senderId.toString()
    );

    if (!isUserInChat) {
      res.status(403).json({
        message: "You are not a participant of this chat",
      });
      return;
    }

    const otherUserId = chat.users.find(
      (userId) => userId.toString() !== senderId.toString()
    );

    if (!otherUserId) {
      res.status(401).json({
        message: "No other user",
      });
      return;
    }

    // TODO: add socket implementation

    const receiverSocketId = getReceiverSocketId(otherUserId.toString());

    let isReceiverInChatRoom = false;

    if (receiverSocketId) {
      const receiverSocket = io.sockets.sockets.get(receiverSocketId);

      if (receiverSocket && receiverSocket.rooms.has(chatId)) {
        isReceiverInChatRoom = true;
      }
    }

    let messageData: any = {
      chatId: chatId,
      sender: senderId,
      seen: isReceiverInChatRoom,
      seenAt: isReceiverInChatRoom ? new Date() : undefined,
      text: text || "",
    };

    if (mediaType) {
      messageData.uploadStatus = "uploading";
      messageData.messageType = mediaType === 'file' ? 'file' : (mediaType === 'video' ? 'video' : 'image');

      if (mediaType === 'image') {
        // For images, store key if already uploaded, else prepare for upload
        if (mediaKey) {
          messageData.image = { key: mediaKey };
          messageData.uploadStatus = "completed";
        }
      } else {
        if (mediaInfo) {
          messageData.file = {
            filename: mediaInfo.filename,
            fileType: mediaInfo.fileType,
            fileSize: mediaInfo.fileSize,
          };
          if (mediaKey) {
            messageData.file.key = mediaKey;
            messageData.uploadStatus = "completed";
          }
        }
      }
    } else {
      messageData.messageType = "text";
    }

    const message = new Messages(messageData);

    const savedMessage = await message.save();

    const latestMessageText = mediaType ? (
      mediaType === 'image' ? "📷 Image" :
      mediaType === 'video' ? "🎥 Video" :
      mediaType === 'file' ? "📄 File" :
      text
    ) : text;

    await Chat.findByIdAndUpdate(
      chatId,
      {
        latestMessage: {
          text: latestMessageText,
          sender: senderId,
        },
        updatedAt: new Date(),
      },
      { new: true }
    );

    // TODO: emit to socket

    io.to(chatId).emit("newMessage", savedMessage);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", savedMessage);
    }

    const senderSocketId = getReceiverSocketId(senderId.toString());

    if (senderSocketId) {
      io.to(senderSocketId).emit("newMessage", savedMessage);
    }

    if (isReceiverInChatRoom && senderSocketId){
      io.to(senderSocketId).emit("messagesSeen", {
        chatId: chatId,
        seenBy: otherUserId,
        messageIds: [savedMessage._id]
      });
    }

    res.status(201).json({
      message: savedMessage,
      sender: senderId,
    });
  }
);

export const updateMessageMedia = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?._id;
    const { messageId, mediaKey } = req.body;

    if (!userId || !messageId || !mediaKey) {
      res.status(400).json({
        message: "UserId, messageId, and mediaKey are required",
      });
      return;
    }

    const message = await Messages.findOne({ _id: messageId, sender: userId });

    if (!message) {
      res.status(404).json({
        message: "Message not found or not owned by user",
      });
      return;
    }

    // Update message with the uploaded key
    if (message.messageType === "image") {
      message.image = { key: mediaKey };
    } else if (message.file) {
      message.file.key = mediaKey;
    }

    message.uploadStatus = "completed";
    await message.save();

    // Emit update via socket to update UI in real-time
    const chat = await Chat.findById(message.chatId);
    if (chat) {
      io.to(message.chatId.toString()).emit("messageUpdated", {
        messageId,
        message: message.toObject(),
      });
    }

    res.status(200).json({
      message: "Message updated successfully",
    });
  }
);

export const queueMessageForProcessing = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?._id;
    const { chatId, text, mediaType, mediaInfo } = req.body;

    if (!userId || !chatId) {
      res.status(400).json({ message: "UserId and chatId are required" });
      return;
    }

    if (!text && !mediaType) {
      res.status(400).json({ message: "Text or mediaType is required" });
      return;
    }

    // Basic validation
    const chat = await Chat.findById(chatId);
    if (!chat) {
      res.status(404).json({ message: "Chat not found" });
      return;
    }

    if (!chat.users.includes(userId)) {
      res.status(403).json({ message: "Not authorized for this chat" });
      return;
    }

    // Find the other user for socket notifications
    const otherUserId = chat.users.find((user: any) => user.toString() !== userId.toString());

    const receiverSocketId = getReceiverSocketId(otherUserId ? otherUserId.toString() : '');

    let isReceiverInChatRoom = false;

    if (receiverSocketId) {
      const receiverSocket = io.sockets.sockets.get(receiverSocketId);

      if (receiverSocket && receiverSocket.rooms.has(chatId)) {
        isReceiverInChatRoom = true;
      }
    }

    // Create message data
    let dbMessageData: any = {
      chatId: chatId,
      sender: userId,
      seen: isReceiverInChatRoom,
      seenAt: isReceiverInChatRoom ? new Date() : undefined,
      text: text || "",
    };

    if (mediaType) {
      dbMessageData.uploadStatus = "uploading";
      dbMessageData.messageType = mediaType === 'file' ? 'file' : (mediaType === 'video' ? 'video' : 'image');

      if (mediaType === 'image') {
        // Prepare for image upload
        dbMessageData.image = { key: '' };
      } else {
        if (mediaInfo) {
          dbMessageData.file = {
            filename: mediaInfo.filename,
            fileType: mediaInfo.fileType,
            fileSize: mediaInfo.fileSize,
            key: '',
          };
        }
      }
    } else {
      dbMessageData.messageType = "text";
    }

    // Save message to database immediately
    const savedMessage = await Messages.create(dbMessageData) as any;

    // Update chat's latest message
    const latestMessageText = mediaType ?
      (mediaType === 'image' ? "📷 Image" :
       mediaType === 'video' ? "🎥 Video" :
       mediaType === 'file' ? "📄 File" : text)
      : text;

    await Chat.findByIdAndUpdate(chatId, {
      latestMessage: { text: latestMessageText, sender: userId },
      updatedAt: new Date(),
    });

    // Queue the message for socket notifications (not saving to DB again)
    const messagePayload = {
      clientMessageId: savedMessage._id.toString(), // Use actual message ID as client ID
      chatId,
      sender: userId,
      text,
      mediaType,
      mediaInfo,
      tempMessageId: savedMessage._id.toString(), // Track the already created message
    };

    // Import and use the smart queue function
    import('../index.js').then(async (indexModule) => {
      try {
        const smartQueue = indexModule.smartQueue;
        await smartQueue(messagePayload);
        console.log('Message queued successfully for notifications:', messagePayload.clientMessageId);

        res.status(200).json({
          message: savedMessage,
          clientMessageId: messagePayload.clientMessageId,
          sender: userId,
        });
      } catch (error) {
        console.error('Failed to queue message:', error);
        // Message is already saved, just return it
        res.status(200).json({
          message: savedMessage,
          clientMessageId: savedMessage._id.toString(),
          sender: userId,
        });
      }
    }).catch((importError) => {
      console.error('Import error:', importError);
      res.status(200).json({
        message: savedMessage,
        clientMessageId: savedMessage._id.toString(),
        sender: userId,
      });
    });
  }
);

export const getMessagesByChat = TryCatch(
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?._id;
    const { chatId } = req.params;

    if (!userId) {
      res.status(401).json({
        message: "Unauthorized",
      });
      return;
    }

    if (!chatId) {
      res.status(400).json({
        message: "ChatId Required",
      });
      return;
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      res.status(404).json({
        message: "Chat not found",
      });
      return;
    }

    const isUserInChat = chat.users.some(
      (userId) => userId.toString() === userId.toString()
    );

    if (!isUserInChat) {
      res.status(403).json({
        message: "You are not a participant of this chat",
      });
      return;
    }

    const messagesToMarkSeen = await Messages.find({
      chatId: chatId,
      sender: { $ne: userId },
      seen: false,
    });

    await Messages.updateMany(
      {
        chatId: chatId,
        sender: { $ne: userId },
        seen: false,
      },
      {
        seen: true,
        seenAt: new Date(),
      }
    );

    const messagesRaw = await Messages.find({ chatId }).sort({ createdAt: 1 });

    // Generate presigned URLs for images and files
    const messages = await Promise.all(messagesRaw.map(async (msg) => {
      const msgObj = msg.toObject() as unknown as IMessageWithUrl & { file: { key: string, url?: string } };
      if (msgObj.messageType === "image" && msgObj.image?.key) {
        msgObj.image.url = await generateViewPresignedUrl(msgObj.image.key);
      } else if (msgObj.file?.key) {
        msgObj.file.url = await generateViewPresignedUrl(msgObj.file.key);
      }
      return msgObj;
    }));

    const otherUserId = chat.users.find((id) => id !== userId);

    try {
      const { data } = await axios.get(
        `${process.env.USER_SERVICE}/api/v1/user/${otherUserId}`
      );

      if (!otherUserId) {
        res.status(400).json({
          message: "No other user",
        });
        return;
      }

      // TODO: add socket implementation

      if(messagesToMarkSeen.length > 0){
        const otherUserSocketId = getReceiverSocketId(otherUserId.toString());

        if (otherUserSocketId) {
          io.to(otherUserSocketId).emit("messagesSeen", {
            chatId: chatId,
            seenBy: userId,
            messageIds: messagesToMarkSeen.map((message) => message._id)
          });
        }
      }

      res.json({
        messages,
        user: data,
      });
    } catch (error) {
      console.log(error);
      res.json({
        messages,
        user: { _id: otherUserId, name: "Unknown User" },
      });
    }
  }
);
