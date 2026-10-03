import express from 'express';
import { requireRegistered } from '../lib/auth.js';
import { imageUpload } from '../lib/upload.js';

export const uploadRouter = express.Router();

/* 访客只读：连图片都不允许上传，闸门统一用 requireRegistered */
uploadRouter.post('/images', requireRegistered, imageUpload.array('files', 9), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '没有收到图片' });
  res.json({ urls: files.map((file) => `/uploads/images/${file.filename}`) });
});