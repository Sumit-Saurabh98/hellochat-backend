import TryCatch from "../config/trycatch.js";
import type { AuthenticatedRequest } from "../middlewares/isAuth.js";
import axios from "axios";
import { type Response } from "express";
import Chat from "../models/Chat.js";
import Messages from "../models/Messages.js";
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

    // Validate contentType for images
    if (!contentType.startsWith("image/")) {
      res.status(400).json({
        message: "Only image files are allowed",
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

    if (!contentType.startsWith("image/")) {
      res.status(400).json({
        message: "Only image files are allowed",
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
    const { chatId, text, imageKey } = req.body;

    if (!senderId || !chatId) {
      res.status(400).json({
        message: "Please provide senderId",
      });
      return;
    }

    if (!text && !imageKey) {
      res.status(400).json({
        message: "Please provide text or image",
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
    };

    if (imageKey) {
      messageData.image = {
        key: imageKey,
      };
      messageData.messageType = "image";
      messageData.text = text || "";
    } else {
      messageData.text = text;
      messageData.messageType = "text";
    }

    const message = new Messages(messageData);

    const savedMessage = await message.save();

    const latestMessageText = imageKey ? "📷 Image" : text;

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

    // Generate presigned URLs for images
    const messages = await Promise.all(messagesRaw.map(async (msg) => {
      const msgObj = msg.toObject() as unknown as IMessageWithUrl;
      if (msgObj.messageType === "image" && msgObj.image?.key) {
        msgObj.image.url = await generateViewPresignedUrl(msgObj.image.key);
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
