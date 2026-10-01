import { randomInt, createHmac } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { z } from "zod";
import { env } from "../config/env.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { createTenantSchema } from "../validators/tenantValidators.js";
import { createTenant, generateTenantSlug } from "../services/tenantService.js";
import { User } from "../models/User.js";
import { Tenant } from "../models/Tenant.js";
import { runAsSystem } from "../tenancy/tenantContext.js";

const baseDetails = createTenantSchema.shape.body.omit({ temporaryPassword: true, plan: true });
const details = baseDetails.extend({
  slug: createTenantSchema.shape.body.shape.slug,
  industry: createTenantSchema.shape.body.shape.industry.unwrap(),
  companySize: createTenantSchema.shape.body.shape.companySize.unwrap(),
  country: createTenantSchema.shape.body.shape.country.unwrap(),
  referralSource: createTenantSchema.shape.body.shape.referralSource.unwrap(),
  primaryUseCase: createTenantSchema.shape.body.shape.primaryUseCase.unwrap(),
});

const verifyOtpSchema = z.object({
  body: z.object({
    registrationToken: z.string().min(20).max(4096),
    otp: z.string().trim().regex(/^\d{6}$/, "Verification code must be 6 digits"),
    password: createTenantSchema.shape.body.shape.temporaryPassword,
  }),
});

const finish = z.object({
  token: z.string().min(20).max(4096),
  password: createTenantSchema.shape.body.shape.temporaryPassword,
});

export const registrationRouter = Router();

registrationRouter.use(
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many registration attempts. Please try again in an hour." },
  })
);

registrationRouter.get(
  "/generate-slug",
  asyncHandler(async (request, response) => {
    const name = typeof request.query.name === "string" ? request.query.name : "organization";
    const slug = await generateTenantSlug(name);
    response.json({ success: true, data: { slug } });
  })
);

