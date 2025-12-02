/**
 * Cloudflare R2 Storage Utilities
 * Centralized file upload and management for R2 storage
 * 
 * R2 is S3-compatible, so we use @aws-sdk/client-s3
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

/**
 * R2 Client Configuration
 * Uses S3-compatible API
 */
function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucketName = process.env.R2_BUCKET_NAME

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('Missing Cloudflare R2 configuration. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME in .env')
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  })
}

/**
 * Upload file to R2 storage
 * @param file - File to upload
 * @param filePath - Path in bucket (e.g., 'incidents/user-id/filename.jpg')
 * @param contentType - MIME type of the file
 * @returns Public URL of the uploaded file
 */
export async function uploadToR2(
  file: File | Buffer,
  filePath: string,
  contentType: string
): Promise<string> {
  const client = getR2Client()
  const bucketName = process.env.R2_BUCKET_NAME!

  // Convert File to Buffer if needed
  let buffer: Buffer
  if (file instanceof File) {
    const arrayBuffer = await file.arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
  } else {
    buffer = file
  }

  // Upload to R2
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: filePath,
    Body: buffer,
    ContentType: contentType,
    // Make file publicly accessible (if using public bucket)
    // Or use signed URLs for private buckets
  })

  await client.send(command)

  // Generate public URL
  // Use R2_PUBLIC_URL if configured, otherwise use default R2 URL
  const publicUrl = process.env.R2_PUBLIC_URL
  if (publicUrl) {
    // Use configured public URL
    return `${publicUrl}/${filePath}`
  } else {
    // Use default R2 public URL
    const accountId = process.env.R2_ACCOUNT_ID!
    return `https://${bucketName}.${accountId}.r2.dev/${filePath}`
  }
}

/**
 * Delete file from R2 storage
 * @param filePath - Path in bucket
 */
export async function deleteFromR2(filePath: string): Promise<void> {
  const client = getR2Client()
  const bucketName = process.env.R2_BUCKET_NAME!

  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: filePath,
  })

  await client.send(command)
}

/**
 * Get file from R2 storage
 * @param filePath - Path in bucket
 * @returns File buffer
 */
export async function getFromR2(filePath: string): Promise<Buffer> {
  const client = getR2Client()
  const bucketName = process.env.R2_BUCKET_NAME!

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: filePath,
  })

  const response = await client.send(command)
  
  if (!response.Body) {
    throw new Error('File not found in R2 storage')
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = []
  for await (const chunk of response.Body as any) {
    chunks.push(chunk)
  }
  
  return Buffer.concat(chunks)
}

/**
 * Generate unique file path for incident photos
 * @param userId - User ID
 * @param originalFileName - Original file name
 * @returns Unique file path
 */
export function generateIncidentPhotoPath(userId: string, originalFileName?: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const extension = originalFileName?.split('.').pop() || 'jpg'
  return `incidents/${userId}/${timestamp}-${random}.${extension}`
}

/**
 * Generate unique file path for profile images
 * @param userId - User ID
 * @param originalFileName - Original file name
 * @returns Unique file path
 */
export function generateProfileImagePath(userId: string, originalFileName?: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const extension = originalFileName?.split('.').pop() || 'jpg'
  return `profiles/${userId}/${timestamp}-${random}.${extension}`
}

