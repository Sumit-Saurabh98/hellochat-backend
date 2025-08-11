import dotenv from "dotenv";
dotenv.config();
import amqp from "amqplib";
import nodemailer from "nodemailer";

let channel: amqp.Channel;

const queueName = "hello-send-otp";
const retryQueue = `${queueName}-retry`;
const dlqName = `${queueName}-dlq`;

// Common queue options for main queue with DLQ configured
const mainQueueOptions = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": "",        // Default exchange
    "x-dead-letter-routing-key": dlqName // Route failed messages to DLQ
  }
};

// Retry queue options: after TTL, message returns to main queue
const retryQueueOptions = {
  durable: true,
  arguments: {
    "x-dead-letter-exchange": "",
    "x-dead-letter-routing-key": queueName,
    "x-message-ttl": 10000, // 10 sec retry delay
  }
};

// DLQ options: durable, with message TTL and queue expiration
const dlqOptions = {
  durable: true,
  arguments: {
    "x-message-ttl": 86400000,  // Messages expire after 24h
    "x-expires": 2592000000,    // Queue auto-delete after 30 days idle
  }
};

export const connectRabbitMQ = async () => {
  try {
    const connection = await amqp.connect({
      protocol: "amqp",
      hostname: process.env.RABBITMQ_HOST,
      port: 5672,
      username: process.env.RABBITMQ_USERNAME,
      password: process.env.RABBITMQ_PASSWORD,
    });

    channel = await connection.createChannel();

    // Assert all queues consistently with proper options
    await channel.assertQueue(dlqName, dlqOptions);
    await channel.assertQueue(retryQueue, retryQueueOptions);
    await channel.assertQueue(queueName, mainQueueOptions);

    console.log("RabbitMQ connected and queues asserted");
  } catch (error) {
    console.error("Failed to connect or assert queues", error);
  }
};

// export const publishToQueue = async (message: any) => {
//   if (!channel) {
//     console.error("RabbitMQ channel is not initialized");
//     return;
//   }

//   // Always assert queue with consistent options before publishing
//   await channel.assertQueue(queueName, mainQueueOptions);

//   channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
//     persistent: true,
//   });
// };

// Consumer for sending OTP emails with retry and DLQ handling
export const startSendOtpConsumer = async () => {
  if (!channel) {
    console.error("RabbitMQ channel is not initialized");
    return;
  }

  channel.consume(queueName, async (msg) => {
    if (!msg) return;

    if (!msg.properties.headers) {
      msg.properties.headers = {};
    }

    let retryCount = parseInt(msg.properties.headers["x-retry"] || "0", 10);

    try {
      const { to, subject, body } = JSON.parse(msg.content.toString());

      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_PASSWORD,
        },
      });

      await transporter.sendMail({
        from: "Hello Chat",
        to,
        subject,
        text: body,
      });

      console.log(`✅ OTP mail sent to ${to}`);
      channel.ack(msg);
    } catch (error) {
      retryCount++;

      if (retryCount >= 3) {
        console.error(`❌ Max retries reached for message. Sending to DLQ. Error:`, error);
        channel.nack(msg, false, false); // send to DLQ (requeue=false)
      } else {
        console.warn(`⚠️ Retry attempt ${retryCount} for message. Error:`, error);
        channel.sendToQueue(retryQueue, msg.content, {
          headers: { "x-retry": retryCount },
          persistent: true,
        });
        channel.ack(msg);
      }
    }
  });

  console.log("Consumer started, listening for messages...");
};
