import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { postgres } from "../persistence/postgres.js";
import { AppError } from "../utils/AppError.js";
import { requireTenantId } from "../tenancy/tenantContext.js";

export interface StoredObject { provider: "CLOUDINARY" | "POSTGRESQL"; key: string; format?: string; size: number }

const configured = () => {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) throw new AppError("Private document storage is not configured", 503, "STORAGE_UNAVAILABLE");
  cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
};
const cloudinaryConfigured = () => Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

const uploadCloudinaryPrivate = async (buffer: Buffer, folder: string): Promise<StoredObject> => {
  configured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ resource_type: "raw", type: "authenticated", folder, public_id: randomUUID(), overwrite: false }, (error, result) => {
      if (error || !result) reject(new AppError("Document upload failed", 502, "STORAGE_UPLOAD_FAILED"));
      else resolve({ provider: "CLOUDINARY", key: result.public_id, format: result.format, size: result.bytes });
    });
    stream.end(buffer);
  });
};

export const signedPrivateUrl = (key: string): string => {
  configured();
  return cloudinary.url(key, { resource_type: "raw", type: "authenticated", sign_url: true, secure: true });
};

const uploadPostgresPrivate = async (buffer: Buffer, metadata: Record<string, string>): Promise<StoredObject> => {
  const key = new mongoose.Types.ObjectId().toString();
  const tenantId = requireTenantId().toString();
  await postgres.query(
    "INSERT INTO binary_objects (id, tenant_id, file_name, mime_type, category, metadata, content, size_bytes) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
    [key, tenantId, metadata.originalName ?? randomUUID(), metadata.mimeType ?? "application/octet-stream", metadata.category ?? "EMPLOYEE_DOCUMENT", JSON.stringify(metadata), buffer, buffer.length],
  );
  return { provider: "POSTGRESQL", key, size: buffer.length };
};

export const uploadPrivate = async (buffer: Buffer, folder: string, metadata: Record<string, string> = {}): Promise<StoredObject> => {
  const tenantId = requireTenantId().toString();
  if (cloudinaryConfigured()) {
    try { return await uploadCloudinaryPrivate(buffer, `${tenantId}/${folder}`); }
    catch (error) { if (!(error instanceof AppError) || error.code !== "STORAGE_UPLOAD_FAILED") throw error; }
  }
  return uploadPostgresPrivate(buffer, { ...metadata, folder, category: metadata.category ?? "EMPLOYEE_DOCUMENT" });
};

export const uploadProfilePhoto = async (buffer: Buffer, employeeId: string, mimeType: string): Promise<string> => {
  const tenantId = requireTenantId().toString();
  if (cloudinaryConfigured()) {
    configured();
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ resource_type: "image", type: "upload", folder: `${tenantId}/mobius-ems/${employeeId}/profile`, public_id: "avatar", overwrite: true, invalidate: true, transformation: [{ width: 600, height: 600, crop: "fill", gravity: "face", quality: "auto", fetch_format: "auto" }] }, (error, result) => {
        if (error || !result) reject(new AppError("Profile photo upload failed", 502, "PROFILE_PHOTO_UPLOAD_FAILED"));
        else resolve(result.public_id);
      });
      stream.end(buffer);
    });
  }
  const stored = await uploadPostgresPrivate(buffer, { fileName: `${employeeId}-${randomUUID()}`, mimeType, category: "PROFILE_PHOTO", employeeId });
  return `postgres:${stored.key}`;
};

export const profilePhotoUrl = (key?: string): string | undefined => {
  if (!key) return undefined;
  if (key.startsWith("postgres:")) return `/api/v1/employees/profile-photos/${key.slice(9)}`;
  if (!cloudinaryConfigured()) return undefined;
  configured();
  return cloudinary.url(key, { resource_type: "image", type: "upload", secure: true, transformation: [{ width: 240, height: 240, crop: "fill", gravity: "face", quality: "auto", fetch_format: "auto" }] });
};

export const deleteProfilePhoto = async (key?: string): Promise<void> => {
  if (!key) return;
  if (key.startsWith("postgres:")) {
    await postgres.query("DELETE FROM binary_objects WHERE id=$1 AND tenant_id=$2", [key.slice(9), requireTenantId().toString()]);
    return;
  }
  configured();
  const result = await cloudinary.uploader.destroy(key, { resource_type: "image", type: "upload", invalidate: true });
  if (!["ok", "not found"].includes(result.result)) throw new AppError("Profile photo could not be deleted", 502, "STORAGE_DELETE_FAILED");
};

export const uploadApplicantPrivate = async (buffer: Buffer, originalName: string, mimeType: string): Promise<StoredObject> => {
  const stored = await uploadPrivate(buffer, "mobius-ems/applicants", { originalName, mimeType, category: "APPLICANT_CV" });
  return stored.provider === "POSTGRESQL" ? { ...stored, format: path.extname(originalName).slice(1).toLowerCase() || undefined } : stored;
};

const readPostgresObject = async (key: string, category?: string) => {
  if (!mongoose.isValidObjectId(key)) return undefined;
  const values: unknown[] = [key, requireTenantId().toString()];
  const categorySql = category ? " AND category=$3" : "";
  if (category) values.push(category);
  const result = await postgres.query(`SELECT content, mime_type FROM binary_objects WHERE id=$1 AND tenant_id=$2${categorySql}`, values);
  return result.rows[0] as { content: Buffer; mime_type: string } | undefined;
};

export const openPostgresPrivate = async (key: string) => {
  const item = await readPostgresObject(key);
  if (!item) throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  return Readable.from(item.content);
};

export const deletePrivateObject = async (stored: Pick<StoredObject, "provider" | "key">): Promise<void> => {
  if (stored.provider === "POSTGRESQL") {
    const result = await postgres.query("DELETE FROM binary_objects WHERE id=$1 AND tenant_id=$2", [stored.key, requireTenantId().toString()]);
    if (!result.rowCount) throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    return;
  }
  configured();
  const result = await cloudinary.uploader.destroy(stored.key, { resource_type: "raw", type: "authenticated", invalidate: true });
  if (!["ok", "not found"].includes(result.result)) throw new AppError("Document could not be deleted from private storage", 502, "STORAGE_DELETE_FAILED");
};

export const openPostgresProfilePhoto = async (key: string) => {
  const item = await readPostgresObject(key, "PROFILE_PHOTO");
  if (!item) throw new AppError("Profile photo not found", 404, "PROFILE_PHOTO_NOT_FOUND");
  return { stream: Readable.from(item.content), mimeType: item.mime_type || "image/jpeg" };
};
