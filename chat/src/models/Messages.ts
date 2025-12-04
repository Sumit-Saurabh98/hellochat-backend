import mongoose, {Document, Schema, Types} from "mongoose";

export interface IMessage extends Document{
    chatId: Types.ObjectId;
    sender: string;
    text?: string;
    image?: {
    key: string;
  };
    file?: {
      key: string;
      filename: string;
      fileType: string;
      fileSize: number;
    };
  messageType: "text" | "image" | "video" | "file";
  uploadStatus?: "pending" | "uploading" | "completed" | "failed";
  seen: boolean;
  seenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMessageWithUrl extends IMessage {
  image?: {
    key: string;
    url: string;
  };
}

const schema:Schema<IMessage> = new Schema({
    chatId: {type: Schema.Types.ObjectId, required: true},
    sender: {type: String, required: true},
    text: {type: String},
    image: {
        key: {type: String}
    },
    file: {
      key: {type: String},
      filename: {type: String},
      fileType: {type: String},
      fileSize: {type: Number},
    },
    messageType: {
      type: String,
      enum: ["text", "image", "video", "file"],
      default: "text",
    },
    uploadStatus: {
      type: String,
      enum: ["pending", "uploading", "completed", "failed"],
      default: null,
    },
    seen: {
      type: Boolean,
      default: false,
    },
    seenAt: {
      type: Date,
      default: null,
    },
}, {
    timestamps: true
})

export default mongoose.model<IMessage>("Message", schema);
