import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export default s3Client;

// Function to generate presigned URL for single file upload (<15MB)
export const generateSingleUploadPresignedUrl = async (fileName: string, contentType: string): Promise<{ uploadUrl: string, key: string }> => {
  const bucketName = process.env.AWS_S3_BUCKET_NAME!;
  const key = `uploads/${uuidv4()}-${fileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

  return { uploadUrl, key };
};

// Function to initiate multipart upload
export const initiateMultipartUpload = async (fileName: string, contentType: string): Promise<{ uploadId: string, key: string }> => {
  const bucketName = process.env.AWS_S3_BUCKET_NAME!;
  const key = `uploads/${uuidv4()}-${fileName}`;

  const command = new CreateMultipartUploadCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });

  const response = await s3Client.send(command);

  return {
    uploadId: response.UploadId!,
    key,
  };
};

// Function to generate presigned URL for a part in multipart upload
export const generatePartPresignedUrl = async (key: string, uploadId: string, partNumber: number, contentType?: string): Promise<{ uploadUrl: string, partNumber: number }> => {
  const bucketName = process.env.AWS_S3_BUCKET_NAME!;

  const command = new UploadPartCommand({
    Bucket: bucketName,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  return { uploadUrl, partNumber };
};

// Function to complete multipart upload
export const completeMultipartUpload = async (key: string, uploadId: string, parts: Array<{ ETag: string, PartNumber: number }>): Promise<void> => {
  const bucketName = process.env.AWS_S3_BUCKET_NAME!;

  const command = new CompleteMultipartUploadCommand({
    Bucket: bucketName,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts,
    },
  });

  await s3Client.send(command);
};

// Function to generate presigned GET URL for viewing image
export const generateViewPresignedUrl = async (key: string): Promise<string> => {
  const bucketName = process.env.AWS_S3_BUCKET_NAME!;

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

  return url;
};
