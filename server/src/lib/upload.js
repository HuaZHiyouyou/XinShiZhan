import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from '../db.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-wav', 'audio/flac']);

function storageFor(folder) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(UPLOAD_DIR, folder)),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  });
}

export const imageUpload = multer({
  storage: storageFor('images'),
  limits: { fileSize: 5 * 1024 * 1024, files: 9 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_TYPES.has(file.mimetype)) {
      cb(new Error('仅支持 jpg / png / webp / gif 图片'));
      return;
    }
    cb(null, true);
  },
});

export const audioUpload = multer({
  storage: storageFor('audio'),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!AUDIO_TYPES.has(file.mimetype)) {
      cb(new Error('仅支持 mp3 / wav / ogg / m4a / flac 音频'));
      return;
    }
    cb(null, true);
  },
});