registrationRouter.post(
  "/request",
  validate(z.object({ body: details })),
  asyncHandler(async (request, response) => {
    const input = details.parse(request.body);

    if (await runAsSystem(() => User.collection.findOne({ email: input.adminEmail }, { projection: { _id: 1 } }))) throw new AppError("An account already uses this email. Sign in instead or use another email", 409, "EMAIL_EXISTS");
    
    let slug = input.slug?.trim().toLowerCase();
    if (slug) {
      if (await Tenant.exists({ slug })) {
        slug = await generateTenantSlug(input.name);
      }
    } else {
      slug = await generateTenantSlug(input.name);
    }

    // Generate a six-digit verification code.
    const otp = randomInt(100000, 1000000).toString();
    // The signed token is readable by its holder. A keyed digest prevents
    // recovering a six-digit code by enumerating its small search space.
    const otpHash = createHmac("sha256", env.JWT_ACCESS_SECRET).update(`${slug}:${input.adminEmail}:${otp}`).digest("hex");

    const registrationToken = jwt.sign(
      { ...input, slug, otpHash, purpose: "organization-registration-otp" },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "15m", audience: "organization-registration-otp", issuer: "mobius-ems" }
    );

    const host = process.env.MAIL_HOST || env.SMTP_HOST;
    const user = process.env.MAIL_USERNAME || env.SMTP_USER;
    const pass = process.env.MAIL_PASSWORD || env.SMTP_PASSWORD;
    const brevoConfigured = Boolean(env.EMAIL_AUTOMATION_ENABLED && env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL);

    const emailSubject = `Your MobiusEMS Verification Code: ${otp}`;
    const emailText = `Your MobiusEMS verification code is: ${otp}\n\nUse this 6-digit code to verify your email and complete registration for ${input.name}.\n\nThis code expires in 15 minutes. If you did not request this, please ignore this email.`;
    const emailHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;border:1px solid #e2e8f0;border-radius:16px;background-color:#ffffff">
      <div style="margin-bottom:20px">
        <span style="font-size:18px;font-weight:700;color:#0284c7">MobiusEMS</span>
      </div>
      <h1 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 12px">Organization Verification Code</h1>
      <p style="font-size:14px;color:#475569;margin:0 0 20px;line-height:1.5">
        Please enter the following 6-digit code to verify your email and complete registration for <strong>${input.name}</strong>:
      </p>
      <div style="background-color:#f1f5f9;border:1px solid #cbd5e1;border-radius:12px;padding:18px;text-align:center;margin:0 0 20px">
        <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#0f172a;font-family:monospace">${otp}</span>
      </div>
      <p style="font-size:13px;color:#64748b;margin:0 0 8px">
        This code expires in <strong>15 minutes</strong>. Do not share this code with anyone.
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0 16px" />
      <p style="font-size:12px;color:#94a3b8;margin:0">
        If you did not request this registration, you can safely ignore this email.
      </p>
    </div>`;

    // 1. Try SMTP if configured
    if (host && user && pass) {
      const port = Number(process.env.MAIL_PORT || env.SMTP_PORT || 587);
      const isSecure = port === 465;
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: isSecure,
        requireTLS: !isSecure,
        auth: { user, pass },
        connectionTimeout: 10000,
        socketTimeout: 20000,
      });

      try {
        await transport.sendMail({
          from: {
            name: process.env.MAIL_FROM_NAME || env.BREVO_SENDER_NAME || "MobiusEMS",
            address: process.env.MAIL_FROM_ADDRESS || user,
          },
          to: input.adminEmail,
          subject: emailSubject,
          text: emailText,
          html: emailHtml,
        });

        response.json({
          success: true,
          message: `Verification code sent to ${input.adminEmail}.`,
          data: {
            registrationToken,
            emailSent: true,
          },
        });
        return;
      } catch (err) {
        console.error("Failed to send SMTP OTP email:", err);
      } finally {
        transport.close();
      }
    }

    // 2. Try Brevo API if configured
    if (brevoConfigured) {
      try {
        const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "api-key": env.BREVO_API_KEY!,
          },
          body: JSON.stringify({
            sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL },
            to: [{ email: input.adminEmail, name: input.adminName }],
            subject: emailSubject,
            textContent: emailText,
            htmlContent: emailHtml,
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (brevoRes.ok) {
          response.json({
            success: true,
            message: `Verification code sent to ${input.adminEmail}.`,
            data: {
              registrationToken,
              emailSent: true,
            },
          });
          return;
        }

        console.error("Brevo registration OTP email error:", await brevoRes.text());
      } catch (err) {
        console.error("Brevo dispatch error:", err);
      }
    }

    // Never expose the verification code to an unverified production caller.
    if (env.NODE_ENV === "production") {
      throw new AppError("Verification email could not be sent. Please retry shortly or contact support.", 503, "EMAIL_DELIVERY_UNAVAILABLE");
    }
    response.json({
      success: true,
      message: "Email service is not configured on this server. Use the direct code provided below to complete registration.",
      data: {
        registrationToken,
        emailSent: false,
        directOtp: otp,
      },
    });
  })
);

registrationRouter.post(
  "/verify-otp",
  validate(verifyOtpSchema),
  asyncHandler(async (request, response) => {
    const { registrationToken, otp, password } = request.body;

    let payload: jwt.JwtPayload;
    try {
      const decoded = jwt.verify(registrationToken, env.JWT_ACCESS_SECRET, {
        algorithms: ["HS256"],
        audience: "organization-registration-otp",
        issuer: "mobius-ems",
      });
      if (typeof decoded === "string" || decoded.purpose !== "organization-registration-otp") {
        throw new Error();
      }
      payload = decoded;
    } catch {
      throw new AppError("Verification code is expired or invalid. Please request a new code.", 400);
    }

    const expectedHash = createHmac("sha256", env.JWT_ACCESS_SECRET).update(`${payload.slug}:${payload.adminEmail}:${otp.trim()}`).digest("hex");
    if (payload.otpHash !== expectedHash) {
      throw new AppError("Invalid verification code. Please check and try again.", 400);
    }

    const verified = details.extend({ slug: z.string() }).parse(payload);
    const tenant = await createTenant({ ...verified, plan: "STANDARD", temporaryPassword: password });

    response.status(201).json({
      success: true,
      message: "Organization created successfully! Sign in with your email and password.",
      data: { slug: tenant!.slug },
    });
  })
);

registrationRouter.post(
  "/complete",
  validate(z.object({ body: finish })),
  asyncHandler(async (request, response) => {
    const input = finish.parse(request.body);
    let verified;
    try {
      const payload = jwt.verify(input.token, env.JWT_ACCESS_SECRET, {
        algorithms: ["HS256"],
        audience: "organization-registration",
        issuer: "mobius-ems",
      });
      if (typeof payload === "string") throw new Error();
      verified = baseDetails.required({ slug: true }).parse(payload);
    } catch {
      throw new AppError("Verification link is invalid or expired. Please register again.", 400);
    }
    const tenant = await createTenant({ ...verified, plan: "STANDARD", temporaryPassword: input.password });
    response.status(201).json({
      success: true,
      message: "Organization created. Sign in with your email and password.",
      data: { slug: tenant!.slug },
    });
  })
);
