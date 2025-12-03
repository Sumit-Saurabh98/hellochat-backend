import express from "express";
import { createNewChat, getAllChats, getMessagesByChat, sendMessage, getSingleUploadPresignedUrl, initiateMultipartUploadUrl, completeMultipartUploadHandler, getImageViewUrl } from "../controllers/chat.js";
import isAuth from "../middlewares/isAuth.js";

const router = express.Router();

router.post('/chat/new', isAuth, createNewChat)
router.get('/chat/all', isAuth, getAllChats)
router.post('/upload/single', isAuth, getSingleUploadPresignedUrl);
router.post('/upload/multipart/initiate', isAuth, initiateMultipartUploadUrl);
router.post('/upload/multipart/complete', isAuth, completeMultipartUploadHandler);
router.get('/image/view', isAuth, getImageViewUrl);
router.post('/message', isAuth, sendMessage);
router.get('/message/:chatId', isAuth, getMessagesByChat)

export default router;
