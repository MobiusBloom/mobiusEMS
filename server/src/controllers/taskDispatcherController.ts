import type { Request, Response } from "express";
import * as service from "../services/taskDispatcherService.js";

const actor = (request: Request) => ({ id: request.user!.id, role: request.user!.role });

export const preview = async (request: Request, response: Response): Promise<void> => {
  response.status(201).json({ success: true, message: "Tasks extracted", data: await service.previewTaskImport({ text: request.body.text, file: request.file, project: request.body.project, mode: request.body.mode }, actor(request)) });
};

export const commit = async (request: Request, response: Response): Promise<void> => {
  response.status(201).json({ success: true, message: "Extracted tasks created", data: await service.commitTaskImport(String(request.params.id), request.body.items, actor(request)) });
};
