import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as controller from "../controllers/authController.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { changePasswordSchema, loginSchema, requestPasswordResetSchema, resetPasswordSchema } from "../validators/authValidators.js";

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false, message: { success: false, message: "Too many sign-in attempts. Please try again later" } });
authRouter.post("/login", loginLimiter, validate(loginSchema), asyncHandler(controller.login));
authRouter.post("/forgot-password", rateLimit({ windowMs: 15 * 60 * 1000, limit: 3, standardHeaders: "draft-7", legacyHeaders: false, message: { success: false, message: "Too many password reset requests. Please wait 15 minutes before trying again." } }), validate(requestPasswordResetSchema), asyncHandler(controller.requestPasswordReset));
authRouter.post("/reset-password", validate(resetPasswordSchema), asyncHandler(controller.resetPassword));
authRouter.post("/refresh", asyncHandler(controller.refresh));
authRouter.post("/logout", asyncHandler(controller.logout));
authRouter.get("/me", authenticate, asyncHandler(controller.me));
authRouter.post("/change-password", authenticate, validate(changePasswordSchema), asyncHandler(controller.changePassword));
