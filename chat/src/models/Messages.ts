import mongoose, {Document, Schema, Types} from "mongoose";

export interface IMessage extends Document{
    chatId: Types.ObjectId;
    sender: string;
    text?: string;
    image?: {
    key: string;
  };
  messageType: "text" | "image";
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
    messageType: {
      type: String,
      enum: ["text", "image"],
      default: "text",
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
